"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Check,
  Lightbulb,
  Loader2,
  Plus,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScoreCard } from "@/components/feedback/score-card";
import { CorrectionEntry } from "@/components/feedback/correction-entry";
import { HighlightPraise } from "@/components/feedback/highlight-praise";
import { WordCard } from "@/components/feedback/word-card";
import { ErrorState } from "@/components/states/error-state";
import { db } from "@/lib/db";
import { dbHelpers } from "@/lib/db-helpers";
import { recordCost } from "@/lib/cost-tracker";
import { conversationReviewSchema, toJsonSchema } from "@/lib/ai-schemas";
import { normalizeTo100 } from "@/lib/rubric";
import type { Card as SrsCard, ConversationReview } from "@/lib/types";

const SCORE_LABELS: Array<{ key: keyof ConversationReview["scores"]; label: string }> = [
  { key: "fluency", label: "Fluency" },
  { key: "accuracy", label: "Accuracy" },
  { key: "vocabulary", label: "Vocabulary" },
  { key: "complexity", label: "Complexity" },
];

const REVIEW_SYSTEM_PROMPT = `You are an expert English tutor analyzing a completed conversation practice session.
Your job is to produce a structured review that helps the learner improve.

Return ONLY a valid JSON object — no markdown code fences, no explanation before or after the JSON.
The JSON must exactly match this schema:

{
  "scores": {
    "fluency": number (1-10),
    "accuracy": number (1-10),
    "vocabulary": number (1-10),
    "complexity": number (1-10)
  },
  "errors": [
    { "original": string, "corrected": string, "explanation": string }
  ],
  "improvements": [
    { "original": string, "improved": string, "context": string }
  ],
  "highlights": [
    { "text": string, "reason": string }
  ],
  "newVocabulary": [
    { "word": string, "lemma": string, "definition": string, "example": string, "collocations": string[], "wordFamily": string }
  ]
}

Guidelines:
- Only analyze the user's messages, not the assistant's.
- "errors" are actual grammar/word-choice mistakes the user made — pair each with a clear, concise explanation.
- "improvements" are places where the user's English was correct but not idiomatic — suggest a more natural or native-sounding phrasing, with the surrounding context.
- "highlights" are things the user genuinely did well (good word choice, correct complex structure, natural phrasing) — be specific and honest, do not invent praise if there is nothing notable.
- "newVocabulary" are useful words or phrases from the conversation (assistant's or user's) that are worth the learner adding to their vocabulary list — include the dictionary lemma form.
- For each "newVocabulary" item, include "collocations": 3-5 common collocations/word partnerships for that word (e.g., for "resist": "resist temptation", "resist change", "resist the urge"). Return them as an array of short strings.
- For each "newVocabulary" item, include "wordFamily": one related word from the same word family (e.g., for "resist": "resistance", for "decide": "decision"). Use an empty string if there is no useful related form.
- The "example" sentence for each "newVocabulary" item must be a DIFFERENT sentence from how the word was actually used in this conversation — write a fresh example that shows the word in a new context, so the learner sees it used more than one way.
- Be encouraging in tone, but honest and precise about errors.
- If there are no errors, improvements, highlights, or new vocabulary, return an empty array for that field — do not omit the field.
- Output must be parseable by JSON.parse with no post-processing.`;

const buildReviewPrompt = (
  messages: Array<{ role: string; content: string }>
): string => {
  const transcript = messages
    .map((m) => `${m.role === "user" ? "USER" : "ASSISTANT"}: ${m.content}`)
    .join("\n");
  return `Here is the full transcript of an English conversation practice session:\n\n${transcript}\n\nAnalyze this conversation and return the JSON review described in the system prompt.`;
};

const extractKeyWord = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");

type ItemKind = "error" | "improvement" | "vocabulary";

