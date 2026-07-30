"use client";

// Shadowing (repeat-after-me) tab for the listening page. Extracted from
// app/listening/page.tsx (W1-T1). W1-T3 added the 3-step direct-comprehension
// stage machine (imagine → listen → recall); subtitle gating / variable speed
// land in later W1 tasks.

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2, Mic, Play, Square } from "lucide-react";
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
  listeningShadowingSchema,
  sentenceChunkSchema,
  toJsonSchema,
} from "@/lib/ai-schemas";
import {
  saveListeningExercise,
  ExerciseCompletionActions,
} from "@/components/listening/shared";

type RecStatus = "idle" | "recording" | "transcribing";

// The 3-step direct-comprehension stage machine (methodology):
//   imagine — read the topic/context/imageryHint and form the mental picture
//             BEFORE hearing or reading the English (fire-together-wire-together)
//   listen  — hear the audio repeatedly until the sound is clear; English stays hidden
//   recall  — reveal the English line + translation, then record & check
// Orthogonal to RecStatus (which tracks the microphone device, not the learning step).
type Stage = "imagine" | "listen" | "recall";
const STAGE_ORDER: readonly Stage[] = ["imagine", "listen", "recall"];

// Subtitle reveal mode, active only in the recall stage. imagine/listen always
// hide the English (methodology: see the picture first, not the text). In recall
// the learner can choose how much to reveal — english-only by default (test
// direct understanding), bilingual to check the translation, hidden to replay
// from sound alone.
type SubtitleMode = "hidden" | "english" | "bilingual";

// Idle window before a focus nudge fires (methodology: 100% attention). Only
// checked during active stages (listen/recall); imagine is the guided setup.
const FOCUS_IDLE_MS = 20_000;

// Edge-TTS voice options across accents (methodology mentions accent training).
const VOICE_OPTIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "en-US-AriaNeural", label: "美式" },
  { id: "en-GB-LibbyNeural", label: "英式" },
  { id: "en-AU-NatashaNeural", label: "澳式" },
  { id: "en-IN-NeerjaNeural", label: "印度" },
];

// Runtime shape of a shadowing set (mirrors listeningShadowingSchema).
export interface ShadowingSentence {
  text: string;
  translation: string;
  imageryHint: string;
}
export interface ShadowingData {
  topic: string;
  context: string;
  sentences: ShadowingSentence[];
}

// Guard pool/fallback content (Record<string, unknown>) into a typed
// ShadowingData, rejecting shapes that don't satisfy the schema contract.
const isShadowingData = (value: unknown): value is ShadowingData => {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.topic !== "string" || typeof v.context !== "string") return false;
  if (!Array.isArray(v.sentences) || v.sentences.length === 0) return false;
  return v.sentences.every((s) => {
    if (typeof s !== "object" || s === null) return false;
    const sn = s as Record<string, unknown>;
    return (
      typeof sn.text === "string" &&
      typeof sn.translation === "string" &&
      typeof sn.imageryHint === "string"
    );
  });
};

// Runtime shape of a progressive phrase chunking (mirrors sentenceChunkSchema).
export interface SentenceChunk {
  phrase: string;
  meaning: string;
  role: string;
}
const isSentenceChunks = (value: unknown): value is { chunks: SentenceChunk[] } => {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.chunks) || v.chunks.length === 0) return false;
  return v.chunks.every((c) => {
    if (typeof c !== "object" || c === null) return false;
    const cn = c as Record<string, unknown>;
    return (
      typeof cn.phrase === "string" &&
      typeof cn.meaning === "string" &&
      typeof cn.role === "string"
    );
  });
};


