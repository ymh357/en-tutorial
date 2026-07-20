"use client";

import { useEffect, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  MessageSquare,
  PenLine,
  Sparkles,
  TrendingDown,
  TrendingUp,
  XCircle,
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
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Progress,
  ProgressTrack,
  ProgressIndicator,
} from "@/components/ui/progress";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLiveQuery } from "dexie-react-hooks";
import { useProfile } from "@/hooks/use-db";
import { db } from "@/lib/db";
import { dbHelpers } from "@/lib/db-helpers";
import { recordCost } from "@/lib/cost-tracker";
import { formatDate, parseDate } from "@/lib/date";
import { getKnownWordsForLevel, type CefrLevel } from "@/lib/frequency-list";
import {
  assessmentReadingGenSchema,
  assessmentClozeGenSchema,
  assessmentWritingScoreSchema,
  assessmentConversationScoreSchema,
  toJsonSchema,
} from "@/lib/ai-schemas";
import type { AssessmentResult } from "@/lib/types";

type Phase =
  | "intro"
  | "reading"
  | "cloze"
  | "writing"
  | "conversation"
  | "results";

interface ReadingQuestion {
  question: string;
  options: string[];
  correctIndex: number;
}

interface ReadingData {
  passage: string;
  questions: ReadingQuestion[];
}

interface ClozeBlank {
  index: number;
  answer: string;
  acceptAlso: string[];
}

interface ClozeData {
  passage: string;
  blanks: ClozeBlank[];
}

interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

// Re-exported for app/history/page.tsx, which still imports this type from
// this module path; the canonical definition now lives in lib/types.ts.
export type { AssessmentResult };

const ASSESSMENT_PROGRESS_KEY = "en-tutor-assessment-progress";

const WRITING_PROMPTS = [
  "Describe a memorable trip you have taken and explain what made it special.",
  "Discuss the advantages and disadvantages of working from home.",
  "Describe a skill you would like to learn and why it interests you.",
  "Explain how technology has changed the way people communicate.",
  "Describe a person who has influenced your life and explain how.",
];

const CONVERSATION_TOPICS = [
  "your favorite way to spend a weekend",
  "a book or movie that made an impression on you",
  "how you think cities will change in the next 20 years",
  "the role of food in your culture",
  "a challenge you overcame recently",
];

const TOTAL_CONVERSATION_TURNS = 5;

// Free-text path — used only by sendConversationTurn's mid-conversation reply
// generation, which is a natural-language chat turn, not a JSON shape.
// Reading/cloze/writing-score/conversation-score all use the structured
// object path inlined per call site below.
const callReview = async (
  prompt: string,
  system: string
): Promise<string> => {
  const res = await fetch("/api/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, system }),
  });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  const data = (await res.json()) as {
    content?: string;
    error?: string;
    usage?: { promptTokens: number; completionTokens: number };
    model?: string;
  };
  if (data.error || !data.content) {
    throw new Error(data.error || "No content returned");
  }
  if (data.usage && data.model) {
    recordCost({
      model: data.model,
      inputTokens: data.usage.promptTokens ?? 0,
      outputTokens: data.usage.completionTokens ?? 0,
      module: "assessment",
    });
  }
  return data.content;
};

interface WritingScoreData {
  score: number;
  feedback: string;
}

interface ConversationScoreData {
  fluency: number;
  accuracy: number;
  vocabulary: number;
  feedback: string;
}

