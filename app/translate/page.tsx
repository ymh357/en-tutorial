"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Loader2,
  Mail,
  Megaphone,
  MessageCircle,
  Newspaper,
  Plus,
  RefreshCw,
  Star,
  Map as MapIcon,
  type LucideIcon,
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
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProfile } from "@/hooks/use-db";
import { db } from "@/lib/db";
import { dbHelpers } from "@/lib/db-helpers";
import { recordCost } from "@/lib/cost-tracker";
import { completeTask } from "@/lib/task-pool";
import { translateGenSchema, translateEvalSchema, toJsonSchema } from "@/lib/ai-schemas";
import type {
  Card as SrsCard,
  TranslationExercise as TranslationExerciseRecord,
} from "@/lib/types";
import { normalizeTo100, scoreLabel } from "@/lib/rubric";

type ExerciseMode = "sentence" | "paragraph" | "situational";

type TranslationAnnotationType = "error" | "awkward" | "good";

interface TranslationAnnotation {
  type: TranslationAnnotationType;
  text: string;
  explanation: string;
}

interface TranslationEvaluation {
  score: number;
  annotations: TranslationAnnotation[];
  polishedVersion: string;
  keyDifferences: string[];
  alternativeTranslations: string[];
  grammarNotes: string[];
}

interface TranslationExercise {
  chinese: string;
  referenceTranslation: string;
  keyPoints: string[];
  scenario?: string;
}

interface Scenario {
  id: string;
  label: string;
  icon: LucideIcon;
}

const SCENARIOS: Scenario[] = [
  { id: "business-email", label: "Business Email", icon: Mail },
  { id: "public-notice", label: "Public Notice", icon: Megaphone },
  { id: "casual-dialogue", label: "Casual Dialogue", icon: MessageCircle },
  { id: "news-headline", label: "News Report", icon: Newspaper },
  { id: "product-review", label: "Product Review", icon: Star },
  { id: "travel-guide", label: "Travel Guide", icon: MapIcon },
];

const MODE_LABEL: Record<ExerciseMode, string> = {
  sentence: "Single Sentence",
  paragraph: "Paragraph",
  situational: "Situational",
};

const ANNOTATION_CLASS: Record<TranslationAnnotationType, string> = {
  error: "bg-red-200/70 dark:bg-red-900/50",
  awkward: "bg-yellow-200/70 dark:bg-yellow-900/50",
  good: "bg-green-200/70 dark:bg-green-900/50",
};

const ANNOTATION_LABEL: Record<TranslationAnnotationType, string> = {
  error: "Error",
  awkward: "Awkward",
  good: "Good",
};

// Local shape guard for pool-task content (already an object read from
// IndexedDB, not raw AI response text — no fence-strip/JSON.parse needed).
const isTranslationExercise = (value: unknown): value is TranslationExercise => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.chinese === "string" &&
    typeof v.referenceTranslation === "string" &&
    Array.isArray(v.keyPoints)
  );
};

type Segment = {
  text: string;
  annotationIndex: number | null;
};

// Highlight the user's translation by finding each annotation's `text` as a
// substring. Unlike the writing editor, the evaluator only returns the
// annotated phrase (no char offsets), since it's comparing two separate texts.
const buildSegments = (
  text: string,
  annotations: TranslationAnnotation[]
): Segment[] => {
  type Range = { start: number; end: number; annotationIndex: number };
  const ranges: Range[] = [];

  annotations.forEach((a, idx) => {
    if (!a.text) return;
    const lowerText = text.toLowerCase();
    const lowerNeedle = a.text.toLowerCase();
    const start = lowerText.indexOf(lowerNeedle);
    if (start === -1) return;
    ranges.push({ start, end: start + a.text.length, annotationIndex: idx });
  });

  if (ranges.length === 0) {
    return [{ text, annotationIndex: null }];
  }

  ranges.sort((a, b) => a.start - b.start);

  const segments: Segment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue; // skip overlapping matches
    if (range.start > cursor) {
      segments.push({ text: text.slice(cursor, range.start), annotationIndex: null });
    }
    segments.push({
      text: text.slice(range.start, range.end),
      annotationIndex: range.annotationIndex,
    });
    cursor = range.end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), annotationIndex: null });
  }
  return segments;
};