export const ShadowingTab = ({ cefrLevel }: { cefrLevel: string }) => {
  const [data, setData] = useState<ShadowingData | null>(null);
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<Stage>("imagine");
  const [subtitleMode, setSubtitleMode] = useState<SubtitleMode>("english");
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [voice, setVoice] = useState<string>("en-US-AriaNeural");
  const [listensCount, setListensCount] = useState<number>(0);
  const [subjectiveComprehension, setSubjectiveComprehension] = useState<number | null>(null);
  const [chunks, setChunks] = useState<SentenceChunk[] | null>(null);
  const [isChunking, setIsChunking] = useState(false);
  // Focus/attention: methodology demands 100% focus. Track the last meaningful
  // interaction; if the learner goes idle past FOCUS_IDLE_MS during an active
  // stage, show a nudge to pull attention back. Counting resets (re-engagements
  // after a nudge) is an observable focus signal.
  const [showFocusNudge, setShowFocusNudge] = useState(false);
  const [focusResets, setFocusResets] = useState(0);
  const lastActiveRef = useRef<number>(0);
  const markActive = (): void => {
    lastActiveRef.current = Date.now();
    setShowFocusNudge(false);
  };
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

  // Focus watchdog: during listen/recall, if no meaningful interaction happens
  // for FOCUS_IDLE_MS, surface a nudge. markActive() (wired to play / stage
  // advance / record) resets the window and clears the nudge. imagine is
  // excluded — it's the guided picture-forming step, not a sustained-attention
  // task. The effect only starts/stops a timer and writes a ref (no synchronous
  // setState in the effect body); setState happens in the interval callback
  // (conditional, true-direction only).
  useEffect(() => {
    if (stage === "imagine") return;
    lastActiveRef.current = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - lastActiveRef.current >= FOCUS_IDLE_MS) {
        setShowFocusNudge(true);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [stage, index]);

  const generateSentences = async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    setData(null);
    setIndex(0);
    setStage("imagine");
    setListensCount(0);
    setSubjectiveComprehension(null);
    setChunks(null);
    setTranscript(null);
    setResult(null);
    setApproximate(false);
    setShowFocusNudge(false);

    // Try the pre-generated pool first (cron/Blob-backed), matching the other
    // listening tabs — a pool hit means no live LLM wait.
    try {
      const poolTask = await db.poolTasks
        .where("type").equals("listening-shadowing")
        .and(t => !t.completed && t.assignedDate !== "")
        .first();

      if (poolTask) {
        // Shadowing pool content now matches listeningShadowingSchema (object
        // shape: topic/context/sentences). Guard at runtime before adopting.
        if (isShadowingData(poolTask.content)) {
          setData(poolTask.content);
          await completeTask(poolTask.id);
          setIsLoading(false);
          return;
        }
      }
    } catch {
      // Fall through to real-time generation
    }

    // Fallback to real-time generation via the structured-output route (same
    // schema as the pool, so pool and fallback yield identical shapes).
    try {
      const system =
        "You are an English pronunciation coach. Return ONLY valid JSON (no markdown fences, no explanation).";
      const prompt = `Generate 5 short English sentences (5-10 words each) at ${cefrLevel} level for shadowing practice. Pick a single concrete everyday topic. Return JSON: { "topic": "short topic", "context": "one sentence of scene/background a learner pictures before listening", "sentences": [{ "text": "English sentence", "translation": "Chinese translation", "imageryHint": "a brief cue to form the mental picture for this sentence, in Chinese" }] }`;
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          system,
          schema: toJsonSchema(listeningShadowingSchema),
        }),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const payload = (await res.json()) as { object?: unknown };
      if (!isShadowingData(payload.object)) {
        throw new Error("Could not parse the sentences. Please try again.");
      }
      setData(payload.object);
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

  const currentSentence = data?.sentences[index]?.text ?? "";
  const currentTranslation = data?.sentences[index]?.translation ?? "";
  const currentImageryHint = data?.sentences[index]?.imageryHint ?? "";

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
          shadowResult.accuracy,
          {
            stage,
            missedWords: shadowResult.original
              .filter((e) => !e.correct)
              .map((e) => e.word),
            subjectiveComprehension: subjectiveComprehension ?? undefined,
            listensCount,
          }
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

  // Progressive phrase chunking for a sentence the learner can't parse at once
  // (methodology: divide-and-conquer). Splits the long sentence into short
  // phrases, each with meaning + grammatical role, via the structured /api/review
  // path (sentenceChunkSchema).
  const chunkSentence = async (): Promise<void> => {
    if (!currentSentence || isChunking) return;
    setIsChunking(true);
    setChunks(null);
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system:
            "You are an English teacher. Break the sentence into short meaningful phrases. Return ONLY valid JSON.",
          prompt: `Break this English sentence into short phrases in order. For each phrase give its meaning (Chinese) and grammatical role (English). Sentence: "${currentSentence}" Return JSON: { "chunks": [{ "phrase": "...", "meaning": "...", "role": "..." }] }`,
          schema: toJsonSchema(sentenceChunkSchema),
        }),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const payload = (await res.json()) as { object?: unknown };
      if (!isSentenceChunks(payload.object)) {
        throw new Error("Could not chunk the sentence.");
      }
      setChunks(payload.object.chunks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to chunk the sentence");
    } finally {
      setIsChunking(false);
    }
  };

  const nextSentence = async (): Promise<void> => {
    setTranscript(null);
    setResult(null);
    setApproximate(false);
    setStage("imagine");
    setListensCount(0);
    setSubjectiveComprehension(null);
    setChunks(null);
    setShowFocusNudge(false);
    if (data && index + 1 < data.sentences.length) {
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
            {data && data.sentences.length > 0 && (
              <span className="text-xs text-muted-foreground font-normal">
                {index + 1}/{data.sentences.length}
              </span>
            )}
          </CardTitle>
          <CardDescription className="text-xs">
            先想画面 → 听声音 → 揭示原文跟读，让英语声音直接唤起画面。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading && !data ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Generating sentences...
            </div>
          ) : (
            <>
              {/* 3-step progress indicator */}
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                {STAGE_ORDER.map((s, i) => (
                  <span
                    key={s}
                    className={
                      s === stage
                        ? "font-medium text-foreground"
                        : "text-muted-foreground/60"
                    }
                  >
                    {i + 1}. {s === "imagine" ? "想画面" : s === "listen" ? "听声音" : "跟读"}
                  </span>
                ))}
              </div>

              {showFocusNudge && (
                <Alert>
                  <AlertDescription className="flex items-center justify-between gap-2">
                    <span>走神了？把注意力拉回到声音上——练习需要 100% 专注。</span>
                    <Button
                      size="sm"
                      className="min-h-[32px] shrink-0"
                      onClick={() => {
                        setFocusResets((n) => n + 1);
                        markActive();
                      }}
                    >
                      我回来了
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              {stage === "imagine" && (
                <div className="space-y-3 py-1">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground text-center">
                    {data?.topic}
                  </p>
                  <p className="text-sm text-muted-foreground text-center italic">
                    {data?.context}
                  </p>
                  <p className="text-sm text-center py-2 border-l-2 border-primary/40 pl-3 ml-3 mr-3">
                    {currentImageryHint}
                  </p>
                  <p className="text-xs text-muted-foreground text-center">
                    闭上眼睛，先在脑海中构造这个画面，不要急着看英文。
                  </p>
                  <Button
                    size="lg"
                    className="w-full min-h-[44px]"
                    onClick={() => {
                      markActive();
                      setStage("listen");
                    }}
                  >
                    我已想好画面
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              )}

              {stage === "listen" && (
                <div className="space-y-3">
                  <Button
                    size="lg"
                    className="w-full min-h-[44px]"
                    onClick={() => {
                      markActive();
                      setListensCount((c) => c + 1);
                      void speak(currentSentence, undefined, playbackRate, voice);
                    }}
                  >
                    <Play className="h-4 w-4" />
                    播放（{playbackRate}x）
                  </Button>

                  {/* Variable speed: slow down to catch the sound, then ramp up
                      for overload training (methodology). Client-side playbackRate
                      reuses the cached blob — no extra network round-trip. */}
                  <div className="flex flex-wrap gap-2 justify-center">
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                      <Button
                        key={r}
                        size="sm"
                        variant={playbackRate === r ? "default" : "outline"}
                        className="min-h-[36px]"
                        onClick={() => setPlaybackRate(r)}
                      >
                        {r}x
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    听不清就减速反复听；听清后可加速到 1.5x/2x 增加强度。
                  </p>

                  {/* Accent selection (methodology: accent training). */}
                  <div className="flex flex-wrap gap-2 justify-center items-center">
                    <span className="text-xs text-muted-foreground">口音：</span>
                    {VOICE_OPTIONS.map((v) => (
                      <Button
                        key={v.id}
                        size="sm"
                        variant={voice === v.id ? "default" : "outline"}
                        className="min-h-[32px]"
                        onClick={() => {
                          markActive();
                          setVoice(v.id);
                        }}
                      >
                        {v.label}
                      </Button>
                    ))}
                  </div>

                  {/* Didn't catch it? Break the sentence into phrases
                      (methodology: divide-and-conquer for long sentences). */}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full min-h-[36px]"
                    onClick={() => void chunkSentence()}
                    disabled={isChunking || !currentSentence}
                  >
                    {isChunking ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : null}
                    {isChunking ? "拆解中..." : "听不懂？拆解成短语"}
                  </Button>
                  {chunks && (
                    <div className="space-y-1 text-sm border-l-2 border-primary/40 pl-3">
                      {chunks.map((c, i) => (
                        <div key={i} className="leading-snug">
                          <span className="font-medium">{c.phrase}</span>
                          <span className="text-xs text-muted-foreground ml-2">{c.role}</span>
                          <div className="text-xs text-muted-foreground">{c.meaning}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  <Button
                    size="lg"
                    variant="outline"
                    className="w-full min-h-[44px]"
                    onClick={() => {
                      markActive();
                      setSubtitleMode("english");
                      setStage("recall");
                    }}
                  >
                    揭示原文并跟读
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              )}

              {stage === "recall" && (
                <div className="space-y-3">
                  {subtitleMode !== "hidden" && (
                    <p className="text-base font-medium text-center py-2">
                      {currentSentence}
                    </p>
                  )}
                  {subtitleMode === "bilingual" && (
                    <p className="text-sm text-muted-foreground text-center italic">
                      {currentTranslation}
                    </p>
                  )}
                  {subtitleMode === "hidden" && (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      字幕已隐藏——纯靠声音跟读。
                    </p>
                  )}

                  {/* Subtitle mode switcher */}
                  <div className="flex flex-wrap gap-2 justify-center">
                    {(["english", "bilingual", "hidden"] as const).map((m) => (
                      <Button
                        key={m}
                        size="sm"
                        variant={subtitleMode === m ? "default" : "outline"}
                        className="min-h-[36px]"
                        onClick={() => setSubtitleMode(m)}
                      >
                        {m === "english" ? "纯英" : m === "bilingual" ? "双语" : "隐藏"}
                      </Button>
                    ))}
                  </div>

                  {/* Self-rated direct comprehension: did the picture fire from
                      the sound alone? 1=没画面 2=模糊 3=清晰。Methodology signal. */}
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground text-center">
                      听的时候画面浮现了吗？
                    </p>
                    <div className="flex flex-wrap gap-2 justify-center">
                      {[1, 2, 3].map((n) => (
                        <Button
                          key={n}
                          size="sm"
                          variant={subjectiveComprehension === n ? "default" : "outline"}
                          className="min-h-[36px]"
                          onClick={() => setSubjectiveComprehension(n)}
                        >
                          {n === 1 ? "1·没画面" : n === 2 ? "2·模糊" : "3·清晰"}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <Button
                    size="lg"
                    variant={recStatus === "recording" ? "destructive" : "default"}
                    className="w-full min-h-[44px]"
                    onClick={() => {
                      markActive();
                      recStatus === "recording" ? void stopAttempt() : void startAttempt();
                    }}
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
                </div>
              )}
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

      {data && data.sentences.length > 0 && (
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
