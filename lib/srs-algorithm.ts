import type { Card, MasteryLevel } from "./types";

export type Rating = 0 | 1 | 2 | 3;

export const ratingLabels: Record<Rating, string> = {
  0: "Again",
  1: "Hard",
  2: "Good",
  3: "Easy",
};

const MINIMUM_EASE = 1.3;

// Mastered requires both: interval >= 30 days AND 3+ consecutive successful reviews
const computeMasteryLevel = (
  interval: number,
  repetitions: number
): MasteryLevel => {
  if (repetitions === 0) return "new";
  if (interval < 7) return "learning";
  if (interval < 30) return "familiar";
  if (repetitions >= 3) return "mastered";
  return "familiar";
};

export const computeNextReview = (
  card: Card,
  rating: Rating
): {
  easeFactor: number;
  interval: number;
  repetitions: number;
  nextReview: Date;
  masteryLevel: MasteryLevel;
} => {
  let { easeFactor, interval, repetitions } = card;

  if (rating === 0) {
    repetitions = 0;
    interval = 0.0007; // ~1 minute in days
    easeFactor = Math.max(MINIMUM_EASE, easeFactor - 0.2);
  } else if (rating === 1) {
    // Hard: keep current interval, reduce ease
    easeFactor = Math.max(MINIMUM_EASE, easeFactor - 0.15);
    if (repetitions === 0) {
      interval = 0.007; // ~10 minutes
    } else {
      interval = Math.max(1, interval * 1.2);
    }
    repetitions += 1;
  } else if (rating === 2) {
    // Good: normal progression
    easeFactor = Math.max(MINIMUM_EASE, easeFactor - 0.05 + 0.1);
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 3;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetitions += 1;
  } else {
    // Easy: accelerated progression
    easeFactor = Math.max(MINIMUM_EASE, easeFactor + 0.15);
    if (repetitions === 0) {
      interval = 4;
    } else {
      interval = Math.round(interval * easeFactor * 1.3);
    }
    repetitions += 1;
  }

  const nextReview = new Date();
  nextReview.setTime(nextReview.getTime() + interval * 24 * 60 * 60 * 1000);

  const masteryLevel = computeMasteryLevel(interval, repetitions);

  return { easeFactor, interval, repetitions, nextReview, masteryLevel };
};

export const getNextIntervals = (card: Card): Record<Rating, number> => {
  const results: Record<Rating, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const r of [0, 1, 2, 3] as Rating[]) {
    results[r] = computeNextReview(card, r).interval;
  }
  return results;
};
