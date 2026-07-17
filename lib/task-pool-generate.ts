import { db } from "./db";
import type { PoolTaskType } from "./types";
import { assignTasks } from "./task-pool";

const TASK_TYPES: PoolTaskType[] = [
  "listening-dictation",
  "listening-comprehension",
  "listening-prediction",
  "translation-sentence",
  "translation-paragraph",
  "translation-situational",
  "reading-article",
  "writing-prompt",
];

const buildPrompt = (
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
      prompt: `Generate a 100-150 word English passage at ${level} level with 3 multiple-choice comprehension questions. Return JSON: { "passage": "...", "questions": [{ "question": "...", "options": ["A","B","C","D"], "correctIndex": 0 }] }`,
    },
    "listening-prediction": {
      system: "You are an English teacher. Return ONLY valid JSON.",
      prompt: `Generate a short English passage (3-4 sentences) at ${level} level with a clear logical progression. Return JSON: { "firstHalf": "first 1-2 sentences", "secondHalf": "remaining", "topic": "brief topic" }`,
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
  const typesToGenerate = TASK_TYPES.slice(0, Math.min(count, TASK_TYPES.length));
  const today = new Date().toISOString().split("T")[0];

  for (const type of typesToGenerate) {
    try {
      const { system, prompt } = buildPrompt(type, level);
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, system }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data.content) continue;

      let text = data.content.trim();
      const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fence) text = fence[1].trim();

      const content = JSON.parse(text) as Record<string, unknown>;
      await db.poolTasks.add({
        id: crypto.randomUUID(),
        type,
        difficulty: level,
        content,
        assignedDate: today,
        completed: false,
        createdAt: new Date(),
      });
    } catch {
      // Skip failed, continue
    }
  }

  await assignTasks();
};
