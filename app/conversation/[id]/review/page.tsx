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
import { db } from "@/lib/db";
import { dbHelpers } from "@/lib/db-helpers";
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
    { "word": string, "lemma": string, "definition": string, "example": string, "collocations": string[] }
  ]
}

Guidelines:
- Only analyze the user's messages, not the assistant's.
- "errors" are actual grammar/word-choice mistakes the user made — pair each with a clear, concise explanation.
- "improvements" are places where the user's English was correct but not idiomatic — suggest a more natural or native-sounding phrasing, with the surrounding context.
- "highlights" are things the user genuinely did well (good word choice, correct complex structure, natural phrasing) — be specific and honest, do not invent praise if there is nothing notable.
- "newVocabulary" are useful words or phrases from the conversation (assistant's or user's) that are worth the learner adding to their vocabulary list — include the dictionary lemma form.
- For each "newVocabulary" item, include "collocations": 3-5 common collocations/word partnerships for that word (e.g., for "resist": "resist temptation", "resist change", "resist the urge"). Return them as an array of short strings.
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

const parseReviewResponse = (raw: string): ConversationReview | null => {
  let text = raw.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }
  try {
    const parsed = JSON.parse(text) as ConversationReview;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !parsed.scores ||
      !Array.isArray(parsed.errors) ||
      !Array.isArray(parsed.improvements) ||
      !Array.isArray(parsed.highlights) ||
      !Array.isArray(parsed.newVocabulary)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
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

  const conversation = useLiveQuery(
    () => db.conversations.get(conversationId),
    [conversationId]
  );

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
        body: JSON.stringify({ prompt, system: REVIEW_SYSTEM_PROMPT }),
      });

      if (!res.ok) {
        throw new Error(`Review request failed (${res.status})`);
      }

      const data = (await res.json()) as { content?: string };
      if (!data.content) {
        throw new Error("Empty response from review service");
      }

      const review = parseReviewResponse(data.content);
      if (!review) {
        throw new Error("Could not parse the AI's review response");
      }

      await db.conversations.update(conversationId, { review });
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

  if (conversation === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (conversation === null || !conversation) {
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

      {review === null && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10">
            {generationError ? (
              <>
                <AlertTriangle className="h-6 w-6 text-destructive" />
                <p className="text-center text-sm text-muted-foreground">
                  {generationError}
                </p>
                <Button onClick={handleRetry}>Retry</Button>
              </>
            ) : (
              <>
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Generating Review...
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {review !== null && (
        <>
          {/* Score Card */}
          <Card>
            <CardHeader>
              <CardTitle>Scores</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {SCORE_LABELS.map(({ key, label }) => (
                <div key={key} className="flex flex-col items-center gap-1">
                  <div className="text-2xl font-bold">{review.scores[key]}</div>
                  <div className="text-xs text-muted-foreground">{label}/10</div>
                </div>
              ))}
            </CardContent>
          </Card>

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
                    <div
                      key={key}
                      className="rounded-lg border bg-card p-3 text-sm"
                    >
                      <p>
                        <span className="text-destructive line-through">
                          {error.original}
                        </span>
                        {" -> "}
                        <span className="font-medium text-foreground">
                          {error.corrected}
                        </span>
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {error.explanation}
                      </p>
                      <Button
                        size="sm"
                        variant={isAdded ? "secondary" : "outline"}
                        className="mt-2"
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
                    <div
                      key={key}
                      className="rounded-lg border bg-card p-3 text-sm"
                    >
                      <p>
                        <span className="text-muted-foreground">
                          {improvement.original}
                        </span>
                        {" -> "}
                        <span className="font-medium text-foreground">
                          {improvement.improved}
                        </span>
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {improvement.context}
                      </p>
                      <Button
                        size="sm"
                        variant={isAdded ? "secondary" : "outline"}
                        className="mt-2"
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
            <Card className="border-green-500/30 bg-green-500/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-green-600 dark:text-green-500">
                  <Sparkles className="h-4 w-4" />
                  Positive Highlights
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {review.highlights.map((highlight, i) => (
                  <div
                    key={`highlight-${i}`}
                    className="rounded-lg border bg-card p-3 text-sm"
                  >
                    <p className="font-medium">&ldquo;{highlight.text}&rdquo;</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {highlight.reason}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
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
                    <div
                      key={key}
                      className="rounded-lg border bg-card p-3 text-sm"
                    >
                      <p className="font-medium">{vocab.word}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {vocab.definition}
                      </p>
                      <p className="mt-1 text-xs italic text-muted-foreground">
                        {vocab.example}
                      </p>
                      {vocab.collocations && vocab.collocations.length > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          <span className="font-medium">Collocations: </span>
                          {vocab.collocations.join("; ")}
                        </p>
                      )}
                      <Button
                        size="sm"
                        variant={isAdded ? "secondary" : "outline"}
                        className="mt-2"
                        disabled={isAdded || addingKey === key}
                        onClick={() =>
                          handleAddToSrs("vocabulary", key, {
                            type: "vocabulary",
                            lemma: vocab.lemma,
                            front: vocab.word,
                            back: vocab.definition,
                            context: vocab.example,
                            collocations: vocab.collocations,
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
        </>
      )}
    </div>
  );
};

export default ReviewPage;
