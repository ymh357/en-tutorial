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

### P2a · lemma + graded wordlist

P2a Phase 1: complete (commits e8a14e5..aedfa95, review clean / approved)
  - lib/lemma.ts (wink-lemmatizer lazy dynamic import; ensureLemmatizer + lemmatize noun→verb→adjective, lowercase fallback) + types/wink-lemmatizer.d.ts; lib/data/wordlist.json (9894 google-10000 words, MIT) + frequency-list.ts rewrite (rank→band proxy, getKnownWordsForLevel/getWordLevel signatures unchanged).
  - Verified: tsc clean; touched files eslint clean; reviewer independently ran the real lemmatizer (running→run, knives→knife, went→go, children→child), confirmed Turbopack CJS/ESM interop for the dynamic import, and consumer compat (onboarding, initProfile).
  - Minor: WinkLemmatizer type in lemma.ts duplicates the d.ts default shape (cosmetic, brief-sourced).

P2a Phase 2: complete (commits da6f56a..22b06d1, review clean / approved)
  - reader coverage lemmatizes text words + knownWordsBase; distinguishes known(mastered+baseline) vs learning(learning/familiar) via mutually-exclusive else-if; recomputes on lemmaReady; new UI "X% known · Learning: Y%". srs/browse + isWordKnown unified to lib/lemma (isWordKnown now async-lemmatizes both sides). onboarding: no change needed.
  - New reader hooks placed in the pre-early-return hooks group; the pre-existing P3-owned hooks-order defect was NOT worsened (reader eslint findings identical before/after).
  - Verified: tsc clean; touched files eslint clean.
  - Minor: isWordKnown param name now slightly misleading (cosmetic); isWordKnown has no callers (pre-existing dead code); conversation review's extractKeyWord doesn't route through lib/lemma, so those cards' lemmas may not match lemmatized reader text (pre-existing, out-of-scope, waived — record for a later lemma-unification pass, likely P3).

Next: P2a final whole-branch review (opus, e1fb2c8..22b06d1).

P2a final whole-branch review (opus, e1fb2c8..22b06d1): With fixes — one Important (I1): reader coverage sets inserted raw card.lemma while article text is wink-lemmatized, regressing match for inflected-lemma cards (conversation/pre-P2a cards).
P2a fix: commit 2dfb0de — masteredLemmaSet/learningLemmaSet now lemmatize(card.lemma) + lemmaReady in deps. Verified: tsc clean; reader eslint findings unchanged (pre-existing hooks-order/unused/prefer-const remain — P3).
P2a deferred (not merge blockers): getWordLevel doesn't lemmatize input (no callers, latent M2); bandForRank trailing return unreachable (M3); onboarding allocates full array for .length (M4); isWordKnown param name; conversation-review extractKeyWord creation-side lemma unification (P3).
Bundle: wordlist.json (~35KB gz) lands only in the onboarding route chunk; main bundle unaffected. wink-lemmatizer stays dynamic-imported.

P2a: COMPLETE. Code commits e8a14e5..2dfb0de (+ plan e1fb2c8). Branch kept as-is (all sub-project-A plans stack on feat/data-correctness-foundation until A completes).
Next: P2b — listening/translation ledger unification page-side (write incrementTodayStat listeningCount/translationCount; delete localStorage aggregates; roadmap/dashboard/profile read from Dexie).

### P2b · ledger unification (page side)

P2b Phase 1: complete (commits 49c7ca5..acbc4db, review clean / approved)
  - db-helpers.getListeningAggregate(mode?) + useListeningExercises/useTranslationExercises hooks; listening (4 completion points) & translate now incrementTodayStat("listeningCount"/"translationCount"); detail-table writes + updateStreak preserved; recordListeningExercise/recordTranslation + *_STATS_KEY deleted.
  - Verified: tsc clean; 4 touched files eslint clean; grep confirms writers gone (residue only in Phase 2 files page/roadmap — expected mid-phase).

P2b Phase 2: complete (commits c40a49b..daafe9a, review clean / approved)
  - dashboard lastListening/lastTranslation from useListeningExercises(1)/useTranslationExercises(1)[0]?.createdAt; mergedCompletedSteps "done today" check now uses todayStats.listeningCount/translationCount>0 (was localStorage — in-scope connected fix); roadmap "Dictation accuracy" = getListeningAggregate("dictation").avgAccuracy (filtered — label fixed), listening-count requirement = unfiltered getListeningAggregate().count; useLiveQuery uses a stable EMPTY_LISTENING_AGGREGATE fallback constant. All localStorage keys + readListeningStats deleted (repo-wide grep empty).
  - Verified: tsc clean; roadmap eslint clean; page.tsx retains 1 pre-existing unrelated warning (pullOrGenerate effect).

Next: P2b final whole-branch review (opus, b49944f..daafe9a).

P2b final whole-branch review (opus, b49944f..daafe9a): Ready to merge = Yes. Write→read loop closed; no orphans (grep-empty); types/schema/study-engine contract aligned; no historical data loss (P1 v4 migration already backfilled counts); dictation-only accuracy is a sound label fix.
  - One Important (follow-up, now fixed in-branch): study-engine doneTodayCount.listening hardcoded 0 — plan could suggest listening after it was done today, contradicting the dashboard.
P2b fix: commit d540d16 — doneTodayCount.listening = todayStats.listeningCount (stale comment removed). tsc + eslint clean.

