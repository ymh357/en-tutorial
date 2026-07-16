"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Loader2,
  Plus,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { dbHelpers } from "@/lib/db-helpers";
import {
  WRITING_REVIEW_ROUND1_SYSTEM,
  WRITING_REVIEW_ROUND2_SYSTEM,
} from "@/lib/writing-prompts";
import type {
  AnnotationType,
  Card as SrsCard,
  WritingAnnotation,
  WritingReview,
  WritingSession,
  WritingTaskType,
} from "@/lib/types";

interface Round1Review {
  contentScore: number;
  structureFeedback: string;
  suggestions: string[];
  strengths: string[];
  revisionPriority: string;
}

const MIN_WORDS = 10;

const TASK_TYPE_LABEL: Record<WritingTaskType, string> = {
  email: "Business Email",
  essay: "Essay",
  social: "Social Media Post",
  report: "Report Summary",
  quick: "Quick Task",
  free: "Free Writing",
};

// Shared JSON schema/guidelines appended to the round 2 (language-focused) system
// prompt so the AI knows the exact annotation format to return.
const REVIEW_JSON_SCHEMA = `

Return ONLY valid JSON (no markdown fences, no explanation outside the JSON) in this exact format:
{
  "score": <1-10>,
  "annotations": [
    {
      "type": "error" | "suggestion" | "style" | "positive",
      "start": <character index in original text>,
      "end": <character index>,
      "original": "<the text being annotated>",
      "replacement": "<suggested replacement, or same text if positive>",
      "explanation": "<why this is an error/suggestion/improvement, or why it's good>",
      "collocations": ["<correct collocation pattern(s), when relevant>"]
    }
  ],
  "polishedVersion": "<the full text rewritten with all corrections applied>",
  "errorPatterns": [
    { "category": "<e.g., tense, articles, prepositions>", "description": "<brief description>" }
  ]
}

Guidelines:
- Be encouraging while honest about errors
- Mark genuinely good expressions as "positive" type
- For "error" type: grammar mistakes, spelling errors
- For "suggestion" type: better word choices, more natural expressions
- For "style" type: register/tone improvements, sentence structure
- Annotations must have accurate start/end character positions in the original text
- Include at least 1-2 positive annotations if the writing has any merit
- Include a "collocations" array on an annotation whenever the error/suggestion involves a word partnership the learner got wrong (e.g., a wrong preposition, verb-noun pairing, or adjective-noun pairing) — show the correct collocation pattern(s) (e.g., ["depend on someone", "rely on someone"]). Omit or leave empty when not relevant (e.g., pure spelling errors or positive annotations).`;

const buildReviewPrompt = (taskPrompt: string, content: string): string =>
  `Task: ${taskPrompt || "Free writing"}\n\nStudent's writing:\n${content}\n\nAnalyze this writing and return the JSON review described in the system prompt.`;

const parseRound1Response = (raw: string): Round1Review | null => {
  let text = raw.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }
  try {
    const parsed = JSON.parse(text) as Round1Review;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.contentScore !== "number" ||
      typeof parsed.structureFeedback !== "string" ||
      !Array.isArray(parsed.suggestions) ||
      !Array.isArray(parsed.strengths) ||
      typeof parsed.revisionPriority !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const DRAFT_SAVE_DEBOUNCE_MS = 500;

const getDraftKey = (id: string): string => `en-tutor-writing-draft-${id}`;

const loadDraft = (id: string): string => {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.localStorage.getItem(getDraftKey(id));
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { content?: string };
    return typeof parsed.content === "string" ? parsed.content : "";
  } catch {
    return "";
  }
};

const saveDraft = (id: string, content: string): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getDraftKey(id), JSON.stringify({ content }));
  } catch {
    // Ignore quota-exceeded or serialization errors — draft persistence is best-effort.
  }
};

const clearDraft = (id: string): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(getDraftKey(id));
  } catch {
    // Ignore storage errors on cleanup.
  }
};

