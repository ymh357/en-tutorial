"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import {
  Brain,
  MessageSquare,
  BookOpen,
  PenLine,
  Headphones,
  Languages,
  Flame,
  Trophy,
  Sparkles,
  CheckCircle2,
  Circle,
  TrendingUp,
  Coins,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { db } from "@/lib/db";
import { dbHelpers } from "@/lib/db-helpers";
import {
  useProfile,
  useSessionQueue,
  useVocabCounts,
  useTodayStats,
  useStatsRange,
  useConversations,
  useReadingSessions,
  useWritingSessions,
  useListeningExercises,
  useTranslationExercises,
} from "@/hooks/use-db";
import { generateStudyPlan, type StudyStep, type StudyStepType } from "@/lib/study-engine";
import { getCostSummary, type CostSummary } from "@/lib/cost-tracker";
import { getPoolStatus } from "@/lib/task-pool";
import { formatDate, daysBetween, startOfWeek } from "@/lib/date";
import type { DailyStats, MasteryLevel, PoolTask } from "@/lib/types";

const STEP_ICONS: Record<StudyStepType, typeof Brain> = {
  srs: Brain,
  conversation: MessageSquare,
  reading: BookOpen,
  writing: PenLine,
  listening: Headphones,
  translate: Languages,
};

const SESSION_STORAGE_PREFIX = "en-tutor-session-";

const DAILY_GOAL_STORAGE_KEY = "en-tutor-daily-goal";
const DEFAULT_DAILY_GOAL_MINUTES = 20;

// Read the user's configured daily study goal (minutes/day) written by the
// Settings page. Guards missing / NaN / non-positive values back to the default.
const loadDailyGoal = (): number => {
  if (typeof window === "undefined") return DEFAULT_DAILY_GOAL_MINUTES;
  const raw = window.localStorage.getItem(DAILY_GOAL_STORAGE_KEY);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_DAILY_GOAL_MINUTES;
};

const getGreeting = (hour: number): string => {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  if (hour >= 18 && hour < 24) return "Good evening";
  return "Burning the midnight oil?";
};

const CEFR_LABELS: Record<string, string> = {
  A1: "A1 · Beginner",
  A2: "A2 · Elementary",
  B1: "B1 · Intermediate",
  B2: "B2 · Upper Intermediate",
  C1: "C1 · Advanced",
  C2: "C2 · Proficient",
};

const HEATMAP_DAYS = 180;

const activityCount = (stats: DailyStats | undefined): number => {
  if (!stats) return 0;
  return (
    stats.conversationCount +
    stats.readingCount +
    stats.writingCount +
    stats.srsReviewed
  );
};

const heatmapColor = (count: number): string => {
  if (count <= 0) return "bg-gray-100 dark:bg-gray-800";
  if (count <= 2) return "bg-green-200 dark:bg-green-900";
  if (count <= 5) return "bg-green-400 dark:bg-green-700";
  return "bg-green-600 dark:bg-green-500";
};

const sumStats = (stats: DailyStats[]) => {
  return stats.reduce(
    (acc, s) => ({
      wordsLearned: acc.wordsLearned + s.wordsLearned,
      errorsFixed: acc.errorsFixed + s.errorsFixed,
      sessions:
        acc.sessions + s.conversationCount + s.readingCount + s.writingCount,
    }),
    { wordsLearned: 0, errorsFixed: 0, sessions: 0 }
  );
};

const formatDelta = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

const VOCAB_LABELS: Record<MasteryLevel, string> = {
  new: "New",
  learning: "Learning",
  relearning: "Relearning",
  familiar: "Familiar",
  mastered: "Mastered",
};

const VOCAB_COLORS: Record<MasteryLevel, string> = {
  new: "bg-gray-400",
  learning: "bg-blue-400",
  relearning: "bg-orange-400",
  familiar: "bg-amber-400",
  mastered: "bg-green-500",
};

