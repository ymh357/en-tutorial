// lib/date.ts
// Local-timezone date utilities. Single source for all "what day is it"
// logic, replacing four divergent copies across the app and removing the
// local/UTC split that made completions not register on the right day.

export const formatDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const today = (): string => formatDate(new Date());

// Parse "YYYY-MM-DD" as a LOCAL date. `new Date("YYYY-MM-DD")` parses as UTC,
// which is exactly the bug this utility removes.
export const parseDate = (s: string): Date => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};

// Week starts on Monday.
export const startOfWeek = (d: Date): Date => {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (date.getDay() + 6) % 7; // days since Monday
  date.setDate(date.getDate() - diff);
  return date;
};

// Whole-day difference (b - a), computed on local calendar days.
export const daysBetween = (a: Date, b: Date): number => {
  const msPerDay = 1000 * 60 * 60 * 24;
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db.getTime() - da.getTime()) / msPerDay);
};
