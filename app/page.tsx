"use client";

import { useEffect, useMemo, useState } from "react";
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
import { dbHelpers } from "@/lib/db-helpers";
import {
  useProfile,
  useDueCards,
  useVocabCounts,
  useTodayStats,
  useStatsRange,
  useConversations,
  useReadingSessions,
  useWritingSessions,
} from "@/hooks/use-db";
import { generateStudyPlan, type StudyStep, type StudyStepType } from "@/lib/study-engine";
import type { DailyStats, MasteryLevel } from "@/lib/types";

const STEP_ICONS: Record<StudyStepType, typeof Brain> = {
  srs: Brain,
  conversation: MessageSquare,
  reading: BookOpen,
  writing: PenLine,
  listening: Headphones,
  translate: Languages,
};

const SESSION_STORAGE_PREFIX = "en-tutor-session-";

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

const formatDate = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const daysBetween = (a: Date, b: Date): number => {
  const msPerDay = 1000 * 60 * 60 * 24;
  const aStart = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const bStart = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((aStart.getTime() - bStart.getTime()) / msPerDay);
};

// Monday-based start of week
const startOfWeek = (date: Date): Date => {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = (day + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - diff);
  return d;
};

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
  familiar: "Familiar",
  mastered: "Mastered",
};

const VOCAB_COLORS: Record<MasteryLevel, string> = {
  new: "bg-gray-400",
  learning: "bg-blue-400",
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
] as const;

const DashboardPage = () => {
  const profile = useProfile();
  const dueCards = useDueCards();
  const vocabCounts = useVocabCounts();
  const todayStats = useTodayStats();
  const conversations = useConversations(1);
  const readingSessions = useReadingSessions(1);
  const writingSessions = useWritingSessions(1);

  useEffect(() => {
    dbHelpers.updateStreak();
  }, []);

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
    const totalDays = daysBetween(today, alignedStart) + 1;

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

  const sessionKey = useMemo(
    () => `${SESSION_STORAGE_PREFIX}${formatDate(new Date())}`,
    []
  );

  // Lazily read today's completed steps from sessionStorage on first render
  // (resets on page refresh, since sessionStorage is per-tab and the key is
  // date-scoped rather than persisted across days).
  const [completedSteps, setCompletedSteps] = useState<Set<StudyStepType>>(
    () => {
      if (typeof window === "undefined") return new Set();
      const raw = window.sessionStorage.getItem(sessionKey);
      if (!raw) return new Set();
      try {
        const parsed = JSON.parse(raw) as string[];
        return new Set(parsed as StudyStepType[]);
      } catch {
        return new Set();
      }
    }
  );

  const markStepCompleted = (type: StudyStepType) => {
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      next.add(type);
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(sessionKey, JSON.stringify([...next]));
      }
      return next;
    });
  };

  const skipStep = (type: StudyStepType) => {
    markStepCompleted(type);
  };

  const studyPlan = useMemo<StudyStep[]>(() => {
    if (!profile || !todayStats) return [];
    return generateStudyPlan({
      dueCards: dueCards.length,
      lastConversation: conversations[0]?.createdAt ?? null,
      lastReading: readingSessions[0]?.createdAt ?? null,
      lastWriting: writingSessions[0]?.createdAt ?? null,
      profile,
      todayStats,
    });
  }, [
    dueCards.length,
    conversations,
    readingSessions,
    writingSessions,
    profile,
    todayStats,
  ]);

  const totalPlanMinutes = studyPlan.reduce(
    (sum, step) => sum + step.estimatedMinutes,
    0
  );
  const completedPlanMinutes = studyPlan
    .filter((step) => completedSteps.has(step.type))
    .reduce((sum, step) => sum + step.estimatedMinutes, 0);
  const planProgressPct =
    totalPlanMinutes > 0
      ? Math.min(100, Math.round((completedPlanMinutes / totalPlanMinutes) * 100))
      : 0;

  const firstUnfinishedStep = studyPlan.find(
    (step) => !completedSteps.has(step.type)
  );

  const greeting = useMemo(() => getGreeting(new Date().getHours()), []);

  const totalVocab = vocabCounts
    ? vocabCounts.new + vocabCounts.learning + vocabCounts.familiar + vocabCounts.mastered
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
                  const done = completedSteps.has(step.type);
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
                                onClick={() => markStepCompleted(step.type)}
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
                onClick={() => markStepCompleted(firstUnfinishedStep.type)}
              >
                Start Full Session &rarr;
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Stats Overview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 md:space-y-4">
            <div className="flex items-center gap-2">
              <Flame className="size-4 text-orange-500 shrink-0 md:size-5" />
              <div>
                <p className="text-xs font-medium md:text-sm">
                  {profile?.streakCurrent ?? 0} day
                  {(profile?.streakCurrent ?? 0) === 1 ? "" : "s"} streak
                </p>
                <p className="text-xs text-muted-foreground">
                  Best: {profile?.streakLongest ?? 0} days
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Trophy className="size-4 text-amber-500 shrink-0 md:size-5" />
              <div>
                <p className="text-xs font-medium md:text-sm">
                  {vocabCounts?.mastered ?? 0} words mastered
                </p>
                <p className="text-xs text-muted-foreground">
                  {totalVocab} total words tracked
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-blue-500 shrink-0 md:size-5" />
              <div>
                <p className="text-xs font-medium md:text-sm">
                  {profile?.initialCefrLevel
                    ? CEFR_LABELS[profile.initialCefrLevel] ??
                      profile.initialCefrLevel
                    : "Not set"}
                </p>
                <p className="text-xs text-muted-foreground">Current level</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Launch */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Launch</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
            {(["new", "learning", "familiar", "mastered"] as MasteryLevel[]).map(
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
    </div>
  );
};

export default DashboardPage;
