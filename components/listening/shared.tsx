// Shared building blocks for the listening module muti-tag page.
// Extracted from app/listening/page.tsx (W1-T1) so individual tab components can be
// split into their own files without reaching back into the page module.

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { recordCost } from "@/lib/cost-tracker";

export type Mode = "dictation" | "comprehension" | "shadowing" | "prediction";

// Strip a single ```json ... ``` fence, if present, from an LLM free-text reply.
export const stripFences = (raw: string): string => {
  let text = raw.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }
  return text;
};

// Persist a completed listening exercise to the local DB for the history page.
// `extra` carries the W1 methodology fields (stage reached, missed words,
// self-rated comprehension, replay count) when available — omitted by older
// call sites that only have accuracy.
export const saveListeningExercise = async (
  mode: Mode,
  prompt: string,
  userAnswer: string,
  accuracy: number,
  extra?: {
    stage?: string;
    missedWords?: string[];
    subjectiveComprehension?: number;
    listensCount?: number;
    materialId?: string;
  }
): Promise<void> => {
  await db.listeningExercises.add({
    id: crypto.randomUUID(),
    mode,
    prompt,
    userAnswer,
    accuracy,
    ...extra,
    createdAt: new Date(),
  });
};

// Free-text path — used only by dictation sentence generation and shadowing
// sentence generation, both of which return non-JSON-object shapes that don't
// fit the structured-output route. Everything else uses the structured object
// path inlined per call site.
export const callReview = async (prompt: string, system: string): Promise<string> => {
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
      module: "listening",
    });
  }
  return data.content;
};

// Shared post-exercise navigation shown once a result/completion state renders.
export const ExerciseCompletionActions = ({
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
