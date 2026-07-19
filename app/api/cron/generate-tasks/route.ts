import { put } from "@vercel/blob";
import { generateText } from "ai";
import { qualityModel } from "@/lib/ai";
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
    prompt: `Generate a 100-150 word English passage at ${DEFAULT_LEVEL} level with 3 multiple-choice comprehension questions. Return JSON: { "passage": "...", "questions": [{ "question": "...", "options": ["A","B","C","D"], "correctIndex": 0 }] }`,
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

const parseJsonContent = (text: string): Record<string, unknown> | null => {
  try {
    let cleaned = text.trim();
    const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) cleaned = fence[1].trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
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
      const result = await generateText({
        model: qualityModel,
        system,
        prompt,
      });

      const content = parseJsonContent(result.text);
      if (!content) continue;

      tasks.push({ id: crypto.randomUUID(), type, difficulty: level, content });
    } catch {
      // Skip failed generations, continue with next type
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
