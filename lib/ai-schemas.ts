// Centralized zod schemas for every AI response shape produced by the app.
//
// This is the single source of truth for "what JSON should the model return"
// intended to replace the ~10 duplicated fence-strip + JSON.parse + manual
// shape-check implementations scattered across page components, and to be
// shared between live-generation consumers and the task-pool/cron generators
// (see `poolTaskSchemas` below) — sharing one schema between the pool
// generator and its live consumer is exactly what would have caught the
// `listening-comprehension` `topic` field drift bug fixed here.
//
// Bridge — a schema defined here can be consumed two ways:
//   1. Directly by `generateObject({ schema })` in server-side code: zod
//      schemas implement the Standard Schema interface, so the AI SDK's
//      `FlexibleSchema` type accepts them as-is, no wrapping required.
//   2. As JSON Schema sent over the wire: `/api/review` is called via
//      `fetch`, so the request body must be plain JSON — a zod object itself
//      cannot be serialized. Use `toJsonSchema()` below to convert before
//      sending; the route rehydrates the plain object with `ai`'s
//      `jsonSchema()` helper for `generateObject`.
//
// The zod -> JSON Schema conversion uses zod v4's native `z.toJSONSchema()`
// rather than the third-party `zod-to-json-schema` package (present
// transitively in node_modules, e.g. pulled in by shadcn, but not a direct
// dependency here): zod 4.4.3 — the version already resolved by ai@7's peer
// range "^3.25.76 || ^4.1.8" — ships this conversion natively, so no extra
// dependency is needed.

import { z } from "zod";
import type { PoolTaskType } from "./types";

// --- Conversation review (app/conversation/[id]/review/page.tsx) ---
// Reuses the shape already typed as `ConversationReview` in lib/types.ts.

export const conversationReviewSchema = z.object({
  scores: z.object({
    fluency: z.number().min(1).max(10),
    accuracy: z.number().min(1).max(10),
    vocabulary: z.number().min(1).max(10),
    complexity: z.number().min(1).max(10),
  }),
  errors: z.array(
    z.object({
      original: z.string(),
      corrected: z.string(),
      explanation: z.string(),
    })
  ),
  improvements: z.array(
    z.object({
      original: z.string(),
      improved: z.string(),
      context: z.string(),
    })
  ),
  highlights: z.array(
    z.object({
      text: z.string(),
      reason: z.string(),
    })
  ),
  newVocabulary: z.array(
    z.object({
      word: z.string(),
      lemma: z.string(),
      definition: z.string(),
      example: z.string(),
      collocations: z.array(z.string()).optional(),
      wordFamily: z.string().optional(),
    })
  ),
});

// --- Reader (app/reader/[id]/page.tsx, app/reader/page.tsx) ---

// Sentence grammar analysis is free-form prose today, not JSON — the prompt
// explicitly asks for well-organized prose and the response is stored as-is.
// Defined here for completeness only; this call should stay on the plain
// `generateText` path (no `schema` in the /api/review request body).
export const readerSentenceAnalysisSchema = z.string();

// Progressive phrase chunking for a long sentence the learner can't parse at
// once (methodology: divide-and-conquer). Each chunk is a short phrase with its
// meaning and grammatical role, so the sentence can be understood piece by
// piece rather than as one opaque blob. Used by the listening "didn't catch it"
// branch (W1-T7); reader may adopt it later (W2).
export const sentenceChunkSchema = z.object({
  chunks: z.array(
    z.object({
      phrase: z.string(),
      meaning: z.string(),
      role: z.string(),
    })
  ),
});

export const readerComprehensionEvalSchema = z.object({
  evaluations: z.array(
    z.object({
      correct: z.boolean(),
      feedback: z.string(),
    })
  ),
});

export const readerArticleGenSchema = z.object({
  title: z.string(),
  content: z.string(),
  comprehensionQuestions: z.array(
    z.object({
      question: z.string(),
      type: z.string(),
    })
  ),
});