const ReviewPage = () => {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const conversationId = params.id;

  const conversationResult = useLiveQuery(
    async () => {
      const c = await db.conversations.get(conversationId);
      return c === undefined ? ("not-found" as const) : c;
    },
    [conversationId]
  );
  const conversation =
    conversationResult === undefined || conversationResult === "not-found"
      ? null
      : conversationResult;
  const convLoading = conversationResult === undefined;
  const convNotFound = conversationResult === "not-found";

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [addedKeys, setAddedKeys] = useState<Set<string>>(new Set());
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const generationStartedRef = useRef(false);

  const generateReview = useCallback(async () => {
    if (!conversation) return;
    setIsGenerating(true);
    setGenerationError(null);

    try {
      const prompt = buildReviewPrompt(conversation.messages);
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          system: REVIEW_SYSTEM_PROMPT,
          schema: toJsonSchema(conversationReviewSchema),
          maxOutputTokens: 8192,
          disableThinking: true, // scoring/extraction — no reasoning pass needed
        }),
      });

      if (!res.ok) {
        throw new Error(`Review request failed (${res.status})`);
      }

      const data = (await res.json()) as {
        object?: ConversationReview;
        usage?: { inputTokens: number; outputTokens: number };
        model?: string;
      };
      if (!data.object) {
        throw new Error("Empty response from review service");
      }

      if (data.usage && data.model) {
        recordCost({
          model: data.model,
          inputTokens: data.usage.inputTokens ?? 0,
          outputTokens: data.usage.outputTokens ?? 0,
          module: "conversation",
        });
      }

      // AI grades on a 1-10 scale; normalize to 0-100 before storing so both
      // the persisted record and the in-session render (via useLiveQuery,
      // which reflects this write) agree with the rest of the app's scale.
      const normalizedReview: ConversationReview = {
        ...data.object,
        scores: {
          fluency: normalizeTo100(data.object.scores.fluency),
          accuracy: normalizeTo100(data.object.scores.accuracy),
          vocabulary: normalizeTo100(data.object.scores.vocabulary),
          complexity: normalizeTo100(data.object.scores.complexity),
        },
      };
      await db.conversations.update(conversationId, { review: normalizedReview });
    } catch (err) {
      setGenerationError(
        err instanceof Error ? err.message : "Failed to generate review"
      );
    } finally {
      setIsGenerating(false);
    }
  }, [conversation, conversationId]);

  useEffect(() => {
    if (!conversation) return;
    if (conversation.review !== null) return;
    if (generationStartedRef.current) return;
    if (isGenerating || generationError) return;
    generationStartedRef.current = true;
    const timer = setTimeout(() => void generateReview(), 0);
    return () => clearTimeout(timer);
  }, [conversation, isGenerating, generationError, generateReview]);

  const handleRetry = () => {
    generationStartedRef.current = false;
    setGenerationError(null);
    void generateReview();
  };

  const handleAddToSrs = async (
    kind: ItemKind,
    key: string,
    cardData: Pick<SrsCard, "type" | "lemma" | "front" | "back" | "context"> &
      Partial<Pick<SrsCard, "collocations" | "wordFamily">>
  ) => {
    if (!conversation || addedKeys.has(key) || addingKey) return;
    setAddingKey(key);
    try {
      const existing = await dbHelpers.getCardByLemma(cardData.lemma);
      if (!existing) {
        const newCard: SrsCard = {
          id: crypto.randomUUID(),
          type: cardData.type,
          lemma: cardData.lemma,
          front: cardData.front,
          back: cardData.back,
          context: cardData.context,
          source: "conversation",
          sourceId: conversation.id,
          easeFactor: 2.5,
          interval: 0,
          repetitions: 0,
          nextReview: new Date(),
          masteryLevel: "new",
          createdAt: new Date(),
          lastReviewedAt: null,
          ...(cardData.collocations ? { collocations: cardData.collocations } : {}),
          ...(cardData.wordFamily ? { wordFamily: cardData.wordFamily } : {}),
        };
        await db.cards.add(newCard);
        await dbHelpers.incrementTodayStat("wordsLearned");
      }
      setAddedKeys((prev) => new Set(prev).add(key));
    } finally {
      setAddingKey(null);
    }
  };

  if (convLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (convNotFound || !conversation) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-sm text-muted-foreground">Conversation not found.</p>
        <Button variant="outline" onClick={() => router.push("/conversation")}>
          <ArrowLeft className="h-4 w-4" />
          Back to Conversations
        </Button>
      </div>
    );
  }

  const review = conversation.review;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-6 overflow-y-auto pb-8">
      <div className="flex items-center justify-between pt-2">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2"
          onClick={() => router.push("/conversation")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Conversations
        </Button>
        <Button onClick={() => router.push("/conversation")}>
          Start New Conversation
        </Button>
      </div>

      <div>
        <h1 className="text-xl font-semibold">{conversation.scenario}</h1>
        <p className="text-sm text-muted-foreground">
          {conversation.messages.length} messages &middot;{" "}
          {Math.round(conversation.duration / 60)} min
        </p>
      </div>

      {review === null &&
        (generationError ? (
          <ErrorState
            title="Couldn't generate review"
            description={generationError}
            onRetry={handleRetry}
          />
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Generating Review...
              </p>
            </CardContent>
          </Card>
        ))}

      {review !== null && (
        <>
          {/* Score Card */}
          <ScoreCard
            overallScore={Math.round(
              SCORE_LABELS.reduce((sum, { key }) => sum + review.scores[key], 0) /
                SCORE_LABELS.length
            )}
            overallLabel="SCORE"
            title="Your scores"
            subtitle="Averaged across four dimensions"
            dimensions={SCORE_LABELS.map(({ key, label }) => ({
              label,
              score: review.scores[key],
              max: 100,
            }))}
          />

          {/* Errors */}
          {review.errors.length > 0 && (
            <Card className="border-destructive/30 bg-destructive/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  Error Corrections
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {review.errors.map((error, i) => {
                  const key = `error-${i}`;
                  const isAdded = addedKeys.has(key);
                  return (
                    <div key={key} className="space-y-2">
                      <CorrectionEntry
                        kind="correction"
                        original={error.original}
                        corrected={error.corrected}
                        explanation={error.explanation}
                      />
                      <Button
                        size="sm"
                        variant={isAdded ? "secondary" : "outline"}
                        disabled={isAdded || addingKey === key}
                        onClick={() =>
                          handleAddToSrs("error", key, {
                            type: "error",
                            lemma: extractKeyWord(error.original),
                            front: error.original,
                            back: `${error.corrected}\n\n${error.explanation}`,
                            context: error.explanation,
                          })
                        }
                      >
                        {isAdded ? (
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
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Improvements */}
          {review.improvements.length > 0 && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-500">
                  <Lightbulb className="h-4 w-4" />
                  Expression Improvements
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {review.improvements.map((improvement, i) => {
                  const key = `improvement-${i}`;
                  const isAdded = addedKeys.has(key);
                  return (
                    <div key={key} className="space-y-2">
                      <CorrectionEntry
                        kind="word-choice"
                        original={improvement.original}
                        corrected={improvement.improved}
                        explanation={improvement.context}
                      />
                      <Button
                        size="sm"
                        variant={isAdded ? "secondary" : "outline"}
                        disabled={isAdded || addingKey === key}
                        onClick={() =>
                          handleAddToSrs("improvement", key, {
                            type: "expression",
                            lemma: extractKeyWord(improvement.original),
                            front: improvement.original,
                            back: improvement.improved,
                            context: improvement.context,
                          })
                        }
                      >
                        {isAdded ? (
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
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Highlights */}
          {review.highlights.length > 0 && (
            <div className="space-y-3">
              {review.highlights.map((highlight, i) => (
                <HighlightPraise key={`highlight-${i}`} title="Positive highlight">
                  &ldquo;{highlight.text}&rdquo;
                  <span className="mt-1 block text-sm text-muted-foreground">
                    {highlight.reason}
                  </span>
                </HighlightPraise>
              ))}
            </div>
          )}

          {/* New Vocabulary */}
          {review.newVocabulary.length > 0 && (
            <Card className="border-blue-500/30 bg-blue-500/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-blue-600 dark:text-blue-500">
                  <BookOpen className="h-4 w-4" />
                  New Vocabulary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {review.newVocabulary.map((vocab, i) => {
                  const key = `vocab-${i}`;
                  const isAdded = addedKeys.has(key);
                  return (
                    <div key={key} className="space-y-1">
                      <WordCard
                        word={vocab.word}
                        definition={vocab.definition}
                        example={vocab.example}
                        added={isAdded}
                        addDisabled={addingKey === key}
                        onAdd={() =>
                          handleAddToSrs("vocabulary", key, {
                            type: "vocabulary",
                            lemma: vocab.lemma,
                            front: vocab.word,
                            back: vocab.definition,
                            context: vocab.example,
                            collocations: vocab.collocations,
                            wordFamily: vocab.wordFamily,
                          })
                        }
                      />
                      {((vocab.collocations && vocab.collocations.length > 0) ||
                        vocab.wordFamily) && (
                        <div className="px-1 text-xs text-muted-foreground">
                          {vocab.collocations && vocab.collocations.length > 0 && (
                            <p>
                              <span className="font-medium">Collocations: </span>
                              {vocab.collocations.join("; ")}
                            </p>
                          )}
                          {vocab.wordFamily && (
                            <p>
                              <span className="font-medium">Word family: </span>
                              {vocab.wordFamily}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

export default ReviewPage;
