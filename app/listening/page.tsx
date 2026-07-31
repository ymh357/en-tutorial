"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Ear,
  Headphones,
  Loader2,
  Mic,
  Play,
  RotateCcw,
  Sparkles,
  Turtle,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ErrorState } from "@/components/states/error-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProfile } from "@/hooks/use-db";
import { db } from "@/lib/db";
import { dbHelpers } from "@/lib/db-helpers";
import { recordCost } from "@/lib/cost-tracker";
import { completeTask, getReusableTask } from "@/lib/task-pool";
import { speak } from "@/lib/tts";
import {
  listeningComprehensionSchema,
  listeningPredictionSchema,
  listeningPredictionEvalSchema,
  toJsonSchema,
} from "@/lib/ai-schemas";
import { alignWords, type AlignResult } from "@/lib/word-align";
import { normalizeTo100 } from "@/lib/rubric";
import type { PoolTaskType } from "@/lib/types";
import { ShadowingTab } from "@/components/listening/shadowing-tab";
import {
  callReview,
  saveListeningExercise,
  stripFences,
  ExerciseCompletionActions,
  type Mode,
} from "@/components/listening/shared";

// --- Dictation ---

const DictationTab = ({ cefrLevel }: { cefrLevel: string }) => {
  const [sentence, setSentence] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userInput, setUserInput] = useState("");
  const [result, setResult] = useState<AlignResult | null>(null);
  const [completed, setCompleted] = useState(0);
  const [totalAccuracy, setTotalAccuracy] = useState(0);
  const [poolSentences, setPoolSentences] = useState<string[]>([]);
  const [sentenceIndex, setSentenceIndex] = useState(0);

  const generateSentence = async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    setResult(null);
    setUserInput("");

    // If we have remaining pool sentences, use the next one
    if (sentenceIndex + 1 < poolSentences.length) {
      const nextIdx = sentenceIndex + 1;
      setSentenceIndex(nextIdx);
      setSentence(poolSentences[nextIdx]);
      setIsLoading(false);
      return;
    }

    // Try pool first
    try {
      const poolTask = await db.poolTasks
        .where("type").equals("listening-dictation")
        .and(t => !t.completed && t.assignedDate !== "")
        .first();

      if (poolTask && isDictationData(poolTask.content)) {
        const { sentences } = poolTask.content;
        setPoolSentences(sentences);
        setSentenceIndex(0);
        setSentence(sentences[0]);
        await completeTask(poolTask.id, "listening-dictation");
        setIsLoading(false);
        return;
      }
    } catch {
      // Fall through to real-time generation
    }

    // Alternating repetition (W3): no fresh pool item, so revive a previously-
    // seen one rather than discarding it. Still falls through to real-time
    // generation if none eligible or the revived row is stale.
    try {
      const reusable = await getReusableTask("listening-dictation");
      if (reusable && isDictationData(reusable.content)) {
        const { sentences } = reusable.content;
        setPoolSentences(sentences);
        setSentenceIndex(0);
        setSentence(sentences[0]);
        await completeTask(reusable.id, "listening-dictation");
        setIsLoading(false);
        return;
      }
      if (reusable) {
        // Revived a stale/old-shape row — burn it so it isn't re-revived.
        await completeTask(reusable.id);
      }
    } catch {
      // Fall through to real-time generation
    }

    // Fallback to real-time generation
    try {
      const prompt = `Generate a single English sentence at ${cefrLevel} level. Just the sentence, nothing else.`;
      const content = await callReview(prompt, "You are an English teacher creating dictation practice sentences.");
      setPoolSentences([]);
      setSentenceIndex(0);
      setSentence(stripFences(content).replace(/^["']|["']$/g, "").trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate sentence");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => void generateSentence(), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkAnswer = async (): Promise<void> => {
    if (!sentence || !userInput.trim()) return;
    const diff = alignWords(sentence, userInput);
    setResult(diff);
    setCompleted((c) => c + 1);
    setTotalAccuracy((sum) => sum + diff.accuracy);
    await dbHelpers.updateStreak();
    await dbHelpers.incrementTodayStat("listeningCount");
    await saveListeningExercise("dictation", sentence, userInput, diff.accuracy);
  };

  const avgAccuracy = completed > 0 ? Math.round(totalAccuracy / completed) : 0;

  return (
    <div className="space-y-4">
      {error && (
        <ErrorState title="Something went wrong" description={error} />
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Listen and Type</CardTitle>
          <CardDescription className="text-xs">
            Play the sentence, then type exactly what you heard.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading && !sentence ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Generating sentence...
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="lg"
                  className="min-h-[44px] flex-1 sm:flex-none"
                  onClick={() => void speak(sentence)}
                  disabled={!sentence}
                >
                  <Play className="h-4 w-4" />
                  Play
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  className="min-h-[44px] flex-1 sm:flex-none"
                  onClick={() => void speak(sentence)}
                  disabled={!sentence}
                >
                  <RotateCcw className="h-4 w-4" />
                  Replay
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  className="min-h-[44px] flex-1 sm:flex-none"
                  onClick={() => void speak(sentence, "-30%")}
                  disabled={!sentence}
                >
                  <Turtle className="h-4 w-4" />
                  Slow
                </Button>
              </div>

              <Input
                placeholder="Type what you heard..."
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void checkAnswer();
                }}
                className="min-h-[44px]"
              />

              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  className="flex-1 min-h-[44px]"
                  onClick={() => void checkAnswer()}
                  disabled={!userInput.trim()}
                >
                  Check
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 min-h-[44px]"
                  onClick={() => void generateSentence()}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Next Sentence"
                  )}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center justify-between">
              Result
              <Badge variant={result.accuracy >= 80 ? "default" : "secondary"}>
                {result.accuracy}% accuracy
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex flex-wrap gap-1">
              {result.original.map((entry, idx) => (
                <span key={idx} className="inline-flex flex-col items-center mx-0.5">
                  <span
                    className={
                      entry.correct
                        ? "text-green-700 dark:text-green-400"
                        : "text-red-700 dark:text-red-400 line-through"
                    }
                  >
                    {entry.word}
                  </span>
                  {!entry.correct && entry.heardAs && (
                    <span className="text-[10px] text-amber-600 dark:text-amber-400">
                      {entry.heardAs}
                    </span>
                  )}
                </span>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Original: &ldquo;{sentence}&rdquo;
            </p>
            <p className="text-xs text-muted-foreground">
              Your answer: &ldquo;{userInput}&rdquo;
            </p>
          </CardContent>
        </Card>
      )}

      {completed > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          {completed} sentence{completed === 1 ? "" : "s"} completed &middot; avg
          accuracy {avgAccuracy}%
        </p>
      )}

      {result && (
        <ExerciseCompletionActions
          onTryAnother={() => void generateSentence()}
        />
      )}
    </div>
  );
};