// --- Writing (app/writing/[id]/page.tsx, app/writing/page.tsx) ---

export const writingRound1Schema = z.object({
  contentScore: z.number().min(1).max(10),
  structureFeedback: z.string(),
  suggestions: z.array(z.string()),
  strengths: z.array(z.string()),
  revisionPriority: z.string(),
});

// Reuses the shape already typed as `WritingAnnotation`/`WritingReview` in
// lib/types.ts.
const writingAnnotationSchema = z.object({
  type: z.enum(["error", "suggestion", "style", "positive"]),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  original: z.string(),
  replacement: z.string(),
  explanation: z.string(),
  collocations: z.array(z.string()).optional(),
});

export const writingReviewSchema = z.object({
  score: z.number().min(1).max(10),
  annotations: z.array(writingAnnotationSchema),
  polishedVersion: z.string(),
  errorPatterns: z.array(
    z.object({
      category: z.string(),
      description: z.string(),
    })
  ),
});

// Pool generator only (no live equivalent) — consumed as `PoolWritingPrompt`
// content by app/writing/page.tsx.
export const writingPromptGenSchema = z.object({
  taskType: z.enum(["email", "essay", "social", "report", "quick", "free"]),
  prompt: z.string(),
  targetWords: z.number().int().min(1),
  keyPhrases: z.array(z.string()),
  scaffolding: z.string(),
});

// --- Translate (app/translate/page.tsx) ---

export const translateGenSchema = z.object({
  chinese: z.string(),
  referenceTranslation: z.string(),
  keyPoints: z.array(z.string()),
  // Only populated by the live "situational" generation path today; the pool
  // generator for the same mode omits it, which this optional field allows.
  scenario: z.string().optional(),
});

export const translateEvalSchema = z.object({
  score: z.number().min(1).max(10),
  annotations: z.array(
    z.object({
      type: z.enum(["error", "awkward", "good"]),
      text: z.string(),
      explanation: z.string(),
    })
  ),
  polishedVersion: z.string(),
  keyDifferences: z.array(z.string()),
  alternativeTranslations: z.array(z.string()),
  grammarNotes: z.array(z.string()),
});

// translation-sentence pool tasks bundle several items into one generation call.
export const translateSentenceBatchSchema = z.object({
  items: z.array(translateGenSchema),
});

// --- Listening (app/listening/page.tsx) ---

// Pool generator only (no live equivalent — live dictation generates one
// free-text sentence at a time, not this batched JSON shape).
export const listeningDictationSchema = z.object({
  sentences: z.array(z.string()),
});

// `topic` fixes the schema-drift bug documented in the B investigation: the
// pool generator's prompt previously omitted `topic`, so pool-generated
// listening-comprehension content silently failed the client's
// `parseComprehensionData` shape check and was never actually consumable.
// Sharing this one schema between the pool generator and the live consumer
// (both wired up in B2) prevents that class of drift by construction.
export const listeningComprehensionSchema = z.object({
  passage: z.string(),
  topic: z.string(),
  questions: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()),
      correctIndex: z.number().int().min(0),
    })
  ),
});

// Object-shaped so it fits the standard generateObject object path (a bare
// z.array(z.string()) would need output:"array" mode, which the review route
// does not set). Carries topic/context for the "imagine" stage (methodology:
// form the mental picture before reading the English) plus a per-sentence
// translation and imageryHint cue.
export const listeningShadowingSchema = z.object({
  topic: z.string(),
  context: z.string(),
  sentences: z.array(
    z.object({
      text: z.string(),
      translation: z.string(),
      imageryHint: z.string(),
    })
  ),
});

export const listeningPredictionSchema = z.object({
  firstHalf: z.string(),
  secondHalf: z.string(),
  topic: z.string(),
});

export const listeningPredictionEvalSchema = z.object({
  score: z.number().min(1).max(10),
  feedback: z.string(),
});

// --- Assessment (app/assessment/page.tsx) ---
// Same shape family as the listening comprehension schema above, but without
// `topic` — the assessment reading section never asked for one.

