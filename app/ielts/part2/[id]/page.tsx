"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Check,
  Lightbulb,
  Loader2,
  Mic,
  Plus,
  Send,
  Sparkles,
  Volume2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { dbHelpers } from "@/lib/db-helpers";
import {
  PART2_CARDS,
  pickRandomCard,
  type Part2Card,
} from "@/lib/ielts-part2-cards";
import { useCountdown, useStopwatch } from "@/lib/use-countdown";
import {
  scorePart2Monologue,
  generateFollowUps,
  reviewFollowUpAnswers,
} from "@/lib/ielts-part2-review";
import {
  startRecording,
  isRecordingSupported,
  type RecordingSession,
} from "@/lib/speech";
import { speakStream, stopSpeaking } from "@/lib/tts";
import type { Card as SrsCard, Part2Review, Part2Session } from "@/lib/types";

// Single source of truth for the whole session UI (deliberately one enum
// instead of the conversation page's multi-flag tangle).
type Part2Phase =
  | "prep"
  | "speaking"
  | "transcribing"
  | "scoring"
  | "followup"
  | "done";

const PREP_SECONDS = 60;
const SPEAK_CAP_SECONDS = 120;
const MIN_SPEAK_SECONDS = 30;
const MIN_TRANSCRIPT_WORDS = 10;

// Provenance tag for vocab cards created from Part 2 practice. Pinned in one
// typed constant so the literal is defined once; "ielts-part2" is part of the
// CardSource union in lib/types.ts.
const PART2_CARD_SOURCE: SrsCard["source"] = "ielts-part2";

const wordCount = (text: string): number =>
  text.trim().split(/\s+/).filter(Boolean).length;