const normalizeAnswer = (value: string): string =>
  value.trim().toLowerCase().replace(/[.,!?;:'"]/g, "");

const scoreClozeBlank = (userAnswer: string, blank: ClozeBlank): boolean => {
  const normalizedUser = normalizeAnswer(userAnswer);
  if (!normalizedUser) return false;
  const candidates = [blank.answer, ...blank.acceptAlso].map(normalizeAnswer);
  return candidates.includes(normalizedUser);
};

// Single source of truth for score -> level mapping. Each entry's fine
// `band` is the display label (levelBandForScore); its coarse `cefr` is
// the level used to drive study-difficulty suggestions (cefrFromScore).
// Ascending by minScore; a score matches the last entry it meets or beats.
const CEFR_BANDS: { minScore: number; band: string; cefr: string }[] = [
  { minScore: 0, band: "A2 (Lower)", cefr: "A2" },
  { minScore: 30, band: "A2 (Upper)", cefr: "A2" },
  { minScore: 45, band: "B1 (Lower)", cefr: "B1" },
  { minScore: 55, band: "B1 (Upper)", cefr: "B1" },
  { minScore: 65, band: "B2 (Lower)", cefr: "B2" },
  { minScore: 75, band: "B2 (Upper)", cefr: "B2" },
  { minScore: 85, band: "C1 (Lower)", cefr: "C1" },
  { minScore: 95, band: "C1 (Upper)", cefr: "C1" },
];

const bandForScore = (score: number): (typeof CEFR_BANDS)[number] => {
  let match = CEFR_BANDS[0];
  for (const entry of CEFR_BANDS) {
    if (score >= entry.minScore) match = entry;
    else break;
  }
  return match;
};

const levelBandForScore = (score: number): string => bandForScore(score).band;
const cefrFromScore = (score: number): string => bandForScore(score).cefr;

interface AssessmentProgress {
  phase: Phase;
  readingData: ReadingData | null;
  readingAnswers: Record<number, number>;
  readingScore: number;
  clozeData: ClozeData | null;
  clozeAnswers: Record<number, string>;
  clozeScore: number;
  writingPrompt: string;
  writingContent: string;
  writingScore: number;
  writingFeedback: string;
  conversationTopic: string;
  conversationHistory: ConversationTurn[];
  conversationScore: number;
  conversationFeedback: string;
}

// Stored snapshot also carries a savedAt timestamp so a stale snapshot (e.g.
// abandoned days ago) can be discarded on restore instead of resuming forever.
const ASSESSMENT_PROGRESS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type StoredAssessmentProgress = AssessmentProgress & { savedAt: number };

const saveAssessmentProgress = (progress: AssessmentProgress): void => {
  if (typeof window === "undefined") return;
  const stored: StoredAssessmentProgress = { ...progress, savedAt: Date.now() };
  window.localStorage.setItem(ASSESSMENT_PROGRESS_KEY, JSON.stringify(stored));
};

const loadAssessmentProgress = (): AssessmentProgress | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ASSESSMENT_PROGRESS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAssessmentProgress;
    if (Date.now() - parsed.savedAt > ASSESSMENT_PROGRESS_MAX_AGE_MS) {
      window.localStorage.removeItem(ASSESSMENT_PROGRESS_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const clearAssessmentProgress = (): void => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ASSESSMENT_PROGRESS_KEY);
};

// Simple SVG radar chart for the 4 ability dimensions — no external chart lib.
const RadarChart = ({
  scores,
}: {
  scores: { label: string; value: number }[];
}) => {
  const cx = 200;
  const cy = 180;
  const r = 100;
  const n = scores.length;

  const pointFor = (value: number, i: number) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const dist = (value / 100) * r;
    return { x: cx + dist * Math.cos(angle), y: cy + dist * Math.sin(angle) };
  };

  const points = scores.map((s, i) => pointFor(s.value, i));
  const bgPoints = scores.map((_, i) => pointFor(100, i));
  const polygonPoints = points.map((p) => `${p.x},${p.y}`).join(" ");
  const bgPolygonPoints = bgPoints.map((p) => `${p.x},${p.y}`).join(" ");

  const rings = [0.25, 0.5, 0.75, 1];

  return (
    <svg viewBox="0 0 400 380" className="mx-auto w-full max-w-sm" style={{ aspectRatio: "400/380" }}>
      {rings.map((ring) => {
        const ringPoints = scores
          .map((_, i) => pointFor(100 * ring, i))
          .map((p) => `${p.x},${p.y}`)
          .join(" ");
        return (
          <polygon
            key={ring}
            points={ringPoints}
            className="fill-none stroke-border"
            strokeWidth={1}
          />
        );
      })}
      {/* Axis lines */}
      {bgPoints.map((p, i) => (
        <line
          key={i}
          x1={cx}
          y1={cy}
          x2={p.x}
          y2={p.y}
          className="stroke-border"
          strokeWidth={1}
        />
      ))}
      {/* Background (max) polygon, subtle */}
      <polygon points={bgPolygonPoints} className="fill-none" />
      {/* Score polygon */}
      <polygon
        points={polygonPoints}
        className="fill-primary/20 stroke-primary"
        strokeWidth={2}
      />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} className="fill-primary" />
      ))}
      {/* Labels */}
      {scores.map((s, i) => {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        const labelDist = r + 30;
        const lx = cx + labelDist * Math.cos(angle);
        const ly = cy + labelDist * Math.sin(angle);
        const anchor =
          Math.cos(angle) > 0.3
            ? "start"
            : Math.cos(angle) < -0.3
              ? "end"
              : "middle";
        const dy = Math.sin(angle) > 0.3 ? 14 : Math.sin(angle) < -0.3 ? -4 : 5;
        return (
          <text
            key={s.label}
            x={lx}
            y={ly + dy}
            textAnchor={anchor}
            className="fill-foreground text-xs font-medium"
          >
            {s.label} ({s.value})
          </text>
        );
      })}
    </svg>
  );
};