export const assessmentReadingGenSchema = z.object({
  passage: z.string(),
  questions: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()),
      correctIndex: z.number().int().min(0),
    })
  ),
});

// Graded-spread reading: 2-3 subtests generated at current-1/current/current+1
// CEFR levels (see lib/assessment-scoring.ts spreadLevels), used to locate the
// user's level rather than assuming it from studyLevel.
export const assessmentGradedReadingSchema = z.object({
  subtests: z.array(z.object({
    level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]), // requested target level (scoring pairs by app's requested order, not this echo)
    passage: z.string(),
    questions: z.array(z.object({
      question: z.string(),
      options: z.array(z.string()).length(4),
      correctIndex: z.number().int().min(0).max(3),
    })).length(3),
  })).min(2).max(3), // 3 normally; 2 at a ladder end
});

export const assessmentClozeGenSchema = z.object({
  passage: z.string(),
  blanks: z.array(
    z.object({
      index: z.number().int().min(0),
      answer: z.string(),
      acceptAlso: z.array(z.string()).optional(),
    })
  ),
});

export const assessmentWritingScoreSchema = z.object({
  score: z.number().min(1).max(10),
  feedback: z.string(),
});

export const assessmentConversationScoreSchema = z.object({
  fluency: z.number().min(1).max(10),
  accuracy: z.number().min(1).max(10),
  vocabulary: z.number().min(1).max(10),
  feedback: z.string(),
});

// --- Task pool generators ---
// lib/task-pool-generate.ts (client) and app/api/cron/generate-tasks/route.ts
// (server) currently define the same 8 PoolTaskType prompts/shapes
// independently — this map is the ONE shared definition both should migrate
// to (B2), reusing the live-generation schemas above wherever the shape is
// identical.

export const poolTaskSchemas: Record<PoolTaskType, z.ZodType> = {
  "listening-dictation": listeningDictationSchema,
  "listening-comprehension": listeningComprehensionSchema,
  "listening-prediction": listeningPredictionSchema,
  "listening-shadowing": listeningShadowingSchema,
  "translation-sentence": translateSentenceBatchSchema,
  "translation-paragraph": translateGenSchema,
  "translation-situational": translateGenSchema,
  "reading-article": readerArticleGenSchema,
  "writing-prompt": writingPromptGenSchema,
};

// --- IELTS Part 2 (app/ielts/part2/**) ---

export const part2ReviewSchema = z.object({
  scores: z.object({
    fluencyCoherence: z.number().min(0).max(9),
    lexicalResource: z.number().min(0).max(9),
    grammaticalRange: z.number().min(0).max(9),
    pronunciation: z.number().min(0).max(9),
  }),
  bandEstimate: z.number().min(0).max(9),
  errors: z.array(
    z.object({
      original: z.string(),
      corrected: z.string(),
      explanation: z.string(),
    })
  ),
  improvements: z.array(
    z.object({
      original: z.string(),
      improved: z.string(),
      context: z.string(),
    })
  ),
  highlights: z.array(
    z.object({ text: z.string(), reason: z.string() })
  ),
  newVocabulary: z.array(
    z.object({
      word: z.string(),
      lemma: z.string(),
      definition: z.string(),
      sourceSentence: z.string(),
      example: z.string(),
    })
  ),
});

export const part2FollowUpSchema = z.object({
  questions: z.array(z.string()).min(1).max(2),
});

export const part2FollowUpFeedbackSchema = z.object({
  feedback: z.string(),
});

// --- JSON Schema bridge ---

/**
 * Converts a zod schema into a plain JSON Schema object, for embedding in an
 * `/api/review` request body's `schema` field (client -> server transport,
 * since a zod object cannot cross a `fetch` JSON boundary as-is). The route
 * rehydrates the plain object via `ai`'s `jsonSchema()` for `generateObject`.
 */
export const toJsonSchema = (schema: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema) as Record<string, unknown>;
