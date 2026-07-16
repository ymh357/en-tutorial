"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ArrowLeft, Mic, Send, Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { dbHelpers } from "@/lib/db-helpers";
import { useProfile } from "@/hooks/use-db";
import { getScenarioById } from "@/lib/scenarios";
import type { Conversation, ConversationMessage, ScenarioType } from "@/lib/types";

const MIN_EXCHANGES_TO_END = 3;

// Minimal ambient typing for the Web Speech API — not in lib.dom.d.ts.
interface SpeechRecognitionResultLike {
  results: { [index: number]: { [index: number]: { transcript: string } } };
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionResultLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

const getSpeechRecognition = (): (new () => SpeechRecognitionLike) | undefined => {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

const getMessageText = (parts: Array<{ type: string; text?: string }>): string =>
  parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");

const buildSystemPrompt = (params: {
  type: ScenarioType | null;
  scenarioParam: string | null;
  cefrLevel: string;
}): { system: string; title: string; description: string } => {
  const { type, scenarioParam, cefrLevel } = params;
  const levelLine = cefrLevel
    ? `The user's CEFR level is ${cefrLevel}. Adjust your vocabulary, sentence complexity, and pace to match this level.`
    : "Adjust your vocabulary and sentence complexity to a generally intermediate level.";

  const baseInstructions = [
    "Stay in character throughout the conversation.",
    levelLine,
    "Do not correct the user's grammar mid-conversation — just respond naturally, as a real person in this situation would. Corrections happen later in a separate review step.",
    "Keep responses conversational and not too long.",
  ].join(" ");

  if (type === "preset" && scenarioParam) {
    const scenario = getScenarioById(scenarioParam);
    if (scenario) {
      return {
        system: `${scenario.systemPromptContext} ${baseInstructions}`,
        title: scenario.name,
        description: scenario.description,
      };
    }
  }

  if (type === "custom" && scenarioParam) {
    return {
      system: `You are roleplaying the following scenario described by the user: "${scenarioParam}". Play an appropriate character for this scenario. ${baseInstructions}`,
      title: "Custom Scenario",
      description: scenarioParam,
    };
  }

  return {
    system: `You are a friendly English conversation partner having a free-form chat with the user about anything they'd like to discuss. ${baseInstructions}`,
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
        cefrLevel: profile?.initialCefrLevel ?? "",
      }),
    [type, scenarioParam, profile?.initialCefrLevel]
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { system },
      }),
    [system]
  );

  const { messages, sendMessage, status, stop, error } = useChat({
    id: conversationId,
    transport,
  });

  const [input, setInput] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [startTime] = useState<number>(() => Date.now());

  const isStreaming = status === "streaming" || status === "submitted";
  const voiceSupported =
    typeof window !== "undefined" &&
    ("webkitSpeechRecognition" in window || "SpeechRecognition" in window);

  const exchangeCount = messages.filter((m) => m.role === "user").length;
  const canEnd = exchangeCount >= MIN_EXCHANGES_TO_END && !isStreaming;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    window.speechSynthesis.speak(utterance);
  };

  const handleToggleVoiceInput = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
      return;
    }
    const SpeechRecognitionCtor = getSpeechRecognition();
    if (!SpeechRecognitionCtor) return;

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    recognition.onerror = () => setIsRecording(false);
    recognition.onend = () => setIsRecording(false);

    recognitionRef.current = recognition;
    setIsRecording(true);
    recognition.start();
  };

  const handleEndAndReview = async () => {
    if (!canEnd || isEnding) return;
    setIsEnding(true);

    const conversationMessages: ConversationMessage[] = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
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
      createdAt: new Date(),
    };

    await db.conversations.put(conversation);
    await dbHelpers.incrementTodayStat("conversationCount");
    await dbHelpers.updateStreak();

    router.push(`/conversation/${conversationId}/review`);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Scenario header */}
      <div className="shrink-0 space-y-1 pb-4">
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
          {profile?.initialCefrLevel && (
            <Badge variant="secondary">{profile.initialCefrLevel}</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      {/* Message area */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto rounded-lg border bg-muted/20 p-4">
        {messages.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">
            Say hello to start the conversation.
          </p>
        )}
        {messages.map((message) => {
          const text = getMessageText(message.parts);
          if (!text) return null;
          const isUser = message.role === "user";
          return (
            <div
              key={message.id}
              className={`flex ${isUser ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
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
      <div className="shrink-0 space-y-2 pt-4">
        <div className="flex gap-2">
          {voiceSupported && (
            <Button
              type="button"
              variant={isRecording ? "default" : "outline"}
              size="icon"
              onClick={handleToggleVoiceInput}
              aria-label="Voice input"
            >
              <Mic className="h-4 w-4" />
            </Button>
          )}
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message..."
            className="min-h-[40px] resize-none"
            disabled={isStreaming}
          />
          {isStreaming ? (
            <Button type="button" variant="outline" onClick={() => stop()}>
              <Square className="h-4 w-4" />
              Stop
            </Button>
          ) : (
            <Button type="button" onClick={handleSend} disabled={!input.trim()}>
              <Send className="h-4 w-4" />
              Send
            </Button>
          )}
        </div>
        <Button
          variant="secondary"
          className="w-full"
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
