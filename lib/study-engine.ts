import type { DailyStats, LearningProfile } from "./types";
import { daysBetween } from "./date";

export type StudyStepType =
  | "srs"
  | "conversation"
  | "reading"
  | "writing"
  | "listening"
  | "translate";

export type StepGranularity = "fine" | "medium" | "coarse";

export interface StudyStep {
  type: StudyStepType;
  title: string;
  description: string;
  estimatedMinutes: number;
  href: string;
  priority: number; // higher = more important
  reason: string; // why this step was chosen
}

export interface GenerateStudyPlanOptions {
  dueCards: number;
  lastConversation: Date | null;
  lastReading: Date | null;
  lastWriting: Date | null;
  lastListening?: Date | null;
  lastTranslation?: Date | null;
  profile: LearningProfile;
  todayStats: DailyStats;
  targetMinutes?: number;
}

const DEFAULT_TARGET_MINUTES = 20;
const MAX_STEP_TYPES = 3;
const ROTATE_AFTER_DAYS = 0; // "did it yesterday" -> gap < 1 day counts as done recently
const TRANSLATION_STALE_DAYS = 2;

const SRS_MINUTES_PER_CARD = 1 / 3; // 1 min per 3 cards
const SRS_MAX_MINUTES = 5;
const CONVERSATION_MINUTES = 8;
const READING_MINUTES = 7;
const WRITING_MINUTES = 8;
const LISTENING_MINUTES = 7;
const TRANSLATION_MINUTES = 5;

// Days-since-last-practice sentinel for activities never done. Large enough
// to always win the "longest gap" comparison without needing Infinity math.
const NEVER_DONE_GAP = 999;

const daysSince = (date: Date | null | undefined): number => {
  if (!date) return NEVER_DONE_GAP;
  if (Number.isNaN(date.getTime())) return NEVER_DONE_GAP; // corrupt lastDate
  return Math.max(0, daysBetween(date, new Date()));
};

const srsMinutes = (count: number): number => {
  if (count <= 0) return 0;
  return Math.min(SRS_MAX_MINUTES, Math.max(1, Math.round(count * SRS_MINUTES_PER_CARD)));
};

// Map a CEFR level to practice-step granularity (methodology: level decides
// step fineness). A1-A2 → fine (forced context, slow default, auto-chunk),
// B1-B2 → medium, C1-C2 → coarse (skip hand-holding, native speed).
// Falls back to "medium" when the level is absent/unrecognized rather than
// guessing fine/coarse. Exported so module UIs (e.g. listening) can derive the
// same granularity locally from the profile.
export const granularityForLevel = (level: string | undefined): StepGranularity => {
  switch (level) {
    case "A1":
    case "A2":
      return "fine";
    case "B1":
    case "B2":
      return "medium";
    case "C1":
    case "C2":
      return "coarse";
    default:
      return "medium";
  }
};

interface RotationCandidate {
  type: Exclude<StudyStepType, "srs" | "translate">;
  gapDays: number;
  minutes: number;
  title: string;
  description: string;
  href: string;
}

/**
 * Pure function: given today's signals, produce a prioritized, time-boxed
 * study plan. No side effects, no I/O — callers are responsible for fetching
 * the inputs (due cards, last-activity dates, profile, today's stats).
 */
