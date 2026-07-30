import { db } from "./db";
import type { PoolTask, PoolTaskType } from "./types";
import { formatDate, today } from "./date";

const TASKS_PER_DAY = 6; // how many tasks per day
const POOL_TARGET_DAYS = 7; // assign up to 7 days ahead

// Get today's assigned tasks (assigned + incomplete from past days carried forward)
export const getTodayTasks = async (): Promise<PoolTask[]> => {
  const todayStr = today();

  // Get overdue incomplete tasks (assigned to past dates)
  const overdue = await db.poolTasks
    .where("assignedDate")
    .below(todayStr)
    .and((t) => !t.completed && t.assignedDate !== "")
    .toArray();

  // Get today's assigned tasks
  const todayTasks = await db.poolTasks
    .where("assignedDate")
    .equals(todayStr)
    .toArray();

  // Overdue tasks come first (carry forward)
  return [...overdue, ...todayTasks];
};

// Assign tasks from the unassigned pool to upcoming days
export const assignTasks = async (): Promise<void> => {
  const now = new Date();

  for (let dayOffset = 0; dayOffset < POOL_TARGET_DAYS; dayOffset++) {
    const date = new Date(now);
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

// Check today's local task counts (generation now happens server-side via cron)
export const getPoolStatus = async (): Promise<{
  todayTotal: number;
  todayCompleted: number;
}> => {
  const todayTasks = await getTodayTasks();
  const todayCompleted = todayTasks.filter((t) => t.completed).length;

  return {
    todayTotal: todayTasks.length,
    todayCompleted,
  };
};

// Mark a task as consumed. Methodology (W3): a consumed task isn't discarded
// — it records exposure so the same material can resurface across scenes
// (alternating repetition) rather than being a one-shot. `completed` stays
// true for compatibility with existing queries, but exposureCount/lastSeen*
// let a reactivation pass revive low-exposure items when the pool runs dry.
export const completeTask = async (
  taskId: string,
  seenIn?: string
): Promise<void> => {
  const task = await db.poolTasks.get(taskId);
  if (!task) return;
  await db.poolTasks.update(taskId, {
    completed: true,
    exposureCount: (task.exposureCount ?? 0) + 1,
    lastSeenAt: new Date(),
    lastSeenIn: seenIn ?? task.lastSeenIn,
  });
};

// Alternating-repetition (methodology W3): when a task type has no fresh
// incomplete items, revive a previously-seen one so the same material resurfaces
// in a new session instead of being discarded. Picks the completed item with
// the lowest exposureCount that hasn't been seen within `minIntervalMs`, and
// reactivates it (completed=false). Returns the reactivated task or null when
// nothing is eligible. Callers fall back to real-time generation on null.
export const getReusableTask = async (
  type: PoolTaskType,
  minIntervalMs = 6 * 60 * 60 * 1000 // 6h: don't immediately redo what was just done
): Promise<PoolTask | null> => {
  const cutoff = new Date(Date.now() - minIntervalMs);
  const candidates = await db.poolTasks
    .where("type")
    .equals(type)
    .and((t) => t.completed && (!t.lastSeenAt || t.lastSeenAt < cutoff))
    .toArray();
  if (candidates.length === 0) return null;
  // Lowest exposure first — spread repetitions across the corpus.
  candidates.sort(
    (a, b) => (a.exposureCount ?? 0) - (b.exposureCount ?? 0)
  );
  const chosen = candidates[0];
  await db.poolTasks.update(chosen.id, {
    completed: false,
    assignedDate: today(),
  });
  return { ...chosen, completed: false, assignedDate: today() };
};
