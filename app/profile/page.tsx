"use client";

import { useEffect, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  BookOpen,
  MessageSquare,
  PenLine,
  Sparkles,
  Trophy,
  Lock,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { dbHelpers } from "@/lib/db-helpers";
import {
  useProfile,
  useVocabCounts,
  useConversations,
  useWritingSessions,
  useReadingSessions,
  useStatsRange,
} from "@/hooks/use-db";
import type { Card as VocabCard, Conversation, DailyStats } from "@/lib/types";

const CEFR_LABELS: Record<string, string> = {
  A1: "A1 · Beginner",
  A2: "A2 · Elementary",
  B1: "B1 · Intermediate",
  B2: "B2 · Upper Intermediate",
  C1: "C1 · Advanced",
  C2: "C2 · Proficient",
};

const SCORE_DIMENSIONS = [
  { key: "fluency", label: "Fluency", color: "#3b82f6" },
  { key: "accuracy", label: "Accuracy", color: "#ef4444" },
  { key: "vocabulary", label: "Vocabulary", color: "#22c55e" },
  { key: "complexity", label: "Complexity", color: "#a855f7" },
] as const;

const MILESTONE_DEFS = [
  { id: "first_steps", title: "First Steps", description: "Complete your first conversation" },
  { id: "bookworm", title: "Bookworm", description: "Finish 10 reading sessions" },
  { id: "wordsmith", title: "Wordsmith", description: "Master 100 words" },
  { id: "persistent", title: "Persistent", description: "Reach a 7-day streak" },
  { id: "dedicated", title: "Dedicated", description: "Reach a 30-day streak" },
  { id: "vocabulary_builder", title: "Vocabulary Builder", description: "Master 500 words" },
] as const;

const formatDate = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const monthKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const monthLabel = (key: string): string => {
  const [y, m] = key.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("en-US", { month: "short" });
};

const last6Months = (): string[] => {
  const months: string[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(monthKey(d));
  }
  return months;
};

const VocabGrowthChart = ({ data }: { data: { label: string; value: number }[] }) => {
  const max = Math.max(...data.map((d) => d.value), 1);
  const width = data.length * 60;
  return (
    <svg viewBox={`0 0 ${width} 200`} className="h-48 w-full min-w-[240px]">
      {data.map((d, i) => {
        const barHeight = (d.value / max) * 160;
        return (
          <g key={i}>
            <rect
              x={i * 60 + 12}
              y={180 - barHeight}
              width={36}
              height={barHeight}
              className="fill-primary"
              rx={4}
            />
            <text
              x={i * 60 + 30}
              y={175 - barHeight}
              textAnchor="middle"
              className="fill-foreground text-[10px] font-medium"
            >
              {d.value > 0 ? d.value : ""}
            </text>
            <text
              x={i * 60 + 30}
              y={196}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

type ScorePoint = { fluency: number; accuracy: number; vocabulary: number; complexity: number };

const ScoreTrendChart = ({ points }: { points: ScorePoint[] }) => {
  const width = Math.max((points.length - 1) * 60, 60) + 40;
  const height = 200;
  const chartTop = 10;
  const chartBottom = 170;
  const chartHeight = chartBottom - chartTop;

  const xFor = (i: number) => {
    if (points.length === 1) return width / 2;
    return 20 + (i / (points.length - 1)) * (width - 40);
  };
  const yFor = (score: number) => chartBottom - (score / 10) * chartHeight;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-52 w-full min-w-[240px]">
      {/* gridlines */}
      {[0, 2.5, 5, 7.5, 10].map((tick) => (
        <line
          key={tick}
          x1={20}
          x2={width - 20}
          y1={yFor(tick)}
          y2={yFor(tick)}
          className="stroke-border"
          strokeWidth={1}
        />
      ))}
      {SCORE_DIMENSIONS.map((dim) => {
        const path = points
          .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i)} ${yFor(p[dim.key])}`)
          .join(" ");
        return (
          <g key={dim.key}>
            <path d={path} fill="none" stroke={dim.color} strokeWidth={2} />
            {points.map((p, i) => (
              <circle
                key={i}
                cx={xFor(i)}
                cy={yFor(p[dim.key])}
                r={3}
                fill={dim.color}
              />
            ))}
          </g>
        );
      })}
      {points.map((_, i) => (
        <text
          key={i}
          x={xFor(i)}
          y={height - 2}
          textAnchor="middle"
          className="fill-muted-foreground text-[9px]"
        >
          {i + 1}
        </text>
      ))}
    </svg>
  );
};

const ProfilePage = () => {
  const profile = useProfile();
  const vocabCounts = useVocabCounts();
  const conversations = useConversations(50);
  const writingSessions = useWritingSessions(200);
  const readingSessions = useReadingSessions(200);

  const allCards = useLiveQuery(() => db.cards.toArray(), []) ?? [];

  const firstStatDate = useLiveQuery(
    () => db.dailyStats.orderBy("id").first(),
    []
  );

  const allTimeRange = useMemo(() => {
    const end = formatDate(new Date());
    const start = "2000-01-01";
    return { start, end };
  }, []);
  const allStats = useStatsRange(allTimeRange.start, allTimeRange.end);

  // --- Overview ---
  const totalVocab = vocabCounts
    ? vocabCounts.new + vocabCounts.learning + vocabCounts.familiar + vocabCounts.mastered
    : 0;
  const totalConversationsCompleted = conversations.filter((c) => c.review !== null).length;
  const totalArticlesRead = readingSessions.length;
  const totalWordsWritten = writingSessions.reduce((sum, s) => sum + s.wordCount, 0);
  const memberSince = firstStatDate?.id ?? null;

  // --- Vocabulary Growth Chart (last 6 months, cards created that month) ---
  const vocabGrowthData = useMemo(() => {
    const months = last6Months();
    const counts = new Map<string, number>(months.map((m) => [m, 0]));
    for (const card of allCards as VocabCard[]) {
      const key = monthKey(new Date(card.createdAt));
      if (counts.has(key)) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return months.map((m) => ({ label: monthLabel(m), value: counts.get(m) ?? 0 }));
  }, [allCards]);

  // --- Conversation Score Trends (last 10 with reviews) ---
  const scoredConversations = useMemo(() => {
    return (conversations as Conversation[])
      .filter((c) => c.review !== null)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(-10);
  }, [conversations]);

  const scorePoints: ScorePoint[] = useMemo(
    () =>
      scoredConversations.map((c) => ({
        fluency: c.review!.scores.fluency,
        accuracy: c.review!.scores.accuracy,
        vocabulary: c.review!.scores.vocabulary,
        complexity: c.review!.scores.complexity,
      })),
    [scoredConversations]
  );

  // --- Error Pattern Analysis ---
  const errorPatternStats = useMemo(() => {
    const reviewed = writingSessions.filter((s) => s.review !== null);
    const sorted = [...reviewed].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const half = Math.ceil(sorted.length / 2);
    const earlier = sorted.slice(0, half);
    const recent = sorted.slice(half);

    const countByCategory = (sessions: typeof sorted) => {
      const map = new Map<string, number>();
      for (const s of sessions) {
        for (const ep of s.review!.errorPatterns) {
          map.set(ep.category, (map.get(ep.category) ?? 0) + 1);
        }
      }
      return map;
    };

    const totalCounts = countByCategory(sorted);
    const earlierCounts = countByCategory(earlier);
    const recentCounts = countByCategory(recent);

    const entries = Array.from(totalCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, count]) => {
        const earlierCount = earlierCounts.get(category) ?? 0;
        const recentCount = recentCounts.get(category) ?? 0;
        let trend: "improving" | "stable" | "declining" = "stable";
        if (earlier.length > 0 && recent.length > 0) {
          if (recentCount < earlierCount) trend = "improving";
          else if (recentCount > earlierCount) trend = "declining";
        }
        return { category, count, trend };
      });

    return entries;
  }, [writingSessions]);

  // --- Practice Distribution ---
  const practiceDistribution = useMemo(() => {
    const totals = allStats.reduce(
      (acc, s: DailyStats) => ({
        conversation: acc.conversation + s.conversationCount,
        reading: acc.reading + s.readingCount,
        writing: acc.writing + s.writingCount,
        srs: acc.srs + s.srsReviewed,
      }),
      { conversation: 0, reading: 0, writing: 0, srs: 0 }
    );
    const total = totals.conversation + totals.reading + totals.writing + totals.srs;
    return [
      { label: "Conversations", value: totals.conversation, color: "bg-blue-500", icon: MessageSquare },
      { label: "Reading", value: totals.reading, color: "bg-green-500", icon: BookOpen },
      { label: "Writing", value: totals.writing, color: "bg-purple-500", icon: PenLine },
      { label: "SRS Review", value: totals.srs, color: "bg-amber-500", icon: Sparkles },
    ].map((item) => ({
      ...item,
      pct: total > 0 ? (item.value / total) * 100 : 0,
    }));
  }, [allStats]);

  // --- Milestones: check & award ---
  useEffect(() => {
    const checkMilestones = async () => {
      const currentProfile = await dbHelpers.getProfile();
      const earnedIds = new Set(currentProfile.milestones.map((m) => m.id));
      const masteredCount = await db.cards.where("masteryLevel").equals("mastered").count();
      const conversationCount = await db.conversations.count();
      const readingCount = await db.readingSessions.count();

      const toAward: string[] = [];
      if (!earnedIds.has("first_steps") && conversationCount >= 1) toAward.push("first_steps");
      if (!earnedIds.has("bookworm") && readingCount >= 10) toAward.push("bookworm");
      if (!earnedIds.has("wordsmith") && masteredCount >= 100) toAward.push("wordsmith");
      if (!earnedIds.has("persistent") && currentProfile.streakLongest >= 7) toAward.push("persistent");
      if (!earnedIds.has("dedicated") && currentProfile.streakLongest >= 30) toAward.push("dedicated");
      if (!earnedIds.has("vocabulary_builder") && masteredCount >= 500) toAward.push("vocabulary_builder");

      if (toAward.length > 0) {
        const now = new Date();
        const newMilestones = [
          ...currentProfile.milestones,
          ...toAward.map((id) => ({ id, earnedAt: now })),
        ];
        await db.learningProfile.put({ ...currentProfile, milestones: newMilestones });
      }
    };
    checkMilestones();
  }, []);

  const milestonesById = useMemo(() => {
    const map = new Map<string, Date>();
    for (const m of profile?.milestones ?? []) {
      map.set(m.id, new Date(m.earnedAt));
    }
    return map;
  }, [profile]);

  const hasData = totalVocab > 0 || conversations.length > 0 || writingSessions.length > 0 || readingSessions.length > 0;

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Learning Profile</h1>
        <p className="text-muted-foreground">
          Your progress, trends, and analytics over time
        </p>
      </div>

      {!hasData && (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-muted-foreground">
              No activity yet. Start a conversation, read an article, or write
              something to begin building your learning profile.
            </p>
          </CardContent>
        </Card>
      )}

      {/* 1. Overview */}
      <Card>
        <CardHeader>
          <CardTitle>Overview</CardTitle>
          <CardDescription>
            {profile?.initialCefrLevel
              ? CEFR_LABELS[profile.initialCefrLevel] ?? profile.initialCefrLevel
              : "CEFR level not set"}
            {memberSince ? ` · Member since ${memberSince}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-2xl font-bold text-green-600">
                {vocabCounts?.mastered ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">Mastered</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-blue-500">
                {vocabCounts?.learning ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">Learning</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-amber-500">
                {vocabCounts?.familiar ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">Familiar</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-400">
                {vocabCounts?.new ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">New</p>
            </div>
          </div>
          <div className="mt-6 grid grid-cols-1 gap-4 border-t pt-4 sm:grid-cols-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="size-5 shrink-0 text-blue-500" />
              <div>
                <p className="text-sm font-medium">{totalConversationsCompleted}</p>
                <p className="text-xs text-muted-foreground">Conversations completed</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <BookOpen className="size-5 shrink-0 text-green-500" />
              <div>
                <p className="text-sm font-medium">{totalArticlesRead}</p>
                <p className="text-xs text-muted-foreground">Articles read</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <PenLine className="size-5 shrink-0 text-purple-500" />
              <div>
                <p className="text-sm font-medium">{totalWordsWritten}</p>
                <p className="text-xs text-muted-foreground">Words written</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {/* 2. Vocabulary Growth Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Vocabulary Growth</CardTitle>
            <CardDescription>New cards created per month (last 6 months)</CardDescription>
          </CardHeader>
          <CardContent>
            {allCards.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Complete conversations and reading to start tracking vocabulary growth.
              </p>
            ) : (
              <div className="min-h-[200px] overflow-x-auto">
                <VocabGrowthChart data={vocabGrowthData} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* 3. Conversation Score Trends */}
        <Card>
          <CardHeader>
            <CardTitle>Conversation Score Trends</CardTitle>
            <CardDescription>Last {scorePoints.length || 0} reviewed conversations</CardDescription>
          </CardHeader>
          <CardContent>
            {scorePoints.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Complete your first conversation to see score trends.
              </p>
            ) : (
              <>
                <div className="min-h-[200px] overflow-x-auto">
                  <ScoreTrendChart points={scorePoints} />
                </div>
                <div className="mt-2 flex flex-wrap gap-3">
                  {SCORE_DIMENSIONS.map((dim) => (
                    <div key={dim.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: dim.color }}
                      />
                      {dim.label}
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* 4. Error Pattern Analysis */}
        <Card>
          <CardHeader>
            <CardTitle>Error Pattern Analysis</CardTitle>
            <CardDescription>Top error categories from writing reviews</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {errorPatternStats.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Submit writing for review to see your error patterns.
              </p>
            ) : (
              errorPatternStats.map((stat) => (
                <div key={stat.category} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{stat.category}</p>
                    <p className="text-xs text-muted-foreground">{stat.count} occurrences</p>
                  </div>
                  <Badge
                    variant={
                      stat.trend === "improving"
                        ? "default"
                        : stat.trend === "declining"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {stat.trend}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* 5. Practice Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Practice Distribution</CardTitle>
            <CardDescription>How you split your practice time</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {practiceDistribution.every((d) => d.value === 0) ? (
              <p className="text-sm text-muted-foreground">
                Start practicing to see your activity distribution.
              </p>
            ) : (
              practiceDistribution.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5">
                        <Icon className="size-3.5 text-muted-foreground" />
                        {item.label}
                      </span>
                      <span className="text-muted-foreground">{item.value}</span>
                    </div>
                    <div className="mt-1 h-2 w-full rounded-full bg-muted">
                      <div
                        className={`h-2 rounded-full ${item.color}`}
                        style={{ width: `${item.pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* 6. Milestones */}
      <Card>
        <CardHeader>
          <CardTitle>Milestones</CardTitle>
          <CardDescription>Achievements you&apos;ve earned along the way</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {MILESTONE_DEFS.map((m) => {
              const earnedAt = milestonesById.get(m.id);
              const earned = earnedAt !== undefined;
              return (
                <div
                  key={m.id}
                  className={`flex items-start gap-3 rounded-lg border p-3 ${
                    earned ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30" : "opacity-50"
                  }`}
                >
                  {earned ? (
                    <Trophy className="size-5 shrink-0 text-amber-500" />
                  ) : (
                    <Lock className="size-5 shrink-0 text-muted-foreground" />
                  )}
                  <div>
                    <p className="text-sm font-medium">{m.title}</p>
                    <p className="text-xs text-muted-foreground">{m.description}</p>
                    {earned && (
                      <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                        Earned {formatDate(earnedAt)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ProfilePage;