const buildGenerationPrompt = (
  mode: ExerciseMode,
  level: string,
  scenario: Scenario | null
): { system: string; prompt: string } => {
  const system = `You are generating Chinese text for English translation practice at ${level} level.`;

  if (mode === "paragraph") {
    return {
      system,
      prompt:
        'Generate a 3-5 sentence Chinese paragraph on a random daily topic. Return ONLY valid JSON (no markdown fences): { "chinese": "...", "referenceTranslation": "...", "keyPoints": ["..."] }',
    };
  }

  if (mode === "situational" && scenario) {
    return {
      system,
      prompt: `Generate a short Chinese text in ${scenario.label} format (business email / public notice / casual dialogue / news report / product review / travel guide, matching "${scenario.label}"). Return ONLY valid JSON (no markdown fences): { "chinese": "...", "referenceTranslation": "...", "keyPoints": ["..."], "scenario": "${scenario.label}" }`,
    };
  }

  return {
    system,
    prompt: `Generate one Chinese sentence suitable for translation practice. The sentence should use vocabulary and grammar that maps to ${level} English. Return ONLY valid JSON (no markdown fences): { "chinese": "...", "referenceTranslation": "...", "keyPoints": ["point1", "point2"] }`,
  };
};

const EVAL_SYSTEM_PROMPT =
  "You are an English translation teacher evaluating a student's Chinese-to-English translation.";

const buildEvalPrompt = (
  chinese: string,
  reference: string,
  userTranslation: string
): string =>
  `Original Chinese: ${chinese}\nReference translation: ${reference}\nStudent's translation: ${userTranslation}\n\nEvaluate the translation and return ONLY valid JSON (no markdown fences) in this exact format:\n{\n  "score": 1-10,\n  "annotations": [\n    { "type": "error"|"awkward"|"good", "text": "the phrase", "explanation": "why" }\n  ],\n  "polishedVersion": "improved version of student's translation",\n  "keyDifferences": ["difference 1", "difference 2"],\n  "alternativeTranslations": ["another acceptable version"],\n  "grammarNotes": ["note about specific grammar point"]\n}`;