const parseReviewResponse = (raw: string): WritingReview | null => {
  let text = raw.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }
  try {
    const parsed = JSON.parse(text) as WritingReview;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.score !== "number" ||
      !Array.isArray(parsed.annotations) ||
      typeof parsed.polishedVersion !== "string" ||
      !Array.isArray(parsed.errorPatterns)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const scoreLabel = (score: number): string => {
  if (score >= 9) return "Excellent";
  if (score >= 7) return "Good";
  if (score >= 5) return "Fair";
  return "Needs Work";
};

const ANNOTATION_PRIORITY: Record<AnnotationType, number> = {
  error: 0,
  suggestion: 1,
  style: 2,
  positive: 3,
};

const ANNOTATION_CLASS: Record<AnnotationType, string> = {
  error: "bg-red-200/70 dark:bg-red-900/50",
  suggestion: "bg-yellow-200/70 dark:bg-yellow-900/50",
  style: "bg-blue-200/70 dark:bg-blue-900/50",
  positive: "bg-green-200/70 dark:bg-green-900/50",
};

const ANNOTATION_LABEL: Record<AnnotationType, string> = {
  error: "Grammar Error",
  suggestion: "Word Choice",
  style: "Style",
  positive: "Excellent",
};

type Segment = {
  text: string;
  annotationIndex: number | null;
};

// Split the text into segments at annotation boundaries. When ranges overlap,
// the higher-priority annotation type (error > suggestion > style > positive)
// wins for the overlapping portion.
const buildSegments = (
  text: string,
  annotations: WritingAnnotation[]
): Segment[] => {
  if (annotations.length === 0) {
    return [{ text, annotationIndex: null }];
  }

  const boundaries = new Set<number>([0, text.length]);
  annotations.forEach((a) => {
    boundaries.add(Math.max(0, Math.min(a.start, text.length)));
    boundaries.add(Math.max(0, Math.min(a.end, text.length)));
  });
  const sorted = Array.from(boundaries).sort((a, b) => a - b);

  const segments: Segment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (start >= end) continue;

    let bestIndex: number | null = null;
    let bestPriority = Infinity;
    annotations.forEach((a, idx) => {
      if (a.start <= start && a.end >= end) {
        const priority = ANNOTATION_PRIORITY[a.type];
        if (priority < bestPriority) {
          bestPriority = priority;
          bestIndex = idx;
        }
      }
    });

    segments.push({ text: text.slice(start, end), annotationIndex: bestIndex });
  }
  return segments;
};

