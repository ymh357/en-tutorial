# SDD Progress Ledger

Task 1: complete (commit bfedbdd, scaffold verified)
Task 2: complete (commit aa75f3b, types verified)
Task 3: complete (commit cb1602a, db layer verified)
Task 4: complete (commit cc38789, SM-2 algorithm verified)
Task 5: complete (commit f92e7e3, frequency list verified)
Task 6: complete (commit c16d857, AI layer verified, adapted for AI SDK v7)
Task 7: complete (commit b7b5b7a, Zustand store verified)
Task 8: complete (commit 10b713c, app shell verified, adapted for base-ui sidebar)
Task 9: complete (commit 36ca502, Dexie hooks verified)
Task 10: complete (commit 07d336f, settings page verified)
Task 11: complete (commit 32a4ed3, onboarding flow verified E2E in browser)

## Sub-project A — data & correctness foundation

Plan: docs/superpowers/plans/2026-07-19-data-foundation-p1-dates-and-model.md
Branch: feat/data-correctness-foundation

### P1 · local dates + data model v4

P1 Phase 1: complete (commits eab07c3..f3bfd9d, review clean / approved)
  - lib/date.ts (local-tz date utils) + call-site unification in db-helpers, task-pool, task-pool-generate, study-engine.
  - Verified: `tsc --noEmit` clean repo-wide; `eslint` clean on the 5 scoped files (1 pre-existing, out-of-scope unused-param warning in task-pool-generate.ts `count`).
  - Accepted deviation: brief Tasks 2/3 Step-3 live devtools checks were substituted with static/behavior-equivalence verification — user global rule forbids starting a dev server unprompted; the refactor is mechanical & behavior-preserving and the reviewer confirmed file-by-file equivalence.
  - Minor findings (deferred to final whole-branch review triage):
    * lib/task-pool.ts assignTasks: `const today = new Date()` shadows the imported `today` fn (harmless now; future-edit trap — rename to `now`).
    * lib/date.ts daysBetween uses Math.round while plan prose said "floor" — Math.round is DST-robust; the plan wording is the imprecise side (doc-only).

P1 Phase 2: complete (commits 796b98f..5660f94, review clean / approved by opus reviewer)
  - types v4 (DailyStats +listeningCount/translationCount; LearningProfile +assessedLevel/studyLevel; new AssessmentResult), db v4 stores(+assessments) + upgrade migration, db-helpers new columns/profile defaults/saveAssessment/getAssessments.
  - Verified: tsc --noEmit clean after Task 7; the 3 touched files lint clean. (4 pre-existing eslint errors remain in unrelated files — hooks/use-mobile.ts setState-in-effect etc. — plus the task-pool-generate `count` warning; out of this phase's scope.)
  - Migration correctness confirmed by opus reviewer: deterministic count backfill (no double-count on re-run), complete DailyStats row for listening/translation-only days, valid Dexie-4 tx.table upgrade access, field-accurate localStorage assessments import, crypto.randomUUID available in browser upgrade context.
  - Minor findings (deferred to final review triage):
    * assessments import non-idempotent (fresh UUID/row) — plan-mandated & safe (Dexie runs a version upgrade once).
    * empty-DailyStats literal now duplicated across 4 sites — consider a createEmptyDailyStats() factory.
    * getAssessments sorts in JS — could use Dexie orderBy("date").reverse().
    * dailyStats backfill double-writes some rows — deterministic, migration-time only.
  - Accepted deviation (as Phase 1): live-devtools migration check not run (no dev server per user rule); verified by code review.

P1 final whole-branch review (opus, 92fbc47..5660f94): clean except ONE Important — migration copied old assessment `date` (an ISO timestamp from the old page writer) into a field contracted as YYYY-MM-DD.
P1 fix: commit 5c9716c — migration now `date: formatDate(new Date(a.date))` (local YYYY-MM-DD, matching saveAssessment); also renamed task-pool `assignTasks` `today`→`now` (Minor #1). Verified: tsc --noEmit clean; P1-touched files eslint clean (1 pre-existing `count` warning in task-pool-generate remains — deferred).
Deferred to P2 (quality, not correctness): createEmptyDailyStats() factory (Minor #4); getAssessments Dexie orderBy (Minor #5); dailyStats backfill double-write micro-opt (#6); task-pool-generate `count` cleanup; and all page-layer consumption of the new columns/fields/assessments table.

P1: COMPLETE. Code commits eab07c3..5c9716c on branch feat/data-correctness-foundation (+ spec a2e2f45, plan 92fbc47).
Next sub-project-A plan: P2 — lemma + graded wordlist; listening/translation ledger unification on the page side; profile field-split read-site switch; assessment/history page cutover to the assessments table; CEFR threshold unification; assessment write-back "confirm" (decision point a).