const QUICK_LAUNCH = [
  {
    href: "/conversation",
    title: "Conversation",
    description: "Practice speaking with an AI partner",
    icon: MessageSquare,
  },
  {
    href: "/reader",
    title: "Reader",
    description: "Read articles and build vocabulary",
    icon: BookOpen,
  },
  {
    href: "/writing",
    title: "Writing",
    description: "Write and get instant feedback",
    icon: PenLine,
  },
  {
    href: "/srs",
    title: "Review Cards",
    description: "Practice spaced repetition",
    icon: Brain,
  },
  {
    href: "/listening",
    title: "Listening",
    description: "Sharpen your listening skills",
    icon: Headphones,
  },
  {
    href: "/translate",
    title: "Translate",
    description: "Practice Chinese-to-English translation",
    icon: Languages,
  },
] as const;

const DashboardPage = () => {
  const profile = useProfile();
  // Display fallback: assessedLevel first, studyLevel if not yet assessed.
  const displayLevel = profile?.assessedLevel || profile?.studyLevel;
  // Use the same budgeted queue /srs serves (new cards capped by daily
  // budget), not the raw due count, so "Review N cards" here always matches
  // what a session will actually present.
  const dailyNewLimit = profile?.dailyNewLimit ?? 20;
  const sessionQueue = useSessionQueue(dailyNewLimit);
  const vocabCounts = useVocabCounts();
  const todayStats = useTodayStats();
  const conversations = useConversations(5);
  const readingSessions = useReadingSessions(1);
  const writingSessions = useWritingSessions(1);
  const recentListening = useListeningExercises(1);
  const recentTranslation = useTranslationExercises(1);
  const totalConversationCount = useLiveQuery(() => db.conversations.count()) ?? 0;
  const totalWritingCount = useLiveQuery(() => db.writingSessions.count()) ?? 0;
  const [costSummary] = useState<CostSummary>(() => getCostSummary());
  const [dailyGoalMinutes] = useState<number>(() => loadDailyGoal());

  // Ensure today's tasks exist in local pool. Tries server first (Vercel Blob
  // filled by the daily cron job), then falls back to client-side generation
  // if the server has nothing — but only once per calendar day per device.
  useEffect(() => {
    const LAST_GEN_KEY = "en-tutor-last-pool-gen";
    const today = new Date().toISOString().split("T")[0];

    const pullOrGenerate = async () => {
      // Check if we already have enough local tasks for today
      const localStatus = await getPoolStatus();
      if (localStatus.todayTotal >= 5) return; // already stocked

      // Try server first. Only the network call is wrapped in try/catch — a
      // failed fetch means "server unavailable, fall through to local
      // generation", but DB writes and the local fallback below must NOT be
      // swallowed by that same catch.
      let serverData: { tasks?: PoolTask[]; date?: string } | null = null;
      try {
        const res = await fetch("/api/tasks/today");
        if (res.ok) {
          serverData = (await res.json()) as { tasks?: PoolTask[]; date?: string };
        }
      } catch {
        // Server unavailable, fall through to local generation
      }

      if (serverData?.tasks?.length) {
        // bulkPut is idempotent (server task ids are stable per day), so
        // concurrent mounts (StrictMode double-mount / multiple tabs) converge
        // instead of throwing a ConstraintError that falsely triggers local
        // generation and burns AI calls. But bulkPut also overwrites existing
        // rows wholesale, so read existing rows first and preserve their
        // completed/createdAt — otherwise a later reload (e.g. the server
        // still serving yesterday's overdue tasks) would resurrect a task the
        // user already completed and double-count stats/streak.
        const existing = await db.poolTasks.bulkGet(serverData.tasks.map((t) => t.id));
        const existingById = new Map(
          existing.filter((t): t is PoolTask => t !== undefined).map((t) => [t.id, t])
        );

        await db.poolTasks.bulkPut(
          serverData.tasks.map((task) => ({
            id: task.id,
            type: task.type,
            difficulty: task.difficulty,
            content: task.content,
            assignedDate: serverData?.date ?? "",
            completed: existingById.get(task.id)?.completed ?? task.completed ?? false,
            createdAt: existingById.get(task.id)?.createdAt ?? task.createdAt ?? new Date(),
          }))
        );
        return; // server had tasks, done
      }

      // Fallback: generate locally, max once per day
      const lastGen = localStorage.getItem(LAST_GEN_KEY);
      if (lastGen === today) return; // already generated today

      // Claim the day up-front. This read-check-set is synchronous (no await
      // between the check above and this set), so a concurrent mount — React
      // StrictMode double-invoke or a second tab — reads the claim and bails
      // instead of also generating, which would double the paid AI calls.
      localStorage.setItem(LAST_GEN_KEY, today);
      try {
        const profileData = await dbHelpers.getProfile();
        const level = profileData.studyLevel || "B1";

        // Import dynamically to avoid pulling generation code into the main
        // bundle when the server path succeeds
        const { generatePoolTasks } = await import("@/lib/task-pool-generate");
        await generatePoolTasks(level, 9); // 1 task per type, all 9 types
      } catch (err) {
        // Generation failed — release the claim so a later load can retry today.
        localStorage.removeItem(LAST_GEN_KEY);
        throw err;
      }
    };

    void pullOrGenerate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once on mount is intentional

  const heatmapRange = useMemo(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (HEATMAP_DAYS - 1));
    return { start: formatDate(start), end: formatDate(end) };
  }, []);

  const heatmapStats = useStatsRange(heatmapRange.start, heatmapRange.end);

  const statsById = useMemo(() => {
    const map = new Map<string, DailyStats>();
    for (const s of heatmapStats) map.set(s.id, s);
    return map;
  }, [heatmapStats]);

  const heatmapWeeks = useMemo(() => {
    const days: { date: string; count: number }[] = [];
    const cursor = new Date();
    cursor.setDate(cursor.getDate() - (HEATMAP_DAYS - 1));
    // Align start to the Monday of that week so columns are complete weeks
    const alignedStart = startOfWeek(cursor);
    const today = new Date();
    const totalDays = daysBetween(alignedStart, today) + 1;

    for (let i = 0; i < totalDays; i++) {
      const d = new Date(alignedStart);
      d.setDate(d.getDate() + i);
      const dateStr = formatDate(d);
      days.push({ date: dateStr, count: activityCount(statsById.get(dateStr)) });
    }

    const weeks: { date: string; count: number }[][] = [];
    for (let i = 0; i < days.length; i += 7) {
      weeks.push(days.slice(i, i + 7));
    }
    return weeks;
  }, [statsById]);

  const weeklySummary = useMemo(() => {
    const now = new Date();
    const thisWeekStart = startOfWeek(now);
    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const lastWeekEnd = new Date(thisWeekStart);
    lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);

    const thisWeekStr = formatDate(thisWeekStart);
    const nowStr = formatDate(now);
    const lastWeekStartStr = formatDate(lastWeekStart);
    const lastWeekEndStr = formatDate(lastWeekEnd);

    const thisWeekStats = heatmapStats.filter(
      (s) => s.id >= thisWeekStr && s.id <= nowStr
    );
    const lastWeekStats = heatmapStats.filter(
      (s) => s.id >= lastWeekStartStr && s.id <= lastWeekEndStr
    );

    const thisWeek = sumStats(thisWeekStats);
    const lastWeek = sumStats(lastWeekStats);

    return {
      words: thisWeek.wordsLearned - lastWeek.wordsLearned,
      errors: thisWeek.errorsFixed - lastWeek.errorsFixed,
      sessions: thisWeek.sessions - lastWeek.sessions,
    };
  }, [heatmapStats]);

  // Words mastered ~30 days ago, approximated from the current mastered count
  // minus words learned in the last 30 days (using the already-fetched 180-day
  // heatmap stats — no extra query needed).
  const wordsMonthAgo = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = formatDate(cutoff);
    const recentWordsLearned = heatmapStats
      .filter((s) => s.id > cutoffStr)
      .reduce((sum, s) => sum + s.wordsLearned, 0);
    const currentMastered = vocabCounts?.mastered ?? 0;
    return Math.max(0, currentMastered - recentWordsLearned);
  }, [heatmapStats, vocabCounts]);

  // Conversation fluency trend from the last 5 reviewed conversations.
  const fluencyTrend = useMemo(() => {
    const scored = conversations
      .filter((c) => c.review !== null)
      .slice(0, 5)
      .map((c) => c.review!.scores.fluency);
    if (scored.length < 2) return null;
    const oldest = scored[scored.length - 1];
    const newest = scored[0];
    if (newest > oldest) return "improving" as const;
    if (newest < oldest) return "declining" as const;
    return "stable" as const;
  }, [conversations]);

  // Concrete ability statements based on actual usage data — the intrinsic
  // motivation anchor, showing tangible capability gains rather than badges.
  const abilityStatements = useMemo(() => {
    const statements: string[] = [];
    const masteredCount = vocabCounts?.mastered ?? 0;
    if (masteredCount > 100) {
      statements.push("You can now read most everyday English texts.");
    }
    if (masteredCount > 300) {
      statements.push("You can now understand most news articles.");
    }
    if (totalConversationCount > 20) {
      statements.push("You can hold conversations on familiar topics.");
    }
    if (totalWritingCount > 10) {
      statements.push("You can write clear emails and short essays.");
    }
    return statements;
  }, [vocabCounts, totalConversationCount, totalWritingCount]);

  const sessionKey = useMemo(
    () => `${SESSION_STORAGE_PREFIX}${formatDate(new Date())}`,
    []
  );

  // Lazily read today's completed steps from sessionStorage on first render
  // Skipped steps (sessionStorage, date-scoped) — these are hidden but NOT
  // marked as completed. Completion is determined solely by real activity data.
  const [skippedSteps, setSkippedSteps] = useState<Set<StudyStepType>>(() => {
    if (typeof window === "undefined") return new Set();
    const raw = window.sessionStorage.getItem(sessionKey);
    if (!raw) return new Set();
    try {
      return new Set(JSON.parse(raw) as StudyStepType[]);
    } catch {
      return new Set();
    }
  });

  // Completion is based ONLY on real activity data — not on clicking Start.
  const mergedCompletedSteps = useMemo<Set<StudyStepType>>(() => {
    const detected = new Set<StudyStepType>();
    if (!todayStats) return detected;
    if (todayStats.srsReviewed > 0) detected.add("srs");
    if (todayStats.conversationCount > 0) detected.add("conversation");
    if (todayStats.readingCount > 0) detected.add("reading");
    if (todayStats.writingCount > 0) detected.add("writing");
    if (todayStats.listeningCount > 0) detected.add("listening");
    if (todayStats.translationCount > 0) detected.add("translate");
    return detected;
  }, [todayStats]);

  const skipStep = (type: StudyStepType) => {
    setSkippedSteps((prev) => {
      const next = new Set(prev);
      next.add(type);
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(sessionKey, JSON.stringify([...next]));
      }
      return next;
    });
  };

  const studyPlan = useMemo<StudyStep[]>(() => {
    if (!profile || !todayStats) return [];
    return generateStudyPlan({
      dueCards: sessionQueue.length,
      lastConversation: conversations[0]?.createdAt ?? null,
      lastReading: readingSessions[0]?.createdAt ?? null,
      lastWriting: writingSessions[0]?.createdAt ?? null,
      lastListening: recentListening[0]?.createdAt ?? null,
      lastTranslation: recentTranslation[0]?.createdAt ?? null,
      profile,
      todayStats,
      targetMinutes: dailyGoalMinutes,
    });
  }, [
    sessionQueue.length,
    conversations,
    readingSessions,
    writingSessions,
    recentListening,
    recentTranslation,
    profile,
    todayStats,
    dailyGoalMinutes,
  ]);

  const totalPlanMinutes = studyPlan.reduce(
    (sum, step) => sum + step.estimatedMinutes,
    0
  );
  const completedPlanMinutes = studyPlan
    .filter((step) => mergedCompletedSteps.has(step.type))
    .reduce((sum, step) => sum + step.estimatedMinutes, 0);
  const planProgressPct =
    totalPlanMinutes > 0
      ? Math.min(100, Math.round((completedPlanMinutes / totalPlanMinutes) * 100))
      : 0;

  const firstUnfinishedStep = studyPlan.find(
    (step) => !mergedCompletedSteps.has(step.type) && !skippedSteps.has(step.type)
  );

  const greeting = useMemo(() => getGreeting(new Date().getHours()), []);

  const totalVocab = vocabCounts
    ? vocabCounts.new +
      vocabCounts.learning +
      vocabCounts.relearning +
      vocabCounts.familiar +
      vocabCounts.mastered
    : 0;

  return (
    <div className="max-w-6xl space-y-4 md:space-y-6">
      <div>
        <h1 className="text-xl font-bold md:text-2xl">
          {greeting}! Ready for today&apos;s practice?
        </h1>
        <p className="text-sm text-muted-foreground md:text-base">
          One button. A scientifically structured session.
        </p>
      </div>

      {/* Today's Plan + Stats Overview */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Today&apos;s Plan</CardTitle>
            <CardDescription>
              {totalPlanMinutes > 0
                ? `${totalPlanMinutes} min session`
                : "Nothing pending right now"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {totalPlanMinutes > 0 && (
              <Progress value={planProgressPct}>
                <span className="sr-only">Session progress</span>
              </Progress>
            )}

            {studyPlan.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing pending right now. Nice work! Explore Quick Launch below
                if you want extra practice.
              </p>
            ) : (
              <ol className="space-y-3">
                {studyPlan.map((step, index) => {
                  const Icon = STEP_ICONS[step.type];
                  const done = mergedCompletedSteps.has(step.type);
                  const skipped = skippedSteps.has(step.type);
                  if (skipped && !done) return null; // hide skipped (but show if actually completed)
                  return (
                    <li
                      key={step.type}
                      className={`rounded-md border p-3 transition-colors ${
                        done ? "bg-muted/50" : "bg-card"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {done ? (
                          <CheckCircle2 className="size-5 text-green-600 shrink-0 mt-0.5" />
                        ) : (
                          <Circle className="size-5 text-muted-foreground shrink-0 mt-0.5" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Icon className="size-4 text-primary shrink-0" />
                            <span
                              className={`text-sm font-medium ${
                                done ? "text-muted-foreground line-through" : ""
                              }`}
                            >
                              {index + 1}. {step.title} ({step.estimatedMinutes} min)
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            &ldquo;{step.reason}&rdquo;
                          </p>
                          {!done && (
                            <div className="mt-2 flex items-center gap-2">
                              <Button
                                size="sm"
                                render={<Link href={step.href} />}
                              >
                                Start
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => skipStep(step.type)}
                              >
                                Skip
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            {firstUnfinishedStep && (
              <Button
                className="mt-2 w-full sm:w-auto"
                render={<Link href={firstUnfinishedStep.href} />}
              >
                Start Full Session &rarr;
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your Growth</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 md:space-y-4">
            <div className="flex items-center gap-2">
              <Trophy className="size-4 text-amber-500 shrink-0 md:size-5" />
              <div>
                <p className="text-xs font-medium md:text-sm">
                  Words you can use: {vocabCounts?.mastered ?? 0}
                  {vocabCounts && vocabCounts.mastered !== wordsMonthAgo && (
                    <span className="text-muted-foreground">
                      {" "}
                      (was {wordsMonthAgo} last month)
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {totalVocab} total words tracked
                </p>
              </div>
            </div>
            {fluencyTrend && (
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-blue-500 shrink-0 md:size-5" />
                <div>
                  <p className="text-xs font-medium md:text-sm">
                    Conversation fluency: {fluencyTrend}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Based on your last {conversations.filter((c) => c.review !== null).length} reviewed conversations
                  </p>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-blue-500 shrink-0 md:size-5" />
              <div>
                <p className="text-xs font-medium md:text-sm">
                  {displayLevel
                    ? CEFR_LABELS[displayLevel] ?? displayLevel
                    : "Not set"}
                </p>
                <p className="text-xs text-muted-foreground">Current level</p>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1 border-t">
              <Flame className="size-3.5 text-accent shrink-0" />
              <p className="text-xs text-muted-foreground">
                {profile?.streakCurrent ?? 0} day
                {(profile?.streakCurrent ?? 0) === 1 ? "" : "s"} streak · Best:{" "}
                {profile?.streakLongest ?? 0} days
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* "You can now..." — concrete ability gains, anchoring intrinsic motivation */}
      {abilityStatements.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>You can now...</CardTitle>
            <CardDescription>
              Real capabilities you&apos;ve gained from practice
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {abilityStatements.map((statement) => (
                <li key={statement} className="flex items-start gap-2 text-sm">
                  <TrendingUp className="size-4 mt-0.5 shrink-0 text-green-600" />
                  <span>{statement}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Quick Launch */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Launch</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {QUICK_LAUNCH.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} className="min-h-[44px]">
                  <Card className="h-full transition-colors hover:border-primary/50">
                    <CardContent className="flex flex-col items-start gap-1.5 p-3 md:gap-2 md:py-2">
                      <Icon className="size-5 text-primary md:size-6" />
                      <div>
                        <p className="text-xs font-medium md:text-sm">
                          {item.title}
                        </p>
                        <p className="hidden text-xs text-muted-foreground sm:block">
                          {item.description}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Learning Heatmap */}
      <Card>
        <CardHeader>
          <CardTitle>Learning Heatmap</CardTitle>
          <CardDescription>Activity over the last 180 days</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-[3px] overflow-x-auto pb-2">
            {heatmapWeeks.map((week, wi) => (
              <div key={wi} className="flex shrink-0 flex-col gap-[3px]">
                {week.map((day) => (
                  <div
                    key={day.date}
                    title={`${day.date}: ${day.count} activit${day.count === 1 ? "y" : "ies"}`}
                    className={`size-3 shrink-0 rounded-sm ${heatmapColor(day.count)}`}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <span>Less</span>
            <div className="size-3 rounded-sm bg-gray-100 dark:bg-gray-800" />
            <div className="size-3 rounded-sm bg-green-200 dark:bg-green-900" />
            <div className="size-3 rounded-sm bg-green-400 dark:bg-green-700" />
            <div className="size-3 rounded-sm bg-green-600 dark:bg-green-500" />
            <span>More</span>
          </div>
        </CardContent>
      </Card>

      {/* Weekly Summary + Vocabulary Distribution */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Weekly Summary</CardTitle>
            <CardDescription>This week vs. last week</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">Words learned</span>
              <Badge variant={weeklySummary.words >= 0 ? "default" : "destructive"}>
                {formatDelta(weeklySummary.words)}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Errors fixed</span>
              <Badge variant={weeklySummary.errors >= 0 ? "default" : "destructive"}>
                {formatDelta(weeklySummary.errors)}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Practice sessions</span>
              <Badge variant={weeklySummary.sessions >= 0 ? "default" : "destructive"}>
                {formatDelta(weeklySummary.sessions)}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vocabulary Distribution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(["new", "learning", "relearning", "familiar", "mastered"] as MasteryLevel[]).map(
              (level) => {
                const count = vocabCounts?.[level] ?? 0;
                const pct = totalVocab > 0 ? (count / totalVocab) * 100 : 0;
                return (
                  <div key={level}>
                    <div className="flex items-center justify-between text-sm">
                      <span>{VOCAB_LABELS[level]}</span>
                      <span className="text-muted-foreground">{count}</span>
                    </div>
                    <div className="mt-1 h-2 w-full rounded-full bg-muted">
                      <div
                        className={`h-2 rounded-full ${VOCAB_COLORS[level]}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              }
            )}
          </CardContent>
        </Card>
      </div>

      {/* AI Cost — compact usage-cost snapshot, details live in Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Coins className="size-4 text-amber-500" />
            AI Cost
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-lg font-semibold">
                {costSummary.todayCostA0GI.toFixed(4)}
              </p>
              <p className="text-xs text-muted-foreground">Today (A0GI)</p>
            </div>
            <div>
              <p className="text-lg font-semibold">
                {costSummary.totalCostA0GI.toFixed(4)}
              </p>
              <p className="text-xs text-muted-foreground">Total (A0GI)</p>
            </div>
            <div>
              <p className="text-lg font-semibold">{costSummary.totalCalls}</p>
              <p className="text-xs text-muted-foreground">API calls</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default DashboardPage;
