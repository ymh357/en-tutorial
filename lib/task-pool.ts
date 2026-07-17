import { db } from "./db";
import type { PoolTask } from "./types";

const TASKS_PER_DAY = 6; // how many tasks per day
const POOL_TARGET_DAYS = 7; // assign up to 7 days ahead

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

// Mark a task as completed
export const completeTask = async (taskId: string): Promise<void> => {
  await db.poolTasks.update(taskId, { completed: true });
};
