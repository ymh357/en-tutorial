export type CardType = "vocabulary" | "error" | "expression";
export type CardSource =
  | "conversation"
  | "ielts-part2"
  | "reading"
  | "writing"
  | "translate"
  | "manual";
export type MasteryLevel = "new" | "learning" | "relearning" | "familiar" | "mastered";
export type ScenarioType = "preset" | "custom" | "free" | "recommended";
export type WritingTaskType =
  | "email"
  | "essay"
  | "social"
  | "report"
  | "quick"
  | "free";
export type AnnotationType = "error" | "suggestion" | "style" | "positive";
export type ErrorTrend = "improving" | "stable" | "declining";

export interface Card {
  id: string;
  type: CardType;
  lemma: string;
  front: string;
  back: string;
  context: string;
  source: CardSource;
  sourceId: string;
  easeFactor: number;
  interval: number;
  repetitions: number;
  nextReview: Date;
  masteryLevel: MasteryLevel;
  createdAt: Date;
  lastReviewedAt: Date | null;
  collocations?: string[]; // Common collocations/word partnerships
  wordFamily?: string; // Related word from the same family
  lapses?: number; // cumulative failure count; algorithm reads `card.lapses ?? 0`
  lapsedInterval?: number; // interval right before entering relearning, for graduation scaling; cleared once graduated
  materialId?: string; // link to the Material this card was mined from (W4)
  sourceSentence?: string; // the real sentence where the word was actually encountered, kept distinct from a fresh `example`
  imageryHint?: string; // a cue to form the mental picture for abstract words (methodology: fire-together-wire-together)
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export interface ConversationReview {
  scores: {
    fluency: number;
    accuracy: number;
    vocabulary: number;
    complexity: number;
  };
  errors: Array<{
    original: string;
    corrected: string;
    explanation: string;
  }>;
  improvements: Array<{
    original: string;
    improved: string;
    context: string;
  }>;
  highlights: Array<{
    text: string;
    reason: string;
  }>;
  newVocabulary: Array<{
    word: string;
    lemma: string;
    definition: string;
    example: string;
    collocations?: string[];
    wordFamily?: string;
  }>;
}

export interface Conversation {
  id: string;
  scenario: string;
  scenarioType: ScenarioType;
  messages: ConversationMessage[];
  review: ConversationReview | null;
  duration: number;
  createdAt: Date;
}

export interface ReadingLookup {
  word: string;
  lemma: string;
  definition: string;
  position: number;
}

export const UNKNOWN_DIFFICULTY = "unknown";

export interface ReadingSession {
  id: string;
  title: string;
  content: string;
  source: "ai_generated" | "pasted" | "url";
  sourceUrl?: string;
  difficulty: string;
  lookups: ReadingLookup[];
  sentenceAnalyses: Array<{ sentence: string; analysis: string }>;
  vocabCoverage: number;
  duration: number;
  createdAt: Date;
}

export interface WritingAnnotation {
  type: AnnotationType;
  start: number;
  end: number;
  original: string;
  replacement: string;
  explanation: string;
  collocations?: string[]; // Correct collocation pattern(s), when relevant (e.g., wrong preposition)
}

export interface WritingReview {
  score: number;
  annotations: WritingAnnotation[];
  polishedVersion: string;
  errorPatterns: Array<{ category: string; description: string }>;
}

export interface WritingSession {
  id: string;
  taskType: WritingTaskType;
  taskPrompt: string;
  content: string;
  wordCount: number;
  review: WritingReview | null;
  createdAt: Date;
}

export interface LearningProfile {
  id: "singleton";
  streakCurrent: number;
  streakLongest: number;
  lastActiveDate: string | null;
  milestones: Array<{ id: string; earnedAt: Date }>;
  initialCefrLevel: string;
  assessedLevel: string; // most recent assessed level, for display only
  studyLevel: string; // difficulty used for generation/content, user-adjustable
  knownWordsBase: string[];
  dailyNewLimit?: number; // new SRS cards per day (default 20 when absent)
  interests?: string[]; // user-chosen topics for authentic-material selection (W4)
  activeTopic?: string; // the topic currently being driven toward 98% coverage before expanding
  primaryTrack?: "fluency" | "mastery"; // fluency = listening-first direct-comprehension track; mastery = SRS-first (default "fluency", W3)
}

export interface DailyStats {
  id: string;
  wordsLearned: number;
  errorsFixed: number;
  conversationCount: number;
  readingCount: number;
  writingCount: number;
  srsReviewed: number;
  listeningCount: number;
  translationCount: number;
  timeSpent: number;
  newCardsIntroduced: number;
}

export interface ListeningExercise {
  id: string;
  mode: "dictation" | "comprehension" | "shadowing" | "prediction";
  prompt: string; // the sentence/passage that was played
  userAnswer: string; // what the user typed/said
  accuracy: number; // 0-100
  stage?: string; // which 3-step stage produced this record (imagine | listen | recall) — W1
  missedWords?: string[]; // words the listener failed to catch, persisted from alignWords diff — W1
  subjectiveComprehension?: number; // 1-3 self-rated "did the picture fire" — methodology direct-understanding signal
  listensCount?: number; // how many times the clip was replayed this exercise (focus/effort proxy)
  materialId?: string; // link to the Material this exercise drilled (enables cross-scene re-exposure) — W3/W4
  createdAt: Date;
}

export interface TranslationExercise {
  id: string;
  mode: "sentence" | "paragraph" | "situational";
  chinese: string; // original Chinese text
  userTranslation: string; // what the user wrote
  referenceTranslation: string; // AI's reference
  score: number; // 0-100 (normalized from the AI's 1-10 via lib/rubric normalizeTo100)
  feedback: string; // AI's evaluation summary
  createdAt: Date;
}

export type PoolTaskType =
  | "listening-dictation"
  | "listening-comprehension"
  | "listening-prediction"
  | "listening-shadowing"
  | "translation-sentence"
  | "translation-paragraph"
  | "translation-situational"
  | "reading-article"
  | "writing-prompt";

export interface PoolTask {
  id: string;
  type: PoolTaskType;
  difficulty: string; // CEFR level
  content: Record<string, unknown>; // type-specific generated content
  assignedDate: string; // YYYY-MM-DD, or "" when unassigned (Dexie can't index null — queries use .equals(""))
  completed: boolean;
  createdAt: Date;
  topic?: string; // controlled topic tag for authentic-material selection & coverage aggregation (W4)
  mediaType?: MaterialMediaType; // form the material takes (W4)
  sourceKind?: MaterialSourceKind; // authentic vs LLM-generated (methodology prefers authentic)
  exposureCount?: number; // cross-scene re-exposure count for the alternating-repetition pool (W3)
  lastSeenAt?: Date;
  lastSeenIn?: string; // which module last consumed this material
}

export interface AssessmentResult {
  id: string;
  date: string; // YYYY-MM-DD
  readingScore: number;
  clozeScore: number;
  writingScore: number;
  conversationScore: number;
  overallScore: number;
  levelBand: string;
  locatedLevel?: string; // CEFR level the spread-probe actually located (more precise than band) — drives step granularity (W2)
  atCeiling?: boolean; // locator hit the top of the probe spread — result may under-state level
  atFloor?: boolean; // locator hit the bottom — result may over-state level
  lowConfidence?: boolean; // objective/subjective mismatch or ceiling/floor hit — persisted so callers can adapt (W2)
}

export interface Part2Review {
  scores: {
    fluencyCoherence: number;   // 0-100 (normalized from 0-9 band)
    lexicalResource: number;    // 0-100
    grammaticalRange: number;   // 0-100
    pronunciation: number;      // 0-100 — experimental proxy (see design)
  };
  bandEstimate: number;         // 0-9 overall IELTS band (0.5 steps)
  errors: Array<{ original: string; corrected: string; explanation: string }>;
  improvements: Array<{ original: string; improved: string; context: string }>;
  highlights: Array<{ text: string; reason: string }>;
  newVocabulary: Array<{
    word: string;
    lemma: string;
    definition: string;
    example: string;
  }>;
  followUpFeedback: string;
}

export interface Part2Session {
  id: string;
  cardId: string;
  topic: string;
  transcript: string;
  durationSec: number;
  review: Part2Review | null;
  followUps: Array<{ question: string; answer: string }>;
  createdAt: Date;
}

export type MaterialMediaType = "text" | "audio" | "video";
export type MaterialSourceKind = "authentic" | "generated";

// A sentence-segmented, optionally audio-aligned unit within a Material.
export interface MaterialSentence {
  text: string;
  translation?: string;
  imageryHint?: string; // cue to form the mental picture (methodology core)
  audioStartMs?: number; // timestamp for audio/video materials
  audioEndMs?: number;
}

// Unified corpus unit. Unlike a PoolTask (consumed-once), a Material persists
// so the same source can be re-listened/re-read across scenes (alternating
// repetition, W3) and carries topic for the "one topic to 98% then expand"
// model (W4).
export interface Material {
  id: string;
  topic: string;
  mediaType: MaterialMediaType;
  sourceKind: MaterialSourceKind;
  sourceUrl?: string; // watch URL (video), page URL (text), or blob URL (audio)
  title: string;
  content: string; // full text / transcript
  sentences?: MaterialSentence[];
  difficulty?: string; // CEFR; omitted/UNKNOWN_DIFFICULTY for authentic materials
  vocabCoverage?: number; // per-topic cumulative coverage toward the 98% gate
  exposureCount: number; // cross-scene re-exposure count
  lastSeenAt?: Date;
  createdAt: Date;
}
