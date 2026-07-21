"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ArrowLeft, Mic, Send, Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { dbHelpers } from "@/lib/db-helpers";
import { recordCost } from "@/lib/cost-tracker";
import { useProfile } from "@/hooks/use-db";
import { getScenarioById } from "@/lib/scenarios";
import type { Conversation, ConversationMessage, ScenarioType } from "@/lib/types";
import type { ChatMessageMetadata } from "@/app/api/chat/route";
import { speakStream, stopSpeaking } from "@/lib/tts";
import { VoiceState } from "@/components/voice/voice-state";
import {
  startRecording,
  isRecordingSupported,
  startBargeInListen,
  type RecordingSession,
  type BargeInListener,
  type TranscribeResult,
} from "@/lib/speech";

const MIN_EXCHANGES_TO_END = 3;

const getMessageText = (parts: Array<{ type: string; text?: string }>): string =>
  parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");

// Convert stored ConversationMessage records (used for db persistence) into
// UIMessage objects that useChat can be seeded with on restore. Restored
// messages have no real usage metadata (it isn't persisted), so metadata is
// left undefined — handleEndAndReview treats that the same as a turn whose
// metadata never arrived.
const toUIMessages = (
  messages: ConversationMessage[]
): UIMessage<ChatMessageMetadata>[] =>
  messages.map((m, idx) => ({
    id: `restored-${idx}`,
    role: m.role,
    parts: [{ type: "text", text: m.content }],
  }));

const buildSystemPrompt = (params: {
  type: ScenarioType | null;
  scenarioParam: string | null;
  cefrLevel: string;
}): { system: string; title: string; description: string } => {
  const { type, scenarioParam, cefrLevel } = params;
  const levelLine = cefrLevel
    ? `The user's CEFR level is ${cefrLevel}. Adjust your vocabulary, sentence complexity, and pace to match this level.`
    : "Adjust your vocabulary and sentence complexity to a generally intermediate level.";

  const personality =
    "You are Alex, a friendly, warm, and genuinely curious conversation partner. You have your own personality — you're easygoing, quick to laugh, and interested in people's stories. You are NOT a language textbook or an AI assistant, and you should never sound like one.";

  const speechPatterns = [
    "Talk like a real person, not a script. Use contractions naturally (I'm, you're, don't, it's, that's).",
    "Sprinkle in natural filler words and reactions occasionally — things like \"well,\" \"actually,\" \"you know,\" \"Oh, interesting!,\" \"Right,\" \"I see,\" \"Hmm.\" Don't overdo it, just enough to feel human.",
    "Vary your sentence length — mix short, punchy reactions with a longer, more elaborated response now and then. Avoid responding with the same rhythm every time.",
    "Show genuine curiosity: react to what the user actually said, and ask a natural follow-up question about it rather than just moving the conversation along.",
    "Default to a casual, relaxed register. Only shift to a more formal tone if the scenario itself is professional (e.g., a job interview or business meeting).",
  ].join(" ");

  const pedagogyInstructions = [
    "i+1 input: Mostly speak at the user's level, but occasionally (roughly 1 in every 5-10 sentences) use a slightly more advanced word, idiom, or sentence structure than the user would use themselves. Don't overload any single reply with hard vocabulary — the goal is a gentle stretch, not a wall of unfamiliar language.",
    "Pushed output: Don't let the user coast on short answers. When they give a brief or vague reply, ask a genuine follow-up that requires elaboration — things like \"What do you mean by that?\", \"Why do you think that happened?\", or \"Can you give me an example?\". Aim to get the user producing longer, more complex sentences over the course of the conversation, not just one-word or one-clause responses.",
    "Recast, not correction: Never explicitly point out or explain a grammar mistake the user makes. Instead, weave the correct form naturally into your own reply, as a native speaker would when confirming or reacting to what someone said. For example, if the user says \"I goed to the store yesterday,\" you might reply \"Oh, you went to the store? What did you pick up?\" — the correction is implicit, embedded in your response, never flagged.",
    "Cognitive challenge: Don't just agree with everything the user says. Occasionally offer a mildly different opinion, push back and ask them to justify their view, or introduce a small unexpected twist into the scenario. Stay warm and non-confrontational, but be a real conversational partner with your own perspective, not a pushover who just validates whatever the user says.",
  ].join(" ");

  const baseInstructions = [
    "Stay in character throughout the conversation.",
    "If the user's first message is exactly \"[Start the conversation]\", treat this as a signal to open the conversation yourself: greet the user naturally and ask an opening question appropriate to the scenario, as if you were the one initiating the chat. Never mention or quote this bracketed instruction back to the user.",
    levelLine,
    "Do not explicitly correct the user's grammar mid-conversation — no direct callouts, no \"you should have said X.\" Detailed corrections happen later in a separate review step. Your only in-conversation error-correction tool is the recast technique described below.",
    "Keep responses conversational and not too long.",
    speechPatterns,
    pedagogyInstructions,
  ].join(" ");

  if (type === "preset" && scenarioParam) {
    const scenario = getScenarioById(scenarioParam);
    if (scenario) {
      return {
        system: `${personality} ${scenario.systemPromptContext} ${baseInstructions}`,
        title: scenario.name,
        description: scenario.description,
      };
    }
  }

  if (type === "custom" && scenarioParam) {
    return {
      system: `${personality} You are roleplaying the following scenario described by the user: "${scenarioParam}". Play an appropriate character for this scenario. ${baseInstructions}`,
      title: "Custom Scenario",
      description: scenarioParam,
    };
  }

  return {
    system: `${personality} You're having a free-form chat with the user about anything they'd like to discuss. ${baseInstructions}`,
    title: "Free Chat",
    description: "Talk about anything you want.",
  };
};

