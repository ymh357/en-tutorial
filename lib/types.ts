export type CardType = "vocabulary" | "error" | "expression";
export type CardSource = "conversation" | "reading" | "writing" | "manual";
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
