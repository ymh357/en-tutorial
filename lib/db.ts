import Dexie, { type EntityTable } from "dexie";
import type {
  Card,
  Conversation,
  ReadingSession,
  WritingSession,
  LearningProfile,
  DailyStats,
  ListeningExercise,
  TranslationExercise,
  PoolTask,
} from "./types";

const db = new Dexie("EnTutorDB") as Dexie & {
  cards: EntityTable<Card, "id">;
  conversations: EntityTable<Conversation, "id">;
  readingSessions: EntityTable<ReadingSession, "id">;
  writingSessions: EntityTable<WritingSession, "id">;
  learningProfile: EntityTable<LearningProfile, "id">;
  dailyStats: EntityTable<DailyStats, "id">;
  listeningExercises: EntityTable<ListeningExercise, "id">;
  translationExercises: EntityTable<TranslationExercise, "id">;
  poolTasks: EntityTable<PoolTask, "id">;
};

db.version(1).stores({
  cards: "id, type, lemma, source, sourceId, nextReview, masteryLevel, createdAt",
  conversations: "id, scenarioType, createdAt",
  readingSessions: "id, source, createdAt",
  writingSessions: "id, taskType, createdAt",
  learningProfile: "id",
  dailyStats: "id",
});

db.version(2).stores({
  cards: "id, type, lemma, source, sourceId, nextReview, masteryLevel, createdAt",
  conversations: "id, scenarioType, createdAt",
  readingSessions: "id, source, createdAt",
  writingSessions: "id, taskType, createdAt",
  learningProfile: "id",
  dailyStats: "id",
  listeningExercises: "id, mode, createdAt",
  translationExercises: "id, mode, createdAt",
});

db.version(3).stores({
  cards: "id, type, lemma, source, sourceId, nextReview, masteryLevel, createdAt",
  conversations: "id, scenarioType, createdAt",
  readingSessions: "id, source, createdAt",
  writingSessions: "id, taskType, createdAt",
  learningProfile: "id",
  dailyStats: "id",
  listeningExercises: "id, mode, createdAt",
  translationExercises: "id, mode, createdAt",
  poolTasks: "id, type, assignedDate, completed, createdAt",
});

export { db };
