// lib/topics.ts
// Single source for topic taxonomy used by reader URL import, onboarding
// interest selection, and (W4-T3) video import. Replaces two divergent
// copies (app/reader TOPICS vs app/onboarding INTEREST_TOPICS) that had
// drifted — one had Environment, the other had Travel/Food/Music.

export const TOPICS: readonly string[] = [
  "Technology",
  "Business",
  "Science",
  "Culture",
  "Daily Life",
  "Health",
  "Education",
  "Environment",
  "Travel",
  "Food",
  "Music",
] as const;

export const DEFAULT_TOPIC: string = TOPICS[0];
