export type CardType = "vocabulary" | "error" | "expression";
export type CardSource = "conversation" | "reading" | "writing" | "translate" | "manual";
export type MasteryLevel = "new" | "learning" | "familiar" | "mastered";
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
  knownWordsBase: string[];
}

export interface DailyStats {
  id: string;
  wordsLearned: number;
  errorsFixed: number;
  conversationCount: number;
  readingCount: number;
  writingCount: number;
  srsReviewed: number;
  timeSpent: number;
}

export interface ListeningExercise {
  id: string;
  mode: "dictation" | "comprehension" | "shadowing" | "prediction";
  prompt: string; // the sentence/passage that was played
  userAnswer: string; // what the user typed/said
  accuracy: number; // 0-100
  createdAt: Date;
}

export interface TranslationExercise {
  id: string;
  mode: "sentence" | "paragraph" | "situational";
  chinese: string; // original Chinese text
  userTranslation: string; // what the user wrote
  referenceTranslation: string; // AI's reference
  score: number; // 1-10
  feedback: string; // AI's evaluation summary
  createdAt: Date;
}

export type PoolTaskType =
  | "listening-dictation"
  | "listening-comprehension"
  | "listening-prediction"
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
  assignedDate: string | null; // YYYY-MM-DD or null if unassigned
  completed: boolean;
  createdAt: Date;
}