P2b: COMPLETE. Code commits 49c7ca5..d540d16 (+ plan b49944f). Branch kept as-is.
Next: P2c — profile field read-site switch (initialCefrLevel → studyLevel for generation / assessedLevel for display); assessment/history cutover to the assessments table; CEFR threshold unify; assessment write-back "confirm" (decision a). Then P3 (backup/import + 11 P0 bugs).

### P2c · level fields + assessment cutover

P2c Phase 1: complete (commits d307f4e..ad916bb, review clean / approved)
  - generation reads → studyLevel (conversation buildSystemPrompt + useMemo dep, translate, listening, page pool-gen); display reads → assessedLevel (conversation badge; dashboard card via assessedLevel||studyLevel; profile card). initialCefrLevel field untouched (legacy). No mis-classified reads.
  - Verified: tsc clean; 5 touched files eslint clean (2 pre-existing warnings unchanged).

P2c Phase 2: pending (assessment: Dexie table cutover + unified CEFR thresholds + confirm-dialog write-back, decision A).

P2c Phase 2: complete (commit 693fdd0 + fix b106e94, review passed after fix)
  - assessment cutover to Dexie (saveAssessment/getAssessments via useLiveQuery; date=formatDate local); CEFR thresholds unified into a single CEFR_BANDS source — opus verified fine+coarse outputs identical at every boundary (45/65/85 preserved, no silent re-leveling); write-back decision A (always assessedLevel; studyLevel only behind a confirm Dialog; initialCefrLevel no longer written).
  - Fixes (b106e94): priorResult snapshot captured BEFORE save (reactive live-query had made "vs last" delta always 0 — a real regression opus caught); line 443 generation read → studyLevel; confirm write also recomputes knownWordsBase (matches settings).
  - Verified: tsc clean; eslint clean.

P2c Phase 3: pending (history read Dexie; roadmap assessedLevel display + readAssessments→Dexie + threshold-source note; settings save studyLevel + recompute knownWordsBase).

P2c Phase 3: complete (commits 3ee464a..1b027b8, review clean / approved)
  - history reads assessments from Dexie (getAssessments useLiveQuery; type from @/lib/types); roadmap display/gate → assessedLevel, readAssessments→useLiveQuery(getAssessments), B2_ASSESSMENT_THRESHOLD sourced-comment; settings Select init studyLevel, save writes studyLevel + recomputed knownWordsBase, update-return checked (falls back to put on 0). readAssessments gone repo-wide; en-tutor-assessments only in db.ts v4 migration (legacy read).
  - Verified: tsc clean; touched files eslint clean (1 pre-existing settings warning).
  - Minor: history isLoading doesn't gate the assessments live-query (brief flicker possible, self-correcting; one-line fix candidate for final-review triage).

Next: P2c final whole-branch review (opus, 741cbe0..1b027b8).

P2c final whole-branch review (opus, 741cbe0..1b027b8): With fixes. All 5 integration checks pass (field classification consistency, single assessment source, write-back loop, priorResult snapshot, cross-phase type/threshold). One Important: date display regression (history/assessment parsed YYYY-MM-DD via new Date() = UTC → fake constant time / negative-tz off-by-one).
P2c fix: commit 2f6f0ff — history:190 + assessment:858 use parseDate (local); history hides the fake clock time on assessment-type entries (other entries keep their real time). tsc + eslint clean.
P2c deferred (Minor, not blockers): getAssessments same-day order nondeterministic (UUID pk order); confirmStudyLevelUpdate/finishAssessment lack the singleton put() fallback settings has; history isLoading doesn't gate assessments (self-corrects via ?? EMPTY); assessment:89 dead re-export.

P2c: COMPLETE. Code commits d307f4e..2f6f0ff (+ plan 741cbe0). Branch kept as-is.

======================================================================
Sub-project A / P2 (a + b + c) COMPLETE.
Done so far on branch feat/data-correctness-foundation:
  P1  local dates + data model v4 (migration)          [DONE]
  P2a lemma + graded wordlist                           [DONE]
  P2b listening/translation ledger unification          [DONE]
  P2c level fields + assessment cutover/thresholds/writeback [DONE]
Remaining in sub-project A:
  P3  backup export/import + Danger Zone hardening + 11 P0 bug fixes
Then: sub-project B (AI contract + cost tracking), C (voice/whisper), D (scoring/assessment psychometrics/SRS scheduling).
======================================================================

Next: P3 (start with backup/import — self-contained — then the P0 bug batch).

### P3a · backup + Danger Zone

P3a Phase 1: complete (commit a3d49cf, review clean / approved)
  - lib/backup.ts: exportBackup/downloadBackup/importBackup + BackupFile; 10 Dexie tables + whitelisted en-tutor-* localStorage; import = schemaVersion check → tx clear+bulkPut → Date revival per DATE_PATHS (assessments.date stays string). Reviewer cross-checked DATE_PATHS vs types.ts field-by-field, TABLES vs db.ts (10/10), Dexie tx API, localStorage whitelist repo-wide.
  - Verified: tsc + eslint clean.

P3a Phase 2: pending (settings export/import UI + Danger Zone hardening: export-first, type-to-confirm, targeted en-tutor-* clear, db.delete timeout).

