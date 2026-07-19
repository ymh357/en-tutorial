"use client";

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  CheckCircle2,
  Circle,
  Dot,
  Lock,
  Map as MapIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/lib/db";
import { dbHelpers } from "@/lib/db-helpers";
import { useProfile } from "@/hooks/use-db";
import { SCENARIOS } from "@/lib/scenarios";
import type { Conversation, ReadingSession, WritingSession } from "@/lib/types";

// --- CEFR progression + assessment localStorage reader ---
// (Monthly assessments aren't stored in IndexedDB — they live in
// localStorage. Reading them here keeps the roadmap accurate without
// adding new DB tables.)

const NEXT_CEFR_LEVEL: Record<string, string> = {
  A1: "A2",
  A2: "B1",
  B1: "B2",
  B2: "C1",
  C1: "C2",
  C2: "C2",
};

const ASSESSMENTS_STORAGE_KEY = "en-tutor-assessments";
const B2_ASSESSMENT_THRESHOLD = 65;

interface StoredAssessment {
  overallScore: number;
}

// Stable fallback reference so useMemo deps don't churn on every render
// while the live query is still resolving.
const EMPTY_LISTENING_AGGREGATE: { count: number; avgAccuracy: number } = {
  count: 0,
  avgAccuracy: 0,
};