export const generateStudyPlan = (
  opts: GenerateStudyPlanOptions
): StudyStep[] => {
  const {
    dueCards,
    lastConversation,
    lastReading,
    lastWriting,
    lastListening = null,
    lastTranslation = null,
    todayStats,
  } = opts;
  const targetMinutes = opts.targetMinutes ?? DEFAULT_TARGET_MINUTES;
  // Fluency track (default): SRS is one activity among many, not the
  // always-first never-dropped gate. Mastery track keeps the classic SRS-first
  // behavior. methodology: don't let review backlog dominate the fluency path.
  const srsFirst = opts.profile?.primaryTrack === "mastery";

  const steps: StudyStep[] = [];

  // Rule 1: SRS review. On the mastery track it's always first (priority 100);
  // on the fluency track (default) it's just another rotation candidate so the
  // review backlog can't crowd out listening/reading practice.
  if (dueCards > 0) {
    steps.push({
      type: "srs",
      title: `Review ${dueCards} card${dueCards === 1 ? "" : "s"}`,
      description: "Spaced repetition review",
      estimatedMinutes: srsMinutes(dueCards),
      href: "/srs",
      priority: srsFirst ? 100 : 50,
      reason: srsFirst
        ? "You have overdue cards — spaced repetition breaks if reviews are skipped, so this comes first."
        : "You have cards due for review.",
    });
  }

  // Rule 5: translation warm-up if it's been 2+ days (or never done).
  const translationGap = daysSince(lastTranslation);
  const includeTranslation = translationGap >= TRANSLATION_STALE_DAYS;

  // Rule 2/4: pick the activity with the longest gap since last practice,
  // rotating away from whatever was done "yesterday" (gap <= ROTATE_AFTER_DAYS).
  const candidates: RotationCandidate[] = [
    {
      type: "conversation",
      gapDays: daysSince(lastConversation),
      minutes: CONVERSATION_MINUTES,
      title: "Practice a conversation",
      description: "Speak with an AI conversation partner",
      href: "/conversation",
    },
    {
      type: "reading",
      gapDays: daysSince(lastReading),
      minutes: READING_MINUTES,
      title: "Read an article",
      description: "Build vocabulary through reading",
      href: "/reader",
    },
    {
      type: "writing",
      gapDays: daysSince(lastWriting),
      minutes: WRITING_MINUTES,
      title: "Write something",
      description: "Get instant feedback on your writing",
      href: "/writing",
    },
    {
      type: "listening",
      gapDays: daysSince(lastListening),
      minutes: LISTENING_MINUTES,
      title: "Listening practice",
      description: "Train your ear with audio exercises",
      href: "/listening",
    },
  ];

  // Rotation: if the most-recent activity was done today or yesterday,
  // deprioritize it in favor of the others (rule 4).
  const rotationSorted = [...candidates].sort((a, b) => {
    // Activities not touched recently (bigger gap) rank first.
    if (b.gapDays !== a.gapDays) return b.gapDays - a.gapDays;
    return 0;
  });

  const recentlyDoneTypes = new Set(
    candidates
      .filter((c) => c.gapDays <= ROTATE_AFTER_DAYS)
      .map((c) => c.type)
  );

  // Prefer candidates not done very recently; fall back to the full list
  // (sorted by gap) if everything was touched recently.
  const rotated = [
    ...rotationSorted.filter((c) => !recentlyDoneTypes.has(c.type)),
    ...rotationSorted.filter((c) => recentlyDoneTypes.has(c.type)),
  ];

  const doneTodayCount: Record<Exclude<StudyStepType, "srs" | "translate">, number> = {
    conversation: todayStats.conversationCount,
    reading: todayStats.readingCount,
    writing: todayStats.writingCount,
    listening: todayStats.listeningCount,
  };

  for (const candidate of rotated) {
    // Already done today — skip so we don't pile up redundant suggestions.
    if (doneTodayCount[candidate.type] > 0) continue;

    const isNeverDone = candidate.gapDays >= NEVER_DONE_GAP;
    const reason = isNeverDone
      ? `You haven't tried ${candidate.type} yet — let's start.`
      : candidate.gapDays >= 1
        ? `You haven't practiced ${candidate.type} in ${candidate.gapDays} day${candidate.gapDays === 1 ? "" : "s"}.`
        : `Keep your ${candidate.type} streak going.`;

    steps.push({
      type: candidate.type,
      title: candidate.title,
      description: candidate.description,
      estimatedMinutes: candidate.minutes,
      href: candidate.href,
      priority: 50 + candidate.gapDays, // longer gap => higher priority
      reason,
    });
  }

  if (includeTranslation) {
    steps.push({
      type: "translate",
      title: "Translation warm-up",
      description: "Quick translation keeps skills sharp",
      estimatedMinutes: TRANSLATION_MINUTES,
      href: "/translate",
      priority: translationGap >= NEVER_DONE_GAP ? 40 : 30,
      reason:
        translationGap >= NEVER_DONE_GAP
          ? "You haven't done a translation warm-up yet."
          : `It's been ${translationGap} days since your last translation warm-up.`,
    });
  }

  // Sort by priority. Mastery track: SRS (100) wins. Fluency track: SRS (50)
  // competes with rotation candidates (50 + gapDays), so a long-unpracticed
  // skill can come first instead.
  steps.sort((a, b) => b.priority - a.priority);

  // Rule 3: never schedule more than 3 distinct activity types per session.
  const limited: StudyStep[] = [];
  const seenTypes = new Set<StudyStepType>();
  for (const step of steps) {
    if (limited.length >= MAX_STEP_TYPES) break;
    if (seenTypes.has(step.type)) continue;
    seenTypes.add(step.type);
    limited.push(step);
  }

  // Rule 6: trim to stay within the target time budget where possible.
  // Mastery track: SRS is non-negotiable, always kept. Fluency track: SRS is
  // trimmable like anything else — the review backlog shouldn't override the
  // user's practice mix.
  let totalMinutes = limited.reduce((sum, s) => sum + s.estimatedMinutes, 0);
  const trimmed = [...limited];
  while (trimmed.length > 1 && totalMinutes > targetMinutes) {
    const last = trimmed[trimmed.length - 1];
    if (srsFirst && last.type === "srs") break; // mastery: never drop SRS
    trimmed.pop();
    totalMinutes -= last.estimatedMinutes;
  }

  return trimmed;
};
