import { put } from "@vercel/blob";
import { generateObject } from "ai";
import { qualityModel } from "@/lib/ai";
import { poolTaskSchemas } from "@/lib/ai-schemas";
import { CREATIVE_TASK_TYPES, CREATIVE_TEMPERATURE, MAX_OUTPUT_TOKENS } from "@/lib/task-pool-generate";
import type { PoolTaskType } from "@/lib/types";

export const maxDuration = 300; // 5 min for batch generation

// CEFR levels the cron pre-generates for each task type. Covers the majority of
// learners; C1/C2 fall back to real-time generation with the user's studyLevel.
// Pre-generating a band (rather than a single hardcoded B1) fixes the level
// desync where any pool hit fed B1 content regardless of the learner's level.
const CRON_LEVELS = ["A2", "B1", "B2"] as const;

// Prompt builder per task type, parameterized by level (mirrors the client-side
// buildPrompt in lib/task-pool-generate.ts — kept in sync manually, plan risk C).
const buildCronPrompt = (
  type: PoolTaskType,
  level: string
): { system: string; prompt: string } => {
  const prompts: Record<PoolTaskType, { system: string; prompt: string }> = {
  "listening-dictation": {
    system: "You are an English teacher. Return ONLY valid JSON.",
    prompt: `Generate 5 English sentences at ${level} level for dictation practice. Return JSON: { "sentences": ["sentence1", "sentence2", ...] }`,
  },
  "listening-comprehension": {
    system: "You are an English teacher. Return ONLY valid JSON.",
    prompt: `Generate a 100-150 word English passage at ${level} level with 3 multiple-choice comprehension questions. Return JSON: { "passage": "...", "topic": "brief topic description", "questions": [{ "question": "...", "options": ["A","B","C","D"], "correctIndex": 0 }] }`,
  },
  "listening-prediction": {
    system: "You are an English teacher. Return ONLY valid JSON.",
    prompt: `Generate a short English passage (3-4 sentences) at ${level} level with a clear logical progression. Return JSON: { "firstHalf": "first 1-2 sentences", "secondHalf": "remaining", "topic": "brief topic" }`,
  },
  "listening-shadowing": {
    system:
      "You are an English pronunciation coach. Return ONLY valid JSON (no markdown fences, no explanation).",
    prompt: `Generate 5 short English sentences (5-10 words each) at ${level} level for shadowing practice. Pick a single concrete everyday topic. Return JSON: { "topic": "short topic", "context": "one sentence of scene/background a learner pictures before listening", "sentences": [{ "text": "English sentence", "translation": "Chinese translation", "imageryHint": "a brief cue to form the mental picture for this sentence, in Chinese" }] }`,
  },
  "translation-sentence": {
    system: "You are a Chinese-English translation teacher. Return ONLY valid JSON.",
    prompt: `Generate 5 Chinese sentences at ${level} English level for translation practice. Return JSON: { "items": [{ "chinese": "...", "referenceTranslation": "...", "keyPoints": ["..."] }] }`,
  },
  "translation-paragraph": {
    system: "You are a Chinese-English translation teacher. Return ONLY valid JSON.",
    prompt: `Generate a 3-5 sentence Chinese paragraph for translation practice at ${level} level. Return JSON: { "chinese": "...", "referenceTranslation": "...", "keyPoints": ["..."] }`,
  },
  "translation-situational": {
    system: "You are a Chinese-English translation teacher. Return ONLY valid JSON.",
    prompt: `Generate a situational Chinese-English translation task at ${level} level (e.g. a short dialogue or real-world scenario). Return JSON: { "chinese": "...", "referenceTranslation": "...", "keyPoints": ["..."] }`,
  },
  "reading-article": {
    system: "You are an English teacher creating reading material. Return ONLY valid JSON.",
    prompt: `Generate a 300-500 word English article at ${level} level on a random topic. Include a title. Return JSON: { "title": "...", "content": "...", "comprehensionQuestions": [{ "question": "...", "type": "main-idea" }] }`,
  },
  "writing-prompt": {
    system: "You are an English writing teacher. Return ONLY valid JSON.",
    prompt: `Generate a writing task at ${level} level. Include the task type, prompt, target word count, and key phrases to practice. Return JSON: { "taskType": "email|essay|social|report", "prompt": "...", "targetWords": 150, "keyPhrases": ["..."], "scaffolding": "brief structure hint" }`,
  },
  };
  return prompts[type];
};

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

  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  // Server-side callers pass the zod schema straight to generateObject
  // (Standard Schema interface) — no JSON Schema transport step needed here,
  // unlike the client. recordCost() is client-only so isn't invoked.
  const generateOne = async (
    type: PoolTaskType,
    level: string
  ): Promise<GeneratedTask | null> => {
    try {
      const { system, prompt } = buildCronPrompt(type, level);
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
        id: crypto.randomUUID(),
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
  const BATCH = 9;
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