const WritingEditorPage = () => {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();

  const sessionId = params.id;
  const taskType = (searchParams.get("type") as WritingTaskType | null) ?? "free";
  const taskPrompt = searchParams.get("prompt")
    ? decodeURIComponent(searchParams.get("prompt") as string)
    : "";

  const [content, setContent] = useState(() => loadDraft(sessionId));
  const [phase, setPhase] = useState<"writing" | "review">("writing");
  // null = writing phase (before round 1 or after revising for round 2);
  // 1 = round 1 (content/structure) result is showing; 2 = round 2 (language) result is showing.
  const [reviewRound, setReviewRound] = useState<1 | 2 | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [round1Review, setRound1Review] = useState<Round1Review | null>(null);
  const [review, setReview] = useState<WritingReview | null>(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState<number | null>(
    null
  );
  const [addedKeys, setAddedKeys] = useState<Set<number>>(new Set());
  const [addingKey, setAddingKey] = useState<number | null>(null);
  const [startTime] = useState<number>(() => Date.now());

  // Check whether this writing session already exists (e.g. the user
  // navigated back to a previous session's URL) so we can restore it
  // instead of starting a blank editor.
  const existingSession = useLiveQuery(
    () => db.writingSessions.get(sessionId),
    [sessionId]
  );
  const [restoredSessionId, setRestoredSessionId] = useState<string | null>(
    null
  );

  // Restore a previously saved session: if it has a review, jump straight to
  // the review display; otherwise pre-fill the editor with the saved content.
  // Adjusting state during render (rather than in a useEffect) avoids an
  // extra render pass, per https://react.dev/learn/you-might-not-need-an-effect.
  if (existingSession && restoredSessionId !== existingSession.id) {
    setRestoredSessionId(existingSession.id);
    setContent(existingSession.content);
    if (existingSession.review) {
      setReview(existingSession.review);
      setReviewRound(2);
      setPhase("review");
      // Round 1 detail isn't persisted, so show a minimal placeholder rather
      // than blocking the review screen (which requires round1Review).
      setRound1Review({
        contentScore: existingSession.review.score,
        structureFeedback: "",
        suggestions: [],
        strengths: [],
        revisionPriority: "",
      });
    } else {
      setPhase("writing");
    }
  }

  // Debounced auto-save of the draft to localStorage while writing.
  useEffect(() => {
    if (phase !== "writing") return;
    const timer = setTimeout(() => {
      if (content.trim()) {
        saveDraft(sessionId, content);
      } else {
        clearDraft(sessionId);
      }
    }, DRAFT_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [content, sessionId, phase]);

  // Warn before leaving the tab if there's unsaved, unsubmitted writing.
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (phase === "writing" && content.trim()) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [phase, content]);

  const wordCount = useMemo(
    () => content.trim().split(/\s+/).filter(Boolean).length,
    [content]
  );

  const canSubmit = wordCount >= MIN_WORDS && !isReviewing;

  const segments = useMemo(
    () => (review ? buildSegments(content, review.annotations) : []),
    [review, content]
  );

  const runRound1Review = async (): Promise<void> => {
    setIsReviewing(true);
    setReviewError(null);

    try {
      const prompt = buildReviewPrompt(taskPrompt, content);
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, system: WRITING_REVIEW_ROUND1_SYSTEM }),
      });

      if (!res.ok) {
        throw new Error(`Review request failed (${res.status})`);
      }

      const data = (await res.json()) as { content?: string };
      if (!data.content) {
        throw new Error("Empty response from review service");
      }

      const parsedRound1 = parseRound1Response(data.content);
      if (!parsedRound1) {
        throw new Error("Could not parse the AI's review response");
      }

      setRound1Review(parsedRound1);
      setReviewRound(1);
      setPhase("review");
    } catch (err) {
      setReviewError(
        err instanceof Error ? err.message : "Failed to generate review"
      );
    } finally {
      setIsReviewing(false);
    }
  };

  const runRound2Review = async (): Promise<void> => {
    setIsReviewing(true);
    setReviewError(null);

    try {
      const prompt = buildReviewPrompt(taskPrompt, content);
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          system: WRITING_REVIEW_ROUND2_SYSTEM + REVIEW_JSON_SCHEMA,
        }),
      });

      if (!res.ok) {
        throw new Error(`Review request failed (${res.status})`);
      }

      const data = (await res.json()) as { content?: string };
      if (!data.content) {
        throw new Error("Empty response from review service");
      }

      const parsedReview = parseReviewResponse(data.content);
      if (!parsedReview) {
        throw new Error("Could not parse the AI's review response");
      }

      const session: WritingSession = {
        id: sessionId,
        taskType,
        taskPrompt,
        content,
        wordCount,
        review: parsedReview,
        createdAt: new Date(),
      };
      await db.writingSessions.put(session);

      const errorCount = parsedReview.annotations.filter(
        (a) => a.type === "error" || a.type === "suggestion"
      ).length;
      const timeSpentSeconds = Math.round((Date.now() - startTime) / 1000);
      await dbHelpers.incrementTodayStat("writingCount");
      if (errorCount > 0) {
        await dbHelpers.incrementTodayStat("wordsLearned", errorCount);
      }
      await dbHelpers.incrementTodayStat("timeSpent", timeSpentSeconds);
      await dbHelpers.updateStreak();

      clearDraft(sessionId);
      setReview(parsedReview);
      setReviewRound(2);
      setPhase("review");
    } catch (err) {
      setReviewError(
        err instanceof Error ? err.message : "Failed to generate review"
      );
    } finally {
      setIsReviewing(false);
    }
  };

  const handleSubmit = (): void => {
    if (!canSubmit) return;
    void runRound1Review();
  };

  const handleSubmitRound2 = (): void => {
    if (!canSubmit) return;
    void runRound2Review();
  };

  const handleRetry = (): void => {
    setReviewError(null);
    if (round1Review === null) {
      void runRound1Review();
    } else {
      void runRound2Review();
    }
  };

  const handleReviseAndResubmit = (): void => {
    setReviewError(null);
    setPhase("writing");
  };

  const handleAddToSrs = async (
    index: number,
    annotation: WritingAnnotation
  ): Promise<void> => {
    if (addedKeys.has(index) || addingKey !== null) return;
    setAddingKey(index);
    try {
      const lemma = annotation.original
        .toLowerCase()
        .replace(/[^a-z\s]/g, "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 4)
        .join(" ");

      const existing = await dbHelpers.getCardByLemma(lemma);
      if (!existing) {
        const newCard: SrsCard = {
          id: crypto.randomUUID(),
          type: "error",
          lemma,
          front: annotation.original,
          back: `${annotation.replacement}\n\n${annotation.explanation}`,
          context: annotation.explanation,
          source: "writing",
          sourceId: sessionId,
          easeFactor: 2.5,
          interval: 0,
          repetitions: 0,
          nextReview: new Date(),
          masteryLevel: "new",
          createdAt: new Date(),
          lastReviewedAt: null,
          ...(annotation.collocations && annotation.collocations.length > 0
            ? { collocations: annotation.collocations }
            : {}),
        };
        await db.cards.add(newCard);
        await dbHelpers.incrementTodayStat("wordsLearned");
      }
      setAddedKeys((prev) => new Set(prev).add(index));
    } finally {
      setAddingKey(null);
    }
  };

  // ---- Phase 1: Writing ----
  if (phase === "writing") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 pb-8 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 min-h-[44px]"
            onClick={() => router.push("/writing")}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <Badge variant="outline">{TASK_TYPE_LABEL[taskType]}</Badge>
        </div>

        {taskPrompt && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Task</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-normal break-words text-sm text-muted-foreground">
                {taskPrompt}
              </p>
            </CardContent>
          </Card>
        )}

        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Start writing here..."
          className="min-h-[320px] w-full resize-y text-base leading-relaxed"
          disabled={isReviewing}
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-muted-foreground">
            {wordCount} {wordCount === 1 ? "word" : "words"}
            {wordCount < MIN_WORDS && ` (minimum ${MIN_WORDS})`}
          </span>
          <Button
            onClick={round1Review === null ? handleSubmit : handleSubmitRound2}
            disabled={!canSubmit}
            className="w-full min-h-[44px] sm:w-auto"
          >
            {isReviewing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing your writing...
              </>
            ) : round1Review === null ? (
              "Submit for Content Review"
            ) : (
              "Submit for Language Review"
            )}
          </Button>
        </div>

        {reviewError && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="flex flex-col items-center gap-3 py-6">
              <AlertTriangle className="h-6 w-6 text-destructive" />
              <p className="text-center text-sm text-muted-foreground break-words">
                {reviewError}
              </p>
              <Button onClick={handleRetry} className="min-h-[44px]">
                Retry
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // ---- Phase 2: Review ----
  if (!round1Review) return null;

  const selected =
    review && selectedAnnotation !== null
      ? review.annotations[selectedAnnotation]
      : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 pb-8 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 min-h-[44px]"
          onClick={() => router.push("/writing")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Writing
        </Button>
        <Badge variant="outline">{TASK_TYPE_LABEL[taskType]}</Badge>
      </div>

      {/* Round 1: Content & Structure Review (not available when a saved
          session with a final review is restored directly, since only the
          round 2 review is persisted). */}
      {round1Review.structureFeedback && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
              <span>Round 1 · Content &amp; Structure</span>
              <span className="text-2xl font-bold">
                {round1Review.contentScore}
                <span className="text-sm font-normal text-muted-foreground">
                  {" "}
                  / 10
                </span>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="whitespace-normal break-words">
              {round1Review.structureFeedback}
            </p>

            {round1Review.suggestions.length > 0 && (
              <div className="space-y-1.5">
                <p className="font-medium">Suggestions</p>
                <ul className="list-disc space-y-1 pl-5">
                  {round1Review.suggestions.map((s, i) => (
                    <li key={i} className="whitespace-normal break-words">
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {round1Review.strengths.length > 0 && (
              <div className="space-y-1.5">
                <p className="font-medium">Strengths</p>
                <ul className="list-disc space-y-1 pl-5">
                  {round1Review.strengths.map((s, i) => (
                    <li key={i} className="whitespace-normal break-words">
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Revision Priority
              </p>
              <p className="mt-1 whitespace-normal break-words font-medium">
                {round1Review.revisionPriority}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* After round 1, before round 2: offer revision */}
      {reviewRound === 1 && (
        <Button
          onClick={handleReviseAndResubmit}
          className="w-full min-h-[44px]"
        >
          Revise &amp; Resubmit
        </Button>
      )}

      {reviewError && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex flex-col items-center gap-3 py-6">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            <p className="text-center text-sm text-muted-foreground break-words">
              {reviewError}
            </p>
            <Button onClick={handleRetry} className="min-h-[44px]">
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Round 2: Language Review (only once submitted) */}
      {reviewRound === 2 && review && (
        <>
          {/* Overall Score */}
          <Card>
            <CardContent className="flex flex-col items-center gap-1 py-6">
              <div className="text-4xl font-bold">{review.score}</div>
              <div className="text-sm text-muted-foreground">
                {scoreLabel(review.score)} · out of 10
              </div>
            </CardContent>
          </Card>

          {/* Annotated Text */}
          <Card className="w-full overflow-hidden">
            <CardHeader>
              <CardTitle className="text-base">Your Writing</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="w-full whitespace-pre-wrap break-words text-sm leading-relaxed">
                {segments.map((segment, i) => {
                  if (segment.annotationIndex === null) {
                    return <span key={i}>{segment.text}</span>;
                  }
                  const annotation = review.annotations[segment.annotationIndex];
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
                  {selected.type !== "positive" && (
                    <Button
                      size="sm"
                      variant={addedKeys.has(selectedAnnotation) ? "secondary" : "outline"}
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
              <CardContent className="space-y-2 text-sm">
                {selected.type !== "positive" && (
                  <p className="whitespace-normal break-words">
                    <span className="text-muted-foreground line-through">
                      {selected.original}
                    </span>
                    {" -> "}
                    <span className="font-medium">{selected.replacement}</span>
                  </p>
                )}
                <p className="whitespace-normal break-words text-muted-foreground">
                  {selected.explanation}
                </p>
                {selected.collocations && selected.collocations.length > 0 && (
                  <p className="whitespace-normal break-words text-muted-foreground">
                    <span className="font-medium">Collocations: </span>
                    {selected.collocations.join("; ")}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Polished Version */}
          <Card className="w-full overflow-hidden">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4" />
                Polished Version
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="w-full whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
                {review.polishedVersion}
              </p>
            </CardContent>
          </Card>

          {/* Error Patterns */}
          {review.errorPatterns.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Error Patterns</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {review.errorPatterns.map((pattern, i) => (
                  <div key={i} className="w-full rounded-lg border p-3 text-sm">
                    <p className="break-words font-medium">{pattern.category}</p>
                    <p className="mt-1 whitespace-normal break-words text-xs text-muted-foreground">
                      {pattern.description}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {reviewRound === 2 && (
        <Button
          onClick={() => router.push("/writing")}
          className="w-full min-h-[44px]"
        >
          Start New Writing Task
        </Button>
      )}
    </div>
  );
};

export default WritingEditorPage;
