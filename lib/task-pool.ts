import { db } from "./db";
import type { PoolTask, PoolTaskType } from "./types";

const TASKS_PER_DAY = 6; // how many tasks per day
const MIN_POOL_DAYS = 3; // refill when less than 3 days of tasks remain
const POOL_TARGET_DAYS = 7; // generate up to 7 days ahead

const formatDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// Get today's assigned tasks (assigned + incomplete from past days carried forward)
export const getTodayTasks = async (): Promise<PoolTask[]> => {
  const today = formatDate(new Date());

  // Get overdue incomplete tasks (assigned to past dates)
  const overdue = await db.poolTasks
    .where("assignedDate")
    .below(today)
    .and((t) => !t.completed && t.assignedDate !== "")
    .toArray();

  // Get today's assigned tasks
  const todayTasks = await db.poolTasks
    .where("assignedDate")
    .equals(today)
    .toArray();

  // Overdue tasks come first (carry forward)
  return [...overdue, ...todayTasks];
};

// Assign tasks from the unassigned pool to upcoming days
export const assignTasks = async (): Promise<void> => {
  const today = new Date();

  for (let dayOffset = 0; dayOffset < POOL_TARGET_DAYS; dayOffset++) {
    const date = new Date(today);
    date.setDate(date.getDate() + dayOffset);
    const dateStr = formatDate(date);

    // Check if this day already has assigned tasks
    const existing = await db.poolTasks
      .where("assignedDate")
      .equals(dateStr)
      .count();

    if (existing >= TASKS_PER_DAY) continue;

    // Get unassigned tasks
    const needed = TASKS_PER_DAY - existing;
    const unassigned = await db.poolTasks
      .where("assignedDate")
      .equals("") // Dexie can't query null, use empty string
      .limit(needed)
      .toArray();

    // Assign them to this day
    for (const task of unassigned) {
      await db.poolTasks.update(task.id, { assignedDate: dateStr });
    }
  }
};

// Check how many unassigned tasks remain
export const getPoolStatus = async (): Promise<{
  unassigned: number;
  todayTotal: number;
  todayCompleted: number;
  needsRefill: boolean;
}> => {
  const unassigned = await db.poolTasks
    .where("assignedDate")
    .equals("")
    .count();

  const todayTasks = await getTodayTasks();
  const todayCompleted = todayTasks.filter((t) => t.completed).length;

  return {
    unassigned,
    todayTotal: todayTasks.length,
    todayCompleted,
    needsRefill: unassigned < TASKS_PER_DAY * MIN_POOL_DAYS,
  };
};

// Mark a task as completed
export const completeTask = async (taskId: string): Promise<void> => {
  await db.poolTasks.update(taskId, { completed: true });
};

// Generate tasks by calling AI for content
export const generatePoolTasks = async (
  cefrLevel: string,
  count: number,
  onProgress?: (done: number, total: number) => void
): Promise<void> => {
  // Distribute across types
  const types: PoolTaskType[] = [
    "listening-dictation",
    "listening-comprehension",
    "listening-prediction",
    "translation-sentence",
    "translation-paragraph",
    "reading-article",
    "writing-prompt",
  ];

  const tasksPerType = Math.ceil(count / types.length);
  let generated = 0;

  for (const type of types) {
    for (let i = 0; i < tasksPerType && generated < count; i++) {
      try {
        const content = await generateContentForType(type, cefrLevel);
        if (content) {
          await db.poolTasks.add({
            id: crypto.randomUUID(),
            type,
            difficulty: cefrLevel,
            content,
            assignedDate: "", // unassigned, use empty string
            completed: false,
            createdAt: new Date(),
          });
          generated++;
          onProgress?.(generated, count);
        }
      } catch {
        // Skip failed generations, continue with next
      }
    }
  }

  // After generating, assign to upcoming days
  await assignTasks();
};

async function generateContentForType(
  type: PoolTaskType,
  level: string
): Promise<Record<string, unknown> | null> {
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

  const config = prompts[type];

  const res = await fetch("/api/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: config.prompt, system: config.system }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  if (!data.content) return null;

  try {
    let text = data.content.trim();
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) text = fenceMatch[1].trim();
    return JSON.parse(text);
  } catch {
    return null;
  }
}