const readAssessments = (): StoredAssessment[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ASSESSMENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredAssessment[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// Conversations only store the scenario's display name (not its id), so
// category attribution is done by matching that name against SCENARIOS.
const categoryForConversation = (conversation: Conversation): string | null => {
  const match = SCENARIOS.find((s) => s.name === conversation.scenario);
  return match?.category ?? null;
};

interface Requirement {
  label: string;
  current: number;
  target: number;
  unit: string;
}

interface RoadmapStage {
  id: string;
  title: string;
  description: string;
  requirements: Requirement[];
  unlocked: boolean;
  completed: boolean;
}

const requirementsMet = (requirements: Requirement[]): boolean =>
  requirements.every((r) => r.current >= r.target);

const requirementProgressPct = (r: Requirement): number =>
  r.target > 0 ? Math.min(100, Math.round((r.current / r.target) * 100)) : 100;

const RequirementBar = ({
  requirement,
  hideNumbers,
}: {
  requirement: Requirement;
  hideNumbers: boolean;
}) => {
  const pct = requirementProgressPct(requirement);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{requirement.label}</span>
        <span className="font-medium tabular-nums">
          {hideNumbers
            ? `?/${requirement.target} ${requirement.unit}`
            : `${requirement.current}/${requirement.target} ${requirement.unit}`}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted">
        <div
          className="h-2 rounded-full bg-primary transition-all"
          style={{ width: `${hideNumbers ? 0 : pct}%` }}
        />
      </div>
    </div>
  );
};

const StageRow = ({
  stage,
  isCurrent,
}: {
  stage: RoadmapStage;
  isCurrent: boolean;
}) => {
  const statusIcon = stage.completed ? (
    <CheckCircle2 className="size-5 shrink-0 text-green-600" />
  ) : stage.unlocked ? (
    <Dot className="size-5 shrink-0 text-primary" />
  ) : (
    <Lock className="size-4 shrink-0 text-muted-foreground" />
  );

  return (
    <div
      className={`relative flex gap-3 pb-8 last:pb-0 ${
        !stage.unlocked ? "opacity-50" : ""
      }`}
    >
      {/* Timeline connector */}
      <div className="flex flex-col items-center">
        <div
          className={`flex size-8 shrink-0 items-center justify-center rounded-full border-2 ${
            stage.completed
              ? "border-green-600 bg-green-50 dark:bg-green-950/30"
              : isCurrent
                ? "border-primary bg-primary/10"
                : "border-border bg-muted"
          }`}
        >
          {statusIcon}
        </div>
        <div className="mt-1 w-px flex-1 bg-border" />
      </div>

      <Card className={`flex-1 ${isCurrent ? "border-primary" : ""}`}>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">{stage.title}</CardTitle>
            {isCurrent && (
              <span className="text-xs font-medium text-primary">
                &larr; You are here
              </span>
            )}
          </div>
          <CardDescription className="text-xs">
            {stage.description}
          </CardDescription>
        </CardHeader>
        {stage.requirements.length > 0 && (
          <CardContent className="space-y-3">
            {stage.requirements.map((r) => (
              <RequirementBar
                key={r.label}
                requirement={r}
                hideNumbers={!stage.unlocked}
              />
            ))}
          </CardContent>
        )}
      </Card>
    </div>
  );
};

const RoadmapPage = () => {
  const profile = useProfile();

  const cardsWithCollocations = useLiveQuery(
    () => db.cards.filter((c) => Boolean(c.collocations && c.collocations.length > 0)).count(),
    []
  );
  const masteredVocabCount = useLiveQuery(
    () => db.cards.where("masteryLevel").equals("mastered").count(),
    []
  );
  const conversations = useLiveQuery(
    () => db.conversations.toArray(),
    []
  ) as Conversation[] | undefined;
  const readingSessions = useLiveQuery(
    () => db.readingSessions.toArray(),
    []
  ) as ReadingSession[] | undefined;
  const writingSessions = useLiveQuery(
    () => db.writingSessions.toArray(),
    []
  ) as WritingSession[] | undefined;
  // "Complete listening exercises" counts all modes (matches its unqualified
  // label); "Dictation accuracy" is filtered to mode === "dictation" to match
  // its label (previously it was mislabeled as an all-modes average).
  const listeningAll = useLiveQuery(
    () => dbHelpers.getListeningAggregate(),
    []
  ) ?? EMPTY_LISTENING_AGGREGATE;
  const dictation = useLiveQuery(
    () => dbHelpers.getListeningAggregate("dictation"),
    []
  ) ?? EMPTY_LISTENING_AGGREGATE;

  const currentLevel = profile?.initialCefrLevel || "B1";
  const nextLevel = NEXT_CEFR_LEVEL[currentLevel] ?? "B2";

  const stages: RoadmapStage[] = useMemo(() => {
    const foundationDone = Boolean(profile?.initialCefrLevel);

    // --- Vocabulary Base ---
    const vocabCount = masteredVocabCount ?? 0;
    const collocationsCount = cardsWithCollocations ?? 0;
    const vocabRequirements: Requirement[] = [
      { label: "Master vocabulary words", current: vocabCount, target: 200, unit: "words" },
      { label: "Learn collocations", current: collocationsCount, target: 50, unit: "collocations" },
    ];
    const vocabDone = requirementsMet(vocabRequirements);

    // --- Conversation Confidence ---
    const reviewedConversations = (conversations ?? []).filter((c) => c.review !== null);
    const conversationCount = reviewedConversations.length;
    const avgFluency =
      reviewedConversations.length > 0
        ? reviewedConversations.reduce((sum, c) => sum + (c.review?.scores.fluency ?? 0), 0) /
          reviewedConversations.length
        : 0;
    const categoriesTried = new Set(
      reviewedConversations
        .map(categoryForConversation)
        .filter((c): c is string => c !== null)
    );
    const conversationRequirements: Requirement[] = [
      { label: "Complete conversations", current: conversationCount, target: 20, unit: "conversations" },
      {
        label: "Average fluency score",
        current: Math.round(avgFluency * 10) / 10,
        target: 6,
        unit: "/10",
      },
      { label: "Try different scenario categories", current: categoriesTried.size, target: 3, unit: "categories" },
    ];
    const conversationDone = requirementsMet(conversationRequirements);

    // --- Reading Fluency ---
    const readingCount = readingSessions?.length ?? 0;
    const avgVocabCoverage =
      readingSessions && readingSessions.length > 0
        ? readingSessions.reduce((sum, s) => sum + s.vocabCoverage, 0) / readingSessions.length
        : 0;
    const readingRequirements: Requirement[] = [
      { label: "Read articles", current: readingCount, target: 15, unit: "articles" },
      {
        label: "Average vocab coverage",
        current: Math.round(avgVocabCoverage),
        target: 80,
        unit: "%",
      },
    ];
    const readingDone = requirementsMet(readingRequirements);

    // --- Writing Clarity ---
    const reviewedWriting = (writingSessions ?? []).filter((s) => s.review !== null);
    const writingCount = reviewedWriting.length;
    const avgWritingScore =
      reviewedWriting.length > 0
        ? reviewedWriting.reduce((sum, s) => sum + (s.review?.score ?? 0), 0) / reviewedWriting.length
        : 0;
    const writingRequirements: Requirement[] = [
      { label: "Complete writing tasks", current: writingCount, target: 10, unit: "tasks" },
      {
        label: "Average writing score",
        current: Math.round(avgWritingScore * 10) / 10,
        target: 6,
        unit: "/10",
      },
    ];
    const writingDone = requirementsMet(writingRequirements);

    // --- Listening Skills ---
    const listeningRequirements: Requirement[] = [
      { label: "Complete listening exercises", current: listeningAll.count, target: 20, unit: "exercises" },
      { label: "Dictation accuracy", current: dictation.avgAccuracy, target: 80, unit: "%" },
    ];
    const listeningDone = requirementsMet(listeningRequirements);

    // --- Level Assessment ---
    const assessments = readAssessments();
    const bestAssessmentScore = assessments.reduce(
      (max, a) => Math.max(max, a.overallScore),
      0
    );
    const assessmentRequirements: Requirement[] = [
      {
        label: "Take the monthly assessment",
        current: assessments.length > 0 ? 1 : 0,
        target: 1,
        unit: "taken",
      },
      {
        label: `Score ≥ ${B2_ASSESSMENT_THRESHOLD} (${nextLevel} threshold)`,
        current: bestAssessmentScore,
        target: B2_ASSESSMENT_THRESHOLD,
        unit: "pts",
      },
    ];
    const assessmentDone = requirementsMet(assessmentRequirements);

    const stageList: Array<Omit<RoadmapStage, "unlocked">> = [
      {
        id: "foundation",
        title: "Foundation",
        description: "Set up your profile",
        requirements: [],
        completed: foundationDone,
      },
      {
        id: "vocabulary",
        title: "Vocabulary Base",
        description: "Build a solid word foundation for everyday communication.",
        requirements: vocabRequirements,
        completed: vocabDone,
      },
      {
        id: "conversation",
        title: "Conversation Confidence",
        description: "Hold conversations across a range of everyday situations.",
        requirements: conversationRequirements,
        completed: conversationDone,
      },
      {
        id: "reading",
        title: "Reading Fluency",
        description: "Read authentic texts with strong comprehension.",
        requirements: readingRequirements,
        completed: readingDone,
      },
      {
        id: "writing",
        title: "Writing Clarity",
        description: "Write clear, well-structured emails and short essays.",
        requirements: writingRequirements,
        completed: writingDone,
      },
      {
        id: "listening",
        title: "Listening Skills",
        description: "Understand natural spoken English at normal speed.",
        requirements: listeningRequirements,
        completed: listeningDone,
      },
      {
        id: "assessment",
        title: "Level Assessment",
        description: `Confirm your progression from ${currentLevel} to ${nextLevel}.`,
        requirements: assessmentRequirements,
        completed: assessmentDone,
      },
    ];

    // A stage unlocks once every stage before it is completed — this is a
    // progress tracker, not a gate, so "unlocked" only controls whether
    // numbers are shown, not whether the underlying feature is usable.
    let previousCompleted = true;
    return stageList.map((stage) => {
      const unlocked = previousCompleted;
      previousCompleted = previousCompleted && stage.completed;
      return { ...stage, unlocked };
    });
  }, [
    profile,
    masteredVocabCount,
    cardsWithCollocations,
    conversations,
    readingSessions,
    writingSessions,
    listeningAll,
    dictation,
    currentLevel,
    nextLevel,
  ]);

  const overallProgressPct = useMemo(() => {
    if (stages.length === 0) return 0;
    const completedCount = stages.filter((s) => s.completed).length;
    return Math.round((completedCount / stages.length) * 100);
  }, [stages]);

  const currentStageId = stages.find((s) => s.unlocked && !s.completed)?.id ?? null;

  return (
    <div className="max-w-3xl space-y-6 p-4 md:space-y-8 md:p-6">
      <div>
        <h1 className="text-xl font-bold mb-2 md:text-2xl flex items-center gap-2">
          <MapIcon className="h-5 w-5" />
          Your Learning Roadmap
        </h1>
        <p className="text-muted-foreground text-sm">
          Progressing from {currentLevel} to {nextLevel}. This tracks real
          practice, not a fixed curriculum — milestones unlock naturally as
          you go.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              {currentLevel} &rarr; {nextLevel}
            </span>
            <span className="text-muted-foreground">{overallProgressPct}% complete</span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-muted">
            <div
              className="h-2.5 rounded-full bg-primary transition-all"
              style={{ width: `${overallProgressPct}%` }}
            />
          </div>
        </CardContent>
      </Card>

      <div>
        {stages.map((stage) => (
          <StageRow
            key={stage.id}
            stage={stage}
            isCurrent={stage.id === currentStageId}
          />
        ))}
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Circle className="size-3" />
        Listening progress is tracked locally in this browser once you
        complete exercises on the Listening page.
      </p>
    </div>
  );
};

export default RoadmapPage;
