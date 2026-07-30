import { put } from "@vercel/blob";
import { generateObject } from "ai";
import { qualityModel } from "@/lib/ai";
import { poolTaskSchemas } from "@/lib/ai-schemas";
import { CREATIVE_TASK_TYPES, CREATIVE_TEMPERATURE, MAX_OUTPUT_TOKENS, buildPrompt } from "@/lib/task-pool-generate";
import { today as todayDate } from "@/lib/date";
import type { PoolTaskType } from "@/lib/types";

export const maxDuration = 300; // 5 min for batch generation

// CEFR levels the cron pre-generates for each task type. Covers the majority of
// learners; C1/C2 fall back to real-time generation with the user's studyLevel.
// Pre-generating a band (rather than a single hardcoded B1) fixes the level
// desync where any pool hit fed B1 content regardless of the learner's level.
const CRON_LEVELS = ["A2", "B1", "B2"] as const;


interface GeneratedTask {
  id: string;
  type: PoolTaskType;
  difficulty: string;
  content: Record<string, unknown>;
}


export const GET = async (req: Request): Promise<Response> => {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    // Reject when the secret is not configured so an unset env var cannot be
    // bypassed via a literal "Bearer undefined" authorization header.
    return Response.json({ error: "Server misconfigured" }, { status: 500 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Use the shared local-timezone today() so blob paths match the client's
  // notion of "today" (server runs with TZ=Asia/Shanghai). The old
  // toISOString().split("T")[0] used UTC and drifted from the client for non-
  // UTC users (review W3 #2).
  const today = todayDate();

  // Server-side callers pass the zod schema straight to generateObject
  // (Standard Schema interface) — no JSON Schema transport step needed here,
  // unlike the client. recordCost() is client-only so isn't invoked.
  const generateOne = async (
    type: PoolTaskType,
    level: string
  ): Promise<GeneratedTask | null> => {
    try {
      const { system, prompt } = buildPrompt(type, level);
      const { object } = await generateObject({
        model: qualityModel,
        schema: poolTaskSchemas[type],
        system,
        prompt,
        ...(CREATIVE_TASK_TYPES.has(type)
          ? { temperature: CREATIVE_TEMPERATURE }
          : {}),
        ...(MAX_OUTPUT_TOKENS[type]
          ? { maxOutputTokens: MAX_OUTPUT_TOKENS[type] }
          : {}),
      });
      return {
        // Deterministic id per type+level+day so a same-day cron re-run
        // overwrites the blob without spawning duplicate rows on the client
        // (review W3 #7 — existingById can match and preserve completed/createdAt).
        id: `${type}-${level}-${today}`,
        type,
        difficulty: level,
        content: object as Record<string, unknown>,
      };
    } catch (err) {
      console.warn(`[cron] failed to generate ${type} @ ${level}`, err);
      return null;
    }
  };

  // Build the type×level work list and run it in bounded-concurrency batches so
  // 27 generations finish within maxDuration without bursting the provider.
  const work: Array<[PoolTaskType, string]> = [];
  for (const type of Object.keys(poolTaskSchemas) as PoolTaskType[]) {
    for (const level of CRON_LEVELS) {
      work.push([type, level]);
    }
  }
  // Bounded concurrency: 4 at a time keeps 0G rate limits happy across the
  // 27 type×level runs (review W3 #5). 7 batches × slowest-in-batch still
  // fits maxDuration=300s.
  const BATCH = 4;
  const tasks: GeneratedTask[] = [];
  for (let i = 0; i < work.length; i += BATCH) {
    const slice = work.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map(([type, level]) => generateOne(type, level))
    );
    for (const r of results) if (r) tasks.push(r);
  }

  const blob = await put(`tasks/${today}.json`, JSON.stringify(tasks), {
    access: "public",
    contentType: "application/json",
    allowOverwrite: true, // deterministic per-day path; allow same-day re-runs to be idempotent
  });

  return Response.json({
    generated: tasks.length,
    date: today,
    url: blob.url,
  });
};