const SECTION_LABELS = ["Reading", "Cloze", "Writing", "Conversation"] as const;

const PhaseProgress = ({ currentIndex }: { currentIndex: number }) => (
  <div className="flex items-center gap-2 flex-wrap">
    {SECTION_LABELS.map((label, idx) => (
      <Badge
        key={label}
        variant={idx === currentIndex ? "default" : idx < currentIndex ? "secondary" : "outline"}
        className="text-xs"
      >
        {idx < currentIndex && <CheckCircle2 className="h-3 w-3 mr-1" />}
        {label}
      </Badge>
    ))}
  </div>
);

// Restorable phases only — a fresh "intro" or a completed "results" never
// need to resume from a saved snapshot.
const RESTORABLE_PHASES = new Set<Phase>(["reading", "cloze", "writing", "conversation"]);

const initialAssessmentProgress = (): AssessmentProgress | null => {
  const saved = loadAssessmentProgress();
  if (!saved || !RESTORABLE_PHASES.has(saved.phase)) return null;
  return saved;
};

const AssessmentPage = () => {
  const profile = useProfile();
  const cefrLevel = profile?.studyLevel || "B1";

  const [restoredProgress] = useState<AssessmentProgress | null>(
    initialAssessmentProgress
  );

  const [phase, setPhase] = useState<Phase>(() => restoredProgress?.phase ?? "intro");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Reading section state
  const [readingData, setReadingData] = useState<ReadingData | null>(
    () => restoredProgress?.readingData ?? null
  );
  const [readingAnswers, setReadingAnswers] = useState<Record<number, number>>(
    () => restoredProgress?.readingAnswers ?? {}
  );
  const [readingScore, setReadingScore] = useState<number>(
    () => restoredProgress?.readingScore ?? 0
  );

  // Cloze section state
  const [clozeData, setClozeData] = useState<ClozeData | null>(
    () => restoredProgress?.clozeData ?? null
  );
  const [clozeAnswers, setClozeAnswers] = useState<Record<number, string>>(
    () => restoredProgress?.clozeAnswers ?? {}
  );
  const [clozeScore, setClozeScore] = useState<number>(
    () => restoredProgress?.clozeScore ?? 0
  );

  // Writing section state
  const [writingPrompt] = useState<string>(
    () =>
      restoredProgress?.writingPrompt ??
      WRITING_PROMPTS[Math.floor(Math.random() * WRITING_PROMPTS.length)]
  );
  const [writingContent, setWritingContent] = useState(
    () => restoredProgress?.writingContent ?? ""
  );
  const [writingScore, setWritingScore] = useState<number>(
    () => restoredProgress?.writingScore ?? 0
  );
  const [writingFeedback, setWritingFeedback] = useState<string>(
    () => restoredProgress?.writingFeedback ?? ""
  );

  // Conversation section state
  const [conversationTopic] = useState<string>(
    () =>
      restoredProgress?.conversationTopic ??
      CONVERSATION_TOPICS[
        Math.floor(Math.random() * CONVERSATION_TOPICS.length)
      ]
  );
  const [conversationHistory, setConversationHistory] = useState<
    ConversationTurn[]
  >(() => restoredProgress?.conversationHistory ?? []);
  const [conversationInput, setConversationInput] = useState("");
  const [conversationScore, setConversationScore] = useState<number>(
    () => restoredProgress?.conversationScore ?? 0
  );
  const [conversationFeedback, setConversationFeedback] = useState<string>(
    () => restoredProgress?.conversationFeedback ?? ""
  );

  const previousAssessments = useLiveQuery(() => dbHelpers.getAssessments(), []) ?? [];
  const [finalResult, setFinalResult] = useState<Omit<
    AssessmentResult,
    "id"
  > | null>(null);
  const [pendingLevel, setPendingLevel] = useState<string | null>(null);

  // dbHelpers.getAssessments() sorts newest-first, so the most recent prior
  // assessment is the first entry (not the last, unlike the old append-only
  // localStorage array).
  const previousResult = previousAssessments[0] ?? null;

  // Snapshot of the assessment that was most recent BEFORE this run's result
  // was saved. previousAssessments is a reactive live query, so once
  // finishAssessment saves the new result, previousAssessments[0] becomes
  // that just-saved row — priorResult is captured ahead of the save so the
  // results screen can still compare against the true prior assessment.
  const [priorResult, setPriorResult] = useState<AssessmentResult | null>(null);

  // Persist progress to localStorage whenever the phase advances, so closing
  // the tab (not just refreshing) doesn't lose the student's work. Includes
  // writingPrompt/conversationTopic so a restored session shows the same
  // prompt/topic the restored answers were written for, instead of re-rolling
  // a new random one.
  useEffect(() => {
    if (phase === "intro" || phase === "results") return;
    saveAssessmentProgress({
      phase,
      readingData,
      readingAnswers,
      readingScore,
      clozeData,
      clozeAnswers,
      clozeScore,
      writingPrompt,
      writingContent,
      writingScore,
      writingFeedback,
      conversationTopic,
      conversationHistory,
      conversationScore,
      conversationFeedback,
    });
  }, [
    phase,
    readingData,
    readingAnswers,
    readingScore,
    clozeData,
    clozeAnswers,
    clozeScore,
    writingPrompt,
    writingContent,
    writingScore,
    writingFeedback,
    conversationTopic,
    conversationHistory,
    conversationScore,
    conversationFeedback,
  ]);

  // --- Section 1: Reading ---
  const startReading = async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const system = `You are an English assessment designer. Generate a reading passage (~200 words) at CEFR level ${cefrLevel}, followed by exactly 5 multiple-choice comprehension questions, each with 4 options and one correct answer.

Return ONLY valid JSON (no markdown fences, no explanation) in this exact format:
{
  "passage": "...",
  "questions": [
    { "question": "...", "options": ["...", "...", "...", "..."], "correctIndex": 0 }
  ]
}`;
      const prompt = `Generate a reading comprehension test at ${cefrLevel} level.`;
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          system,
          schema: toJsonSchema(assessmentReadingGenSchema),
        }),
      });
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }
      const data = (await res.json()) as {
        object?: ReadingData;
        error?: string;
        usage?: { inputTokens: number; outputTokens: number };
        model?: string;
      };
      if (data.error || !data.object) {
        throw new Error(data.error || "Could not parse the reading passage. Please try again.");
      }
      if (data.usage && data.model) {
        recordCost({
          model: data.model,
          inputTokens: data.usage.inputTokens ?? 0,
          outputTokens: data.usage.outputTokens ?? 0,
          module: "assessment",
        });
      }
      setReadingData(data.object);
      setReadingAnswers({});
      setPhase("reading");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate reading section");
    } finally {
      setIsLoading(false);
    }
  };

  const submitReading = (): void => {
    if (!readingData) return;
    const correct = readingData.questions.filter(
      (q, idx) => readingAnswers[idx] === q.correctIndex
    ).length;
    const score = Math.round((correct / readingData.questions.length) * 100);
    setReadingScore(score);
    void startCloze();
  };

  // --- Section 2: Cloze ---
  const startCloze = async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const system = `You are an English assessment designer. Generate a cloze (fill-in-the-blank) passage at CEFR level ${cefrLevel}, roughly 120-180 words, with exactly 8 blanks marked as ___(1)___, ___(2)___, etc. For each blank, provide the expected answer and a list of acceptable synonyms/variations.

Return ONLY valid JSON (no markdown fences, no explanation) in this exact format:
{
  "passage": "The ___(1)___ of remote work has ___(2)___ significantly...",
  "blanks": [
    { "index": 1, "answer": "concept", "acceptAlso": ["idea", "notion"] }
  ]
}`;
      const prompt = `Generate a cloze test at ${cefrLevel} level with exactly 8 blanks.`;
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          system,
          schema: toJsonSchema(assessmentClozeGenSchema),
        }),
      });
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }
      const data = (await res.json()) as {
        object?: {
          passage: string;
          blanks: Array<{ index: number; answer: string; acceptAlso?: string[] }>;
        };
        error?: string;
        usage?: { inputTokens: number; outputTokens: number };
        model?: string;
      };
      if (data.error || !data.object) {
        throw new Error(data.error || "Could not parse the cloze passage. Please try again.");
      }
      if (data.usage && data.model) {
        recordCost({
          model: data.model,
          inputTokens: data.usage.inputTokens ?? 0,
          outputTokens: data.usage.outputTokens ?? 0,
          module: "assessment",
        });
      }
      // acceptAlso is optional in the schema — normalize to [] so ClozeBlank's
      // required array field always has a value (mirrors the old
      // parseClozeData behavior). [B2-4]
      setClozeData({
        ...data.object,
        blanks: data.object.blanks.map((b) => ({
          ...b,
          acceptAlso: b.acceptAlso ?? [],
        })),
      });
      setClozeAnswers({});
      setPhase("cloze");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate cloze section");
    } finally {
      setIsLoading(false);
    }
  };

  const submitCloze = (): void => {
    if (!clozeData) return;
    const correct = clozeData.blanks.filter((blank) =>
      scoreClozeBlank(clozeAnswers[blank.index] ?? "", blank)
    ).length;
    const score = Math.round((correct / clozeData.blanks.length) * 100);
    setClozeScore(score);
    setPhase("writing");
  };

  // --- Section 3: Writing ---
  const submitWriting = async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const system = `You are an expert English writing assessor. Score the student's writing on a scale of 1-10 based on grammar, vocabulary, coherence, and task completion. Provide brief, constructive feedback (2-3 sentences).

Return ONLY valid JSON (no markdown fences, no explanation) in this exact format:
{
  "score": <1-10>,
  "feedback": "<brief feedback>"
}`;
      const prompt = `Task: ${writingPrompt}\n\nStudent's writing:\n${writingContent}\n\nScore this writing.`;
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          system,
          schema: toJsonSchema(assessmentWritingScoreSchema),
        }),
      });
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }
      const data = (await res.json()) as {
        object?: WritingScoreData;
        error?: string;
        usage?: { inputTokens: number; outputTokens: number };
        model?: string;
      };
      if (data.error || !data.object) {
        throw new Error(data.error || "Could not parse the writing score. Please try again.");
      }
      if (data.usage && data.model) {
        recordCost({
          model: data.model,
          inputTokens: data.usage.inputTokens ?? 0,
          outputTokens: data.usage.outputTokens ?? 0,
          module: "assessment",
        });
      }
      setWritingScore(Math.round(data.object.score * 10));
      setWritingFeedback(data.object.feedback);
      setPhase("conversation");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to score writing");
    } finally {
      setIsLoading(false);
    }
  };

  // --- Section 4: Conversation ---
  const sendConversationTurn = async (): Promise<void> => {
    if (!conversationInput.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      const updatedHistory: ConversationTurn[] = [
        ...conversationHistory,
        { role: "user", content: conversationInput.trim() },
      ];
      setConversationInput("");

      if (updatedHistory.length >= TOTAL_CONVERSATION_TURNS) {
        setConversationHistory(updatedHistory);
        await scoreConversation(updatedHistory);
        return;
      }

      const transcript = updatedHistory
        .map((t) => `${t.role === "user" ? "Student" : "Assistant"}: ${t.content}`)
        .join("\n");
      const system = `You are a friendly English conversation partner having a short chat with a student about ${conversationTopic}. Keep replies natural and conversational, no more than 2-3 sentences. Do not correct grammar mid-conversation.`;
      const prompt = `Conversation so far:\n${transcript}\n\nRespond naturally as the assistant, continuing the conversation.`;
      const reply = await callReview(prompt, system);
      const nextHistory: ConversationTurn[] = [
        ...updatedHistory,
        { role: "assistant", content: reply.trim() },
      ];
      setConversationHistory(nextHistory);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to continue conversation");
    } finally {
      setIsLoading(false);
    }
  };

  const scoreConversation = async (
    history: ConversationTurn[]
  ): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const transcript = history
        .map((t) => `${t.role === "user" ? "Student" : "Assistant"}: ${t.content}`)
        .join("\n");
      const system = `You are an expert English speaking assessor. Evaluate the student's turns in this conversation for fluency, accuracy, and vocabulary use, each on a scale of 1-10. Provide brief, constructive feedback (2-3 sentences).

Return ONLY valid JSON (no markdown fences, no explanation) in this exact format:
{
  "fluency": <1-10>,
  "accuracy": <1-10>,
  "vocabulary": <1-10>,
  "feedback": "<brief feedback>"
}`;
      const prompt = `Conversation transcript:\n${transcript}\n\nEvaluate only the Student's turns.`;
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          system,
          schema: toJsonSchema(assessmentConversationScoreSchema),
        }),
      });
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }
      const data = (await res.json()) as {
        object?: ConversationScoreData;
        error?: string;
        usage?: { inputTokens: number; outputTokens: number };
        model?: string;
      };
      if (data.error || !data.object) {
        throw new Error(data.error || "Could not parse the conversation score. Please try again.");
      }
      if (data.usage && data.model) {
        recordCost({
          model: data.model,
          inputTokens: data.usage.inputTokens ?? 0,
          outputTokens: data.usage.outputTokens ?? 0,
          module: "assessment",
        });
      }
      const avg =
        (data.object.fluency + data.object.accuracy + data.object.vocabulary) / 3;
      const score = Math.round(avg * 10);
      setConversationScore(score);
      setConversationFeedback(data.object.feedback);
      await finishAssessment(score);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to score conversation");
    } finally {
      setIsLoading(false);
    }
  };

  const finishAssessment = async (finalConversationScore: number): Promise<void> => {
    const composite = Math.round(
      (readingScore + clozeScore + writingScore + finalConversationScore) / 4
    );
    const result = {
      date: formatDate(new Date()),
      readingScore,
      clozeScore,
      writingScore,
      conversationScore: finalConversationScore,
      overallScore: composite,
      levelBand: levelBandForScore(composite),
    };
    // Capture the prior assessment BEFORE saving — previousAssessments is a
    // live query and would otherwise reflect the row we're about to insert.
    setPriorResult(previousAssessments[0] ?? null);
    await dbHelpers.saveAssessment(result);
    setFinalResult(result);

    // assessedLevel is display-only and always kept current. studyLevel
    // drives content generation, so only change it with the user's
    // confirmation when it would actually differ from today's setting.
    const newLevel = cefrFromScore(composite);
    const currentProfile = await dbHelpers.getProfile();
    await db.learningProfile.update("singleton", { assessedLevel: newLevel });
    if (newLevel !== currentProfile.studyLevel) {
      setPendingLevel(newLevel);
    }

    await dbHelpers.updateStreak();
    clearAssessmentProgress();
    setPhase("results");
  };

  const confirmStudyLevelUpdate = async (): Promise<void> => {
    if (!pendingLevel) return;
    await db.learningProfile.update("singleton", {
      studyLevel: pendingLevel,
      knownWordsBase: getKnownWordsForLevel(pendingLevel as CefrLevel),
    });
    setPendingLevel(null);
  };

  const writingWordCount = writingContent.trim().split(/\s+/).filter(Boolean).length;

  const phaseIndex =
    phase === "reading"
      ? 0
      : phase === "cloze"
        ? 1
        : phase === "writing"
          ? 2
          : phase === "conversation"
            ? 3
            : 0;

  // --- Render: Intro ---
  if (phase === "intro") {
    return (
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold mb-2">Monthly Assessment</h1>
          <p className="text-muted-foreground">
            A comprehensive check-up of your English level across reading, writing, and speaking.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5" />
              What this covers
            </CardTitle>
            <CardDescription>Estimated time: 15-20 minutes</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-3">
              <BookOpen className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Reading Comprehension</p>
                <p className="text-xs text-muted-foreground">
                  Read a short passage and answer 5 multiple-choice questions.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Sparkles className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Cloze Test</p>
                <p className="text-xs text-muted-foreground">
                  Fill in 8 missing words in a passage.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <PenLine className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Writing Task</p>
                <p className="text-xs text-muted-foreground">
                  Write about 100 words in response to a prompt.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <MessageSquare className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Short Conversation</p>
                <p className="text-xs text-muted-foreground">
                  Have a 5-turn conversation with the AI on a random topic.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {previousResult && (
          <Alert>
            <AlertDescription className="text-sm">
              Your last assessment ({parseDate(previousResult.date).toLocaleDateString()}) scored{" "}
              {previousResult.overallScore}/100 — {previousResult.levelBand}.
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button size="lg" className="w-full" onClick={startReading} disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Preparing your assessment...
            </>
          ) : (
            "Start Assessment"
          )}
        </Button>
      </div>
    );
  }

  // --- Render: Reading ---
  if (phase === "reading") {
    return (
      <div className="max-w-2xl space-y-6">
        <PhaseProgress currentIndex={phaseIndex} />
        <div>
          <h1 className="text-xl font-bold mb-1">Reading Comprehension</h1>
          <p className="text-sm text-muted-foreground">
            Read the passage, then answer the questions below.
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {readingData && (
          <>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {readingData.passage}
                </p>
              </CardContent>
            </Card>

            <div className="space-y-4">
              {readingData.questions.map((q, qIdx) => (
                <Card key={qIdx}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      {qIdx + 1}. {q.question}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {q.options.map((option, optIdx) => (
                      <button
                        key={optIdx}
                        type="button"
                        onClick={() =>
                          setReadingAnswers((prev) => ({ ...prev, [qIdx]: optIdx }))
                        }
                        className={`w-full min-h-[44px] text-left text-sm rounded-md border px-3 py-2 transition-colors ${
                          readingAnswers[qIdx] === optIdx
                            ? "border-primary bg-primary/10"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        {option}
                      </button>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>

            <Button
              size="lg"
              className="w-full"
              disabled={
                Object.keys(readingAnswers).length < readingData.questions.length ||
                isLoading
              }
              onClick={submitReading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Preparing next section...
                </>
              ) : (
                "Next Section"
              )}
            </Button>
          </>
        )}
      </div>
    );
  }

  // --- Render: Cloze ---
  if (phase === "cloze") {
    return (
      <div className="max-w-2xl space-y-6">
        <PhaseProgress currentIndex={phaseIndex} />
        <div>
          <h1 className="text-xl font-bold mb-1">Cloze Test</h1>
          <p className="text-sm text-muted-foreground">
            Fill in each blank with the word that best completes the passage.
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {clozeData && (
          <>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {clozeData.passage.replace(/___\(\d+\)___/g, (match) => match)}
                </p>
              </CardContent>
            </Card>

            <div className="space-y-3">
              {clozeData.blanks.map((blank) => (
                <div key={blank.index} className="flex items-center gap-3">
                  <span className="text-sm font-medium w-6 shrink-0">
                    {blank.index}.
                  </span>
                  <Input
                    placeholder={`Answer for blank ${blank.index}`}
                    value={clozeAnswers[blank.index] ?? ""}
                    onChange={(e) =>
                      setClozeAnswers((prev) => ({
                        ...prev,
                        [blank.index]: e.target.value,
                      }))
                    }
                    className="min-h-[44px]"
                  />
                </div>
              ))}
            </div>

            <Button
              size="lg"
              className="w-full"
              disabled={
                clozeData.blanks.some((b) => !(clozeAnswers[b.index] ?? "").trim())
              }
              onClick={submitCloze}
            >
              Next Section
            </Button>
          </>
        )}
      </div>
    );
  }

  // --- Render: Writing ---
  if (phase === "writing") {
    return (
      <div className="max-w-2xl space-y-6">
        <PhaseProgress currentIndex={phaseIndex} />
        <div>
          <h1 className="text-xl font-bold mb-1">Writing Task</h1>
          <p className="text-sm text-muted-foreground">
            Write about 100 words in response to the prompt below.
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardContent className="pt-6">
            <p className="text-sm font-medium">{writingPrompt}</p>
          </CardContent>
        </Card>

        <Textarea
          placeholder="Write your response here..."
          value={writingContent}
          onChange={(e) => setWritingContent(e.target.value)}
          className="min-h-[200px]"
        />
        <p className="text-xs text-muted-foreground text-right">
          {writingWordCount} words
        </p>

        <Button
          size="lg"
          className="w-full"
          disabled={writingWordCount < 30 || isLoading}
          onClick={submitWriting}
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Scoring your writing...
            </>
          ) : (
            "Submit Writing"
          )}
        </Button>
      </div>
    );
  }

  // --- Render: Conversation ---
  if (phase === "conversation") {
    const userTurnsCount = conversationHistory.filter((t) => t.role === "user").length;
    return (
      <div className="max-w-2xl space-y-6">
        <PhaseProgress currentIndex={phaseIndex} />
        <div>
          <h1 className="text-xl font-bold mb-1">Short Conversation</h1>
          <p className="text-sm text-muted-foreground">
            Chat naturally about {conversationTopic}. ({userTurnsCount}/
            {TOTAL_CONVERSATION_TURNS} turns)
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-3">
          {conversationHistory.length === 0 && (
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">
                  Start the conversation with your first message about{" "}
                  {conversationTopic}.
                </p>
              </CardContent>
            </Card>
          )}
          {conversationHistory.map((turn, idx) => (
            <div
              key={idx}
              className={`flex ${turn.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                  turn.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                }`}
              >
                {turn.content}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <Textarea
            placeholder="Type your reply..."
            value={conversationInput}
            onChange={(e) => setConversationInput(e.target.value)}
            className="min-h-[60px] resize-none"
            disabled={isLoading}
          />
          <Button
            onClick={sendConversationTurn}
            disabled={!conversationInput.trim() || isLoading}
            className="w-full sm:w-auto sm:shrink-0 min-h-[44px]"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : userTurnsCount === TOTAL_CONVERSATION_TURNS - 1 ? (
              "Finish"
            ) : (
              "Send"
            )}
          </Button>
        </div>
      </div>
    );
  }

  // --- Render: Results ---
  if (phase === "results" && finalResult) {
    const sectionScores: Array<{
      label: string;
      score: number;
      icon: typeof BookOpen;
    }> = [
      { label: "Reading Comprehension", score: finalResult.readingScore, icon: BookOpen },
      { label: "Cloze Test", score: finalResult.clozeScore, icon: Sparkles },
      { label: "Writing Task", score: finalResult.writingScore, icon: PenLine },
      {
        label: "Conversation",
        score: finalResult.conversationScore,
        icon: MessageSquare,
      },
    ];

    const weakestSection = [...sectionScores].sort((a, b) => a.score - b.score)[0];

    const scoreDelta = priorResult
      ? finalResult.overallScore - priorResult.overallScore
      : null;

    const abilityScores = [
      { label: "Reading", value: finalResult.readingScore },
      { label: "Cloze", value: finalResult.clozeScore },
      { label: "Writing", value: finalResult.writingScore },
      { label: "Speaking", value: finalResult.conversationScore },
    ];

    // Per-dimension comparison vs. the previous assessment, if one exists.
    const dimensionComparisons = priorResult
      ? [
          { label: "Reading", prev: priorResult.readingScore, curr: finalResult.readingScore },
          { label: "Cloze", prev: priorResult.clozeScore, curr: finalResult.clozeScore },
          { label: "Writing", prev: priorResult.writingScore, curr: finalResult.writingScore },
          { label: "Speaking", prev: priorResult.conversationScore, curr: finalResult.conversationScore },
        ]
      : null;

    return (
      <div className="max-w-2xl space-y-6">
        <Dialog
          open={pendingLevel !== null}
          onOpenChange={(open) => {
            if (!open) setPendingLevel(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Update study difficulty?</DialogTitle>
              <DialogDescription>
                This assessment puts you at {pendingLevel}, different from your
                current study difficulty ({profile?.studyLevel || "not set"}).
                Update it so future content matches your new level?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                Keep current
              </DialogClose>
              <Button onClick={() => void confirmStudyLevelUpdate()}>
                Update to {pendingLevel}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div>
          <h1 className="text-2xl font-bold mb-2">Assessment Results</h1>
          <p className="text-muted-foreground">
            Here is your overall performance and recommended focus areas.
          </p>
        </div>

        <Card>
          <CardHeader className="items-center text-center">
            <CardDescription>Overall Score</CardDescription>
            <CardTitle className="text-4xl font-bold">
              {finalResult.overallScore}
              <span className="text-lg text-muted-foreground">/100</span>
            </CardTitle>
            <Badge variant="secondary" className="mt-1">
              {finalResult.levelBand}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {scoreDelta !== null && (
              <div className="flex items-center justify-center gap-1 text-sm">
                {scoreDelta >= 0 ? (
                  <TrendingUp className="h-4 w-4 text-green-600" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-red-600" />
                )}
                <span className={scoreDelta >= 0 ? "text-green-600" : "text-red-600"}>
                  {scoreDelta >= 0 ? "+" : ""}
                  {scoreDelta} vs last assessment
                </span>
              </div>
            )}
            <RadarChart scores={abilityScores} />
            <p className="text-xs text-muted-foreground text-center">
              This is an approximate estimate based on limited test items. For
              official CEFR certification, take a standardized test.
            </p>
          </CardContent>
        </Card>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Section Breakdown</h2>
          {sectionScores.map(({ label, score, icon: Icon }) => (
            <Card key={label}>
              <CardContent className="pt-6 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{label}</span>
                  </div>
                  <span className="text-sm font-semibold">{score}/100</span>
                </div>
                <Progress value={score}>
                  <ProgressTrack>
                    <ProgressIndicator />
                  </ProgressTrack>
                </Progress>
              </CardContent>
            </Card>
          ))}
        </div>

        {dimensionComparisons && (
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">Compared to Last Time</h2>
            <Card>
              <CardContent className="pt-6 space-y-2">
                {dimensionComparisons.map((d) => {
                  const delta = d.curr - d.prev;
                  return (
                    <div
                      key={d.label}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-muted-foreground">{d.label}</span>
                      <span className="font-medium">
                        {d.prev} &rarr; {d.curr}{" "}
                        <span
                          className={
                            delta > 0
                              ? "text-green-600"
                              : delta < 0
                                ? "text-red-600"
                                : "text-muted-foreground"
                          }
                        >
                          ({delta >= 0 ? "+" : ""}
                          {delta})
                        </span>
                      </span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        )}

        {writingFeedback && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Writing Feedback</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{writingFeedback}</p>
            </CardContent>
          </Card>
        )}

        {conversationFeedback && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Conversation Feedback</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{conversationFeedback}</p>
            </CardContent>
          </Card>
        )}

        <Alert>
          <XCircle className="h-4 w-4" />
          <AlertDescription>
            Your weakest area is <strong>{weakestSection.label}</strong>. Consider
            focusing more practice time there over the next month.
          </AlertDescription>
        </Alert>

        <Button size="lg" className="w-full" onClick={() => window.location.reload()}>
          Done
        </Button>
      </div>
    );
  }

  return null;
};

export default AssessmentPage;
