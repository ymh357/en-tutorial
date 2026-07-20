import type { Card, MasteryLevel } from "./types";

export type Rating = 0 | 1 | 2 | 3;

export const ratingLabels: Record<Rating, string> = {
  0: "Again",
  1: "Hard",
  2: "Good",
  3: "Easy",
};

const MINIMUM_EASE = 1.3;
const LAPSE_FACTOR = 0.3;

// Mastered requires both: interval >= 30 days AND 3+ consecutive successful reviews
const computeMasteryLevel = (
  interval: number,
  repetitions: number,
  lapses: number
): MasteryLevel => {
  if (repetitions === 0 && lapses === 0) return "new";
  // A lapsed card sitting on a short interval is relearning, not brand-new.
  if (lapses > 0 && interval < 7) return "relearning";
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
  lapses: number;
  lapsedInterval?: number;
} => {
  let { easeFactor, interval, repetitions } = card;
  let lapses = card.lapses ?? 0;
  let lapsedInterval = card.lapsedInterval;
  const inRelearning = lapses > 0 && repetitions === 0;

  if (rating === 0) {
    // Again: enter/stay relearning. A lapse (and the pre-lapse interval
    // capture) only counts when failing a previously-graduated card
    // (repetitions > 0) — a brand-new or still-learning card that has never
    // graduated hasn't "lapsed" yet, so this keeps it out of the relearning
    // bucket. Repeated Agains while already in relearning (repetitions === 0)
    // don't add further lapses or overwrite the captured interval.
    if (repetitions > 0) {
      lapsedInterval = interval;
      lapses += 1;
    }
    repetitions = 0;
    interval = 0.0007; // ~1 minute in days
    easeFactor = Math.max(MINIMUM_EASE, easeFactor - 0.2);
  } else if (inRelearning && (rating === 2 || rating === 3)) {
    // Graduate from relearning: scale off the pre-lapse interval.
    const base = lapsedInterval ?? 1;
    const factor = rating === 3 ? LAPSE_FACTOR * 1.3 : LAPSE_FACTOR;
    interval = Math.max(1, Math.round(base * factor));
    easeFactor =
      rating === 3
        ? Math.max(MINIMUM_EASE, easeFactor + 0.15)
        : Math.max(MINIMUM_EASE, easeFactor + 0.05);
    repetitions = 1;
    lapsedInterval = undefined; // graduated; clear
  } else if (rating === 1) {
    // Hard: relearning → repeat ~10min step (stay reps 0); else reduce ease, ×1.2.
    easeFactor = Math.max(MINIMUM_EASE, easeFactor - 0.15);
    if (repetitions === 0) {
      interval = 0.007; // ~10 min (relearning/learning step, will re-queue)
    } else {
      interval = Math.max(1, interval * 1.2);
      repetitions += 1;
    }
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

  const masteryLevel = computeMasteryLevel(interval, repetitions, lapses);

  return { easeFactor, interval, repetitions, nextReview, masteryLevel, lapses, lapsedInterval };
};

export const getNextIntervals = (card: Card): Record<Rating, number> => {
  const results: Record<Rating, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const r of [0, 1, 2, 3] as Rating[]) {
    results[r] = computeNextReview(card, r).interval;
  }
  return results;
};