// --- Listening Comprehension ---

interface ComprehensionQuestion {
  question: string;
  options: string[];
  correctIndex: number;
}

interface ComprehensionData {
  passage: string;
  topic: string;
  questions: ComprehensionQuestion[];
}

// Local shape guard for the dictation pool-task content (mirrors the
// fresh-path truthiness check, made explicit so the reused-content path can
// validate older rows without trusting a bare `as` cast).
const isDictationData = (value: unknown): value is { sentences: string[] } => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.sentences) && v.sentences.length > 0 &&
    v.sentences.every((s) => typeof s === "string");
};

// Local shape guard for pool-task content (already an object read from
// IndexedDB, not raw AI response text — no fence-strip/JSON.parse needed).
// `topic` is required here to guard against stale pool content generated
// before the cron/pool generator was migrated to listeningComprehensionSchema
// (Phase 3) — see the schema-drift note in lib/ai-schemas.ts.
const isComprehensionData = (value: unknown): value is ComprehensionData => {
  if (!value || typeof value !== "object") return false;
  const v = value as { passage?: unknown; topic?: unknown; questions?: unknown };
  return (
    typeof v.passage === "string" &&
    typeof v.topic === "string" &&
    Array.isArray(v.questions) &&
    v.questions.length > 0 &&
    v.questions.every(
      (q): q is ComprehensionQuestion =>
        typeof q === "object" &&
        q !== null &&
        typeof (q as ComprehensionQuestion).question === "string" &&
        Array.isArray((q as ComprehensionQuestion).options) &&
        typeof (q as ComprehensionQuestion).correctIndex === "number"
    )
  );
};

