// lib/backup.ts
// Full local-data backup: all Dexie tables + whitelisted en-tutor-* localStorage
// keys → one versioned JSON. Import clears+bulkPuts each table in a transaction
// and revives ISO date strings back into Date objects so Dexie's date indexes
// (createdAt / nextReview) keep working.
import { db } from "./db";

const SCHEMA_VERSION = 4;

// Static localStorage keys worth backing up (skip regenerable/derived ones).
const LOCAL_STATIC_KEYS = [
  "en-tutor-app",
  "en-tutor-daily-goal",
  "en-tutor-dict-history",
  "en-tutor-cost-records",
  "en-tutor-last-pool-gen",
];
// Per-id dynamic key prefixes to include.
const LOCAL_KEY_PREFIXES = [
  "en-tutor-reading-questions-",
  "en-tutor-writing-draft-",
];

// Table name → dotted paths that hold Date values (revived on import).
// Array element paths use "field[].subfield".
const DATE_PATHS: Record<string, string[]> = {
  cards: ["nextReview", "createdAt", "lastReviewedAt"],
  conversations: ["createdAt", "messages[].timestamp"],
  readingSessions: ["createdAt"],
  writingSessions: ["createdAt"],
  learningProfile: ["milestones[].earnedAt"],
  dailyStats: [],
  listeningExercises: ["createdAt"],
  translationExercises: ["createdAt"],
  poolTasks: ["createdAt"],
  assessments: [], // date is a "YYYY-MM-DD" string, not a Date
};

const TABLES = Object.keys(DATE_PATHS);

export interface BackupFile {
  schemaVersion: number;
  exportedAt: string;
  tables: Record<string, unknown[]>;
  localStorage: Record<string, string>;
}

const table = (name: string) =>
  (db as unknown as Record<string, { toArray: () => Promise<unknown[]>; clear: () => Promise<void>; bulkPut: (r: unknown[]) => Promise<unknown> }>)[name];

export const exportBackup = async (): Promise<BackupFile> => {
  const tables: Record<string, unknown[]> = {};
  for (const name of TABLES) {
    tables[name] = await table(name).toArray();
  }
  const ls: Record<string, string> = {};
  if (typeof window !== "undefined") {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      const keep =
        LOCAL_STATIC_KEYS.includes(key) ||
        LOCAL_KEY_PREFIXES.some((p) => key.startsWith(p));
      if (keep) ls[key] = window.localStorage.getItem(key) ?? "";
    }
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    tables,
    localStorage: ls,
  };
};

export const downloadBackup = async (): Promise<void> => {
  const backup = await exportBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `entutor-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

// Revive one dotted date path in-place on a row.
const reviveOne = (row: Record<string, unknown>, path: string): void => {
  const arrayMatch = path.match(/^(.+)\[\]\.(.+)$/);
  if (arrayMatch) {
    const [, field, sub] = arrayMatch;
    const arr = row[field];
    if (Array.isArray(arr)) {
      for (const el of arr) {
        if (el && typeof el === "object" && (el as Record<string, unknown>)[sub] != null) {
          (el as Record<string, unknown>)[sub] = new Date((el as Record<string, unknown>)[sub] as string);
        }
      }
    }
    return;
  }
  if (row[path] != null) row[path] = new Date(row[path] as string);
};

const reviveDates = (name: string, rows: unknown[]): unknown[] => {
  const paths = DATE_PATHS[name] ?? [];
  if (paths.length === 0) return rows;
  for (const row of rows) {
    if (row && typeof row === "object") {
      for (const p of paths) reviveOne(row as Record<string, unknown>, p);
    }
  }
  return rows;
};

export const importBackup = async (file: File): Promise<void> => {
  const parsed = JSON.parse(await file.text()) as BackupFile;
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Incompatible backup (version ${parsed.schemaVersion}, this app expects ${SCHEMA_VERSION}).`
    );
  }
  await db.transaction("rw", db.tables, async () => {
    for (const name of TABLES) {
      const rows = parsed.tables?.[name];
      if (!Array.isArray(rows)) continue;
      await table(name).clear();
      await table(name).bulkPut(reviveDates(name, rows));
    }
  });
  if (typeof window !== "undefined" && parsed.localStorage) {
    for (const [k, v] of Object.entries(parsed.localStorage)) {
      window.localStorage.setItem(k, v);
    }
  }
};