const ConversationPage = () => {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const profile = useProfile();

  const conversationId = params.id;
  const type = searchParams.get("type") as ScenarioType | null;
  const scenarioParam = searchParams.get("scenario");

  const { system, title, description } = useMemo(
    () =>
      buildSystemPrompt({
        type,
        scenarioParam,
        cefrLevel: profile?.studyLevel ?? "",
      }),
    [type, scenarioParam, profile?.studyLevel]
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { system },
      }),
    [system]
  );

  const { messages, sendMessage, status, stop, error, setMessages } = useChat<
    UIMessage<ChatMessageMetadata>
  >({
    id: conversationId,
    transport,
  });

  const [input, setInput] = useState("");
  const [isEnding, setIsEnding] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [startTime] = useState<number>(() => Date.now());
  const previousStatusRef = useRef(status);
  const [voiceMode, setVoiceMode] = useState(false);
  const voiceModeRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  // Barge-in (talk over the assistant): the listener active during TTS
  // playback. It records from the moment the assistant starts speaking, so on
  // onset the user's opening words are already captured. Held in a ref so
  // voice-mode exit / unmount can release its mic stream. bargedInRef marks
  // that an onset fired, so the post-playback path transcribes the captured
  // audio instead of opening a fresh recording.
  const bargeInRef = useRef<BargeInListener | null>(null);
  const bargedInRef = useRef(false);
  // Voice mode is a hands-free, spoken experience: the chat transcript is
  // hidden by default so the user just listens and talks. This toggles it
  // back on for when they want to read along. Not persisted -- each entry
  // into voice mode starts hidden again (reset in toggleVoiceMode).
  const [showTranscript, setShowTranscript] = useState(false);

  type MicStatus = "idle" | "recording" | "transcribing";
  const [micStatus, setMicStatus] = useState<MicStatus>("idle");
  const sessionRef = useRef<RecordingSession | null>(null);
  // True once the component has unmounted; guards setState calls that would
  // otherwise land after an `await` resolves post-unmount.
  const mountedRef = useRef(true);
  // Synchronous re-entry guard: mirrors the ShadowingTab pattern in
  // app/listening/page.tsx -- startMicSession's state only flips AFTER
  // startRecording() resolves, so a second call during that async window
  // would otherwise spawn a second MediaRecorder session.
  const startingRef = useRef(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [lastApproximate, setLastApproximate] = useState(false); // last transcript came from the SpeechRecognition fallback
  // Budget of automatic mic restarts after a failed transcription. Transient
  // failures (network blip, whisper timeout) deserve one silent retry;
  // deterministic ones (no STT configured, dead input device) would otherwise
  // spin forever, so the budget caps that at a single attempt and then hands
  // control back to the user. A ref, not state: it is read and written
  // synchronously inside stopAndSend's async flow, where a re-render-scheduled
  // state update would be read stale on the very next failure.
  const transcribeRetriesRef = useRef(0);
  const MAX_TRANSCRIBE_RETRIES = 1;

  const isStreaming = status === "streaming" || status === "submitted";
  const voiceSupported = typeof window !== "undefined" && isRecordingSupported();

  // The hidden greeting trigger sent to make the AI speak first in voice
  // mode; it's a real message for the API but shouldn't count as a user
  // exchange or be persisted/reviewed as something the user actually said.
  const isGreetingTrigger = (m: UIMessage): boolean =>
    m.role === "user" && getMessageText(m.parts) === "[Start the conversation]";

  const exchangeCount = messages.filter(
    (m) => m.role === "user" && !isGreetingTrigger(m)
  ).length;
  const canEnd = exchangeCount >= MIN_EXCHANGES_TO_END && !isStreaming;

  // Starts a fresh MediaRecorder session (whisper-primary, per lib/speech.ts).
  // getUserMedia denial / unsupported throws a clear error and does NOT retry
  // (kills the old not-allowed retry loop); surface it and drop out of voice mode.
  const startMicSession = async (): Promise<void> => {
    // Never open the mic while TTS is still playing (echo-loop guard), and
    // block concurrent starts (a second call during the startRecording()
    // await below would otherwise spawn a second MediaRecorder session).
    if (startingRef.current || isSpeakingRef.current) return;
    startingRef.current = true;
    // Do NOT clear voiceError here: stopAndSend sets a "try again" / "please
    // repeat" prompt immediately before calling startMicSession, and both run
    // in the same render frame — clearing here would coalesce that message to
    // null (React batching) and it would never show. Errors are cleared only
    // at intentional fresh-start points (toggleVoiceMode ON, faithful send).
    try {
      const session = await startRecording();
      // Re-check after the async gap: discard if we unmounted, TTS started
      // (read-aloud tapped during the await), or voice mode was turned off.
      if (!mountedRef.current || isSpeakingRef.current || !voiceModeRef.current) {
        session.cancel();
        return;
      }
      sessionRef.current = session;
      setMicStatus("recording");
    } catch {
      sessionRef.current = null;
      if (mountedRef.current) {
        setMicStatus("idle");
        setVoiceError(
          "Microphone unavailable (permission denied or unsupported). Voice mode off."
        );
        voiceModeRef.current = false;
        setVoiceMode(false);
      }
    } finally {
      startingRef.current = false;
    }
  };

  // Stop recording → faithful transcript → auto-send.
  //
  // On transcribe failure this reopens the mic AT MOST ONCE (see
  // transcribeRetriesRef), then stops and waits for the user. Retrying
  // without a budget used to spin forever: nothing about a deterministic
  // failure (STT misconfigured, dead input device) changes between attempts,
  // so every retry took the identical path and re-acquired the mic, leaving
  // the browser's recording indicator flickering indefinitely. One retry
  // still absorbs a transient blip; past that, voice mode stays ON and the
  // Record button is offered so recovery is an explicit user action.
  // Shared transcript handler for both the normal record→stop flow and the
  // barge-in captured audio. Takes a promise that resolves with a faithful
  // transcript (or rejects on "nothing recognized" per the lib/speech.ts
  // contract) and applies the same success/retry/error logic to both.
  const processTranscript = async (
    transcriptPromise: Promise<TranscribeResult>
  ): Promise<void> => {
    setMicStatus("transcribing");
    try {
      const { text, approximate } = await transcriptPromise;
      setLastApproximate(approximate);
      setVoiceError(null); // genuine send clears any stale "try again" prompt
      transcribeRetriesRef.current = 0; // a good transcript proves the path works again
      sendMessage({ text });
      // AI reply auto-plays via the voice-autoplay effect, which then
      // resumes recording through speakAndResumeListening → startMicSession.
    } catch {
      // Only retry while voice mode is still on -- the user may have toggled
      // it off during the transcription await, and reopening the mic then
      // would strand a live recording with no UI to stop it.
      if (
        transcribeRetriesRef.current < MAX_TRANSCRIBE_RETRIES &&
        voiceModeRef.current &&
        mountedRef.current
      ) {
        transcribeRetriesRef.current += 1;
        setVoiceError("Didn't catch that — listening again.");
        // startMicSession sets micStatus to "recording" on success, or "idle"
        // (and exits voice mode) if the mic is unavailable -- in both cases
        // the finally below is a no-op since the status left "transcribing".
        // If it early-returns without starting (TTS playing / concurrent
        // start), the status is still "transcribing" and the finally resets
        // it to "idle", surfacing the Record button. No path leaves the UI
        // stuck on "Transcribing…".
        await startMicSession();
        return;
      }
      setVoiceError("Didn't catch that — tap Record to try again.");
    } finally {
      setMicStatus((s) => (s === "transcribing" ? "idle" : s));
    }
  };

  const stopAndSend = async (): Promise<void> => {
    const session = sessionRef.current;
    if (!session || micStatus !== "recording" || isStreaming) return;
    sessionRef.current = null;
    await processTranscript(session.stop());
  };

  // Discard current recording and immediately start a fresh one, but only
  // while voice mode is actually still on -- an unconditional restart could
  // reopen the mic after toggleVoiceMode had just shut it down.
  const cancelMic = (): void => {
    sessionRef.current?.cancel();
    sessionRef.current = null;
    setMicStatus("idle");
    if (voiceModeRef.current) void startMicSession();
  };

  // Speaks the given text via TTS, then resumes listening for the user's next
  // utterance. During playback a barge-in listener runs and RECORDS the whole
  // time: if the user talks over the assistant, onset stops the speech and the
  // already-captured audio -- opening words included -- is transcribed and
  // sent. Nothing is clipped because recording began when the assistant did.
  //
  // The barge-in mic runs with echo cancellation, so the assistant's own TTS
  // is removed from the input and doesn't self-trigger. If imperfect AEC does
  // cause a false barge-in, it's bounded: the captured audio is near-silence,
  // which the empty-transcript path retries once then waits for the user.
  const speakAndResumeListening = async (text: string): Promise<void> => {
    isSpeakingRef.current = true;
    setIsSpeaking(true);
    bargedInRef.current = false;

    // On onset: mark the barge-in and stop TTS. stopSpeaking() flips the
    // playback token so the awaited speakStream() below resolves promptly.
    // Guarded by voiceModeRef so a late onset after the user left is ignored.
    const listener = await startBargeInListen(() => {
      if (!voiceModeRef.current) return;
      bargedInRef.current = true;
      stopSpeaking();
    });
    // The getUserMedia await above takes time; the user may have left voice
    // mode or the page may have unmounted meanwhile, in which case the exit
    // handlers already ran and found bargeInRef null. Drop this just-opened
    // listener now rather than leaking its mic/AudioContext.
    if (!voiceModeRef.current || !mountedRef.current) {
      listener?.cancel();
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      return;
    }
    bargeInRef.current = listener;

    // Sentence-streamed so the first sentence starts playing as soon as its
    // audio is ready instead of after the whole reply synthesizes. Resolves
    // once the passage has played OR when a barge-in stopped it early.
    await speakStream(text);

    isSpeakingRef.current = false;
    setIsSpeaking(false);

    const bargeIn = bargeInRef.current;
    bargeInRef.current = null;

    // Barge-in: the listener has been recording since playback started and is
    // STILL recording the user's ongoing utterance. Don't transcribe yet --
    // hand it off as the active recording session so the user finishes talking
    // and taps "Stop & Send" (or it's stopped by cancel), exactly like a
    // normal turn. Its captured audio already includes the opening words.
    if (bargedInRef.current && bargeIn && voiceModeRef.current && mountedRef.current) {
      sessionRef.current = { stop: bargeIn.stopAndTranscribe, cancel: bargeIn.cancel };
      setMicStatus("recording");
      return;
    }

    // No barge-in (or bailing out): discard the recording and resume the
    // normal listen for the user's turn. cancel() is idempotent.
    bargeIn?.cancel();
    if (voiceModeRef.current) {
      await startMicSession();
    }
  };

  const toggleVoiceMode = () => {
    if (voiceMode) {
      voiceModeRef.current = false;
      setVoiceMode(false);
      sessionRef.current?.cancel();
      sessionRef.current = null;
      setMicStatus("idle");
      setVoiceError(null);
      setLastApproximate(false); // leaving voice mode: don't let a stale banner follow the user out (M-a)
      stopSpeaking();
      bargeInRef.current?.cancel(); // release the barge-in mic if TTS was playing
      bargeInRef.current = null;
      bargedInRef.current = false;
      isSpeakingRef.current = false;
      setIsSpeaking(false);
    } else {
      voiceModeRef.current = true;
      setVoiceMode(true);
      // Clear any leftover text-mode recording session before entering voice
      // mode — otherwise a mid-recording text→voice switch would overwrite
      // sessionRef without cancelling it, leaking a live mic (bug I1).
      sessionRef.current?.cancel();
      sessionRef.current = null;
      setMicStatus("idle");
      setVoiceError(null);
      setLastApproximate(false); // fresh entry into voice mode: don't carry over a text-mode banner (M-a)
      setShowTranscript(false); // fresh entry starts hands-free: transcript hidden until asked for
      transcribeRetriesRef.current = 0; // fresh entry earns a fresh retry budget
      if (messages.length === 0) {
        // Let the AI open the conversation instead of prompting the user to
        // speak first. The greeting reply is spoken via the auto-play effect,
        // which resumes listening once TTS finishes.
        sendMessage({ text: "[Start the conversation]" });
      } else {
        void startMicSession();
      }
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Revealing the transcript in voice mode mounts a fresh scroll container at
  // scrollTop 0 (the effect above won't fire -- messages didn't change), so
  // jump it to the latest message the user just heard. "auto" (not "smooth")
  // so it lands at the bottom immediately rather than animating up from the top.
  useEffect(() => {
    if (showTranscript) bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [showTranscript]);

  // On mount, restore any in-progress (unreviewed) conversation from IndexedDB
  // so a refresh doesn't lose the exchange so far.
  useEffect(() => {
    void (async () => {
      const existing = await db.conversations.get(conversationId);
      if (existing && existing.messages.length > 0 && !existing.review) {
        setMessages(toUIMessages(existing.messages));
      }
    })();
    // Only run once on mount for this conversation id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Persist the conversation (without a review) each time the assistant
  // finishes streaming a reply, so refresh preserves progress.
  useEffect(() => {
    const wasStreaming =
      previousStatusRef.current === "streaming" ||
      previousStatusRef.current === "submitted";
    if (wasStreaming && status === "ready") {
      const conversationMessages: ConversationMessage[] = messages
        .filter((m) => (m.role === "user" || m.role === "assistant") && !isGreetingTrigger(m))
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: getMessageText(m.parts),
          timestamp: new Date(),
        }));

      if (conversationMessages.length > 0) {
        void (async () => {
          const existing = await db.conversations.get(conversationId);
          // Never overwrite a conversation that already has a review — a
          // deep link to a reviewed conversation must not clobber it.
          if (existing?.review) return;
          await db.conversations.put({
            id: conversationId,
            scenario: type === "preset" ? title : (scenarioParam ?? title),
            scenarioType: type ?? "free",
            messages: conversationMessages,
            review: null,
            duration: Math.round((Date.now() - startTime) / 1000),
            // Preserve the original creation time across autosaves instead
            // of resetting it to "now" on every persist.
            createdAt: existing?.createdAt ?? new Date(),
          });
        })();
      }
    }
    previousStatusRef.current = status;
  }, [status, messages, conversationId, type, scenarioParam, title, startTime]);

  // In voice mode, once the assistant finishes replying, speak the reply
  // aloud and then resume listening for the user's next utterance.
  // Uses its own ref to track the previous status independently of the
  // persistence effect (which updates previousStatusRef before this runs).
  const voiceAutoPlayPrevStatusRef = useRef(status);
  useEffect(() => {
    const wasStreaming =
      voiceAutoPlayPrevStatusRef.current === "streaming" ||
      voiceAutoPlayPrevStatusRef.current === "submitted";
    voiceAutoPlayPrevStatusRef.current = status;

    if (wasStreaming && status === "ready" && voiceModeRef.current) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.role === "assistant") {
        const text = getMessageText(lastMessage.parts);
        if (text) {
          const timer = setTimeout(() => void speakAndResumeListening(text), 0);
          return () => clearTimeout(timer);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, messages]);

  // Warn before leaving the tab if the conversation hasn't been ended/reviewed yet.
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (messages.length > 0) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [messages.length]);

  // Stop any active recording/TTS if the page unmounts while voice mode is on.
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      sessionRef.current?.cancel();
      bargeInRef.current?.cancel(); // release the barge-in mic on unmount
      bargeInRef.current = null;
      stopSpeaking();
    };
  }, []);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setVoiceError(null); // typed send is a fresh, unrelated action — drop any stale voice banner (M-a)
    setLastApproximate(false);
    sendMessage({ text });
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSpeak = async (text: string): Promise<void> => {
    if (voiceModeRef.current) {
      // Ignore read-aloud taps while TTS is already playing or a transcript
      // is in flight: replaying would churn sessionRef and overlap speak()
      // (M1). The user can re-tap once we return to Recording/Ready.
      if (isSpeakingRef.current || micStatus === "transcribing") return;
      // Voice mode: stop any live recording first so TTS is not captured,
      // then play through the speaking mutex and resume recording after.
      sessionRef.current?.cancel();
      sessionRef.current = null;
      setMicStatus("idle");
      await speakAndResumeListening(text);
    } else {
      // Text-mode read-aloud: stream sentences so playback starts sooner.
      await speakStream(text);
    }
  };

  // Text-mode mic: record → whisper transcribe → append to the input box
  // (editable, not auto-sent). Same faithful-transcription path as voice mode.
  const handleToggleVoiceInput = async (): Promise<void> => {
    if (micStatus === "recording") {
      const session = sessionRef.current;
      sessionRef.current = null;
      setMicStatus("transcribing");
      try {
        // Fresh action starting: clear stale banners from a prior attempt
        // before this attempt's real outcome is applied below (M-a). The
        // genuine approximate/error state for THIS attempt still lands via
        // setLastApproximate(approximate) / the catch block below.
        setVoiceError(null);
        setLastApproximate(false);
        const { text, approximate } = await (session
          ? session.stop()
          : Promise.resolve({ text: "", approximate: false }));
        setLastApproximate(approximate);
        const trimmed = text.trim();
        if (trimmed) setInput((prev) => (prev ? `${prev} ${trimmed}` : trimmed));
        else setVoiceError("Didn't catch that — please try again.");
      } catch {
        setVoiceError("Couldn't reach transcription — please try again.");
      } finally {
        // Guard against a mode-switch race: if the user started a voice-mode
        // recording (micStatus="recording") while this text-mode transcription
        // was still uploading, an unguarded reset would stomp that live session
        // to "idle", stranding a mic with no UI to stop it. Only reset if still
        // transcribing — mirrors stopAndSend's finally.
        setMicStatus((s) => (s === "transcribing" ? "idle" : s));
      }
      return;
    }
    if (micStatus !== "idle") return;
    setVoiceError(null);
    try {
      const session = await startRecording();
      // Discard if the component unmounted during the await (text mode has
      // no voice-mode/speaking state to re-check, unlike startMicSession).
      if (!mountedRef.current) {
        session.cancel();
        return;
      }
      sessionRef.current = session;
      setMicStatus("recording");
    } catch {
      sessionRef.current = null;
      setMicStatus("idle");
      setVoiceError("Microphone unavailable (permission denied or unsupported).");
    }
  };

  const handleEndAndReview = async () => {
    if (!canEnd || isEnding) return;

    const existing = await db.conversations.get(conversationId);
    if (existing?.review) {
      // Already reviewed — never overwrite it, just go to the existing review.
      router.push(`/conversation/${conversationId}/review`);
      return;
    }

    setIsEnding(true);

    if (voiceModeRef.current) {
      voiceModeRef.current = false;
      setVoiceMode(false);
      sessionRef.current?.cancel();
      sessionRef.current = null;
      setMicStatus("idle");
      stopSpeaking();
      isSpeakingRef.current = false;
    }

    const conversationMessages: ConversationMessage[] = messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && !isGreetingTrigger(m))
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: getMessageText(m.parts),
        timestamp: new Date(),
      }));

    const conversation: Conversation = {
      id: conversationId,
      scenario: type === "preset" ? title : (scenarioParam ?? title),
      scenarioType: type ?? "free",
      messages: conversationMessages,
      review: null,
      duration: Math.round((Date.now() - startTime) / 1000),
      // Preserve the original creation time instead of resetting it to "now".
      createdAt: existing?.createdAt ?? new Date(),
    };

    await db.conversations.put(conversation);
    await dbHelpers.incrementTodayStat("conversationCount");
    await dbHelpers.updateStreak();

    // Sum the real per-turn usage the server attached to each assistant
    // message via messageMetadata (see ChatMessageMetadata in
    // app/api/chat/route.ts), instead of estimating tokens from character
    // count. Falls back to a character-based estimate for turns whose
    // metadata never arrived (stream interrupted, or older messages restored
    // from IndexedDB before this field existed).
    let inputTokens = 0;
    let outputTokens = 0;
    let lastModel: string | undefined;
    let hasAnyMetadata = false;
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      if (m.metadata) {
        inputTokens += m.metadata.usage.inputTokens;
        outputTokens += m.metadata.usage.outputTokens;
        lastModel = m.metadata.model;
        hasAnyMetadata = true;
      }
    }

    if (!hasAnyMetadata) {
      // Rough estimate: ~4 chars per token for English text.
      let totalChars = 0;
      for (const m of messages) {
        if (m.role === "user" || m.role === "assistant") {
          totalChars += getMessageText(m.parts).length;
        }
      }
      const estimatedTokens = Math.ceil(totalChars / 4);
      inputTokens = Math.ceil(estimatedTokens * 0.6);
      outputTokens = Math.ceil(estimatedTokens * 0.4);
    }

    const model = lastModel ?? "deepseek-v4-flash";
    if (inputTokens > 0 || outputTokens > 0) {
      recordCost({
        model,
        inputTokens,
        outputTokens,
        module: "conversation",
      });
    }

    router.push(`/conversation/${conversationId}/review`);
  };

  return (
    <div className="flex h-dvh flex-col md:h-full">
      {/* Scenario header */}
      <div className="shrink-0 space-y-1 p-4 md:p-0 md:pb-4">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 mb-1"
          onClick={() => router.push("/conversation")}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">{title}</h1>
          {profile?.assessedLevel && (
            <Badge variant="secondary">{profile.assessedLevel}</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      {/* Message area (transcript). Hidden in voice mode unless the user asks
          to read along -- voice mode is a hands-free, listen-and-speak
          experience whose live state is shown by the status indicator below.
          Always visible in text mode. */}
      {(!voiceMode || showTranscript) && (
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto rounded-lg border bg-muted/20 p-4 pb-32 md:pb-4">
        {messages.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">
            Say hello to start the conversation.
          </p>
        )}
        {messages.map((message) => {
          const text = getMessageText(message.parts);
          if (!text || text === "[Start the conversation]") return null;
          const isUser = message.role === "user";
          return (
            <div
              key={message.id}
              className={`flex ${isUser ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`w-full max-w-[90%] sm:max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                  isUser
                    ? "bg-primary text-primary-foreground"
                    : "bg-card ring-1 ring-foreground/10"
                }`}
              >
                <p className="whitespace-pre-wrap">{text}</p>
                {!isUser && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="mt-1 -ml-1.5"
                    onClick={() => void handleSpeak(text)}
                    aria-label="Read message aloud"
                  >
                    <Volume2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        {/* Shown whenever the transcript is visible (text mode, or voice mode
            with "Show transcript" on). Suppressed only in the immersive voice
            view, where the status indicator below already says "AI is
            thinking…" and this bubble would be redundant. */}
        {isStreaming && (!voiceMode || showTranscript) && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-card px-3 py-2 text-sm text-muted-foreground ring-1 ring-foreground/10">
              Thinking...
            </div>
          </div>
        )}
        {error && (
          <p className="text-center text-sm text-destructive">
            Something went wrong: {error.message}
          </p>
        )}
        <div ref={bottomRef} />
      </div>
      )}

      {/* Immersive voice view (transcript hidden): nothing has flex-1 above,
          so this spacer fills the gap and lets the controls settle at the
          bottom instead of bunching under the header. */}
      {voiceMode && !showTranscript && <div className="min-h-0 flex-1" />}

      {/* Input area */}
      <div className="fixed bottom-0 left-0 right-0 z-10 shrink-0 space-y-2 border-t bg-background p-4 md:static md:z-auto md:border-t-0 md:bg-transparent md:p-0 md:pt-4">
        {voiceSupported && (
          <Button
            type="button"
            variant={voiceMode ? "default" : "outline"}
            className="w-full min-h-[44px]"
            onClick={toggleVoiceMode}
          >
            <Mic className="h-4 w-4" />
            Voice Mode: {voiceMode ? "ON" : "OFF"}
          </Button>
        )}

        {/* Shared across voice and text mode: startMicSession's permission/
            unsupported error drops back to text mode, and the text-mode mic
            (Task 2) surfaces its own errors here too, so this must render
            outside the ternary below to stay visible in both branches. A
            faithful send clears both via stopAndSend. */}
        {voiceError && <p className="text-xs text-destructive">{voiceError}</p>}
        {lastApproximate && (
          <p className="text-xs text-muted-foreground">
            Approximate transcription (couldn&apos;t reach the service).
          </p>
        )}

        {voiceMode ? (
          <div className="space-y-3">
            {/* Status indicator */}
            {micStatus === "recording" ? (
              <VoiceState
                state="recording"
                title="Listening…"
                subtitle="Tap Stop when you're done"
              />
            ) : micStatus === "transcribing" ? (
              <VoiceState state="transcribing" />
            ) : isStreaming ? (
              <VoiceState state="thinking" title="AI is thinking…" />
            ) : isSpeaking ? (
              <VoiceState
                state="playing"
                title="AI is speaking…"
                subtitle="Recording auto-resumes after this"
              />
            ) : (
              <div className="flex items-center gap-3 rounded-lg border bg-muted/20 px-4 py-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Mic className="h-5 w-5" />
                </div>
                <p className="text-sm font-medium">Ready</p>
              </div>
            )}

            {/* Recording controls */}
            {micStatus === "recording" && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  className="w-full min-h-[44px]"
                  onClick={() => void stopAndSend()}
                  disabled={micStatus !== "recording" || isStreaming}
                >
                  <Send className="h-4 w-4" />
                  Stop & Send
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full min-h-[44px]"
                  onClick={cancelMic}
                  disabled={micStatus !== "recording"}
                >
                  Cancel
                </Button>
              </div>
            )}
            {micStatus === "transcribing" && (
              <Button type="button" className="w-full min-h-[44px]" disabled>
                Transcribing…
              </Button>
            )}
            {/* Idle in voice mode means the automatic listen loop stopped --
                transcription failed, or TTS finished without resuming. This
                is the manual way back in, and the reason a failed transcript
                no longer needs to auto-restart the mic. */}
            {micStatus === "idle" && !isStreaming && !isSpeaking && (
              <Button
                type="button"
                className="w-full min-h-[44px]"
                onClick={() => {
                  // Manual restart: the user is asserting the problem may be
                  // fixed, so grant the automatic retry budget again.
                  transcribeRetriesRef.current = 0;
                  void startMicSession();
                }}
              >
                <Mic className="h-4 w-4" />
                Record
              </Button>
            )}

            {/* Read-along toggle: voice mode hides the transcript by default;
                this reveals/hides it without leaving hands-free mode. */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              aria-expanded={showTranscript}
              onClick={() => setShowTranscript((v) => !v)}
            >
              {showTranscript ? "Hide transcript" : "Show transcript"}
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            {voiceSupported && (
              <div className="flex flex-col items-center gap-1">
                <Button
                  type="button"
                  variant={micStatus === "recording" ? "default" : "outline"}
                  size="icon"
                  className={`min-h-[44px] min-w-[44px] ${micStatus === "recording" ? "animate-pulse bg-red-500 text-white hover:bg-red-500" : ""}`}
                  onClick={() => void handleToggleVoiceInput()}
                  aria-label={
                    micStatus === "recording"
                      ? "Stop recording"
                      : micStatus === "transcribing"
                        ? "Transcribing"
                        : "Voice input"
                  }
                >
                  <Mic className="h-4 w-4" />
                </Button>
                {(micStatus === "recording" || micStatus === "transcribing") && (
                  <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                    {micStatus === "transcribing" ? "Transcribing..." : "Recording..."}
                  </span>
                )}
              </div>
            )}
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message..."
              className="min-h-[44px] resize-none"
              disabled={isStreaming}
            />
            {isStreaming ? (
              <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => stop()}>
                <Square className="h-4 w-4" />
                Stop
              </Button>
            ) : (
              <Button type="button" className="min-h-[44px]" onClick={handleSend} disabled={!input.trim()}>
                <Send className="h-4 w-4" />
                Send
              </Button>
            )}
          </div>
        )}

        <Button
          variant="secondary"
          className="w-full min-h-[44px]"
          disabled={!canEnd || isEnding}
          onClick={handleEndAndReview}
        >
          {isEnding
            ? "Saving..."
            : canEnd
              ? "End & Review"
              : `End & Review (${exchangeCount}/${MIN_EXCHANGES_TO_END} exchanges)`}
        </Button>
      </div>
    </div>
  );
};

export default ConversationPage;
