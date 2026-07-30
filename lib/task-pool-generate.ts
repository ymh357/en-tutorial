import { db } from "./db";
import type { PoolTaskType } from "./types";
import { assignTasks } from "./task-pool";
import { today } from "./date";
import { poolTaskSchemas, toJsonSchema } from "./ai-schemas";
import { recordCost } from "./cost-tracker";

// Creative/open-ended generators need variety across runs — the schema
// path's default temperature (0, see app/api/review/route.ts) favors exact
// compliance over diversity, which is right for data-extraction-shaped tasks
// but would make every generated writing prompt/article/scenario near-
// identical if left at 0.
export const CREATIVE_TASK_TYPES = new Set<PoolTaskType>([
  "writing-prompt",
  "reading-article",
  "translation-situational",
]);
export const CREATIVE_TEMPERATURE = 0.7;

// reading-article generates a full 300-500 word article via
// readerArticleGenSchema — the same schema and word-count target that
// app/reader/page.tsx sends with maxOutputTokens: 8192, because the schema
// path's default 4096 (see app/api/review/route.ts) truncates the article.
// Overflow makes generateObject throw, which the catch below silently
// swallows, so without this override the daily pool would quietly miss
// reading-article content. Other types keep the route's default.
export const MAX_OUTPUT_TOKENS: Partial<Record<PoolTaskType, number>> = {
  "reading-article": 8192,
};

const TASK_TYPES: PoolTaskType[] = [
  "listening-dictation",
  "listening-comprehension",
  "listening-prediction",
  "listening-shadowing",
  "translation-sentence",
  "translation-paragraph",
  "translation-situational",
  "reading-article",
  "writing-prompt",
];

export const buildPrompt = (
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
      prompt: `Generate a situational Chinese-English translation task at ${level} level. Return JSON: { "chinese": "...", "referenceTranslation": "...", "keyPoints": ["..."] }`,
    },
    "reading-article": {
      system: "You are an English teacher creating reading material. Return ONLY valid JSON.",
      prompt: `Generate a 300-500 word English article at ${level} level on a random topic. Include a title. Return JSON: { "title": "...", "content": "...", "comprehensionQuestions": [{ "question": "...", "type": "main-idea" }] }`,
    },
    "writing-prompt": {
      system: "You are an English writing teacher. Return ONLY valid JSON.",
      prompt: `Generate a writing task at ${level} level. Include the task type, prompt, target word count, and key phrases. Return JSON: { "taskType": "email", "prompt": "...", "targetWords": 150, "keyPhrases": ["..."], "scaffolding": "brief structure hint" }`,
    },
  };
  return prompts[type];
};

export const generatePoolTasks = async (
  level: string,
  count: number
): Promise<void> => {
  // Always generate all types so every module tab has pre-loaded content
  const typesToGenerate = TASK_TYPES;
  const todayStr = today();

  for (const type of typesToGenerate) {
    try {
      const { system, prompt } = buildPrompt(type, level);
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          system,
          schema: toJsonSchema(poolTaskSchemas[type]),
          ...(CREATIVE_TASK_TYPES.has(type)
            ? { temperature: CREATIVE_TEMPERATURE }
            : {}),
          ...(MAX_OUTPUT_TOKENS[type]
            ? { maxOutputTokens: MAX_OUTPUT_TOKENS[type] }
            : {}),
        }),
      });
      if (!res.ok) continue;

      const data = (await res.json()) as {
        object?: Record<string, unknown>;
        usage?: { inputTokens: number; outputTokens: number };
        model?: string;
      };
      if (!data.object) continue;

      if (data.usage && data.model) {
        recordCost({
          model: data.model,
          inputTokens: data.usage.inputTokens ?? 0,
          outputTokens: data.usage.outputTokens ?? 0,
          module: "pool",
        });
      }

      await db.poolTasks.add({
        id: crypto.randomUUID(),
        type,
        difficulty: level,
        content: data.object,
        assignedDate: todayStr,
        completed: false,
        createdAt: new Date(),
      });
    } catch {
      // Skip failed, continue
    }
  }

  await assignTasks();
};
