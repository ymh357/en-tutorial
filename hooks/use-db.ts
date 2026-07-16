"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { dbHelpers } from "@/lib/db-helpers";
import type {
  Card,
  Conversation,
  DailyStats,
  LearningProfile,
  MasteryLevel,
  ReadingSession,
  WritingSession,
} from "@/lib/types";

export const useProfile = (): LearningProfile | undefined => {
  return useLiveQuery(() => dbHelpers.getProfile());
};

export const useDueCards = (limit: number = 50): Card[] => {
  return useLiveQuery(() => dbHelpers.getDueCards(limit), [limit]) ?? [];
};

export const useVocabCounts = ():
  | Record<MasteryLevel, number>
  | undefined => {
  return useLiveQuery(() => dbHelpers.getVocabCounts());
};

export const useTodayStats = (): DailyStats | undefined => {
  return useLiveQuery(() => dbHelpers.getTodayStats());
};

export const useStatsRange = (
  startDate: string,
  endDate: string
): DailyStats[] => {
  return (
    useLiveQuery(
      () => dbHelpers.getStatsRange(startDate, endDate),
      [startDate, endDate]
    ) ?? []
  );
};

export const useConversations = (limit: number = 20): Conversation[] => {
  return (
    useLiveQuery(() =>
      db.conversations.orderBy("createdAt").reverse().limit(limit).toArray()
    ) ?? []
  );
};

export const useReadingSessions = (
  limit: number = 20
): ReadingSession[] => {
  return (
    useLiveQuery(() =>
      db.readingSessions.orderBy("createdAt").reverse().limit(limit).toArray()
    ) ?? []
  );
};

export const useWritingSessions = (
  limit: number = 20
): WritingSession[] => {
  return (
    useLiveQuery(() =>
      db.writingSessions.orderBy("createdAt").reverse().limit(limit).toArray()
    ) ?? []
  );
};
