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
  AssessmentResult,
} from "./types";
import { formatDate } from "./date";

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
  assessments: EntityTable<AssessmentResult, "id">;
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

db.version(4)
  .stores({
    cards: "id, type, lemma, source, sourceId, nextReview, masteryLevel, createdAt",
    conversations: "id, scenarioType, createdAt",
    readingSessions: "id, source, createdAt",
    writingSessions: "id, taskType, createdAt",
    learningProfile: "id",
    dailyStats: "id",
    listeningExercises: "id, mode, createdAt",
    translationExercises: "id, mode, createdAt",
    poolTasks: "id, type, assignedDate, completed, createdAt",
    assessments: "id, date",
  })
  .upgrade(async (tx) => {
    // 1) Backfill listeningCount / translationCount on dailyStats from detail tables.
    const daily = tx.table("dailyStats");
    const tally = (rows: Array<{ createdAt: Date | string }>): Record<string, number> => {
      const m: Record<string, number> = {};
      for (const r of rows) {
        const d = formatDate(new Date(r.createdAt));
        m[d] = (m[d] ?? 0) + 1;
      }
      return m;
    };
    const lc = tally(await tx.table("listeningExercises").toArray());
    const tc = tally(await tx.table("translationExercises").toArray());

    // Ensure existing rows carry the new columns.
    const existing = await daily.toArray();
    for (const row of existing) {
      await daily.put({
        ...row,
        listeningCount: row.listeningCount ?? 0,
        translationCount: row.translationCount ?? 0,
      });
    }
    // Merge aggregated counts (creating rows for days that had only listening/translation).
    const affected = new Set([...Object.keys(lc), ...Object.keys(tc)]);
    for (const date of affected) {
      const row = await daily.get(date);
      const base = row ?? {
        id: date,
        wordsLearned: 0,
        errorsFixed: 0,
        conversationCount: 0,
        readingCount: 0,
        writingCount: 0,
        srsReviewed: 0,
        timeSpent: 0,
        listeningCount: 0,
        translationCount: 0,
      };
      await daily.put({
        ...base,
        listeningCount: lc[date] ?? base.listeningCount ?? 0,
        translationCount: tc[date] ?? base.translationCount ?? 0,
      });
    }

    // 2) Profile level split.
    const profiles = tx.table("learningProfile");
    const p = await profiles.get("singleton");
    if (p) {
      await profiles.put({
        ...p,
        assessedLevel: p.assessedLevel ?? p.initialCefrLevel ?? "",
        studyLevel: p.studyLevel ?? p.initialCefrLevel ?? "",
      });
    }

    // 3) Migrate localStorage assessments into the table (one-time).
    if (typeof window !== "undefined") {
      const raw = window.localStorage.getItem("en-tutor-assessments");
      if (raw) {
        try {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) {
            const table = tx.table("assessments");
            for (const a of arr) {
              await table.put({
                id: crypto.randomUUID(),
                date: formatDate(new Date(a.date)),
                readingScore: a.readingScore,
                clozeScore: a.clozeScore,
                writingScore: a.writingScore,
                conversationScore: a.conversationScore,
                overallScore: a.overallScore,
                levelBand: a.levelBand,
              });
            }
          }
        } catch {
          // Corrupt localStorage — skip; original value is left untouched.
        }
      }
    }
  });

db.version(5)
  .stores({
    // identical stores to v4 (no schema change; data-only migration)
    cards: "id, type, lemma, source, sourceId, nextReview, masteryLevel, createdAt",
    conversations: "id, scenarioType, createdAt",
    readingSessions: "id, source, createdAt",
    writingSessions: "id, taskType, createdAt",
    learningProfile: "id",
    dailyStats: "id",
    listeningExercises: "id, mode, createdAt",
    translationExercises: "id, mode, createdAt",
    poolTasks: "id, type, assignedDate, completed, createdAt",
    assessments: "id, date",
  })
  .upgrade(async (tx) => {
    // One-time in-place 1-10 → 0-100 for the three legacy subjective-score
    // fields. Runs exactly once (tied to the version bump), so it is safe to
    // multiply unconditionally — there is no read-path ambiguity.
    const clamp100 = (v: number): number =>
      Math.round(Math.max(0, Math.min(100, v * 10)));

    // writingSessions[].review.score
    const ws = tx.table("writingSessions");
    for (const row of await ws.toArray()) {
      if (row.review && typeof row.review.score === "number") {
        await ws.put({
          ...row,
          review: { ...row.review, score: clamp100(row.review.score) },
        });
      }
    }

    // translationExercises[].score
    const te = tx.table("translationExercises");
    for (const row of await te.toArray()) {
      if (typeof row.score === "number") {
        await te.put({ ...row, score: clamp100(row.score) });
      }
    }

    // conversations[].review.scores.{fluency,accuracy,vocabulary,complexity}
    const cv = tx.table("conversations");
    for (const row of await cv.toArray()) {
      if (row.review && row.review.scores) {
        const s = row.review.scores;
        await cv.put({
          ...row,
          review: {
            ...row.review,
            scores: {
              fluency: clamp100(s.fluency),
              accuracy: clamp100(s.accuracy),
              vocabulary: clamp100(s.vocabulary),
              complexity: clamp100(s.complexity),
            },
          },
        });
      }
    }
  });

export { db };