const ComprehensionTab = ({ cefrLevel }: { cefrLevel: string }) => {
  const [data, setData] = useState<ComprehensionData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [prediction, setPrediction] = useState("");
  const [predictionConfirmed, setPredictionConfirmed] = useState(false);

  const generatePassage = async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    setAnswers({});
    setSubmitted(false);
    setData(null);
    setPrediction("");
    setPredictionConfirmed(false);

    // Try pool first
    try {
      const poolTask = await db.poolTasks
        .where("type").equals("listening-comprehension")
        .and(t => !t.completed && t.assignedDate !== "")
        .first();

      if (poolTask) {
        const content = poolTask.content;
        if (isComprehensionData(content)) {
          setData(content);
          await completeTask(poolTask.id, "listening-comprehension");
          setIsLoading(false);
          return;
        }
      }
    } catch {
      // Fall through to real-time generation
    }

    // Alternating repetition (W3): no fresh item — revive a previously-seen
    // comprehension passage rather than discarding it.
    try {
      const reusable = await getReusableTask("listening-comprehension");
      if (reusable && isComprehensionData(reusable.content)) {
        setData(reusable.content);
        await completeTask(reusable.id, "listening-comprehension");
        setIsLoading(false);
        return;
      }
      if (reusable) {
        await completeTask(reusable.id);
      }
    } catch {
      // Fall through to real-time generation
    }

    try {
      const system =
        "You are an English listening test designer. Return ONLY valid JSON (no markdown fences, no explanation).";
      const prompt = `Generate a 100-150 word English passage at ${cefrLevel} level, followed by 3 multiple-choice comprehension questions. Return as JSON: { "passage": string, "topic": "brief topic description", "questions": [{ "question": string, "options": string[], "correctIndex": number }] }`;
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          system,
          schema: toJsonSchema(listeningComprehensionSchema),
        }),
      });
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }
      const data = (await res.json()) as {
        object?: ComprehensionData;
        error?: string;
        usage?: { inputTokens: number; outputTokens: number };
        model?: string;
      };
      if (data.error || !data.object) {
        throw new Error(data.error || "Could not parse the passage. Please try again.");
      }
      if (data.usage && data.model) {
        recordCost({
          model: data.model,
          inputTokens: data.usage.inputTokens ?? 0,
          outputTokens: data.usage.outputTokens ?? 0,
          module: "listening",
        });
      }
      setData(data.object);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate passage");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => void generatePassage(), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const score = data
    ? data.questions.filter((q, idx) => answers[idx] === q.correctIndex).length
    : 0;

  const submit = async (): Promise<void> => {
    setSubmitted(true);
    await dbHelpers.updateStreak();
    const total = data?.questions.length ?? 1;
    const accuracy = Math.round((score / total) * 100);
    await dbHelpers.incrementTodayStat("listeningCount");
    if (data) {
      const userAnswer = data.questions
        .map((q, idx) => q.options[answers[idx]] ?? "(no answer)")
        .join("; ");
      await saveListeningExercise(
        "comprehension",
        data.passage,
        userAnswer,
        accuracy
      );
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <ErrorState title="Something went wrong" description={error} />
      )}

      {isLoading && !data ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Generating passage...
        </div>
      ) : data && !predictionConfirmed ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Before You Listen
            </CardTitle>
            <CardDescription className="text-xs">
              Topic: {data.topic}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>What do you think this passage will be about?</Label>
              <Textarea
                placeholder="Write a brief prediction based on the topic..."
                value={prediction}
                onChange={(e) => setPrediction(e.target.value)}
                className="min-h-[80px]"
              />
            </div>
            <Button
              className="w-full min-h-[44px]"
              onClick={() => setPredictionConfirmed(true)}
            >
              Start Listening
            </Button>
          </CardContent>
        </Card>
      ) : data ? (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Listen to the Passage</CardTitle>
              <CardDescription className="text-xs">
                Replay as many times as you need before answering.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {prediction.trim() && (
                <p className="text-xs text-muted-foreground border-b pb-2">
                  Your prediction: &ldquo;{prediction}&rdquo;
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="lg"
                  className="min-h-[44px] flex-1 sm:flex-none"
                  onClick={() => void speak(data.passage)}
                >
                  <Play className="h-4 w-4" />
                  Play
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  className="min-h-[44px] flex-1 sm:flex-none"
                  onClick={() => void speak(data.passage)}
                >
                  <RotateCcw className="h-4 w-4" />
                  Replay
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  className="min-h-[44px] flex-1 sm:flex-none"
                  onClick={() => void speak(data.passage, "-30%")}
                >
                  <Turtle className="h-4 w-4" />
                  Slow
                </Button>
              </div>
              {submitted && (
                <p className="text-sm leading-relaxed whitespace-pre-wrap border-t pt-3">
                  {data.passage}
                </p>
              )}
            </CardContent>
          </Card>

          <div className="space-y-3">
            {data.questions.map((q, qIdx) => (
              <Card key={qIdx}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">
                    {qIdx + 1}. {q.question}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {q.options.map((option, optIdx) => {
                    const isSelected = answers[qIdx] === optIdx;
                    const isCorrect = q.correctIndex === optIdx;
                    let stateClass =
                      "border-border hover:border-primary/50";
                    if (submitted) {
                      if (isCorrect) {
                        stateClass =
                          "border-green-600 bg-green-50 dark:bg-green-950/30";
                      } else if (isSelected && !isCorrect) {
                        stateClass =
                          "border-red-600 bg-red-50 dark:bg-red-950/30";
                      }
                    } else if (isSelected) {
                      stateClass = "border-primary bg-primary/10";
                    }
                    return (
                      <button
                        key={optIdx}
                        type="button"
                        disabled={submitted}
                        onClick={() =>
                          setAnswers((prev) => ({ ...prev, [qIdx]: optIdx }))
                        }
                        className={`w-full min-h-[44px] text-left text-sm rounded-md border px-3 py-2 transition-colors disabled:cursor-default ${stateClass}`}
                      >
                        {option}
                      </button>
                    );
                  })}
                </CardContent>
              </Card>
            ))}
          </div>

          {submitted ? (
            <>
              <Alert>
                <AlertDescription>
                  You scored {score}/{data.questions.length} (
                  {Math.round((score / data.questions.length) * 100)}%)
                </AlertDescription>
              </Alert>
              <ExerciseCompletionActions
                onTryAnother={() => void generatePassage()}
              />
            </>
          ) : (
            <Button
              className="w-full min-h-[44px]"
              disabled={Object.keys(answers).length < data.questions.length}
              onClick={() => void submit()}
            >
              Submit Answers
            </Button>
          )}
        </>
      ) : null}
    </div>
  );
};

