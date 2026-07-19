import WORDLIST from "./data/wordlist.json";

export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

const CEFR_ORDER: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

// Frequency-rank upper bounds (exclusive) mapping google-10000 rank to an
// approximate CEFR band. This is a pragmatic high-frequency proxy, NOT a
// certified CEFR list — good enough for coverage / known-word estimates.
const BAND_MAX_RANK: Record<CefrLevel, number> = {
  A1: 1000,
  A2: 2000,
  B1: 3500,
  B2: 5500,
  C1: 7500,
  C2: Number.POSITIVE_INFINITY,
};

const words = WORDLIST as string[];

const RANK = new Map<string, number>();
words.forEach((w, i) => {
  if (!RANK.has(w)) RANK.set(w, i);
});

const bandForRank = (rank: number): CefrLevel => {
  for (const level of CEFR_ORDER) {
    if (rank < BAND_MAX_RANK[level]) return level;
  }
  return "C2";
};

// All words at or below `level` (cumulative), i.e. every word whose rank is
// under that level's upper bound.
export const getKnownWordsForLevel = (level: CefrLevel): string[] => {
  const max = BAND_MAX_RANK[level];
  if (!Number.isFinite(max)) return [...words];
  return words.slice(0, max);
};

export const getWordLevel = (lemma: string): CefrLevel | null => {
  const rank = RANK.get(lemma.toLowerCase());
  return rank === undefined ? null : bandForRank(rank);
};