const formatMmSs = (totalSeconds: number): string => {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const SUB_SCORE_LABELS: Array<{
  key: keyof Part2Review["scores"];
  label: string;
  caveat?: string;
}> = [
  { key: "fluencyCoherence", label: "Fluency & Coherence" },
  { key: "lexicalResource", label: "Lexical Resource" },
  { key: "grammaticalRange", label: "Grammatical Range & Accuracy" },
  {
    key: "pronunciation",
    label: "Pronunciation",
    caveat: "estimate — inferred from transcript, not audio",
  },
];

const resolveCard = (cardId: string | null): Part2Card => {
  if (cardId) {
    const found = PART2_CARDS.find((c) => c.id === cardId);
    if (found) return found;
  }
  return pickRandomCard();
};

const Part2SessionPage = () => {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const sessionId = params.id;

  // The cue card is fixed for the lifetime of this session. Resolved once from
  // ?card= (falling back to a random card) via lazy initial state so it's
  // stable across renders and never re-picks a random card on re-render.
  const [card] = useState<Part2Card>(() =>
    resolveCard(searchParams.get("card"))
  );

  const [phase, setPhase] = useState<Part2Phase>("prep");
  const [notes, setNotes] = useState("");
  const [readAloud, setReadAloud] = useState(false);

  const [transcript, setTranscript] = useState("");
  const [durationSec, setDurationSec] = useState(0);
  const [review, setReview] = useState<Part2Review | null>(null);
  // Latest review mirrored into a ref so finishFollowUps can merge feedback into
  // the current review without reading a stale closure or doing side effects
  // inside a setState updater.
  const reviewRef = useRef<Part2Review | null>(null);

  // A recoverable, user-facing message for the current phase (mic/permission,
  // too-short, transcription failure, scoring failure). Cleared on each fresh
  // attempt.
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Follow-up state.
  const [followUpQuestions, setFollowUpQuestions] = useState<string[]>([]);
  const [followUpIndex, setFollowUpIndex] = useState(0);
  const [followUpAnswers, setFollowUpAnswers] = useState<
    Array<{ question: string; answer: string }>
  >([]);
  const [followUpRecording, setFollowUpRecording] = useState(false);
  const [followUpTranscribing, setFollowUpTranscribing] = useState(false);

  // SRS "add to review cards" tracking.
  const [addedVocab, setAddedVocab] = useState<Set<number>>(new Set());
  const [addingVocab, setAddingVocab] = useState<number | null>(null);

  // Whether the restore-on-mount check has finished. Until it has, we don't run
  // the prep countdown (a finished session must restore to "done", never
  // restart the timer).
  const [restored, setRestored] = useState(false);

  // --- Refs (mutated only in effects/handlers, never during render) ---
  const mountedRef = useRef(true);
  const sessionRef = useRef<RecordingSession | null>(null);
  const startingRef = useRef(false);
  // Latest stopwatch elapsed, mirrored so stopAndTranscribe can capture the
  // speaking duration at the instant of stopping without depending on stale
  // closure state.
  const elapsedRef = useRef(0);
  // Guards the async score→persist→advance path against double entry.
  const scoringRef = useRef(false);

  const isSupported =
    typeof window !== "undefined" && isRecordingSupported();

  // --- Recording start (shared by monologue + re-record) ---
  // Guards double-entry (startingRef): phase only flips to "speaking" AFTER
  // startRecording() resolves, so a second call during that await would spawn a
  // second MediaRecorder. On success stores the session; if we unmounted during
  // the await, cancel it. Mic/permission failure keeps the user recoverable.
  const beginRecording = useCallback(
    async (nextPhase: Extract<Part2Phase, "speaking">): Promise<void> => {
      if (startingRef.current) return;
      startingRef.current = true;
      setErrorMsg(null);
      try {
        const session = await startRecording();
        if (!mountedRef.current) {
          session.cancel();
          return;
        }
        sessionRef.current = session;
        setPhase(nextPhase);
      } catch (err) {
        sessionRef.current = null;
        if (mountedRef.current) {
          const denied =
            err instanceof Error &&
            err.message.includes("microphone permission denied");
          setErrorMsg(
            denied
              ? "Microphone permission denied. Please allow mic access in your browser and try again."
              : "Microphone unavailable (permission denied or unsupported). Please check your device and try again."
          );
        }
      } finally {
        startingRef.current = false;
      }
    },
    []
  );

  // Leaving prep: stop reading the card aloud and start the monologue.
  const startSpeaking = useCallback((): void => {
    stopSpeaking();
    void beginRecording("speaking");
  }, [beginRecording]);

  // --- Scoring (shared by first score + "Retry scoring") ---
  const scoreTranscript = useCallback(
    async (text: string, duration: number): Promise<void> => {
      if (scoringRef.current) return;
      scoringRef.current = true;
      setPhase("scoring");
      setErrorMsg(null);
      try {
        const result = await scorePart2Monologue(
          card.topic,
          card.bullets,
          text
        );
        if (!mountedRef.current) return;
        const session: Part2Session = {
          id: sessionId,
          cardId: card.id,
          topic: card.topic,
          transcript: text,
          durationSec: duration,
          review: result,
          followUps: [],
          createdAt: new Date(),
        };
        await db.part2Sessions.put(session);
        if (!mountedRef.current) return;
        setReview(result);
        setPhase("followup");
      } catch {
        if (!mountedRef.current) return;
        // Never lose the monologue: persist it with review:null so a refresh
        // restores to the retry-scoring affordance rather than dropping it.
        try {
          const existing = await db.part2Sessions.get(sessionId);
          const session: Part2Session = {
            id: sessionId,
            cardId: card.id,
            topic: card.topic,
            transcript: text,
            durationSec: duration,
            review: null,
            followUps: [],
            createdAt: existing?.createdAt ?? new Date(),
          };
          await db.part2Sessions.put(session);
        } catch {
          // Persistence failure is non-fatal here; the transcript is still in
          // state and the user can retry scoring.
        }
        if (!mountedRef.current) return;
        setErrorMsg(
          "Couldn't score your response. Your monologue is saved — you can retry scoring."
        );
        setPhase("scoring");
      } finally {
        scoringRef.current = false;
      }
    },
    [card.topic, card.bullets, card.id, sessionId]
  );

  // --- Stop → transcribe → score ---
  const stopAndTranscribe = useCallback(async (): Promise<void> => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    const capturedDuration = elapsedRef.current;
    setDurationSec(capturedDuration);
    setPhase("transcribing");
    setErrorMsg(null);
    try {
      const { text } = await session.stop();
      if (!mountedRef.current) return;
      if (wordCount(text) < MIN_TRANSCRIPT_WORDS) {
        setTranscript("");
        setErrorMsg("That was very short — try recording again.");
        // Stay recoverable: offer a re-record (no fresh 60s prep).
        setPhase("transcribing");
        return;
      }
      setTranscript(text);
      await scoreTranscript(text, capturedDuration);
    } catch {
      if (!mountedRef.current) return;
      setTranscript("");
      setErrorMsg("Couldn't transcribe your monologue — please re-record.");
      setPhase("transcribing");
    }
  }, [scoreTranscript]);

  // Re-record after a too-short / failed transcription: back to speaking with a
  // fresh recording, WITHOUT repeating the 60s prep (the user already prepared).
  const reRecord = useCallback((): void => {
    setErrorMsg(null);
    void beginRecording("speaking");
  }, [beginRecording]);

  // --- Timers ---
  // Countdown runs only during prep AND only after restore resolved (a restored
  // finished session must not restart the 60s clock).
  const prepRunning = phase === "prep" && restored;
  const { remaining: prepRemaining } = useCountdown(
    PREP_SECONDS,
    startSpeaking,
    prepRunning
  );

  const speakingRunning = phase === "speaking";
  const { elapsed: speakElapsed } = useStopwatch(
    speakingRunning,
    SPEAK_CAP_SECONDS,
    stopAndTranscribe
  );

  // Mirror the live elapsed into a ref so stopAndTranscribe captures the exact
  // duration at stop time (the hook resets elapsed to 0 only when speaking
  // starts, so this stays correct across the stop transition).
  useEffect(() => {
    elapsedRef.current = speakElapsed;
  }, [speakElapsed]);

  // Keep reviewRef in sync so async finalizers merge into the latest review.
  useEffect(() => {
    reviewRef.current = review;
  }, [review]);

  // --- Read card aloud toggle (optional, off by default) ---
  useEffect(() => {
    if (phase === "prep" && readAloud) {
      const text = `${card.topic}. ${card.bullets.join(". ")}.`;
      void speakStream(text);
    }
    // stopSpeaking handled on toggle-off / phase change / unmount below.
  }, [readAloud, phase, card.topic, card.bullets]);

  // Stop TTS whenever we leave prep (or read-aloud is turned off).
  useEffect(() => {
    if (phase !== "prep" || !readAloud) {
      stopSpeaking();
    }
  }, [phase, readAloud]);

  // --- Restore on mount ---
  // A scored session normally jumps straight to "done" and must not restart the
  // flow. Exception: if it was scored but the follow-up round never completed
  // (no answers recorded and no follow-up feedback), restore into "followup" so
  // the user still gets that round instead of silently skipping it. A session
  // persisted without a review (interrupted after transcript) restores the
  // transcript and lands on "scoring" with a retry affordance. Anything else
  // starts a fresh prep.
  useEffect(() => {
    void (async () => {
      try {
        const existing = await db.part2Sessions.get(sessionId);
        if (!mountedRef.current) return;
        if (existing?.review) {
          setTranscript(existing.transcript);
          setDurationSec(existing.durationSec);
          setReview(existing.review);
          setFollowUpAnswers(existing.followUps);
          const followUpIncomplete =
            existing.followUps.length === 0 &&
            !existing.review.followUpFeedback;
          setPhase(followUpIncomplete ? "followup" : "done");
        } else if (existing) {
          setTranscript(existing.transcript);
          setDurationSec(existing.durationSec);
          setErrorMsg(
            "Your monologue was saved but not scored yet — you can retry scoring."
          );
          setPhase("scoring");
        }
      } finally {
        if (mountedRef.current) setRestored(true);
      }
    })();
    // Restore runs once per session id.
  }, [sessionId]);

  // --- Follow-up generation on entering the followup phase ---
  const followUpStartedRef = useRef(false);
  useEffect(() => {
    if (phase !== "followup") return;
    if (followUpStartedRef.current) return;
    followUpStartedRef.current = true;
    void (async () => {
      try {
        const questions = await generateFollowUps(card.topic, transcript);
        if (!mountedRef.current) return;
        if (questions.length === 0) {
          setPhase("done");
          return;
        }
        setFollowUpQuestions(questions);
      } catch {
        // Follow-ups are enrichment, not core: on failure skip straight to the
        // results view instead of blocking the round.
        if (mountedRef.current) setPhase("done");
      }
    })();
  }, [phase, card.topic, transcript]);

  // --- Follow-up recording (reuses the record/stop/transcribe path, no cap) ---
  const startFollowUpRecording = useCallback(async (): Promise<void> => {
    if (startingRef.current || followUpRecording || followUpTranscribing) return;
    startingRef.current = true;
    setErrorMsg(null);
    try {
      const session = await startRecording();
      if (!mountedRef.current) {
        session.cancel();
        return;
      }
      sessionRef.current = session;
      setFollowUpRecording(true);
    } catch {
      sessionRef.current = null;
      if (mountedRef.current) {
        setErrorMsg(
          "Microphone unavailable. Please check mic access and try again."
        );
      }
    } finally {
      startingRef.current = false;
    }
  }, [followUpRecording, followUpTranscribing]);

  // Finalize all follow-up answers: get combined feedback, persist, go to done.
  const finishFollowUps = useCallback(
    async (qa: Array<{ question: string; answer: string }>): Promise<void> => {
      try {
        const feedback = await reviewFollowUpAnswers(card.topic, qa);
        if (!mountedRef.current) return;
        // Merge feedback into the latest review (read from the ref, not a stale
        // closure), then persist and set state outside any updater so the DB
        // write happens exactly once (updaters may run multiple times).
        const current = reviewRef.current;
        const next = current
          ? { ...current, followUpFeedback: feedback }
          : current;
        await db.part2Sessions.update(sessionId, {
          followUps: qa,
          ...(next ? { review: next } : {}),
        });
        if (!mountedRef.current) return;
        if (next) setReview(next);
      } catch {
        // Feedback is enrichment: still persist the answers so they aren't lost.
        if (mountedRef.current) {
          void db.part2Sessions.update(sessionId, { followUps: qa });
        }
      } finally {
        if (mountedRef.current) setPhase("done");
      }
    },
    [card.topic, sessionId]
  );

  const stopFollowUpAnswer = useCallback(async (): Promise<void> => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    setFollowUpRecording(false);
    setFollowUpTranscribing(true);
    setErrorMsg(null);
    const question = followUpQuestions[followUpIndex] ?? "";
    try {
      const { text } = await session.stop();
      if (!mountedRef.current) return;
      const qa = [...followUpAnswers, { question, answer: text }];
      setFollowUpAnswers(qa);
      setFollowUpTranscribing(false);
      if (followUpIndex + 1 < followUpQuestions.length) {
        setFollowUpIndex(followUpIndex + 1);
      } else {
        await finishFollowUps(qa);
      }
    } catch {
      if (!mountedRef.current) return;
      setFollowUpTranscribing(false);
      setErrorMsg(
        "Couldn't transcribe your answer — please record it again."
      );
    }
  }, [
    followUpQuestions,
    followUpIndex,
    followUpAnswers,
    finishFollowUps,
  ]);

  // Speak the current follow-up question aloud (optional).
  const speakQuestion = useCallback((): void => {
    const q = followUpQuestions[followUpIndex];
    if (q) void speakStream(q);
  }, [followUpQuestions, followUpIndex]);

  // --- Add-to-SRS for new vocabulary (mirrors the conversation review page) ---
  const handleAddVocab = useCallback(
    async (index: number): Promise<void> => {
      if (!review) return;
      if (addedVocab.has(index) || addingVocab !== null) return;
      const vocab = review.newVocabulary[index];
      if (!vocab) return;
      setAddingVocab(index);
      try {
        const existing = await dbHelpers.getCardByLemma(vocab.lemma);
        if (!existing) {
          const newCard: SrsCard = {
            id: crypto.randomUUID(),
            type: "vocabulary",
            lemma: vocab.lemma,
            front: vocab.word,
            back: vocab.definition,
            context: vocab.example,
            source: PART2_CARD_SOURCE,
            sourceId: sessionId,
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
        if (mountedRef.current) {
          setAddedVocab((prev) => new Set(prev).add(index));
        }
      } finally {
        if (mountedRef.current) setAddingVocab(null);
      }
    },
    [review, addedVocab, addingVocab, sessionId]
  );

  // --- beforeunload warning while in progress and unscored ---
  const inProgressUnscored =
    phase === "speaking" ||
    phase === "transcribing" ||
    phase === "scoring" ||
    phase === "followup";
  useEffect(() => {
    if (!inProgressUnscored) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [inProgressUnscored]);

  // --- Mounted flag: set true on (re)mount, false on unmount ---
  // Must be set here rather than only cleared in the cleanup below: under React
  // StrictMode (dev) the component mounts, unmounts, then remounts. A one-way
  // "set false on unmount" would leave the ref false forever after that first
  // unmount, silently swallowing every post-await setState on the real mount.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // --- Unmount cleanup: cancel any active recording + stop TTS ---
  useEffect(() => {
    return () => {
      sessionRef.current?.cancel();
      sessionRef.current = null;
      stopSpeaking();
    };
  }, []);

  // --- Unsupported gate ---
  if (!isSupported) {
    return (
      <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center gap-4 text-center">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <div>
          <h1 className="text-lg font-semibold">Voice recording not supported</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            IELTS Part 2 practice needs microphone recording, which isn&apos;t
            available in this browser. Try a recent version of Chrome, Edge, or
            Safari.
          </p>
        </div>
        <Button variant="outline" onClick={() => router.push("/ielts/part2")}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
      </div>
    );
  }

  // In the transcribing phase, an errorMsg is only ever set for a recoverable
  // outcome (too-short or transcription failure) that keeps us on this phase —
  // scoring transitions to phase "scoring" first — so this alone identifies the
  // re-record state without reading a ref during render.
  const showReRecord = phase === "transcribing" && errorMsg !== null;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-6 overflow-y-auto pb-8">
      {/* Header */}
      <div className="flex items-center justify-between pt-2">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2"
          onClick={() => router.push("/ielts/part2")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Badge variant="secondary" className="capitalize">
          {card.category}
        </Badge>
      </div>

      {/* Cue card (shown throughout) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{card.topic}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-2 text-sm font-medium text-muted-foreground">
            You should say:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {card.bullets.map((bullet, i) => (
              <li key={i}>{bullet}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* ---- PREP ---- */}
      {phase === "prep" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span>Preparation time</span>
              <span className="font-mono text-2xl tabular-nums">
                {prepRemaining}s
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              You have {PREP_SECONDS} seconds to prepare. Jot down notes below
              (they&apos;re just for you — never sent or scored), then speak for
              1–2 minutes.
            </p>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Your prep notes (private, not scored)…"
              className="min-h-[120px] resize-none"
            />
            {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                className="w-full min-h-[44px]"
                onClick={startSpeaking}
              >
                <Mic className="h-4 w-4" />
                I&apos;m ready
              </Button>
              <Button
                type="button"
                variant={readAloud ? "default" : "outline"}
                className="w-full min-h-[44px]"
                onClick={() => setReadAloud((v) => !v)}
              >
                <Volume2 className="h-4 w-4" />
                Read card aloud: {readAloud ? "ON" : "OFF"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- SPEAKING ---- */}
      {phase === "speaking" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-white animate-pulse">
                  <Mic className="h-4 w-4" />
                </span>
                Speaking
              </span>
              <span className="font-mono text-2xl tabular-nums">
                {formatMmSs(speakElapsed)}
                <span className="ml-1 text-sm text-muted-foreground">
                  / {formatMmSs(SPEAK_CAP_SECONDS)}
                </span>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Speak continuously about the cue card. Recording stops
              automatically at {formatMmSs(SPEAK_CAP_SECONDS)}.
            </p>
            <Button
              className="w-full min-h-[44px]"
              disabled={speakElapsed < MIN_SPEAK_SECONDS}
              onClick={() => void stopAndTranscribe()}
            >
              <Send className="h-4 w-4" />
              {speakElapsed < MIN_SPEAK_SECONDS
                ? `Keep going… (Stop enabled at ${formatMmSs(MIN_SPEAK_SECONDS)})`
                : "Stop & get feedback"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ---- TRANSCRIBING ---- */}
      {phase === "transcribing" && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-8">
            {showReRecord ? (
              <>
                <AlertTriangle className="h-6 w-6 text-destructive" />
                <p className="text-center text-sm text-muted-foreground">
                  {errorMsg}
                </p>
                <Button onClick={reRecord}>
                  <Mic className="h-4 w-4" />
                  Re-record
                </Button>
              </>
            ) : (
              <>
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Transcribing…</p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---- SCORING (loading OR retry-on-failure) ---- */}
      {phase === "scoring" && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-8">
            {errorMsg ? (
              <>
                <AlertTriangle className="h-6 w-6 text-destructive" />
                <p className="text-center text-sm text-muted-foreground">
                  {errorMsg}
                </p>
                {transcript && (
                  <div className="w-full rounded-lg border bg-muted/20 p-3 text-sm">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      Your monologue:
                    </p>
                    <p className="whitespace-pre-wrap">{transcript}</p>
                  </div>
                )}
                <Button
                  onClick={() => void scoreTranscript(transcript, durationSec)}
                >
                  Retry scoring
                </Button>
              </>
            ) : (
              <>
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Scoring your response…
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---- FOLLOW-UP ---- */}
      {phase === "followup" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Follow-up{" "}
              {followUpQuestions.length > 0 &&
                `(${followUpIndex + 1}/${followUpQuestions.length})`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {followUpQuestions.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-4">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Preparing a follow-up question…
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2 rounded-lg border bg-muted/20 p-3">
                  <p className="text-sm font-medium">
                    {followUpQuestions[followUpIndex]}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Read question aloud"
                    onClick={speakQuestion}
                  >
                    <Volume2 className="h-4 w-4" />
                  </Button>
                </div>
                {errorMsg && (
                  <p className="text-sm text-destructive">{errorMsg}</p>
                )}
                {followUpTranscribing ? (
                  <Button className="w-full min-h-[44px]" disabled>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Transcribing…
                  </Button>
                ) : followUpRecording ? (
                  <Button
                    className="w-full min-h-[44px]"
                    onClick={() => void stopFollowUpAnswer()}
                  >
                    <Send className="h-4 w-4" />
                    Stop & submit answer
                  </Button>
                ) : (
                  <Button
                    className="w-full min-h-[44px]"
                    onClick={() => void startFollowUpRecording()}
                  >
                    <Mic className="h-4 w-4" />
                    Record your answer
                  </Button>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---- DONE (results) ---- */}
      {phase === "done" && review && (
        <>
          {/* Headline band estimate */}
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="flex flex-col items-center gap-1 py-8">
              <p className="text-sm font-medium text-muted-foreground">
                Estimated IELTS Band
              </p>
              <p className="text-5xl font-bold">{review.bandEstimate}</p>
              <p className="text-xs text-muted-foreground">out of 9</p>
            </CardContent>
          </Card>

          {/* Sub-scores */}
          <Card>
            <CardHeader>
              <CardTitle>Band descriptors</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {SUB_SCORE_LABELS.map(({ key, label, caveat }) => (
                <div
                  key={key}
                  className="flex flex-col gap-0.5 rounded-lg border bg-card p-3"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-medium">{label}</span>
                    <span className="text-xl font-bold">
                      {review.scores[key]}
                      <span className="text-xs font-normal text-muted-foreground">
                        /100
                      </span>
                    </span>
                  </div>
                  {caveat && (
                    <span className="text-xs italic text-amber-600 dark:text-amber-500">
                      {caveat}
                    </span>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Transcript */}
          {transcript && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Your monologue{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    · {formatMmSs(durationSec)}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm">{transcript}</p>
              </CardContent>
            </Card>
          )}

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
                {review.errors.map((error, i) => (
                  <div
                    key={`error-${i}`}
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
                  </div>
                ))}
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
                {review.improvements.map((improvement, i) => (
                  <div
                    key={`improvement-${i}`}
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
                  </div>
                ))}
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

          {/* Follow-up feedback */}
          {review.followUpFeedback && (
            <Card className="border-blue-500/30 bg-blue-500/5">
              <CardHeader>
                <CardTitle className="text-base">Follow-up feedback</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {followUpAnswers.map((qa, i) => (
                  <div
                    key={`qa-${i}`}
                    className="rounded-lg border bg-card p-3 text-sm"
                  >
                    <p className="font-medium">{qa.question}</p>
                    <p className="mt-1 text-muted-foreground">{qa.answer}</p>
                  </div>
                ))}
                <p className="text-sm">{review.followUpFeedback}</p>
              </CardContent>
            </Card>
          )}

          {/* New vocabulary */}
          {review.newVocabulary.length > 0 && (
            <Card className="border-purple-500/30 bg-purple-500/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-purple-600 dark:text-purple-500">
                  <BookOpen className="h-4 w-4" />
                  New Vocabulary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {review.newVocabulary.map((vocab, i) => {
                  const isAdded = addedVocab.has(i);
                  return (
                    <div
                      key={`vocab-${i}`}
                      className="rounded-lg border bg-card p-3 text-sm"
                    >
                      <p className="font-medium">{vocab.word}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {vocab.definition}
                      </p>
                      <p className="mt-1 text-xs italic text-muted-foreground">
                        {vocab.example}
                      </p>
                      <Button
                        size="sm"
                        variant={isAdded ? "secondary" : "outline"}
                        className="mt-2"
                        disabled={isAdded || addingVocab === i}
                        onClick={() => void handleAddVocab(i)}
                      >
                        {isAdded ? (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            Added!
                          </>
                        ) : (
                          <>
                            <Plus className="h-3.5 w-3.5" />
                            Add to review cards
                          </>
                        )}
                      </Button>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          <Button
            className="w-full min-h-[44px]"
            onClick={() => router.push("/ielts/part2")}
          >
            Practice another
          </Button>
        </>
      )}
    </div>
  );
};

export default Part2SessionPage;