// --- Prediction ---

interface PredictionPassage {
  firstHalf: string;
  secondHalf: string;
  topic: string;
}

interface PredictionEvaluation {
  score: number;
  feedback: string;
}

const PredictionTab = ({ cefrLevel }: { cefrLevel: string }) => {
  const [passage, setPassage] = useState<PredictionPassage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userInput, setUserInput] = useState("");
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluation, setEvaluation] = useState<PredictionEvaluation | null>(null);

  const generatePassage = async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    setPassage(null);
    setUserInput("");
    setEvaluation(null);

    // Try pool first
    try {
      const poolTask = await db.poolTasks
        .where("type").equals("listening-prediction")
        .and(t => !t.completed && t.assignedDate !== "")
        .first();

      if (poolTask) {
        const content = poolTask.content as { firstHalf: string; secondHalf: string; topic: string };
        if (content.firstHalf && content.secondHalf && content.topic) {
          setPassage(content);
          await completeTask(poolTask.id);
          setIsLoading(false);
          return;
        }
      }
    } catch {
      // Fall through to real-time generation
    }

    try {
      const system =
        "You are an English listening exercise designer. Return ONLY valid JSON (no markdown fences, no explanation).";
      const prompt = `Generate a short English passage (3-4 sentences) at ${cefrLevel} level that has a clear logical progression where the second half naturally follows from the first half. Return JSON:\n{\n  "firstHalf": "first 1-2 sentences",\n  "secondHalf": "remaining sentences",\n  "topic": "brief topic description"\n}`;
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          system,
          schema: toJsonSchema(listeningPredictionSchema),
        }),
      });
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }
      const data = (await res.json()) as {
        object?: PredictionPassage;
        error?: string;
        usage?: { inputTokens: number; outputTokens: number };
        model?: string;
      };
      if (data.error || !data.object) {
        throw new Error(data.error || "Could not parse the passage. Please try again.");
      }
      if (data.usage && data.model) {
        recordCost({
          model: data.model,
          inputTokens: data.usage.inputTokens ?? 0,
          outputTokens: data.usage.outputTokens ?? 0,
          module: "listening",
        });
      }
      setPassage(data.object);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate passage");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => void generatePassage(), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitPrediction = async (): Promise<void> => {
    if (!passage || !userInput.trim()) return;
    setIsEvaluating(true);
    setError(null);
    try {
      const system =
        "You are an English listening comprehension evaluator. Return ONLY valid JSON (no markdown fences, no explanation).";
      const prompt = `The original continuation was: "${passage.secondHalf}"\nThe student predicted: "${userInput}"\nEvaluate how well the prediction matches in terms of logical coherence and contextual understanding (not exact wording). Score 1-10. Return JSON:\n{ "score": number, "feedback": "brief feedback on the prediction quality" }`;
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          system,
          schema: toJsonSchema(listeningPredictionEvalSchema),
          disableThinking: true, // scoring a prediction — no reasoning pass needed
        }),
      });
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }
      const data = (await res.json()) as {
        object?: PredictionEvaluation;
        error?: string;
        usage?: { inputTokens: number; outputTokens: number };
        model?: string;
      };
      if (data.error || !data.object) {
        throw new Error(data.error || "Could not parse the evaluation. Please try again.");
      }
      if (data.usage && data.model) {
        recordCost({
          model: data.model,
          inputTokens: data.usage.inputTokens ?? 0,
          outputTokens: data.usage.outputTokens ?? 0,
          module: "listening",
        });
      }
      const parsed = data.object;
      setEvaluation(parsed);
      await dbHelpers.updateStreak();
      await dbHelpers.incrementTodayStat("listeningCount");
      await saveListeningExercise(
        "prediction",
        `${passage.firstHalf} ${passage.secondHalf}`,
        userInput,
        normalizeTo100(parsed.score)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to evaluate prediction");
    } finally {
      setIsEvaluating(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <ErrorState title="Something went wrong" description={error} />
      )}

      {isLoading && !passage ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Generating passage...
        </div>
      ) : passage ? (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Listen and Predict
              </CardTitle>
              <CardDescription className="text-xs">
                Topic: {passage.topic}. Listen to the beginning, then write
                what you think comes next.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  size="lg"
                  className="min-h-[44px] flex-1 sm:flex-none"
                  onClick={() => void speak(passage.firstHalf)}
                >
                  <Play className="h-4 w-4" />
                  Play
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  className="min-h-[44px] flex-1 sm:flex-none"
                  onClick={() => void speak(passage.firstHalf)}
                >
                  <RotateCcw className="h-4 w-4" />
                  Replay
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  className="min-h-[44px] flex-1 sm:flex-none"
                  onClick={() => void speak(passage.firstHalf, "-30%")}
                >
                  <Turtle className="h-4 w-4" />
                  Slow
                </Button>
              </div>

              {evaluation && (
                <p className="text-sm leading-relaxed whitespace-pre-wrap border-t pt-3">
                  {passage.firstHalf}
                </p>
              )}

              <Textarea
                placeholder="What do you think happens next?"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                disabled={Boolean(evaluation)}
                className="min-h-[80px]"
              />

              {!evaluation && (
                <Button
                  className="w-full min-h-[44px]"
                  onClick={() => void submitPrediction()}
                  disabled={!userInput.trim() || isEvaluating}
                >
                  {isEvaluating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Submit Prediction"
                  )}
                </Button>
              )}
            </CardContent>
          </Card>

          {evaluation && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center justify-between">
                  Result
                  <Badge variant={normalizeTo100(evaluation.score) >= 70 ? "default" : "secondary"}>
                    {normalizeTo100(evaluation.score)}/100
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Actual continuation:
                  </p>
                  <p className="text-sm">{passage.secondHalf}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Your prediction:
                  </p>
                  <p className="text-sm">{userInput}</p>
                </div>
                <p className="text-xs text-muted-foreground border-t pt-2">
                  {evaluation.feedback}
                </p>
              </CardContent>
            </Card>
          )}

          {evaluation && (
            <ExerciseCompletionActions
              onTryAnother={() => void generatePassage()}
            />
          )}
        </>
      ) : null}
    </div>
  );
};

