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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProfile } from "@/hooks/use-db";
import { dbHelpers } from "@/lib/db-helpers";
import { speak } from "@/lib/tts";

// --- Listening stats persistence (for roadmap tracking) ---

const LISTENING_STATS_KEY = "en-tutor-listening-stats";

const recordListeningExercise = (accuracy: number): void => {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(LISTENING_STATS_KEY);
    const stats = raw
      ? (JSON.parse(raw) as { completed: number; totalAccuracy: number })
      : { completed: 0, totalAccuracy: 0 };
    stats.completed += 1;
    stats.totalAccuracy += accuracy;
    window.localStorage.setItem(LISTENING_STATS_KEY, JSON.stringify(stats));
  } catch { /* ignore storage errors */ }
};

// --- Shared helpers ---

interface SpeechRecognitionResultLike {
  results: { [index: number]: { [index: number]: { transcript: string } } };
}

interface SpeechRecognitionErrorLike {
  error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionResultLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  start: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const getSpeechRecognitionConstructor = (): SpeechRecognitionConstructor | null => {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

const startListening = (): Promise<string> => {
  return new Promise((resolve, reject) => {
    const SpeechRecognition = getSpeechRecognitionConstructor();
    if (!SpeechRecognition) {
      reject(new Error("Speech recognition is not supported in this browser."));
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.onresult = (event) => resolve(event.results[0][0].transcript);
    recognition.onerror = (event) => reject(new Error(event.error));
    recognition.start();
  });
};

const stripFences = (raw: string): string => {
  let text = raw.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }
  return text;
};

const callReview = async (prompt: string, system: string): Promise<string> => {
  const res = await fetch("/api/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, system }),
  });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  const data = (await res.json()) as { content?: string; error?: string };
  if (data.error || !data.content) {
    throw new Error(data.error || "No content returned");
  }
  return data.content;
};

const normalizeWord = (word: string): string =>
  word.toLowerCase().replace(/[.,!?;:'"]/g, "");

const tokenize = (text: string): string[] =>
  text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeWord)
    .filter(Boolean);

interface WordDiffEntry {
  word: string;
  correct: boolean;
}

interface DiffResult {
  accuracy: number;
  original: WordDiffEntry[];
}

// Word-level diff: for each original word, check if it appears at the
// corresponding position in the user's transcript.
const diffWords = (original: string, userText: string): DiffResult => {
  const originalWords = tokenize(original);
  const userWords = tokenize(userText);

  const entries: WordDiffEntry[] = originalWords.map((word, idx) => ({
    word,
    correct: userWords[idx] === word,
  }));

  const correctCount = entries.filter((e) => e.correct).length;
  const accuracy =
    originalWords.length === 0
      ? 0
      : Math.round((correctCount / originalWords.length) * 100);

  return { accuracy, original: entries };
};

type Mode = "dictation" | "comprehension" | "shadowing" | "prediction";

// Shared post-exercise navigation shown once a result/completion state renders.
const ExerciseCompletionActions = ({
  onTryAnother,
}: {
  onTryAnother: () => void;
}) => (
  <div className="flex flex-col gap-2 sm:flex-row">
    <Button
      variant="outline"
      className="flex-1 min-h-[44px]"
      render={<Link href="/" />}
    >
      Back to Dashboard
    </Button>
    <Button className="flex-1 min-h-[44px]" onClick={onTryAnother}>
      Try Another Exercise
    </Button>
  </div>
);

// --- Dictation ---

const DictationTab = ({ cefrLevel }: { cefrLevel: string }) => {
  const [sentence, setSentence] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userInput, setUserInput] = useState("");
  const [result, setResult] = useState<DiffResult | null>(null);
  const [completed, setCompleted] = useState(0);
  const [totalAccuracy, setTotalAccuracy] = useState(0);

  const generateSentence = async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    setResult(null);
    setUserInput("");
    try {
      const prompt = `Generate a single English sentence at ${cefrLevel} level. Just the sentence, nothing else.`;
      const content = await callReview(prompt, "You are an English teacher creating dictation practice sentences.");
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
    const diff = diffWords(sentence, userInput);
    setResult(diff);
    setCompleted((c) => c + 1);
    setTotalAccuracy((sum) => sum + diff.accuracy);
    await dbHelpers.updateStreak();
    recordListeningExercise(diff.accuracy);
  };

  const avgAccuracy = completed > 0 ? Math.round(totalAccuracy / completed) : 0;

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
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
                <span
                  key={idx}
                  className={
                    entry.correct
                      ? "text-green-700 dark:text-green-400"
                      : "text-red-700 dark:text-red-400 line-through"
                  }
                >
                  {entry.word}
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

const parseComprehensionData = (raw: string): ComprehensionData | null => {
  try {
    const parsed = JSON.parse(stripFences(raw)) as ComprehensionData;
    if (
      !parsed ||
      typeof parsed.passage !== "string" ||
      typeof parsed.topic !== "string" ||
      !Array.isArray(parsed.questions) ||
      parsed.questions.length === 0 ||
      parsed.questions.some(
        (q) =>
          typeof q.question !== "string" ||
          !Array.isArray(q.options) ||
          typeof q.correctIndex !== "number"
      )
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
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
    try {
      const system =
        "You are an English listening test designer. Return ONLY valid JSON (no markdown fences, no explanation).";
      const prompt = `Generate a 100-150 word English passage at ${cefrLevel} level, followed by 3 multiple-choice comprehension questions. Return as JSON: { "passage": string, "topic": "brief topic description", "questions": [{ "question": string, "options": string[], "correctIndex": number }] }`;
      const content = await callReview(prompt, system);
      const parsed = parseComprehensionData(content);
      if (!parsed) {
        throw new Error("Could not parse the passage. Please try again.");
      }
      setData(parsed);
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
    recordListeningExercise(Math.round((score / total) * 100));
  };

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
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

// --- Shadowing ---

const parseShadowingSentences = (raw: string): string[] | null => {
  try {
    const parsed = JSON.parse(stripFences(raw)) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length === 0 ||
      parsed.some((s) => typeof s !== "string")
    ) {
      return null;
    }
    return parsed as string[];
  } catch {
    return null;
  }
};

const ShadowingTab = ({ cefrLevel }: { cefrLevel: string }) => {
  const [sentences, setSentences] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [result, setResult] = useState<DiffResult | null>(null);
  const [speechSupported, setSpeechSupported] = useState(true);
  const hasCheckedSupport = useRef(false);

  useEffect(() => {
    if (hasCheckedSupport.current) return;
    hasCheckedSupport.current = true;
    setSpeechSupported(Boolean(getSpeechRecognitionConstructor()));
  }, []);

  const generateSentences = async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    setSentences([]);
    setIndex(0);
    setTranscript(null);
    setResult(null);
    try {
      const system =
        "You are an English pronunciation coach. Return ONLY a valid JSON array of strings (no markdown fences, no explanation).";
      const prompt = `Generate 5 short English sentences (5-10 words each) at ${cefrLevel} level for shadowing practice. Return as JSON array of strings.`;
      const content = await callReview(prompt, system);
      const parsed = parseShadowingSentences(content);
      if (!parsed) {
        throw new Error("Could not parse the sentences. Please try again.");
      }
      setSentences(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate sentences");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => void generateSentences(), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentSentence = sentences[index] ?? "";

  const record = async (): Promise<void> => {
    setError(null);
    setIsRecording(true);
    setTranscript(null);
    setResult(null);
    try {
      const text = await startListening();
      setTranscript(text);
      const shadowResult = diffWords(currentSentence, text);
      setResult(shadowResult);
      await dbHelpers.updateStreak();
      recordListeningExercise(shadowResult.accuracy);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not capture your recording"
      );
    } finally {
      setIsRecording(false);
    }
  };

  const nextSentence = async (): Promise<void> => {
    setTranscript(null);
    setResult(null);
    if (index + 1 < sentences.length) {
      setIndex(index + 1);
    } else {
      await generateSentences();
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!speechSupported && (
        <Alert variant="destructive">
          <AlertDescription>
            Speech recognition is not supported in this browser. Try Chrome on
            desktop or Android for the recording feature.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            Repeat After Me
            {sentences.length > 0 && (
              <span className="text-xs text-muted-foreground font-normal">
                {index + 1}/{sentences.length}
              </span>
            )}
          </CardTitle>
          <CardDescription className="text-xs">
            Listen, then record yourself repeating the sentence.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading && sentences.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Generating sentences...
            </div>
          ) : (
            <>
              <p className="text-base font-medium text-center py-2">
                {currentSentence}
              </p>

              <div className="flex flex-wrap gap-2 justify-center">
                <Button
                  size="lg"
                  className="min-h-[44px] flex-1 sm:flex-none"
                  onClick={() => void speak(currentSentence)}
                >
                  <Play className="h-4 w-4" />
                  Normal Speed
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  className="min-h-[44px] flex-1 sm:flex-none"
                  onClick={() => void speak(currentSentence, "-40%")}
                >
                  <Turtle className="h-4 w-4" />
                  Slow Speed
                </Button>
              </div>

              <Button
                size="lg"
                variant={isRecording ? "destructive" : "default"}
                className="w-full min-h-[44px]"
                onClick={() => void record()}
                disabled={!speechSupported || isRecording}
              >
                {isRecording ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Listening...
                  </>
                ) : (
                  <>
                    <Mic className="h-4 w-4" />
                    Record My Attempt
                  </>
                )}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {result && transcript !== null && (
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
                <span
                  key={idx}
                  className={
                    entry.correct
                      ? "text-green-700 dark:text-green-400"
                      : "text-red-700 dark:text-red-400 line-through"
                  }
                >
                  {entry.word}
                </span>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              You said: &ldquo;{transcript}&rdquo;
            </p>
          </CardContent>
        </Card>
      )}

      {result && transcript !== null && (
        <ExerciseCompletionActions
          onTryAnother={() => void nextSentence()}
        />
      )}

      {sentences.length > 0 && (
        <Button
          variant="outline"
          className="w-full min-h-[44px]"
          onClick={() => void nextSentence()}
          disabled={isLoading}
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Next Sentence"}
        </Button>
      )}
    </div>
  );
};

// --- Prediction ---

interface PredictionPassage {
  firstHalf: string;
  secondHalf: string;
  topic: string;
}

const parsePredictionPassage = (raw: string): PredictionPassage | null => {
  try {
    const parsed = JSON.parse(stripFences(raw)) as PredictionPassage;
    if (
      !parsed ||
      typeof parsed.firstHalf !== "string" ||
      typeof parsed.secondHalf !== "string" ||
      typeof parsed.topic !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

interface PredictionEvaluation {
  score: number;
  feedback: string;
}

const parsePredictionEvaluation = (raw: string): PredictionEvaluation | null => {
  try {
    const parsed = JSON.parse(stripFences(raw)) as PredictionEvaluation;
    if (
      !parsed ||
      typeof parsed.score !== "number" ||
      typeof parsed.feedback !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

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
    try {
      const system =
        "You are an English listening exercise designer. Return ONLY valid JSON (no markdown fences, no explanation).";
      const prompt = `Generate a short English passage (3-4 sentences) at ${cefrLevel} level that has a clear logical progression where the second half naturally follows from the first half. Return JSON:\n{\n  "firstHalf": "first 1-2 sentences",\n  "secondHalf": "remaining sentences",\n  "topic": "brief topic description"\n}`;
      const content = await callReview(prompt, system);
      const parsed = parsePredictionPassage(content);
      if (!parsed) {
        throw new Error("Could not parse the passage. Please try again.");
      }
      setPassage(parsed);
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
      const content = await callReview(prompt, system);
      const parsed = parsePredictionEvaluation(content);
      if (!parsed) {
        throw new Error("Could not parse the evaluation. Please try again.");
      }
      setEvaluation(parsed);
      await dbHelpers.updateStreak();
      recordListeningExercise(parsed.score * 10);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to evaluate prediction");
    } finally {
      setIsEvaluating(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
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
                  <Badge variant={evaluation.score >= 7 ? "default" : "secondary"}>
                    {evaluation.score}/10
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

const ListeningPage = () => {
  const profile = useProfile();
  const cefrLevel = profile?.initialCefrLevel || "B1";
  const [mode, setMode] = useState<Mode>("dictation");

  return (
    <div className="max-w-3xl space-y-6 p-4 md:space-y-8 md:p-6">
      <div>
        <h1 className="text-xl font-bold mb-2 md:text-2xl flex items-center gap-2">
          <Headphones className="h-5 w-5" />
          Listening Practice
        </h1>
        <p className="text-muted-foreground text-sm">
          Practice dictation, comprehension, shadowing, and prediction at
          your {cefrLevel} level.
        </p>
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