P3a Phase 2: complete (commit c68c153, review clean / approved)
  - settings: Export (downloadBackup, try/catch); Import (file input → confirm → importBackup → reload; failure = clear message, no half-write since importBackup validates before its tx); Danger Zone hardened — export-first nudge, type-to-confirm ("DELETE"), targeted en-tutor-* clear (no blanket localStorage.clear), db.delete() Promise.race timeout(8s) with distinct "close other tabs" message + busy-state reset on all catch paths.
  - Verified: tsc clean; eslint 1 pre-existing no-console warning.
  - Minor (deferred): Cancel not disabled mid-flight; shared export error state; error-fallback dup; Phase-1 importBackup restores localStorage outside the table tx; db.delete timeout doesn't cancel underlying call.

Next: P3a final whole-branch review (opus, b3303ef..c68c153).

P3a final whole-branch review (opus, b3303ef..c68c153): With fixes. Round-trip faithful (DATE_PATHS covers all Date fields, revival before bulkPut, version gate prevents half-write, Danger Zone hardening real). 3 Importants — all touching the safety-net promise.
P3a fix: commit dc31dc4 — (A) Danger Zone export error now rendered inline (was invisible → a data-loss path); (B) importBackup clears en-tutor-* before restore (true replace, no orphans) + best-effort localStorage (post-tx setItem failure no longer throws / no false "no data changed"); (C) dev-only guard warns if TABLES drifts from db.tables. tsc clean; eslint 0 new.

P3a: COMPLETE. Code commits a3d49cf..dc31dc4 (+ plan b3303ef). Branch kept as-is.

Next: P3b — the 11 P0 bug batch (details in scratchpad/p3-bugs.md). After P3b, sub-project A is DONE; then sub-projects B (AI contract + cost), C (voice/whisper), D (scoring/psychometrics/SRS).

### P3b · 11 P0 bug batch

