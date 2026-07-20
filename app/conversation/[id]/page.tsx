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
import { speak, stopSpeaking } from "@/lib/tts";
import { startRecording, isRecordingSupported, type RecordingSession } from "@/lib/speech";

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

  type MicStatus = "idle" | "recording" | "transcribing";
  const [micStatus, setMicStatus] = useState<MicStatus>("idle");
  const sessionRef = useRef<RecordingSession | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [lastApproximate, setLastApproximate] = useState(false); // last transcript came from the SpeechRecognition fallback

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
    // Never open the mic while TTS is still playing (echo-loop guard).
    if (isSpeakingRef.current) return;
    // Do NOT clear voiceError here: stopAndSend sets a "try again" / "please
    // repeat" prompt immediately before calling startMicSession, and both run
    // in the same render frame — clearing here would coalesce that message to
    // null (React batching) and it would never show. Errors are cleared only
    // at intentional fresh-start points (toggleVoiceMode ON, faithful send).
    try {
      const session = await startRecording();
      sessionRef.current = session;
      setMicStatus("recording");
    } catch {
      sessionRef.current = null;
      setMicStatus("idle");
      setVoiceError(
        "Microphone unavailable (permission denied or unsupported). Voice mode off."
      );
      voiceModeRef.current = false;
      setVoiceMode(false);
    }
  };

  // Stop recording → faithful transcript → auto-send. On transcribe failure,
  // surface a repeat prompt and return to idle (user can record again).
  const stopAndSend = async (): Promise<void> => {
    const session = sessionRef.current;
    if (!session || micStatus !== "recording" || isStreaming) return;
    sessionRef.current = null;
    setMicStatus("transcribing");
    try {
      const { text, approximate } = await session.stop();
      setLastApproximate(approximate);
      const trimmed = text.trim();
      if (trimmed) {
        setVoiceError(null); // genuine send clears any stale "try again" prompt
        sendMessage({ text: trimmed });
        // AI reply auto-plays via the voice-autoplay effect, which then
        // resumes recording through speakAndResumeListening → startMicSession.
      } else {
        setVoiceError("Didn't catch that — try again.");
        await startMicSession();
      }
    } catch {
      setVoiceError("Couldn't reach transcription — please repeat that.");
      await startMicSession();
    } finally {
      setMicStatus((s) => (s === "transcribing" ? "idle" : s));
    }
  };

  // Discard current recording and immediately start a fresh one (stay in voice mode).
  const cancelMic = (): void => {
    sessionRef.current?.cancel();
    sessionRef.current = null;
    setMicStatus("idle");
    void startMicSession();
  };

  // Speaks the given text via TTS, then resumes listening for the user's
  // next utterance once playback finishes. The mic is guaranteed to be off
  // for the entire duration of playback, so TTS audio can never be picked
  // up as false user input.
  const speakAndResumeListening = async (text: string): Promise<void> => {
    isSpeakingRef.current = true;
    setIsSpeaking(true);
    await speak(text); // C1: resolves only after audio truly ends (awaitable fallback)
    isSpeakingRef.current = false;
    setIsSpeaking(false);
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
      stopSpeaking();
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
      sessionRef.current?.cancel();
      stopSpeaking();
    };
  }, []);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    sendMessage({ text });
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSpeak = (text: string) => {
    void speak(text);
  };

  // TASK 2 HANDOFF BRIDGE (temporary): this used to drive the local
  // SpeechRecognition instance via recognitionRef/isRecording, both removed
  // in this refactor (voice mode now goes through the whisper-based
  // startMicSession/stopAndSend/cancelMic session helpers instead). Task 2
  // is responsible for migrating the text-mode mic onto those same helpers
  // and restoring real function here. Until then this is an intentional
  // no-op — the mic button below is rendered `disabled` so it is
  // unreachable from the UI, keeping the file compiling without a dangling
  // reference to the removed SpeechRecognition state.
  const handleToggleVoiceInput = (): void => {
    // no-op — see comment above.
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
    // count. A turn whose metadata never arrived (stream interrupted, or an
    // older message restored from IndexedDB before this field existed)
    // contributes 0 rather than falling back to an estimate.
    let inputTokens = 0;
    let outputTokens = 0;
    let lastModel: string | undefined;
    for (const m of messages) {
      if (m.role !== "assistant" || !m.metadata) continue;
      inputTokens += m.metadata.usage.inputTokens;
      outputTokens += m.metadata.usage.outputTokens;
      lastModel = m.metadata.model;
    }

    if (lastModel && (inputTokens > 0 || outputTokens > 0)) {
      recordCost({
        model: lastModel,
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

      {/* Message area */}
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
                    onClick={() => handleSpeak(text)}
                    aria-label="Read message aloud"
                  >
                    <Volume2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        {isStreaming && (
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
        {voiceError && <p className="text-xs text-red-500">{voiceError}</p>}
        {lastApproximate && (
          <p className="text-xs text-amber-600">
            Approximate transcription (couldn&apos;t reach the service).
          </p>
        )}

        {voiceMode ? (
          <div className="space-y-3">
            {/* Status indicator */}
            <div className="flex items-center gap-3 rounded-lg border bg-muted/20 px-4 py-3">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  micStatus === "recording"
                    ? "animate-pulse bg-red-500 text-white"
                    : isSpeaking
                      ? "bg-green-500 text-white"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                <Mic className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {micStatus === "recording"
                    ? "Listening… tap Stop when done"
                    : micStatus === "transcribing"
                      ? "Transcribing…"
                      : isStreaming
                        ? "AI is thinking…"
                        : isSpeaking
                          ? "AI is speaking…"
                          : "Ready"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isSpeaking && "Recording auto-resumes after this"}
                </p>
              </div>
            </div>

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
          </div>
        ) : (
          <div className="flex gap-2">
            {voiceSupported && (
              // TASK 2 HANDOFF: disabled until the text-mode mic is migrated
              // onto the whisper session helpers (see handleToggleVoiceInput).
              <div className="flex flex-col items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="min-h-[44px] min-w-[44px]"
                  onClick={handleToggleVoiceInput}
                  disabled
                  aria-label="Voice input"
                >
                  <Mic className="h-4 w-4" />
                </Button>
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