// --- Page ---

// All four listening modes now have a pool task type, so any of them can be
// auto-selected when ready pool content exists.
const POOL_CHECK_MODES: readonly Mode[] = [
  "dictation",
  "comprehension",
  "prediction",
  "shadowing",
];

const ListeningPage = () => {
  const profile = useProfile();
  const cefrLevel = profile?.studyLevel || "B1";
  const [mode, setMode] = useState<Mode>("dictation");
  const [readyMode, setReadyMode] = useState<Mode | null>(null);
  const [checkedPool, setCheckedPool] = useState(false);

  useEffect(() => {
    const pickTab = async () => {
      try {
        for (const m of POOL_CHECK_MODES) {
          const type = `listening-${m}` as PoolTaskType;
          const task = await db.poolTasks
            .where("type").equals(type)
            .and((t) => !t.completed && t.assignedDate !== "")
            .first();
          if (task) {
            setMode(m);
            setReadyMode(m);
            break;
          }
        }
      } finally {
        setCheckedPool(true);
      }
    };
    void pickTab();
  }, []);

  return (
    <div className="max-w-3xl space-y-6 p-4 md:space-y-8 md:p-6">
      <div>
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-xl font-bold mb-2 md:text-2xl flex items-center gap-2">
            <Headphones className="h-5 w-5" />
            Listening Practice
          </h1>
          <Link
            href="/listening/import"
            className="shrink-0 whitespace-nowrap text-sm text-primary underline-offset-4 hover:underline"
          >
            导入原版素材
          </Link>
        </div>
        <p className="text-muted-foreground text-sm">
          Practice dictation, comprehension, shadowing, and prediction at
          your {cefrLevel} level.
        </p>
        {checkedPool && (
          <p className="text-xs text-muted-foreground mt-1">
            {readyMode
              ? "Today's exercise is ready."
              : "Generating..."}
          </p>
        )}
      </div>

      <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)}>
        <div className="overflow-x-auto">
          <TabsList className="w-max min-w-full sm:w-auto">
            <TabsTrigger value="dictation" className="whitespace-nowrap">
              <Ear className="h-4 w-4" />
              Dictation
            </TabsTrigger>
            <TabsTrigger value="comprehension" className="whitespace-nowrap">
              <Headphones className="h-4 w-4" />
              Comprehension
            </TabsTrigger>
            <TabsTrigger value="shadowing" className="whitespace-nowrap">
              <Mic className="h-4 w-4" />
              Shadowing
            </TabsTrigger>
            <TabsTrigger value="prediction" className="whitespace-nowrap">
              <Sparkles className="h-4 w-4" />
              Prediction
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="dictation" className="pt-4">
          <DictationTab cefrLevel={cefrLevel} />
        </TabsContent>
        <TabsContent value="comprehension" className="pt-4">
          <ComprehensionTab cefrLevel={cefrLevel} />
        </TabsContent>
        <TabsContent value="prediction" className="pt-4">
          <PredictionTab cefrLevel={cefrLevel} />
        </TabsContent>
        <TabsContent value="shadowing" className="pt-4">
          <ShadowingTab cefrLevel={cefrLevel} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ListeningPage;
