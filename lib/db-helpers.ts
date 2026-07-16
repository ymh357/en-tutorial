import { db } from "./db";
import type {
  Card,
  DailyStats,
  LearningProfile,
  MasteryLevel,
} from "./types";

const formatDate = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const today = (): string => formatDate(new Date());

const DEFAULT_PROFILE: LearningProfile = {
  id: "singleton",
  streakCurrent: 0,
  streakLongest: 0,
  lastActiveDate: null,
  milestones: [],
  initialCefrLevel: "",
  knownWordsBase: [],
};

export const dbHelpers = {
  async getProfile(): Promise<LearningProfile> {
    const profile = await db.learningProfile.get("singleton");
    return profile ?? DEFAULT_PROFILE;
  },

  async initProfile(
    cefrLevel: string,
    knownWords: string[]
  ): Promise<void> {
    await db.learningProfile.put({
      ...DEFAULT_PROFILE,
      initialCefrLevel: cefrLevel,
      knownWordsBase: knownWords,
    });
  },

  async getDueCards(limit: number = 50): Promise<Card[]> {
    const now = new Date();
    return db.cards
      .where("nextReview")
      .belowOrEqual(now)
      .limit(limit)
      .toArray();
  },

  async getCardByLemma(lemma: string): Promise<Card | undefined> {
    return db.cards.where("lemma").equals(lemma).first();
  },

  async getTodayStats(): Promise<DailyStats> {
    const id = today();
    const existing = await db.dailyStats.get(id);
    if (existing) return existing;
    const empty: DailyStats = {
      id,
      wordsLearned: 0,
      errorsFixed: 0,
      conversationCount: 0,
      readingCount: 0,
      writingCount: 0,
      srsReviewed: 0,
      timeSpent: 0,
    };
    return empty;
  },

  async updateTodayStats(updates: Partial<DailyStats>): Promise<void> {
    const id = today();
    const existing = await db.dailyStats.get(id);
    if (existing) {
      await db.dailyStats.update(id, updates);
    } else {
      await db.dailyStats.put({
        id,
        wordsLearned: 0,
        errorsFixed: 0,
        conversationCount: 0,
        readingCount: 0,
        writingCount: 0,
        srsReviewed: 0,
        timeSpent: 0,
        ...updates,
      });
    }
  },

  async incrementTodayStat(
    field: keyof Omit<DailyStats, "id">,
    amount: number = 1
  ): Promise<void> {
    const stats = await this.getTodayStats();
    const current = (stats[field] as number) ?? 0;
    await this.updateTodayStats({ [field]: current + amount });
  },

  async getStatsRange(
    startDate: string,
    endDate: string
  ): Promise<DailyStats[]> {
    return db.dailyStats
      .where("id")
      .between(startDate, endDate, true, true)
      .toArray();
  },

  async getVocabCounts(): Promise<Record<MasteryLevel, number>> {
    const counts: Record<MasteryLevel, number> = {
      new: 0,
      learning: 0,
      familiar: 0,
      mastered: 0,
    };
    await db.cards.each((card) => {
      counts[card.masteryLevel]++;
    });
    return counts;
  },

  async isWordKnown(lemma: string): Promise<boolean> {
    const profile = await this.getProfile();
    if (profile.knownWordsBase.includes(lemma)) return true;
    const card = await this.getCardByLemma(lemma);
    return card?.masteryLevel === "mastered";
  },

  async updateStreak(): Promise<{ current: number; longest: number }> {
    const profile = await this.getProfile();
    const todayStr = today();

    if (profile.lastActiveDate === todayStr) {
      return {
        current: profile.streakCurrent,
        longest: profile.streakLongest,
      };
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = formatDate(yesterday);

    let newCurrent: number;
    if (profile.lastActiveDate === yesterdayStr) {
      newCurrent = profile.streakCurrent + 1;
    } else {
      newCurrent = 1;
    }

    const newLongest = Math.max(newCurrent, profile.streakLongest);

    await db.learningProfile.update("singleton", {
      streakCurrent: newCurrent,
      streakLongest: newLongest,
      lastActiveDate: todayStr,
    });

    return { current: newCurrent, longest: newLongest };
  },
};