const TranslatePage = () => {
  const profile = useProfile();
  const cefrLevel = profile?.studyLevel || "B1";

  const [mode, setMode] = useState<ExerciseMode>("sentence");
  const [scenario, setScenario] = useState<Scenario | null>(null);

  const [exercise, setExercise] = useState<TranslationExercise | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const [userTranslation, setUserTranslation] = useState("");
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<TranslationEvaluation | null>(
    null
  );
  const [selectedAnnotation, setSelectedAnnotation] = useState<number | null>(
    null
  );
  const [addedKeys, setAddedKeys] = useState<Set<number>>(new Set());
  const [addingKey, setAddingKey] = useState<number | null>(null);

  const [sessionCount, setSessionCount] = useState(0);
  const [scoreSum, setScoreSum] = useState(0);

  const wordCount = useMemo(
    () => userTranslation.trim().split(/\s+/).filter(Boolean).length,
    [userTranslation]
  );

  const segments = useMemo(
    () =>
      evaluation ? buildSegments(userTranslation, evaluation.annotations) : [],
    [evaluation, userTranslation]
  );

  const averageScore =
    sessionCount > 0 ? (scoreSum / sessionCount).toFixed(1) : null;

  const resetExerciseState = (): void => {
    setUserTranslation("");
    setEvaluation(null);
    setEvalError(null);
    setSelectedAnnotation(null);
    setAddedKeys(new Set());
  };

  const generateExercise = async (targetMode: ExerciseMode): Promise<void> => {
    if (targetMode === "situational" && !scenario) return;

    setIsGenerating(true);
    setGenerateError(null);
    resetExerciseState();
    setExercise(null);

    // Map mode to pool task type
    const poolTypeMap: Record<ExerciseMode, string> = {
      sentence: "translation-sentence",
      paragraph: "translation-paragraph",
      situational: "translation-situational",
    };

    // Try pool first
    try {
      const poolTask = await db.poolTasks
        .where("type").equals(poolTypeMap[targetMode])
        .and(t => !t.completed && t.assignedDate !== "")
        .first();

      if (poolTask) {
        const content = poolTask.content as Record<string, unknown>;

        if (targetMode === "sentence") {
          // Sentence pool has { items: [{ chinese, referenceTranslation, keyPoints }] }
          const items = content.items as TranslationExercise[] | undefined;
          if (items && items.length > 0) {
            setExercise(items[0]);
            await completeTask(poolTask.id);
            setIsGenerating(false);
            return;
          }
        } else {
          // Paragraph and situational have { chinese, referenceTranslation, keyPoints }
          if (isTranslationExercise(content)) {
            setExercise(content);
            await completeTask(poolTask.id);
            setIsGenerating(false);
            return;
          }
        }
      }
    } catch {
      // Fall through to real-time generation
    }

    // Fallback to real-time generation
    try {
      const { system, prompt } = buildGenerationPrompt(
        targetMode,
        cefrLevel,
        scenario
      );
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          system,
          schema: toJsonSchema(translateGenSchema),
        }),
      });

      if (!res.ok) {
        throw new Error(`Generation request failed (${res.status})`);
      }

      const data = (await res.json()) as {
        object?: TranslationExercise;
        usage?: { inputTokens: number; outputTokens: number };
        model?: string;
      };
      if (!data.object) {
        throw new Error("Empty response from generation service");
      }

      if (data.usage && data.model) {
        recordCost({
          model: data.model,
          inputTokens: data.usage.inputTokens ?? 0,
          outputTokens: data.usage.outputTokens ?? 0,
          module: "translate",
        });
      }

      setExercise(data.object);
    } catch (err) {
      setGenerateError(
        err instanceof Error ? err.message : "Failed to generate exercise"
      );
    } finally {
      setIsGenerating(false);
    }
  };

  // On mount, check which translation pool task type (if any) has ready
  // content and auto-select + auto-generate that mode so the user lands on
  // ready content instead of having to choose a mode first.
  useEffect(() => {
    const pickMode = async () => {
      try {
        const poolTypeByMode: Record<"sentence" | "paragraph", string> = {
          sentence: "translation-sentence",
          paragraph: "translation-paragraph",
        };
        for (const m of ["sentence", "paragraph"] as const) {
          const task = await db.poolTasks
            .where("type").equals(poolTypeByMode[m])
            .and((t) => !t.completed && t.assignedDate !== "")
            .first();
          if (task) {
            setMode(m);
            void generateExercise(m);
            return;
          }
        }
      } catch {
        // Silently ignore pool errors
      }
    };
    void pickMode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleModeChange = (value: string): void => {
    const nextMode = value as ExerciseMode;
    setMode(nextMode);
    setExercise(null);
    setGenerateError(null);
    resetExerciseState();
  };

  const handleScenarioSelect = (s: Scenario): void => {
    setScenario(s);
    void generateExercise("situational");
  };

  const runEvaluation = async (): Promise<void> => {
    if (!exercise) return;
    setIsEvaluating(true);
    setEvalError(null);

    try {
      const prompt = buildEvalPrompt(
        exercise.chinese,
        exercise.referenceTranslation,
        userTranslation
      );
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          system: EVAL_SYSTEM_PROMPT,
          schema: toJsonSchema(translateEvalSchema),
        }),
      });

      if (!res.ok) {
        throw new Error(`Evaluation request failed (${res.status})`);
      }

      const data = (await res.json()) as {
        object?: TranslationEvaluation;
        usage?: { inputTokens: number; outputTokens: number };
        model?: string;
      };
      if (!data.object) {
        throw new Error("Empty response from evaluation service");
      }

      if (data.usage && data.model) {
        recordCost({
          model: data.model,
          inputTokens: data.usage.inputTokens ?? 0,
          outputTokens: data.usage.outputTokens ?? 0,
          module: "translate",
        });
      }

      const parsed = data.object;
      setEvaluation(parsed);
      setSessionCount((c) => c + 1);
      setScoreSum((s) => s + normalizeTo100(parsed.score));

      await dbHelpers.incrementTodayStat("translationCount");
      await dbHelpers.updateStreak();

      const record: TranslationExerciseRecord = {
        id: crypto.randomUUID(),
        mode,
        chinese: exercise.chinese,
        userTranslation,
        referenceTranslation: exercise.referenceTranslation,
        score: normalizeTo100(parsed.score),
        feedback: parsed.keyDifferences.join(" "),
        createdAt: new Date(),
      };
      await db.translationExercises.add(record);
    } catch (err) {
      setEvalError(
        err instanceof Error ? err.message : "Failed to evaluate translation"
      );
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleSubmit = (): void => {
    if (!userTranslation.trim() || isEvaluating) return;
    void runEvaluation();
  };

  const handleNext = (): void => {
    void generateExercise(mode);
  };

  const handleAddToSrs = async (
    index: number,
    annotation: TranslationAnnotation
  ): Promise<void> => {
    if (addedKeys.has(index) || addingKey !== null || !exercise) return;
    setAddingKey(index);
    try {
      const lemma = annotation.text
        .toLowerCase()
        .replace(/[^a-z\s]/g, "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 4)
        .join(" ");

      if (lemma) {
        const existing = await dbHelpers.getCardByLemma(lemma);
        if (!existing) {
          const newCard: SrsCard = {
            id: crypto.randomUUID(),
            type: "error",
            lemma,
            front: annotation.text,
            back: `${exercise.referenceTranslation}\n\n${annotation.explanation}`,
            context: exercise.chinese,
            source: "translate",
            sourceId: crypto.randomUUID(),
            easeFactor: 2.5,
            interval: 0,
            repetitions: 0,
            nextReview: new Date(),
            masteryLevel: "new",
            createdAt: new Date(),
            lastReviewedAt: null,
          };
          await db.cards.add(newCard);
          await dbHelpers.incrementTodayStat("wordsLearned");
        }
      }
      setAddedKeys((prev) => new Set(prev).add(index));
    } finally {
      setAddingKey(null);
    }
  };

  const handleAddAllErrorsToSrs = async (): Promise<void> => {
    if (!evaluation) return;
    for (let i = 0; i < evaluation.annotations.length; i++) {
      const a = evaluation.annotations[i];
      if (a.type === "error" || a.type === "awkward") {
        await handleAddToSrs(i, a);
      }
    }
  };

  const selected =
    selectedAnnotation !== null && evaluation
      ? evaluation.annotations[selectedAnnotation]
      : null;

  const canSubmit = wordCount > 0 && !isEvaluating && !!exercise;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 pb-8 md:p-6">
      <div>
        <h1 className="text-xl font-bold mb-2 md:text-2xl">
          Translation Practice
        </h1>
        <p className="text-sm text-muted-foreground">
          Translate Chinese into English and get detailed AI feedback.
          {averageScore && (
            <span className="ml-1">
              Session average: {averageScore}/100 ({sessionCount} completed)
            </span>
          )}
        </p>
      </div>

      <Tabs value={mode} onValueChange={handleModeChange}>
        <TabsList className="w-max min-w-full sm:w-auto">
          <TabsTrigger value="sentence" className="whitespace-nowrap">
            Single Sentence
          </TabsTrigger>
          <TabsTrigger value="paragraph" className="whitespace-nowrap">
            Paragraph
          </TabsTrigger>
          <TabsTrigger value="situational" className="whitespace-nowrap">
            Situational
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sentence" className="pt-4">
          {!exercise && !isGenerating && mode === "sentence" && (
            <Button
              className="w-full min-h-[44px]"
              onClick={() => void generateExercise("sentence")}
            >
              Generate a Sentence
            </Button>
          )}
        </TabsContent>
        <TabsContent value="paragraph" className="pt-4">
          {!exercise && !isGenerating && mode === "paragraph" && (
            <Button
              className="w-full min-h-[44px]"
              onClick={() => void generateExercise("paragraph")}
            >
              Generate a Paragraph
            </Button>
          )}
        </TabsContent>
        <TabsContent value="situational" className="pt-4">
          {mode === "situational" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Choose a scenario:
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {SCENARIOS.map((s) => {
                  const Icon = s.icon;
                  const isActive = scenario?.id === s.id;
                  return (
                    <Card
                      key={s.id}
                      className={`cursor-pointer min-h-[44px] transition-colors hover:border-primary/50 ${
                        isActive ? "border-primary" : ""
                      }`}
                      onClick={() => handleScenarioSelect(s)}
                    >
                      <CardHeader className="flex flex-col items-center gap-1 py-3 px-2 text-center">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <CardTitle className="text-xs font-medium">
                          {s.label}
                        </CardTitle>
                      </CardHeader>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {isGenerating && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Generating exercise...
            </p>
          </CardContent>
        </Card>
      )}

      {generateError && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex flex-col items-center gap-3 py-6">
            <p className="text-center text-sm text-muted-foreground break-words">
              {generateError}
            </p>
            <Button
              className="min-h-[44px]"
              onClick={() => void generateExercise(mode)}
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {exercise && (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">Chinese</CardTitle>
                <Badge variant="outline">
                  {exercise.scenario ?? MODE_LABEL[mode]} · {cefrLevel}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap break-words text-base leading-relaxed">
                {exercise.chinese}
              </p>
            </CardContent>
          </Card>

          {!evaluation && (
            <div className="space-y-3">
              <Textarea
                value={userTranslation}
                onChange={(e) => setUserTranslation(e.target.value)}
                placeholder="Write your English translation here..."
                className="min-h-[160px] w-full resize-y text-base leading-relaxed"
                disabled={isEvaluating}
              />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm text-muted-foreground">
                  Word count: {wordCount}
                </span>
                <Button
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="w-full min-h-[44px] sm:w-auto"
                >
                  {isEvaluating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Evaluating...
                    </>
                  ) : (
                    "Submit for Review"
                  )}
                </Button>
              </div>

              {evalError && (
                <Card className="border-destructive/30 bg-destructive/5">
                  <CardContent className="flex flex-col items-center gap-3 py-6">
                    <p className="text-center text-sm text-muted-foreground break-words">
                      {evalError}
                    </p>
                    <Button
                      className="min-h-[44px]"
                      onClick={() => void runEvaluation()}
                    >
                      <RefreshCw className="h-4 w-4" />
                      Retry
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </>
      )}

      {evaluation && exercise && (
        <>
          {/* Score */}
          <Card>
            <CardContent className="flex flex-col items-center gap-1 py-6">
              <div className="text-4xl font-bold">{normalizeTo100(evaluation.score)}</div>
              <div className="text-sm text-muted-foreground">
                {scoreLabel(normalizeTo100(evaluation.score))} · out of 100
              </div>
            </CardContent>
          </Card>

          {/* User translation with annotations */}
          <Card className="w-full overflow-hidden">
            <CardHeader>
              <CardTitle className="text-base">Your Translation</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="w-full whitespace-pre-wrap break-words text-sm leading-relaxed">
                {segments.map((segment, i) => {
                  if (segment.annotationIndex === null) {
                    return <span key={i}>{segment.text}</span>;
                  }
                  const annotation = evaluation.annotations[segment.annotationIndex];
                  return (
                    <span
                      key={i}
                      role="button"
                      tabIndex={0}
                      className={`cursor-pointer rounded px-0.5 ${ANNOTATION_CLASS[annotation.type]} ${
                        selectedAnnotation === segment.annotationIndex
                          ? "ring-2 ring-foreground/40"
                          : ""
                      }`}
                      onClick={() => setSelectedAnnotation(segment.annotationIndex)}
                    >
                      {segment.text}
                    </span>
                  );
                })}
              </p>
            </CardContent>
          </Card>

          {/* Detail panel */}
          {selected && selectedAnnotation !== null && (
            <Card className={ANNOTATION_CLASS[selected.type].replace("/70", "/20")}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>{ANNOTATION_LABEL[selected.type]}</span>
                  {selected.type !== "good" && (
                    <Button
                      size="sm"
                      variant={
                        addedKeys.has(selectedAnnotation) ? "secondary" : "outline"
                      }
                      disabled={
                        addedKeys.has(selectedAnnotation) ||
                        addingKey === selectedAnnotation
                      }
                      onClick={() => handleAddToSrs(selectedAnnotation, selected)}
                      className="min-h-[44px]"
                    >
                      {addedKeys.has(selectedAnnotation) ? (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          Added!
                        </>
                      ) : (
                        <>
                          <Plus className="h-3.5 w-3.5" />
                          Add to SRS
                        </>
                      )}
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-normal break-words text-sm text-muted-foreground">
                  {selected.explanation}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Reference translation */}
          <Card className="w-full overflow-hidden">
            <CardHeader>
              <CardTitle className="text-base">Reference Translation</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="w-full whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
                {exercise.referenceTranslation}
              </p>
            </CardContent>
          </Card>

          {/* Polished version */}
          <Card className="w-full overflow-hidden">
            <CardHeader>
              <CardTitle className="text-base">Polished Version</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="w-full whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
                {evaluation.polishedVersion}
              </p>
            </CardContent>
          </Card>

          {/* Key differences */}
          {evaluation.keyDifferences.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Key Differences</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-1.5 pl-4 text-sm text-muted-foreground">
                  {evaluation.keyDifferences.map((diff, i) => (
                    <li key={i} className="break-words">
                      {diff}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Alternative translations */}
          {evaluation.alternativeTranslations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Alternative Translations
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {evaluation.alternativeTranslations.map((alt, i) => (
                  <div key={i} className="w-full rounded-lg border p-3 text-sm">
                    <p className="break-words">{alt}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Grammar notes */}
          {evaluation.grammarNotes.length > 0 && (
            <Card>
              <CardHeader>
                <CardDescription className="text-base font-semibold text-foreground">
                  Grammar & Vocabulary Notes
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-1.5 pl-4 text-sm text-muted-foreground">
                  {evaluation.grammarNotes.map((note, i) => (
                    <li key={i} className="break-words">
                      {note}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              onClick={handleNext}
              className="w-full min-h-[44px] sm:flex-1"
            >
              <ArrowRight className="h-4 w-4" />
              Next {MODE_LABEL[mode]}
            </Button>
            {evaluation.annotations.some(
              (a) => a.type === "error" || a.type === "awkward"
            ) && (
              <Button
                variant="outline"
                onClick={() => void handleAddAllErrorsToSrs()}
                className="w-full min-h-[44px] sm:flex-1"
              >
                <Plus className="h-4 w-4" />
                Add Errors to SRS
              </Button>
            )}
          </div>

          <Button
            variant="ghost"
            className="w-full min-h-[44px]"
            render={<Link href="/" />}
          >
            Back to Dashboard
          </Button>
        </>
      )}
    </div>
  );
};

export default TranslatePage;
