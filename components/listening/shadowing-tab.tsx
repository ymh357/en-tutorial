"use client";

// Shadowing (repeat-after-me) tab for the listening page. Extracted from
// app/listening/page.tsx (W1-T1). W1-T3 added the 3-step direct-comprehension
// stage machine (imagine → listen → recall); subtitle gating / variable speed
// land in later W1 tasks.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import { completeTask, getReusableTask } from "@/lib/task-pool";
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
import { granularityForLevel, type StepGranularity } from "@/lib/study-engine";
import type { Material } from "@/lib/types";
import { materialToShadowingData } from "@/components/listening/material-adapter";
import {
  createYouTubePlayer,
  type MediaSource,
} from "@/components/listening/media-source";
import { createAudioPlayer } from "@/components/listening/audio-source";
import { extractVideoId } from "@/lib/youtube";

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


export const ShadowingTab = ({
  cefrLevel,
  material,
}: {
  cefrLevel: string;
  material?: Material;
}) => {
  // Media materials (authentic video/audio source, W4-T2/T3) swap the TTS
  // audio source for a real media player and skip LLM sentence generation
  // entirely — the text path (material undefined) is completely unaffected.
  // video uses YouTubeMediaSource (iframe), audio uses createAudioPlayer
  // (HTMLAudioElement); both implement the same MediaSource contract.
  const mediaKind = material?.mediaType;
  const isVideo = mediaKind === "video";
  const isAudio = mediaKind === "audio";
  const isMedia = isVideo || isAudio;
  const videoId = isVideo ? extractVideoId(material?.sourceUrl) : null;
  // Methodology: level decides step fineness. fine (A1-A2) => slower default
  // playback + forced imagine context; coarse (C1-C2) => native speed, may
  // skip the guided imagine step.
  const granularity: StepGranularity = granularityForLevel(cefrLevel);
  // Default rate derives from granularity (fine => 0.75, else 1). The user's
  // manual speed choice is held separately so a runtime cefrLevel change updates
  // the default without clobbering an explicit override (review W2 S3). Media
  // mode always starts at 1x — the native recording is the practice material,
  // and forcing 0.75 here would only mislead (the player defaulted to 1x and
  // play() never synced the rate, so A1-A2 showed "0.75x" while playing 1x —
  // deferred ②). The learner still slows down manually via the rate buttons,
  // which DO call setRate.
  const defaultRate = granularity === "fine" && !isMedia ? 0.75 : 1;
  const [userRateOverride, setUserRateOverride] = useState<number | null>(null);
  const playbackRate = userRateOverride ?? defaultRate;
  // Media mode: the player instance lives in a ref (mutating it must not
  // trigger a re-render — media-source/audio-source are imperative).
  // availableRates is mirrored into state once the player is ready so the rate
  // buttons can disable rates the underlying media doesn't actually support
  // (YouTube only; HTMLAudio supports the full grid).
  const router = useRouter();
  const sourceRef = useRef<MediaSource | null>(null);
  // React-owned wrapper for the YouTube player (video only). The player mounts
  // INSIDE it as a non-React child (see media-source.ts createYouTubePlayer):
  // we hand the host element to the source, which appends its own mount <div>
  // that YT.Player replaces with an iframe. Because React never owns that
  // mount/iframe, its reconciliation cannot collide with YT's DOM takeover —
  // the stage-driven className stays on this wrapper and is never smeared onto
  // the iframe. Audio has no on-screen player (sound only), so no host needed.
  const playerHostRef = useRef<HTMLDivElement | null>(null);
  const [availableRates, setAvailableRates] = useState<number[] | null>(null);
  const [abLoop, setAbLoop] = useState(false);
  // Media mode only: surfaced when the learner finishes the last sentence
  // (deferred ① — previously "Next Sentence" on the last sentence silently
  // no-op'd, leaving no completion signal).
  const [finished, setFinished] = useState(false);
  // T2a: text selection in the recall sentence → store a vocabulary card
  // linked to this media Material + sentence index (for clip playback).
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [justSavedCard, setJustSavedCard] = useState(false);
  // Pool/LLM-generated sentence set (text mode only). Media mode derives
  // `data` directly from `material` below instead of going through state —
  // materialToShadowingData is a pure sync function of `material`, so there's
  // nothing to synchronize via an effect (React 19 flags setState-in-effect).
  const [genData, setGenData] = useState<ShadowingData | null>(null);
  const data = useMemo(
    () => (isMedia && material ? materialToShadowingData(material) : genData),
    [isMedia, material, genData]
  );
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<Stage>("imagine");
  // Mirror stage into a ref so the player-construction effect's onStateChange
  // callback (which closes over `stage` at mount time and never re-runs on
  // stage change — deps are [isMedia,…]) can read the CURRENT stage. Without
  // this, activeInterval would keep feeding markActive in recall (where the
  // player can still be playing) and suppress the focus nudge there.
  const stageRef = useRef<Stage>(stage);
  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);
  const [subtitleMode, setSubtitleMode] = useState<SubtitleMode>("english");
  const [voice, setVoice] = useState<string>("en-US-AriaNeural");
  const [listensCount, setListensCount] = useState<number>(0);
  const [subjectiveComprehension, setSubjectiveComprehension] = useState<number | null>(null);
  const [chunks, setChunks] = useState<SentenceChunk[] | null>(null);
  const [isChunking, setIsChunking] = useState(false);
  // Token guard for chunkSentence: nextSentence/generateSentences bump it so a
  // slow in-flight chunk fetch can't land its result on a different sentence.
  const chunkTokenRef = useRef(0);
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
  }, [stage]);

  // Media mode: construct the player once (video: YouTube iframe via host;
  // audio: HTMLAudioElement from sourceUrl). The effect body only builds the
  // player, refs it, and registers callbacks — setState happens inside those
  // callbacks only (React 19 rule, see the focus-watchdog effect above for the
  // same pattern). `data` itself is derived from `material` above (no state
  // needed — see the `data` derivation comment).
  useEffect(() => {
    if (!isMedia || !material) return;
    let source: MediaSource;
    if (isVideo) {
      if (!videoId) return;
      const host = playerHostRef.current;
      if (!host) return;
      source = createYouTubePlayer({ videoId, host });
    } else if (isAudio && material.sourceUrl) {
      source = createAudioPlayer({ src: material.sourceUrl });
    } else {
      return;
    }
    sourceRef.current = source;
    // Media playback is a legitimately still, sustained-attention activity —
    // register with the focus watchdog so continuous PLAYING doesn't get
    // mistaken for going idle. A single markActive() on the state change is
    // NOT enough: the player then plays for many seconds with no further
    // state events, so the watchdog (which arms on listen/recall entry) would
    // fire its 20s nudge mid-playback. Keep marking active on a cadence while
    // playing, and stop when paused/ended (A1 found this nudge firing during
    // playback). Gate markActive on stage==="listen" via stageRef (the effect
    // doesn't re-run on stage change) so a still-playing clip can't keep the
    // watchdog fed in recall, where idle SHOULD nudge (review [重要]).
    let activeInterval: ReturnType<typeof setInterval> | null = null;
    const markActiveIfListening = (): void => {
      if (stageRef.current === "listen") markActive();
    };
    // Capture availableRates + sync the player's rate once, at onReady — the
    // earliest point getAvailableRates() reflects the actual media. Doing this
    // on the first onStateChange was unreliable: if the video is unavailable or
    // auto-play is blocked, the player sits at -1 (unstarted, mapState null)
    // and onStateChange never fires, leaving availableRates null forever and
    // rate buttons undisabled pre-ready (review [次要]). Audio's onReady fires
    // on loadedmetadata.
    const unsubscribeReady = source.onReady(() => {
      const rates = source.getAvailableRates();
      setAvailableRates(rates);
      if (!rates.includes(playbackRate)) {
        const applied = source.setRate(playbackRate);
        if (applied != null) setUserRateOverride(applied);
      } else {
        source.setRate(playbackRate);
      }
    });
    const unsubscribe = source.onStateChange((state) => {
      if (state === "playing") {
        markActiveIfListening();
        if (!activeInterval) {
          activeInterval = setInterval(() => markActiveIfListening(), 5000);
        }
      } else {
        if (activeInterval) {
          clearInterval(activeInterval);
          activeInterval = null;
        }
        markActiveIfListening();
      }
    });
    // Surface media load failures (blob URL dead / file corrupt / video
    // unavailable / embedding disabled). Without this, audio in particular — a
    // detached <audio> with no visible error frame — fails silently: ready
    // never true, play() no-ops, listensCount still climbs (review [重要]).
    const unsubscribeError = source.onError((message) => {
      setError(message);
      if (activeInterval) {
        clearInterval(activeInterval);
        activeInterval = null;
      }
    });
    return () => {
      if (activeInterval) clearInterval(activeInterval);
      unsubscribe();
      unsubscribeReady();
      unsubscribeError();
      source.destroy();
      sourceRef.current = null;
    };
    // playbackRate is captured at first-readiness above, not on every change —
    // re-running this effect would tear down and rebuild the player. The rate
    // buttons call setRate imperatively for live changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMedia, isVideo, isAudio, material, videoId]);

  const generateSentences = async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    setGenData(null);
    setIndex(0);
    setStage("imagine");
    setListensCount(0);
    setSubjectiveComprehension(null);
    setChunks(null);
    chunkTokenRef.current++;
    setIsChunking(false);
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
          setGenData(poolTask.content);
          await completeTask(poolTask.id, "listening-shadowing");
          setIsLoading(false);
          return;
        }
        // Stale pre-W1-T2 content (bare string[] shape): mark complete so this
        // row isn't re-fetched and rejected every visit, then fall through to
        // real-time generation.
        await completeTask(poolTask.id);
      }
    } catch {
      // Fall through to real-time generation
    }

    // Alternating repetition (W3): no fresh pool item, so revive a previously-
    // seen one rather than discarding it — same material resurfaces across
    // sessions. Still falls through to real-time generation if none eligible.
    try {
      const reusable = await getReusableTask("listening-shadowing");
      if (reusable && isShadowingData(reusable.content)) {
        setGenData(reusable.content);
        await completeTask(reusable.id, "listening-shadowing");
        setIsLoading(false);
        return;
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
      setGenData(payload.object);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate sentences");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Media mode feeds data directly from `material` (effect above) — skip
    // LLM/pool sentence generation entirely.
    if (isMedia) return;
    const timer = setTimeout(() => void generateSentences(), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentSentence = data?.sentences[index]?.text ?? "";
  const currentTranslation = data?.sentences[index]?.translation ?? "";
  const currentImageryHint = data?.sentences[index]?.imageryHint ?? "";
  // Media mode only: true on the last sentence, where "Next Sentence" becomes
  // "完成练习" and triggers the finished state (deferred ①).
  const isLastSentence =
    isMedia && !!data && index >= data.sentences.length - 1;

  // Media mode: play sentence `i`'s audio range. parseJson3 emits
  // audioEndMs: undefined whenever a json3 event is missing dDurationMs or
  // carries dDurationMs: 0 (both occur in real auto-caption tracks) — so we
  // can't just no-op when it's absent, or the learner hits a silent dead end.
  // Fall back to the next sentence's start (capped at 5s ahead) so the clip
  // always has a bounded end.
  const playSentence = (i: number): void => {
    const s = material?.sentences?.[i];
    if (s?.audioStartMs == null) return;
    const nextStart = material?.sentences?.[i + 1]?.audioStartMs;
    const endMs =
      s.audioEndMs ??
      Math.min(nextStart ?? s.audioStartMs + 5000, s.audioStartMs + 15000);
    setListensCount((c) => c + 1);
    sourceRef.current?.play(s.audioStartMs, endMs);
  };

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
            focusResets,
            materialId: material?.id,
          }
        );
        if (material?.id) {
          await dbHelpers.bumpMaterialExposure(material.id);
        }
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
    const token = ++chunkTokenRef.current;
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
      // Discard if the sentence changed (nextSentence/generateSentences) while
      // the fetch was in flight — otherwise sentence A's chunks land on B.
      if (token !== chunkTokenRef.current) return;
      setChunks(payload.object.chunks);
    } catch (err) {
      if (token !== chunkTokenRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to chunk the sentence");
    } finally {
      if (token === chunkTokenRef.current) setIsChunking(false);
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
    chunkTokenRef.current++;
    setIsChunking(false);
    if (data && index + 1 < data.sentences.length) {
      const nextIndex = index + 1;
      setIndex(nextIndex);
      // Video mode: pause and seek to the next sentence's start, but don't
      // auto-play — the learner presses play in the listen stage, same as
      // the TTS path never auto-speaks on advance. Also reset AB-loop — it's
      // a per-sentence practice aid, not a standing preference, so it must
      // not carry over and silently loop the next sentence's first playback.
      if (isMedia && material?.sentences) {
        const next = material.sentences[nextIndex];
        setAbLoop(false);
        sourceRef.current?.setAbLoop(false);
        sourceRef.current?.pause();
        if (next?.audioStartMs != null) {
          sourceRef.current?.seekTo(next.audioStartMs);
        }
      }
    } else if (!isMedia) {
      await generateSentences();
    } else {
      // Media mode reached the last sentence: surface completion instead of
      // silently no-op'ing (deferred ①). Pause the player and show a finished
      // state with a way back to listening practice.
      sourceRef.current?.pause();
      setFinished(true);
    }
  };

  const handleSentenceMouseUp = (): void => {
    if (!isMedia) return;
    if (stage !== "recall") return;
    if (subtitleMode === "hidden") return;
    const sel = window.getSelection()?.toString().trim() ?? "";
    if (sel.length === 0 || !currentSentence.includes(sel)) {
      setPendingSelection(null);
      return;
    }
    setPendingSelection(sel);
  };

  const handleSaveCard = async (): Promise<void> => {
    if (!material || !pendingSelection) return;
    const front = pendingSelection;
    try {
      await db.cards.add({
        id: crypto.randomUUID(),
        front,
        back: "",
        type: "vocabulary",
        lemma: front,
        context: "",
        sourceSentence: currentSentence,
        source: "listening",
        sourceId: material.id,
        materialId: material.id,
        sentenceIndex: index,
        easeFactor: 2.5,
        interval: 0,
        repetitions: 0,
        nextReview: new Date(),
        masteryLevel: "new",
        createdAt: new Date(),
        lastReviewedAt: null,
      });
      setJustSavedCard(true);
      setTimeout(() => setJustSavedCard(false), 1500);
    } catch (err) {
      console.error("save card failed", err);
    }
    setPendingSelection(null);
    window.getSelection()?.removeAllRanges();
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

              {isVideo && (
                // Always mounted (not just during "listen") so the host exists
                // in the DOM before the player-construction effect (which runs
                // once on mount, independent of `stage`) reads playerHostRef.
                // The player mounts INSIDE this wrapper as a non-React child
                // (see media-source.ts), so the stage-driven className/visibility
                // lives here on the React-owned wrapper — never on the iframe,
                // which React does not own and thus cannot smear className onto.
                <div
                  ref={playerHostRef}
                  className={
                    stage === "listen"
                      ? "aspect-video w-full rounded-md overflow-hidden [&>iframe]:block [&>iframe]:h-full [&>iframe]:w-full"
                      : "hidden"
                  }
                />
              )}

              {stage === "imagine" && (
                <div className="space-y-3 py-1">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground text-center">
                    {data?.topic}
                  </p>
                  <p className="text-sm text-muted-foreground text-center italic">
                    {data?.context}
                  </p>
                  {isMedia && currentImageryHint === "" ? (
                    <div className="space-y-2 text-center">
                      {isVideo && videoId && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}
                          alt={data?.context ?? "video thumbnail"}
                          className="mx-auto rounded-md max-w-full"
                        />
                      )}
                      <p className="text-sm py-2 border-l-2 border-primary/40 pl-3 ml-3 mr-3 text-left">
                        {isVideo
                          ? "先看视频标题和封面，想象这个视频会讲什么，不要急着播放。"
                          : "先看标题，想象这段音频会讲什么，不要急着播放。"}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-center py-2 border-l-2 border-primary/40 pl-3 ml-3 mr-3">
                      {currentImageryHint}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground text-center">
                    {granularity === "coarse"
                      ? "高阶段：可略过画面引导，直接进入听力。"
                      : "闭上眼睛，先在脑海中构造这个画面，不要急着看英文。"}
                  </p>
                  <Button
                    size="lg"
                    className="w-full min-h-[44px]"
                    onClick={() => {
                      markActive();
                      setStage("listen");
                    }}
                  >
                    {granularity === "coarse" ? "直接听" : "我已想好画面"}
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
                      if (isMedia) {
                        playSentence(index);
                      } else {
                        setListensCount((c) => c + 1);
                        void speak(currentSentence, undefined, playbackRate, voice);
                      }
                    }}
                  >
                    <Play className="h-4 w-4" />
                    播放（{playbackRate}x）
                  </Button>

                  {isMedia && (
                    <div className="flex justify-center">
                      <Button
                        size="sm"
                        variant={abLoop ? "default" : "outline"}
                        className="min-h-[36px]"
                        onClick={() => {
                          markActive();
                          const next = !abLoop;
                          setAbLoop(next);
                          sourceRef.current?.setAbLoop(next);
                        }}
                      >
                        {abLoop ? "AB 循环开" : "AB 循环关"}
                      </Button>
                    </div>
                  )}

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
                        disabled={isVideo && availableRates !== null && !availableRates.includes(r)}
                        onClick={() => {
                          markActive();
                          setUserRateOverride(r);
                          if (isMedia) {
                            const applied = sourceRef.current?.setRate(r);
                            if (applied != null) setUserRateOverride(applied);
                          }
                        }}
                      >
                        {r}x
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    听不清就减速反复听；听清后可加速到 1.5x/2x 增加强度。
                  </p>

                  {/* Accent selection (methodology: accent training) — media
                      mode has one fixed voice (the speaker in the recording),
                      so the accent picker doesn't apply. */}
                  {!isMedia && (
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
                  )}

                  <Button
                    size="lg"
                    variant="outline"
                    className="w-full min-h-[44px]"
                    onClick={() => {
                      markActive();
                      setSubtitleMode("english");
                      setStage("recall");
                      // Media mode: pause when leaving the listen stage — video's
                      // host goes display:none but YT audio keeps playing under
                      // it (and AB-loop would loop forever); audio has no host
                      // but plays just the same. Without this the sentence clip
                      // bleeds into recall and, while still playing, keeps the
                      // focus watchdog fed (review [重要]).
                      if (isMedia) {
                        sourceRef.current?.pause();
                      }
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
                    <p
                      className="text-base font-medium text-center py-2"
                      onMouseUp={handleSentenceMouseUp}
                    >
                      {currentSentence}
                    </p>
                  )}
                  {pendingSelection ? (
                    <div className="flex justify-center">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleSaveCard()}
                      >
                        存为生词卡：{pendingSelection}
                      </Button>
                    </div>
                  ) : null}
                  {justSavedCard ? (
                    <p className="text-xs text-center text-primary">已存</p>
                  ) : null}
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
                  {isMedia && currentTranslation === "" && (
                    <p className="text-xs text-muted-foreground text-center">
                      该素材无中文译文。
                    </p>
                  )}

                  {/* Subtitle mode switcher. Media materials have no
                      translation (only real captions), so "bilingual" is
                      dropped — only english/hidden remain. Text mode always
                      keeps "bilingual" even if the LLM happens to return an
                      empty translation (pre-existing behavior, out of scope). */}
                  <div className="flex flex-wrap gap-2 justify-center">
                    {(isMedia && currentTranslation === ""
                      ? (["english", "hidden"] as const)
                      : (["english", "bilingual", "hidden"] as const)
                    ).map((m) => (
                      <Button
                        key={m}
                        size="sm"
                        variant={subtitleMode === m ? "default" : "outline"}
                        className="min-h-[36px]"
                        onClick={() => {
                          markActive();
                          setSubtitleMode(m);
                        }}
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
                          onClick={() => {
                            markActive();
                            setSubjectiveComprehension(n);
                          }}
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
                      if (recStatus === "recording") {
                        void stopAttempt();
                      } else {
                        void startAttempt();
                      }
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

                  {/* Long sentence? Break it into phrases (methodology:
                      divide-and-conquer). Lives in recall — where English is
                      already revealed — so the listen stage stays sound-first. */}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full min-h-[36px]"
                    onClick={() => {
                      markActive();
                      void chunkSentence();
                    }}
                    disabled={isChunking || !currentSentence}
                  >
                    {isChunking ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : null}
                    {isChunking ? "拆解中..." : "长句？拆成短语逐个理解"}
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
            <div className="flex justify-center">
              <Button
                size="sm"
                variant="outline"
                className="min-h-[36px]"
                onClick={() => {
                  markActive();
                  if (isMedia) {
                    playSentence(index);
                  } else {
                    void speak(currentSentence, undefined, undefined, voice);
                  }
                }}
              >
                <Play className="h-4 w-4" />
                再听原句
              </Button>
            </div>
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

      {data && data.sentences.length > 0 && !(result && transcript !== null) && !finished && (
        <Button
          variant="outline"
          className="w-full min-h-[44px]"
          onClick={() => void nextSentence()}
          disabled={isLoading || recStatus !== "idle"}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isLastSentence ? (
            "完成练习"
          ) : (
            "Next Sentence"
          )}
        </Button>
      )}

      {finished && (
        <Card>
          <CardContent className="py-8 text-center space-y-4">
            <p className="text-sm font-medium">
              已完成全部 {data?.sentences.length ?? 0} 句精听练习。
            </p>
            <Button onClick={() => router.push("/listening")}>
              返回听力练习
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
