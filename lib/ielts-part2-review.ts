import {
  part2ReviewSchema,
  part2FollowUpSchema,
  part2FollowUpFeedbackSchema,
  toJsonSchema,
} from "./ai-schemas";
import { recordCost } from "./cost-tracker";
import type { Part2Review } from "./types";

// IELTS 0-9 band -> app's 0-100 scale. band 9 => 100.
const bandTo100 = (band: number): number =>
  Math.round(Math.max(0, Math.min(100, (band / 9) * 100)));

// IELTS bands are reported in 0.5 steps; snap the model's overall estimate to
// the nearest half-band and clamp to the valid 0-9 range.
const roundToHalfBand = (band: number): number =>
  Math.max(0, Math.min(9, Math.round(band * 2) / 2));

const SCORING_SYSTEM_PROMPT = [
  "You are an experienced IELTS Speaking examiner scoring a Part 2 long-turn monologue.",
  "Score STRICTLY on the four official IELTS band descriptors, each 0-9 (0.5 steps allowed):",
  "Fluency & Coherence, Lexical Resource, Grammatical Range & Accuracy, Pronunciation.",
  "IMPORTANT: the transcript is what the candidate actually said, transcribed faithfully including any mistakes.",
  "Score it AS SPOKEN. Do NOT mentally correct errors before scoring; the errors are the signal.",
  "For Pronunciation you only have the transcript, not the audio — infer conservatively from spelling/phonetic hints and keep this score cautious.",
  "Also return an overall bandEstimate (0-9).",
  "errors: concrete grammar/word errors the candidate made, with the corrected form and a short explanation.",
  "improvements: phrasings that were understandable but could be more natural/advanced.",
  "highlights: things the candidate did well.",
  "newVocabulary: useful words/phrases worth learning (dictionary lemma form).",
  "Return empty arrays (never omit fields) when a category has nothing.",
].join(" ");

const postReview = async <T>(body: {
  prompt: string;
  system: string;
  schema: Record<string, unknown>;
  maxOutputTokens: number;
}): Promise<T> => {
  const res = await fetch("/api/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, disableThinking: true }),
  });
  if (!res.ok) throw new Error(`Review request failed (${res.status})`);
  const data = (await res.json()) as {
    object?: T;
    usage?: { inputTokens: number; outputTokens: number };
    model?: string;
  };
  if (!data.object) throw new Error("Empty response from review service");
  if (data.usage && data.model) {
    recordCost({
      model: data.model,
      inputTokens: data.usage.inputTokens ?? 0,
      outputTokens: data.usage.outputTokens ?? 0,
      module: "ielts-part2",
    });
  }
  return data.object;
};

export const scorePart2Monologue = async (
  topic: string,
  bullets: string[],
  transcript: string
): Promise<Part2Review> => {
  const prompt = [
    `Cue card topic: ${topic}`,
    `Points the candidate should cover: ${bullets.join("; ")}`,
    "",
    "Candidate's monologue (verbatim transcript):",
    transcript,
  ].join("\n");

  const raw = await postReview<{
    scores: {
      fluencyCoherence: number;
      lexicalResource: number;
      grammaticalRange: number;
      pronunciation: number;
    };
    bandEstimate: number;
    errors: Part2Review["errors"];
    improvements: Part2Review["improvements"];
    highlights: Part2Review["highlights"];
    newVocabulary: Part2Review["newVocabulary"];
  }>({
    prompt,
    system: SCORING_SYSTEM_PROMPT,
    schema: toJsonSchema(part2ReviewSchema),
    maxOutputTokens: 8192,
  });

  return {
    scores: {
      fluencyCoherence: bandTo100(raw.scores.fluencyCoherence),
      lexicalResource: bandTo100(raw.scores.lexicalResource),
      grammaticalRange: bandTo100(raw.scores.grammaticalRange),
      pronunciation: bandTo100(raw.scores.pronunciation),
    },
    bandEstimate: roundToHalfBand(raw.bandEstimate),
    errors: raw.errors,
    improvements: raw.improvements,
    highlights: raw.highlights,
    newVocabulary: raw.newVocabulary,
    followUpFeedback: "",
  };
};

export const generateFollowUps = async (
  topic: string,
  transcript: string
): Promise<string[]> => {
  const prompt = [
    "You are an IELTS examiner. The candidate just gave this Part 2 monologue.",
    `Topic: ${topic}`,
    "Monologue:",
    transcript,
    "",
    "Ask 1-2 short, natural follow-up questions on the same topic (as an examiner transitioning toward Part 3).",
  ].join("\n");
  const out = await postReview<{ questions: string[] }>({
    prompt,
    system: "Generate short IELTS-style spoken follow-up questions.",
    schema: toJsonSchema(part2FollowUpSchema),
    maxOutputTokens: 512,
  });
  return out.questions.slice(0, 2);
};

export const reviewFollowUpAnswers = async (
  topic: string,
  qa: Array<{ question: string; answer: string }>
): Promise<string> => {
  const prompt = [
    `Topic: ${topic}`,
    "The candidate answered these follow-up questions (verbatim transcripts):",
    ...qa.map((x, i) => `Q${i + 1}: ${x.question}\nA${i + 1}: ${x.answer}`),
    "",
    "Give one short paragraph of feedback on the follow-up answers (fluency, relevance, any notable errors). Keep it concise.",
  ].join("\n");
  const out = await postReview<{ feedback: string }>({
    prompt,
    system: "You are an IELTS examiner giving brief, encouraging, concrete feedback.",
    schema: toJsonSchema(part2FollowUpFeedbackSchema),
    maxOutputTokens: 1024,
  });
  return out.feedback;
};
