"use client";

// Shadowing (repeat-after-me) tab for the listening page. Extracted from
// app/listening/page.tsx (W1-T1) — behavior unchanged on this step; the 3-step
// stage machine / subtitle gating / variable speed land in later W1 tasks.

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Play, Square, Turtle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ErrorState } from "@/components/states/error-state";
import { db } from "@/lib/db";
import { dbHelpers } from "@/lib/db-helpers";
import { completeTask } from "@/lib/task-pool";
import { speak } from "@/lib/tts";
import {
  startRecording,
  isRecordingSupported,
  type RecordingSession,
} from "@/lib/speech";
import { alignWords, type AlignResult } from "@/lib/word-align";
import {
  callReview,
  saveListeningExercise,
  stripFences,
  ExerciseCompletionActions,
} from "@/components/listening/shared";

type RecStatus = "idle" | "recording" | "transcribing";

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

export const ShadowingTab = ({ cefrLevel }: { cefrLevel: string }) => {
  const [sentences, setSentences] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recStatus, setRecStatus] = useState<RecStatus>("idle");
  const sessionRef = useRef<RecordingSession | null>(null);
  // Synchronous re-entry guard: recStatus/sessionRef only flip AFTER
  // startRecording() resolves, so a second click during that async window
  // would otherwise spawn a second MediaRecorder and orphan the first
  // (unstoppable live mic). This ref blocks that window.
  const startingRef = useRef(false);
  // True once ShadowingTab has unmounted; guards setState calls that would
  // otherwise land after startRecording()'s await resolves post-unmount.
  const mountedRef = useRef(true);
  const [approximate, setApproximate] = useState(false); // last attempt used the SpeechRecognition fallback (auto-corrected → unreliable for a repeat check)
  const [transcript, setTranscript] = useState<string | null>(null);
  const [result, setResult] = useState<AlignResult | null>(null);
  const [speechSupported, setSpeechSupported] = useState(true);
  const hasCheckedSupport = useRef(false);

  useEffect(() => {
    if (hasCheckedSupport.current) return;
    hasCheckedSupport.current = true;
    setSpeechSupported(isRecordingSupported());
  }, []);

  // Release the microphone if the tab is switched away from (or the page is
  // left) mid-recording -- ShadowingTab renders inside a Base UI Tabs.Panel,
  // which unmounts hidden panels by default, so an in-flight session would
  // otherwise leave getUserMedia's stream + MediaRecorder running with no
  // way to stop them.
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      sessionRef.current?.cancel();
      sessionRef.current = null;
    };
  }, []);

  const generateSentences = async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    setSentences([]);
    setIndex(0);
    setTranscript(null);
    setResult(null);
    setApproximate(false);

    // Try the pre-generated pool first (cron/Blob-backed), matching the other
    // listening tabs — a pool hit means no live LLM wait.
    try {
      const poolTask = await db.poolTasks
        .where("type").equals("listening-shadowing")
        .and(t => !t.completed && t.assignedDate !== "")
        .first();

      if (poolTask) {
        // Shadowing pool content is a JSON string array (listeningShadowingSchema),
        // unlike the object-shaped content of the other task types — cast via
        // unknown and guard at runtime.
        const content = poolTask.content as unknown as string[];
        if (Array.isArray(content) && content.length > 0) {
          setSentences(content);
          await completeTask(poolTask.id);
          setIsLoading(false);
          return;
        }
      }
    } catch {
      // Fall through to real-time generation
    }

    // Fallback to real-time generation
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

  const startAttempt = async (): Promise<void> => {
    if (startingRef.current || recStatus !== "idle") return;
    startingRef.current = true;
    setError(null);
    setTranscript(null);
    setResult(null);
    setApproximate(false);
    try {
      const session = await startRecording();
      // Discard if the tab was switched away from / the page was left
      // during the await (see the unmount-cleanup effect above).
      if (!mountedRef.current) {
        session.cancel();
        return;
      }
      sessionRef.current = session;
      setRecStatus("recording");
    } catch {
      sessionRef.current = null;
      if (mountedRef.current) {
        setRecStatus("idle");
        setError("Microphone unavailable (permission denied or unsupported).");
      }
    } finally {
      startingRef.current = false;
    }
  };

  // Stop recording → faithful whisper transcript → word-match feedback.
  const stopAttempt = async (): Promise<void> => {
    const session = sessionRef.current;
    if (!session || recStatus !== "recording") return;
    sessionRef.current = null;
    setRecStatus("transcribing");
    try {
      const { text, approximate: approx } = await session.stop();
      const said = text.trim();
      if (!said) {
        setError("Didn't catch that — try recording again.");
        return;
      }
      setTranscript(said);
      setApproximate(approx);
      const shadowResult = alignWords(currentSentence, said);
      setResult(shadowResult);
      // Persistence is best-effort: a DB write failure must not masquerade as
      // a transcription error (the result above already stands).
      try {
        await dbHelpers.updateStreak();
        await dbHelpers.incrementTodayStat("listeningCount");
        await saveListeningExercise(
          "shadowing",
          currentSentence,
          said,
          shadowResult.accuracy
        );
      } catch {
        // Stats are non-critical; keep the result visible.
      }
    } catch {
      setError("Couldn't reach transcription — please try again.");
    } finally {
      setRecStatus((s) => (s === "transcribing" ? "idle" : s));
    }
  };

  const nextSentence = async (): Promise<void> => {
    setTranscript(null);
    setResult(null);
    setApproximate(false);
    if (index + 1 < sentences.length) {
      setIndex(index + 1);
    } else {
      await generateSentences();
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <ErrorState title="Something went wrong" description={error} />
      )}

      {!speechSupported && (
        <Alert variant="destructive">
          <AlertDescription>
            Recording is not supported in this browser. Try a recent Chrome,
            Safari, or Firefox.
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
                variant={recStatus === "recording" ? "destructive" : "default"}
                className="w-full min-h-[44px]"
                onClick={() =>
                  recStatus === "recording" ? void stopAttempt() : void startAttempt()
                }
                disabled={!speechSupported || recStatus === "transcribing"}
              >
                {recStatus === "recording" ? (
                  <>
                    <Square className="h-4 w-4" />
                    Stop &amp; Check
                  </>
                ) : recStatus === "transcribing" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Transcribing...
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
                {result.accuracy}% word match
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
              You said: &ldquo;{transcript}&rdquo;
            </p>
            <p className="text-xs text-muted-foreground">
              Word match against the target — not a pronunciation score.
            </p>
            {approximate && (
              <p className="text-xs text-muted-foreground">
                Approximate transcription (service unavailable) — this used an
                auto-corrected fallback, so the word match may read higher than reality.
              </p>
            )}
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
          disabled={isLoading || recStatus !== "idle"}
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Next Sentence"}
        </Button>
      )}
    </div>
  );
};