P3b Phase 1: complete (commits 1a27993..1f819b0, review clean / approved by opus)
  - reader: (#1) lookupPanelRef/scrollIntoView hooks moved above all early returns — hooks-order errors 2→0, crash gone; (#9) handleWordClick locates sentence by per-lemma occurrence `count` (not the post-render occurrenceCounterRef total). srs: (#2) render-body conditional setState snapshots the due set at session start (converges, no infinite loop; iterates frozen snapshot; ratings still write db; remount re-snapshots). conversation: (#3) createdAt = existing?.createdAt ?? new Date(); (#4) both put paths guarded by existing?.review — no path overwrites a reviewed conversation.
  - Verified (opus): tsc clean; reader hooks-order 2→0; srs/conversation eslint clean.
  - Minor (tracked, pre-existing/accepted): findSentenceForWord lemma-vs-wordform count mismatch (inflected words may still misresolve — pre-existing; #9 is a net improvement); deep-linked reviewed-conversation new messages silently dropped (data-protection tradeoff); srs first-frame "All caught up!" flash.

P3b Phase 2: pending (cron auth+blob overwrite; extract TLS/redirects; dashboard pool race + streak-on-mount + daily-goal wiring).

P3b Phase 2: complete (commits 285263a..aed8b13 + fix a41de67, review passed after fix by opus)
  - cron: (#5) reject when CRON_SECRET unset; (#8) blob put allowOverwrite. extract: (#6) socket pinned to validated IP + real hostname SNI (genuine TLS, no rebinding window); bounded redirect loop re-running full SSRF validation per hop (private/metadata redirects blocked); 5MB/timeout/private guards preserved; live-verified (https 200, http→https 301 followed, localhost blocked). dashboard: (#8-prewarm) bulkPut idempotent + catch narrowed to fetch; (#10) streak removed from mount; (#11) daily goal from localStorage → targetMinutes.
  - Fix a41de67: prewarm bulkGets existing + preserves completed/createdAt (bulkPut was resurrecting completed tasks on re-stock — opus caught); undici pinned as direct dep (^7.28.0), since the SSRF pinning depends on it.
  - Verified (opus): tsc clean; eslint no new; SSRF has no surviving bypass.

P3b Phase 3: pending (assessment durable progress: sessionStorage→localStorage + prompt/topic in snapshot; stale "Listening/Cloze"→"Cloze" label at dimensionComparisons).

P3b Phase 3: complete (commit 8ca1a42, review clean / approved)
  - assessment progress: sessionStorage→localStorage with 24h expiry (stale discarded, try/catch safe); writingPrompt/conversationTopic added to snapshot + restored (random only when no snapshot — fixes refresh prompt↔answer mismatch); dimensionComparisons label "Listening/Cloze"→"Cloze". Integrates cleanly with P2c (priorResult/Dexie untouched).
  - Verified: tsc + eslint clean; no sessionStorage leftover, no re-randomization path.

Next: P3b final whole-branch review (opus, 739ebf2..8ca1a42).

P3b final whole-branch review (opus, 739ebf2..8ca1a42): With fixes. All 11 P0 fixes present, correct, compose cleanly; crash/data-loss/security all resolved; tsc clean, eslint no new. One Important: local-gen double-billing race half-closed (LAST_GEN_KEY claim was after generatePoolTasks → concurrent mount on the server-empty fallback path double-generates).
P3b fix: commit 26c67b0 — claim LAST_GEN_KEY BEFORE generating (synchronous read-check-set blocks concurrent mount) + release the claim on failure (retry-safe). tsc clean; eslint 1 pre-existing warning.
P3b deferred (Minor): reader findSentenceForWord lemma/wordform mismatch (pre-existing, net-improved); deep-linked reviewed-conversation message drop (data-protection tradeoff); srs first-frame flash; reader dead loading/not-found branches (pre-existing); loadDailyGoal dup (page vs settings); cron 500-vs-401.

P3b: COMPLETE. Code commits 1a27993..26c67b0 (+ plan 739ebf2).

##############################################################
SUB-PROJECT A (data & correctness foundation): COMPLETE.
Six plans on feat/data-correctness-foundation, each reviewed per-phase + an opus whole-branch review, every Important fixed in-branch:
  P1  local dates + Dexie v4 + migration
  P2a lemma + graded wordlist
  P2b listening/translation ledger unification
  P2c level fields + assessment cutover/thresholds/writeback
  P3a backup export/import + Danger Zone hardening
  P3b 11 P0 bug fixes
Branch NOT merged/pushed (kept as-is). tsc clean repo-wide; eslint only pre-existing findings.
Remaining overhaul scope — NEW sub-projects, each needs its own brainstorm/spec (the original brainstorm covered ONLY sub-project A):
  B  AI contract (generateObject/zod, maxOutputTokens, low temp) + cost-tracking correctness
  C  voice/whisper (STT cutover, TTS mutex loops, pronunciation)
  D  scoring/assessment psychometrics + SRS scheduling (leech / new-card queue / relearning)
##############################################################

DECISION (user, sub-project A done): keep branch as-is (B/C/D stack on feat/data-correctness-foundation; unified merge/PR later). Next sub-project = B (AI contract + cost).

## Sub-project B — AI contract + cost tracking (needs its own spec; original brainstorm covered only A)
Scope:
  - /api/review → generateObject + zod schemas (structured output), maxOutputTokens, low temperature for scoring/grading calls.
  - server (/api/chat + /api/review) returns the REAL model id + token usage; client recordCost uses real values (replace hardcoded "claude-sonnet-5"); pool-gen + cron cost recorded (or removed from the "covered" claim).
  - Consumers of /api/review structured output to migrate: conversation review, reader (sentence analysis + comprehension eval), writing (round1 + round2), translate (gen + eval), listening (all tabs), assessment (all sections), task-pool-generate, cron.
Next step: explore every AI call site + the cost-tracker path, then write the B spec.

### B1 · review route structured + schema lib + cost surfacing
Plan committed. base = (this commit). Phases: P1 = lib/ai-schemas.ts + /api/review generateObject + lib/ai smoke-test; P2 = /api/chat usage onFinish + cost-tracker cumulative totals. Then B2 = migrate the 8 consumer files to schema + real recordCost.

B1 Phase 1: complete (commits 3c7842d..57685db + fix cd8f3e6, review passed after fix by opus)
  - lib/ai-schemas.ts: 15+ zod schemas (reuse types.ts ConversationReview/WritingReview; listeningComprehension INCLUDES topic — drift fixed); poolTaskSchemas Record<PoolTaskType> tsc-exhaustive; zod v4 z.toJSONSchema() bridge (no extra dep). /api/review: schema→generateObject {object,usage,model}; no-schema→generateText (old behavior preserved). ai@7 usage is {inputTokens,outputTokens}; route maps legacy path→{promptTokens,completionTokens} (matches all 8 consumers — no cost zeroing) + schema path→{inputTokens,outputTokens}; returns real model id both paths.
  - Fix cd8f3e6: legacy path no maxOutputTokens cap (2048 risked truncating full-rewrite/article → restored old no-cap); schema path 4096; supportsStructuredOutputs=false (native json_schema verified staging+pro only, production unverified → degradation mode still validates SDK-side; flip true after prod smoke-test).
  - Verified (opus): tsc + eslint clean; usage mapping cross-checked vs SDK types + 8 consumers.
  - Minor (for B2): route only supports object-mode generateObject (shadowing top-level array / sentenceAnalysis string need output-mode or wrapper); two usage shapes coexist during migration; assessmentClozeGen acceptAlso optional vs required.

B1 Phase 2: pending (chat usage onFinish → client; cost-tracker durable cumulative totals independent of the 500-record trim).

B1 Phase 2: complete (commits 39d6070..4bbc611, review clean / approved)
  - chat route: toUIMessageStreamResponse({messageMetadata}) surfaces {usage:{inputTokens,outputTokens}, model:response.modelId} (modelId from finish-step part, totalUsage from finish); exports ChatMessageMetadata for B2; surfacing-only (client wiring is B2). cost-tracker: durable en-tutor-cost-totals cumulative store — recordCost updates both detail+totals; getCostSummary reads Total/byModule/byModel/today from totals (no shrink after 500-record trim); records from trimmed list; seeds from surviving records once (no double-count — reviewer traced fresh + legacy paths); clearCostHistory clears both keys; cron-not-counted comment.
  - Verified: tsc + eslint clean; reviewer confirmed ai@7 metadata API against compiled node_modules JS; no double-count / no shrinking total.
  - Minor: getCostSummary first-read setItem side-effect; isValidTotals shallow-checks; cross-tab race (pre-existing).

Next: B1 final whole-branch review (opus, 5ddfaf3..4bbc611).

B1 final whole-branch review (opus, 5ddfaf3..4bbc611): With fixes (mostly docs/CI, not B1 code). Clean B2 foundation: tsc green, B1 files eslint clean, 8 legacy consumers zero regression, degradation mode returns a validated object (verified vs node_modules), chat real model id verified. Implementer caught 2 plan-induced regressions (usage field names, legacy token cap) — senior judgment. No Critical.
3 Importants are ALL B2-SCOPE TRAPS (not B1 bugs — B1 merges as-is). >>> B2 CHECKLIST <<<
  [B2-1] schema path caps maxOutputTokens 4096 while legacy has no cap → big-output calls (reader article `content`, writing `polishedVersion`, long conversation review) TRUNCATE if migrated to schema path → incomplete JSON → 502. B2 must pass explicit maxOutputTokens for big-output calls.
  [B2-2] top-level array (listeningShadowingSchema) + string (readerSentenceAnalysisSchema) can't flow the object-mode route. B2: keep these on the text path (client parses) OR add output-mode to route; route.ts has no guard/comment — add one.
  [B2-3] response.modelId may carry a pin/version suffix not matching MODEL_PRICING keys → recordCost silently falls back to flash pricing (~12x under-count for pro). B2: smoke-test the real modelId string; normalize or adjust MODEL_PRICING keys; change the silent flash fallback to a warning.
  [B2-4] assessmentClozeGen.acceptAlso optional in schema but ClozeBlank.acceptAlso required + spread at assessment:252 → B2 must keep the `?? []` normalization when consuming data.object.
  Also: two coexisting usage shapes (legacy promptTokens vs schema inputTokens) — converge in B2. Schema path temperature defaults 0; creative pool generators need explicit temperature when migrated. B2 first task: real-network smoke-test /api/review(schema) + /api/chat to record the exact response.modelId (decides B2-3 pricing key AND whether lib/ai.ts can flip supportsStructuredOutputs:true).

B1: COMPLETE (code merges as-is). Code commits 3c7842d..4bbc611 (+ plan 5ddfaf3).
Branch hygiene next: clean 2 pre-existing eslint errors (reader wordFamily prefer-const, use-mobile setState-in-effect) for a green branch.

### B2 · consumer migration
B2 Phase 0: complete (commit 839b0a1, review clean / approved)
  - smoke-test (staging — .env.local has staging creds; production unverified): pro→"deepseek-v4-pro", flash→"deepseek-v4-flash" — both MATCH MODEL_PRICING keys (no normalization needed; B2-3 pricing-key concern resolved). Native json_schema confirmed on staging (adversarial enum probe) for both models. supportsStructuredOutputs stays false (production unverified → degradation mode). Unknown-model fallback now console.warn (not silent flash pricing).
  - Verified: tsc + eslint clean; no stray script / secret committed.

B2 Phase 1: pending (conversation review, reader/[id], writing/[id] → structured schema + real model/usage cost; big-output calls explicit maxOutputTokens; reader sentence-analysis stays text path).

B2 Phase 1: complete (commits dea1335..37788ba, review clean / approved)
  - conversation review → conversationReviewSchema (data.object; parseReviewResponse deleted; recordCost real model+inputTokens/outputTokens; maxOutputTokens 8192). reader → comprehension eval to readerComprehensionEvalSchema; sentence-analysis STAYS text path (string schema, [B2-2]); both recordCost real. writing → round1 writingRound1Schema + round2 writingReviewSchema (maxOutputTokens 8192); parse fns deleted; recordCost real.
  - Verified (reviewer cross-checked field-by-field vs ai-schemas + types): zero drift; no claude-sonnet-5/fence-strip; optional guards preserved; tsc clean; eslint 0 errors (1 pre-existing reader warning).
  - Note: redundant JSON-format text left in some system prompts (inert, out of scope).

B2 Phase 2: pending (translate, listening, assessment → structured schema + real cost; shadowing top-level array stays text path; assessment cloze keep acceptAlso ?? []).

B2 Phase 2: complete (commits f61a763..f78e27e, review clean / approved)
  - translate: gen (translateGenSchema, 3 modes same shape) + eval (translateEvalSchema); parses deleted; recordCost real (translate). listening: comprehension (listeningComprehensionSchema w/ topic) + prediction migrated; dictation live-gen stays text path (free-text single sentence; listeningDictationSchema is pool-only) + shadowing stays text path (top-level array — object-mode route can't route it) [B2-2]; recordCost real (listening). assessment: reading/cloze/writing-score/conversation-score schemas; cloze keeps acceptAlso ?? [] [B2-4]; parses deleted; recordCost real (assessment).
  - Verified (reviewer field-by-field vs deleted parsers + schemas + surrounding code): zero drift; no claude-sonnet-5/fence-strip (except intentional free-text paths); tsc + eslint clean.
  - Minor: checklist wording for dictation imprecise (code decision correct/evidenced).

B2 Phase 3: pending (task-pool-generate + cron → poolTaskSchemas [shared schema kills listening-comprehension topic drift]; reader/page article-gen → structured + backfill recordCost).

B2 Phase 3: complete (commits 9f89c2f..1909c1f + fix 8e3bbe2, review passed after fix)
  - pool-gen: 8 poolTaskSchemas via /api/review; creative types temperature 0.7; recordCost(pool) backfilled; reading-article maxOutputTokens 8192 (fix 8e3bbe2 — was inheriting 4096 → silent truncation of the daily pool). cron: generateObject with poolTaskSchemas (server passes zod directly); listening-comprehension now emits topic (DRIFT KILLED); CRON_SECRET auth + blob allowOverwrite preserved; comprehension prompt now mentions topic. reader-home: readerArticleGenSchema + maxOutputTokens 8192; recordCost(reader) backfilled (path had none).
  - Verified: tsc clean; eslint 0 new; no field drift; cron/live now share schemas.

Next: B2 final whole-branch review (opus, c30bca8..8e3bbe2).

B2 final whole-branch review (opus, c30bca8..8e3bbe2): Ready to merge Yes; sub-project B NOT complete (gap: live conversation cost still estimated).
B2 final fix: commit a141416 — conversation page consumes ChatMessageMetadata via useChat<UIMessage<ChatMessageMetadata>>, records real model+usage summed across turns (restored msgs lack metadata → graceful), char-estimate + hardcoded deepseek-v4-flash deleted. cron: temperature 0.7 for creative types + reading-article maxOutputTokens 8192 + catch console.warn. cost-tracker module comment lists pool/reader. tsc + eslint clean.

B2: COMPLETE. Code commits 839b0a1..a141416 (+ plan c30bca8).

##############################################################
SUB-PROJECT B (AI contract + cost): COMPLETE (B1 + B2).
  - /api/review structured output (generateObject + client-passed JSON schema); degradation mode (native verified on staging, prod-unverified → false).
  - Centralized zod schemas (lib/ai-schemas.ts); 8 consumers migrated off manual fence-strip; 3 free-text/array holdouts stay text-path (dictation/shadowing/sentence-analysis).
  - Real cost end-to-end: every recordCost uses server-returned real model+usage; conversation uses chat metadata (no more char-estimate/hardcode); pool+reader-home backfilled; cost-tracker durable cumulative totals.
  - listening-comprehension topic drift killed (shared schema).
Branch NOT merged/pushed (kept as-is per user: unified landing after all sub-projects).
Remaining: C (voice/whisper — STT cutover to /api/stt, TTS mutex loops, pronunciation), D (scoring/psychometrics/SRS scheduling). Each needs its own brainstorm/spec.
##############################################################

## Sub-project C — voice/whisper (spec committed, needs its own plans)
Spec: docs/superpowers/specs/2026-07-20-voice-whisper-design.md. Background: scratchpad/c-consumers.md.
Decision: Whisper-primary + SpeechRecognition-fallback; new lib/speech.ts (MediaRecorder→/api/stt, fallback). 4 TTS-mutex bugs (echo loop High, read-aloud bypass High, permission-denied loop Med, transcript overwrite Med-high). Pronunciation feedback exploratory (gated on 0g verbose_json/confidence smoke-test).
Files: app/conversation/[id]/page.tsx, app/listening/page.tsx (shadowing only — prediction is typed), lib/tts.ts, app/api/stt/route.ts, new lib/speech.ts.
Plans: C1 (STT infra: lib/speech.ts + tts.ts awaitable fallback + /api/stt hardening + whisper smoke-test) / C2 (conversation voice rebuild + 4 mutex fixes) / C3 (listening shadowing + feedback-or-defer).

### C1 · STT infra
Plan committed. base = (this commit). Phases: P1 = /api/stt hardening + whisper smoke-test + lib/speech.ts (record→transcribe→fallback); P2 = lib/tts.ts fallbackSpeak awaitable (echo-loop root fix). Then C2 = conversation voice rebuild (startVoiceRecording→recordAndTranscribe + 4 mutex fixes), C3 = listening shadowing cutover + pronunciation/content feedback (or defer per smoke-test).

C1 Phase 1: complete (commits 5bf3a69..a49714c + fix f98521c, review passed after fix)
  - /api/stt hardened: OG_API_KEY-missing → clear {error:"STT not configured"} before formData (kills "Bearer undefined"→502); 10MB size guard → 413; language param; optional verbose_json; faithful prompt preserved. lib/speech.ts: startRecording (getUserMedia+MediaRecorder) / stop (blob→/api/stt→{text,approximate:false}, on fail → fresh SpeechRecognition approximate:true, double-fail rejects) / cancel / isRecordingSupported; tracks stopped on ALL paths incl. setup-throw (fix f98521c) + recorder.onerror + error chaining. lib/tts fix is Phase 2.
  - WHISPER SMOKE-TEST (real, staging): faithful {text} works BUT whisper silently normalizes blatant non-words ("goed"→"go", "buyed"→"buy") despite the no-correction prompt — a REAL caveat for C's premise (more faithful than browser SpeechRecognition, but not perfectly; recast/review loop recovers most but not all inflection errors). verbose_json = YES (segment-level avg_logprob/no_speech_prob) but WORD-level confidence = NO (words null even with word granularity) → C3 pronunciation feedback can only be segment-coarse; likely defer to content-accuracy comparison.
  - Verified: tsc + eslint clean.

C1 Phase 2: complete (commits 5f3d08e + fix 7f89c39, task review passed; re-review of fix in flight)
  - lib/tts.ts: fallbackSpeak now returns Promise<void>, resolving on utterance.onend/onerror (was fire-and-forget → speak() resolved before fallback audio finished → conversation voice mode reopened mic mid-utterance = echo-loop root cause). New parseUtteranceRate maps Edge-TTS "-30%"/"+0%" strings → SpeechSynthesisUtterance.rate (0.1..10 clamp), so Slow now works on the fallback path too. Both speak() call sites (!res.ok branch + catch) now `await fallbackSpeak(text, rate)`.
  - Task review (sonnet), 3 rounds: SPEC ✅ throughout. Findings, all fixed:
    * R1 Important: awaited fallback could hang forever — Chromium documented bugs where cancel()/long utterances don't fire onend/onerror → speak() never resolves → conversation UI stuck "AI is speaking…" + mic never reopens (undoes this task's own goal). Fix 7f89c39: race a `settled`-guarded finish() against a timeout; clearTimeout on settle.
    * R1 Minor: sync throw in !res.ok branch re-entered outer catch → double fallback. Fix 7f89c39: utterance construction+speak() inside try/catch, catch → finish() (resolve not reject).
    * R2 FAIL: flat 60s cap ignored rate & was shorter than genuine playback of listening's 100-150 word passage at -30% (~86s) → timeout fired ~26s early = mid-speech mic reopen (the echo loop, narrower). Fix 41f84bb: hoist utteranceRate, timeout = min(180000, (5000+len*120)/utteranceRate).
    * R3: PASS on all points — worst case (900ch @0.7) ≈161s timeout vs ~86s playback (~75s margin); -40% clamps to 180s ceiling vs ~100s playback; short/absent-rate not pathological. QUALITY: approved.
  - Verified after each fix: tsc --noEmit clean; eslint lib/tts.ts clean. Final HEAD 41f84bb.

C1: COMPLETE. Code commits 5bf3a69..41f84bb (Phase 1 5bf3a69..a49714c + fix f98521c; Phase 2 5f3d08e + fixes 7f89c39, 41f84bb) on branch feat/data-correctness-foundation (+ spec 2026-07-20-voice-whisper, C1 plan).
  - DECISION: C's broad (whole-branch) review is DEFERRED to one pass after C3, covering C1+C2+C3 together. Rationale: C1 is pure infra (lib/speech.ts + /api/stt + tts.ts) with NO consumers yet — C2/C3 wire it into the conversation & listening pages. A C1-only broad review would just re-examine 3 already-task-reviewed files; the real cross-file integration risk lives in C2/C3 consuming this infra, so the broad review is most valuable once that integration exists. (Deviates from A/B's per-plan-final pattern, deliberately, for a small infra plan.)
Next: C2 — conversation page voice rebuild (startVoiceRecording → recordAndTranscribe; record→Transcribing→faithful transcript; 4 mutex fixes) + C3 — listening shadowing cutover + content-accuracy feedback (pronunciation degraded: whisper gives NO word-level confidence per C1 smoke-test).

### C2 · conversation voice rebuild + 4 mutex fixes
Plan committed a0b011e; opus plan-review → NEEDS REVISION (3 must-fix, all in error-SURFACING not the state machine): C1 voiceError only shown inside voiceMode branch (perm-denied + text-mode errors invisible); C2 startMicSession setVoiceError(null) at entry wipes stopAndSend's same-frame "try again" (React batch coalesce); I1 text→voice toggle overwrote sessionRef without cancel (leaked live mic). + M1 read-aloud overlap guard, M2 approximate not surfaced for text mode. Revised plan 648ac8f (voiceError/approximate moved OUTSIDE the voiceMode ternary; error cleared only at toggle-ON + faithful-send; toggle-ON cancels stale session; handleSpeak guards on isSpeakingRef/transcribing). base = 648ac8f.

C2 Task 1: complete (commit b546cec, review clean / SPEC ✅ QUALITY approved by opus)
  - conversation page voice-mode cutover: local SpeechRecognition types + getSpeechRecognition removed; isRecording/liveTranscript/recognitionRef + startVoiceRecording/handleVoiceSend/handleVoiceClear removed. New micStatus:"idle"|"recording"|"transcribing" + sessionRef + voiceError + lastApproximate. startMicSession/stopAndSend/cancelMic per plan; speakAndResumeListening awaits speak() (C1 awaitable) then startMicSession; toggleVoiceMode ON cancels stale session + clears error + preserves [Start the conversation]; unmount + handleEndAndReview teardown updated; voice UI micStatus-driven (Stop&Send/Cancel/Transcribing), interim preview removed; voiceError/lastApproximate rendered OUTSIDE the voiceMode ternary.
  - mutex bugs 1/3/4 fixed here (echo: await speak + isSpeakingRef guard; perm-denied: startRecording throws, no retry loop; overwrite: one-record-one-transcribe, no continuous restart). bug 2 (read-aloud) is Task 2.
  - COMPILE-BRIDGE (controller-approved): handleToggleVoiceInput + text-mode mic button left disabled/no-op (references deleted getSpeechRecognition/recognitionRef/setIsRecording) — Task 2 restores full function via whisper. Documented in task-1-report.md.
  - Verified: tsc --noEmit 0 (repo-wide); eslint file 0. Reviewer independently re-ran both = 0.
  - 2 Minor (both brief-dictated literal code, non-blocking, TO FOLD INTO TASK 2): (M-a) voiceError/lastApproximate banner can linger in text mode — clear setLastApproximate(false)/setVoiceError(null) when leaving the voice flow (toggle both branches + handleSend). (M-b) hardcoded text-red-500/text-amber-600 → use theme token text-destructive (+ an amber equivalent) for dark-mode contrast/consistency.
C2 Task 2: complete (commit 4bd0736 + race fix 6f403a4, task review passed after fix; re-review of fix in flight)
  - bug 2 read-aloud mutex: handleSpeak in voice mode cancels live session + sets micStatus idle, guards on isSpeakingRef/transcribing (no overlap), plays via speakAndResumeListening (mutex), resumes after. UI call site void-wrapped.
  - text-mode mic → whisper: handleToggleVoiceInput replaced Task-1 no-op stub with record→stop→transcribe→APPEND to input (editable, not auto-sent); permission-denied clear error no retry; button re-enabled, micStatus-driven.
  - Folded Task-1 minors: M-a stale banner cleared at toggle ON/OFF + handleSend + text-mic success (implementer correctly clears BEFORE session.stop() so the real per-attempt approximate value still surfaces); M-b text-red-500→text-destructive, text-amber-600→text-muted-foreground.
  - Task review (opus): SPEC ✅. QUALITY changes-needed → 1 Important race: handleToggleVoiceInput finally used unguarded setMicStatus("idle") (stomps a voice-mode session started mid-upload → stranded live mic, no UI to stop). Fix 6f403a4: guarded finally setMicStatus(s=>s==="transcribing"?"idle":s), mirrors stopAndSend. (+ 1 Minor: hardcoded pulse bg color, consistent w/ existing, no action.)
  - Verified after fix: tsc --noEmit 0; eslint file 0.
  - Fix re-review (opus) PASS: race closed (guard preserves session B "recording"); normal path still ends idle; no new wedged state. SPEC ✅ QUALITY approved. Residual benign cosmetic bleed only.

C2: COMPLETE. Code commits b546cec..6f403a4 on branch feat/data-correctness-foundation (+ plan a0b011e, revision 648ac8f). Conversation page fully on whisper (voice mode + text-mode mic); 4 mutex bugs fixed (echo/read-aloud/perm-loop/overwrite). C's broad whole-branch review still deferred to after C3.
Next: C3 — listening shadowing STT cutover (startListening one-shot SpeechRecognition → whisper recordAndTranscribe) + content-accuracy feedback honesty (diffWords already compares transcript vs target; make naming honest + surface approximate). NOTE: shadowing record() already does content-accuracy via diffWords — C3's main value is the faithful-transcript cutover + honest labeling; NO word-level pronunciation scoring (whisper gives no word confidence per C1 smoke-test).

### C3 · listening shadowing cutover + honest word-match feedback
Plan committed a69def9; opus plan-review → NEEDS REVISION (2 must-fix): unescaped apostrophe in not-supported copy would break react/no-unescaped-entities eslint gate; missing unmount cleanup leaked mic on tab-switch/nav (Base UI Tabs.Panel unmounts hidden panels). + folded Minor: gate Next Sentence on recStatus (else advancing mid-record leaks mic). Revised plan 5a6c504. base = 5a6c504. Single task, one file (app/listening/page.tsx), shadowing tab only.

C3 Task 1: complete (commit a2ec428 + fix c49b9ac, task review passed after fix; re-review of fix in flight)
  - Deleted top-of-file one-shot SpeechRecognition setup (SR interfaces+type, getSpeechRecognitionConstructor, startListening ~62-102); stripFences KEPT (dictation uses it). Imported startRecording/isRecordingSupported/RecordingSession; added Square to lucide import.
  - ShadowingTab: isRecording → recStatus:"idle"|"recording"|"transcribing" + sessionRef + approximate; speechSupported via isRecordingSupported(); startAttempt/stopAttempt (record→stop→transcribe→diffWords, guarded finally); unmount cleanup cancels sessionRef; button 3-state toggle (Record/Stop&Check/Transcribing); Next Sentence gated on recStatus.
  - Honesty (spec §5): Badge "{accuracy}% word match" (not "accuracy"); "Word match against the target — not a pronunciation score." line; approximate caveat inside result card. diffWords/saveListeningExercise("shadowing")/streak/stat unchanged. NO word-level pronunciation scoring (whisper has none).
  - Task review (opus): SPEC ✅. QUALITY changes-needed → 1 Important (double-start re-entry: startAttempt set no sync state before await startRecording() → double-click spawns 2nd MediaRecorder, orphans 1st = unstoppable live mic; originated in plan's prescribed code) + 1 Minor (DB-write failure surfaced misleading "couldn't reach transcription" while result shown). Fix c49b9ac: startingRef sync re-entry guard (set before await, reset in finally, early-return if starting||recStatus!==idle); DB writes wrapped in own try/catch (swallow, result stands).
  - Verified after fix: tsc --noEmit 0; eslint file 0.
  - Fix re-review (opus) PASS: (1) double-click within await window blocked by startingRef; (2) retry after permission-denied works (ref reset in finally); (3) success routes to stopAttempt, no stuck ref; (4) DB-write failure keeps result, no false transcription error, converges idle. SPEC ✅ QUALITY approved.
  - OPEN ITEM for C broad review (pre-existing, spans C2+C3): unmount DURING `await startRecording()` → cleanup runs while sessionRef still null → resolved session assigned to dead ref, never cancelled = narrow mic leak. Same pattern in C2 startMicSession + C3 startAttempt. Evaluate holistically in broad review; fix across both if confirmed.

C3: COMPLETE. Code commits a2ec428..c49b9ac on branch feat/data-correctness-foundation (+ plan a69def9, revision 5a6c504). listening shadowing on whisper faithful transcript + honest "word match, not pronunciation" labeling + approximate caveat; mic-leak guards (unmount cleanup, double-start guard, Next-Sentence gating).

##############################################################
SUB-PROJECT C (voice/whisper): all plans (C1+C2+C3) COMPLETE. Pending: C broad whole-branch review (C1+C2+C3 integrated), deferred here per decision. Base for C broad review = 0b59902 (last commit before C1 code 5bf3a69) → HEAD c49b9ac.
Remaining after C: D (scoring/psychometrics/SRS — needs own brainstorm/spec). Branch still NOT merged/pushed (unified landing after all sub-projects).
##############################################################
