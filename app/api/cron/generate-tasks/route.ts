import { put } from "@vercel/blob";
import { generateObject } from "ai";
import { qualityModel } from "@/lib/ai";
import { poolTaskSchemas } from "@/lib/ai-schemas";
import type { PoolTaskType } from "@/lib/types";

export const maxDuration = 300; // 5 min for batch generation

const DEFAULT_LEVEL = "B1"; // default level, can be made configurable later

const TASK_PROMPTS: Record<PoolTaskType, { system: string; prompt: string }> = {
  "listening-dictation": {
    system: "You are an English teacher. Return ONLY valid JSON.",
    prompt: `Generate 5 English sentences at ${DEFAULT_LEVEL} level for dictation practice. Return JSON: { "sentences": ["sentence1", "sentence2", ...] }`,
  },
  "listening-comprehension": {
    system: "You are an English teacher. Return ONLY valid JSON.",
    prompt: `Generate a 100-150 word English passage at ${DEFAULT_LEVEL} level with 3 multiple-choice comprehension questions. Return JSON: { "passage": "...", "topic": "brief topic description", "questions": [{ "question": "...", "options": ["A","B","C","D"], "correctIndex": 0 }] }`,
  },
  "listening-prediction": {
    system: "You are an English teacher. Return ONLY valid JSON.",
    prompt: `Generate a short English passage (3-4 sentences) at ${DEFAULT_LEVEL} level with a clear logical progression. Return JSON: { "firstHalf": "first 1-2 sentences", "secondHalf": "remaining", "topic": "brief topic" }`,
  },
  "translation-sentence": {
    system: "You are a Chinese-English translation teacher. Return ONLY valid JSON.",
    prompt: `Generate 5 Chinese sentences at ${DEFAULT_LEVEL} English level for translation practice. Return JSON: { "items": [{ "chinese": "...", "referenceTranslation": "...", "keyPoints": ["..."] }] }`,
  },
  "translation-paragraph": {
    system: "You are a Chinese-English translation teacher. Return ONLY valid JSON.",
    prompt: `Generate a 3-5 sentence Chinese paragraph for translation practice at ${DEFAULT_LEVEL} level. Return JSON: { "chinese": "...", "referenceTranslation": "...", "keyPoints": ["..."] }`,
  },
  "translation-situational": {
    system: "You are a Chinese-English translation teacher. Return ONLY valid JSON.",
    prompt: `Generate a situational Chinese-English translation task at ${DEFAULT_LEVEL} level (e.g. a short dialogue or real-world scenario). Return JSON: { "chinese": "...", "referenceTranslation": "...", "keyPoints": ["..."] }`,
  },
  "reading-article": {
    system: "You are an English teacher creating reading material. Return ONLY valid JSON.",
    prompt: `Generate a 300-500 word English article at ${DEFAULT_LEVEL} level on a random topic. Include a title. Return JSON: { "title": "...", "content": "...", "comprehensionQuestions": [{ "question": "...", "type": "main-idea" }] }`,
  },
  "writing-prompt": {
    system: "You are an English writing teacher. Return ONLY valid JSON.",
    prompt: `Generate a writing task at ${DEFAULT_LEVEL} level. Include the task type, prompt, target word count, and key phrases to practice. Return JSON: { "taskType": "email|essay|social|report", "prompt": "...", "targetWords": 150, "keyPhrases": ["..."], "scaffolding": "brief structure hint" }`,
  },
};

interface GeneratedTask {
  id: string;
  type: PoolTaskType;
  difficulty: string;
  content: Record<string, unknown>;
}

// Creative/open-ended types need variety across runs — generateObject's
// default temperature favors exact schema compliance over diversity, which
// would make every cron-generated writing prompt/article/scenario near-
// identical. Mirrors CREATIVE_TASK_TYPES in lib/task-pool-generate.ts (the
// client pool-gen path).
const CREATIVE_TASK_TYPES = new Set<PoolTaskType>([
  "writing-prompt",
  "reading-article",
  "translation-situational",
]);
const CREATIVE_TEMPERATURE = 0.7;

// reading-article targets a 300-500 word article; generateObject's default
// max output can truncate that, which throws and gets silently skipped by
// the catch below. Mirrors MAX_OUTPUT_TOKENS in lib/task-pool-generate.ts.
const MAX_OUTPUT_TOKENS: Partial<Record<PoolTaskType, number>> = {
  "reading-article": 8192,
};

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
  const level = DEFAULT_LEVEL;

  const tasks: GeneratedTask[] = [];

  for (const [type, { system, prompt }] of Object.entries(TASK_PROMPTS) as [
    PoolTaskType,
    { system: string; prompt: string },
  ][]) {
    try {
      // Server-side callers pass the zod schema straight to generateObject
      // (Standard Schema interface) — no JSON Schema transport step needed
      // here, unlike the client (lib/task-pool-generate.ts), which must
      // serialize the schema over `fetch` via toJsonSchema(). Sharing this
      // exact schema with the live consumers (wired up in B2) is what makes
      // cron-generated content match the shape the client actually expects —
      // e.g. listening-comprehension now always includes `topic`, closing
      // the drift where pool content silently failed client-side validation.
      //
      // This call is entirely server-side with no client involved, so
      // recordCost() (localStorage-backed, client-only — see
      // lib/cost-tracker.ts) cannot be invoked here: cron-generated content
      // cost is not counted in the client cost dashboard.
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

      tasks.push({
        id: crypto.randomUUID(),
        type,
        difficulty: level,
        content: object as Record<string, unknown>,
      });
    } catch (err) {
      console.warn(`[cron] failed to generate ${type}`, err);
      continue;
    }
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
