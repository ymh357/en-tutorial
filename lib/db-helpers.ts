import { db } from "./db";
import type {
  Card,
  DailyStats,
  LearningProfile,
  ListeningExercise,
  MasteryLevel,
  AssessmentResult,
} from "./types";
import { formatDate, today } from "./date";
import { ensureLemmatizer, lemmatize } from "./lemma";

// Listening modes graded subjectively (AI-scored), not by objective accuracy
// against a reference. Excluded from avgAccuracy so a subjective score never
// gets averaged in as if it were an objective percentage.
const SUBJECTIVE_LISTENING_MODES = new Set(["prediction"]);

const DEFAULT_PROFILE: LearningProfile = {
  id: "singleton",
  streakCurrent: 0,
  streakLongest: 0,
  lastActiveDate: null,
  milestones: [],
  initialCefrLevel: "",
  assessedLevel: "",
  studyLevel: "",
  knownWordsBase: [],
};

export const dbHelpers = {
  async getProfile(): Promise<LearningProfile> {
    const profile = await db.learningProfile.get("singleton");
    if (profile) {
      return {
        ...profile,
        assessedLevel: profile.assessedLevel ?? profile.initialCefrLevel ?? "",
        studyLevel: profile.studyLevel ?? profile.initialCefrLevel ?? "",
      };
    }
    return { ...DEFAULT_PROFILE, milestones: [], knownWordsBase: [] };
  },

  async initProfile(
    cefrLevel: string,
    knownWords: string[]
  ): Promise<void> {
    await db.learningProfile.put({
      ...DEFAULT_PROFILE,
      initialCefrLevel: cefrLevel,
      assessedLevel: cefrLevel,
      studyLevel: cefrLevel,
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
      listeningCount: 0,
      translationCount: 0,
      timeSpent: 0,
      newCardsIntroduced: 0,
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
        listeningCount: 0,
        translationCount: 0,
        timeSpent: 0,
        newCardsIntroduced: 0,
        ...updates,
      });
    }
  },

  async incrementTodayStat(
    field: keyof Omit<DailyStats, "id">,
    amount: number = 1
  ): Promise<void> {
    const id = today();
    await db.transaction("rw", db.dailyStats, async () => {
      const existing = await db.dailyStats.get(id);
      if (existing) {
        const current = (existing[field] as number) ?? 0;
        await db.dailyStats.update(id, { [field]: current + amount });
      } else {
        await db.dailyStats.put({
          id,
          wordsLearned: 0,
          errorsFixed: 0,
          conversationCount: 0,
          readingCount: 0,
          writingCount: 0,
          srsReviewed: 0,
          listeningCount: 0,
          translationCount: 0,
          timeSpent: 0,
          newCardsIntroduced: 0,
          [field]: amount,
        });
      }
    });
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
    const levels: MasteryLevel[] = [
      "new",
      "learning",
      "relearning",
      "familiar",
      "mastered",
    ];
    const results = await Promise.all(
      levels.map((level) =>
        db.cards.where("masteryLevel").equals(level).count()
      )
    );
    return {
      new: results[0],
      learning: results[1],
      relearning: results[2],
      familiar: results[3],
      mastered: results[4],
    };
  },

  async getDueReviews(limit = 50): Promise<Card[]> {
    const now = new Date();
    return db.cards
      .where("nextReview")
      .belowOrEqual(now)
      .and((c) => c.masteryLevel !== "new")
      .limit(limit)
      .toArray();
  },

  async getNewCards(limit: number): Promise<Card[]> {
    if (limit <= 0) return [];
    const now = new Date();
    return db.cards
      .where("nextReview")
      .belowOrEqual(now)
      .and((c) => c.masteryLevel === "new")
      .limit(limit)
      .toArray();
  },

  // Reviews first, then new cards capped by the remaining daily new-card budget.
  async getSessionQueue(dailyNewLimit: number): Promise<Card[]> {
    const reviews = await this.getDueReviews(50);
    const stats = await this.getTodayStats();
    const remainingNew = Math.max(
      0,
      dailyNewLimit - (stats.newCardsIntroduced ?? 0)
    );
    const newCards = await this.getNewCards(remainingNew);
    return [...reviews, ...newCards];
  },

  async isWordKnown(lemma: string): Promise<boolean> {
    await ensureLemmatizer();
    const key = lemmatize(lemma);
    const profile = await this.getProfile();
    if (profile.knownWordsBase.some((w) => lemmatize(w) === key)) return true;
    const card = await this.getCardByLemma(key);
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

    await db.learningProfile.put({
      ...profile,
      streakCurrent: newCurrent,
      streakLongest: newLongest,
      lastActiveDate: todayStr,
    });

    return { current: newCurrent, longest: newLongest };
  },

  async getListeningAggregate(
    mode?: ListeningExercise["mode"]
  ): Promise<{ count: number; avgAccuracy: number }> {
    const rows = mode
      ? await db.listeningExercises.where("mode").equals(mode).toArray()
      : await db.listeningExercises.toArray();
    // count is intentionally over ALL modes (roadmap's "complete 20 listening
    // exercises" gate relies on this); only avgAccuracy excludes subjective
    // modes so it stays a pure objective-accuracy average.
    const objectiveRows = rows.filter(
      (r) => !SUBJECTIVE_LISTENING_MODES.has(r.mode)
    );
    const avgAccuracy =
      objectiveRows.length === 0
        ? 0
        : Math.round(
            objectiveRows.reduce((s, e) => s + e.accuracy, 0) /
              objectiveRows.length
          );
    return { count: rows.length, avgAccuracy };
  },

  async saveAssessment(result: Omit<AssessmentResult, "id">): Promise<void> {
    await db.assessments.add({ id: crypto.randomUUID(), ...result });
  },

  async getAssessments(): Promise<AssessmentResult[]> {
    const all = await db.assessments.toArray();
    return all.sort((a, b) => b.date.localeCompare(a.date));
  },
};
