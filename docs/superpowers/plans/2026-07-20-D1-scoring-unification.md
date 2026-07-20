# 子项目 D / D1 · 判分统一（0-100 + 集中 rubric + 对齐修复）— Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 统一全 app 评分量表为 0-100（存储/展示/聚合），集中 rubric（分档 label + prompt 校准锚 + 唯一归一入口），把 `diffWords` 位置索引改编辑距离对齐（消级联），按 mode 区分 listening 客观/主观聚合（零迁移），并就地 ×10 迁移既有 1-10 存量分数。

**Architecture:** 新 `lib/rubric.ts`（SCORE_BANDS/scoreLabel/normalizeTo100/rubricSnippet）+ 新 `lib/word-align.ts`（Needleman-Wunsch 词对齐）。各页把散落的 `*10`/自建 `scoreLabel` 换成集中实现；主观 AI 分在写入前经 `normalizeTo100`。`lib/db.ts` v5 迁移就地 ×10 三处存量分数。`getListeningAggregate` 用 `SUBJECTIVE_LISTENING_MODES` 分离。

**Tech Stack:** Next.js 16、React 19、TS strict、Dexie。

## Global Constraints

- TS strict；纯本地；注释英文。
- 无测试框架：`tsc --noEmit` + `eslint`（分支现 0 error，保持）+ 推理核对 + 关键算法（NW 对齐、迁移 ×10）手算样例。不起 dev server。
- Git：每 task 提交；用户已授权所有 git 操作。commit 末尾附：
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SDA8JvMdjpqLaxXC7gLC9M
  ```

## 位置 & 依赖

子项目 D 的第一个 plan（顺序 D1→D2→D3；D1 = DB v5）。spec: `docs/superpowers/specs/2026-07-20-scoring-assessment-srs-design.md`（§2、§5）。背景与精确 file:line: `scratchpad/d-subsystems.md`。D1 是 D3 合成的地基（normalizeTo100/rubric），且分数迁移须先落地。

**关键既有事实（迁移/接线依据）：**
- 1-10 主观分位置：`conversations[].review.scores.{fluency,accuracy,vocabulary,complexity}`（`lib/types.ts:41-47`，存于 `conversations` 表 review 字段）；`writingSessions[].review.score`（`lib/types.ts:116`）；`translationExercises[].score`（`lib/types.ts:172`）。
- **跳过**（已 0-100 或已 ×10）：`AssessmentResult.writingScore`/`clozeScore`/`readingScore`/`conversationScore`/`overallScore`（`app/assessment/page.tsx` 已 0-100）；`ListeningExercise.accuracy`（客观 mode 已 0-100；prediction 已 ×10 存 `:1186`）。
- `*10` 散落点：`app/assessment/page.tsx:684`（writing）、`:778-781`（conversation avg×10）、`app/listening/page.tsx:1186`（prediction）。
- `scoreLabel` 重复：`app/writing/[id]/page.tsx:125-130`、`app/translate/page.tsx:100-105`。
- `diffWords`：`app/listening/page.tsx:134-151`（位置索引）。
- `getListeningAggregate`：`lib/db-helpers.ts:201-210`。
- 展示 /10 点：`app/history/page.tsx:136,160,183`、`app/writing/[id]/page.tsx:608,688`、`app/translate/page.tsx:721`、`app/listening/page.tsx:1286`。
- db 迁移模式：`lib/db.ts` 现最高 v4（含 `.upgrade(async (tx)=>{...})`）。

## File Structure（分 3 phase）

- Phase 1：`lib/rubric.ts`（新）、`lib/word-align.ts`（新）。
- Phase 2：`lib/db.ts`（v5 迁移）、`lib/db-helpers.ts`（getListeningAggregate 分离）。
- Phase 3：消费页接线（conversation review / writing / translate / listening / assessment）。

---

## Phase 1 — 集中模块（2 新文件）

### Task 1: `lib/rubric.ts`

**Files:** Create `lib/rubric.ts`

- [ ] **Step 1: 写文件。**
  ```ts
  // Centralized 0-100 scoring scale. All scores in the app are 0-100 for
  // storage/display/aggregation. Subjective AI graders still return 1-10 (LLMs
  // calibrate better on a small integer scale); normalizeTo100 is the single
  // boundary that converts them. NEVER average a subjective (1-10 ×10) score
  // with an objective percentage as if equally precise (see D3 composite).

  export interface ScoreBand {
    min: number; // inclusive lower bound on the 0-100 scale
    label: string;
  }

  // Ordered high → low; scoreLabel picks the first band whose min is met.
  export const SCORE_BANDS: ScoreBand[] = [
    { min: 90, label: "Excellent" },
    { min: 75, label: "Good" },
    { min: 60, label: "Fair" },
    { min: 0, label: "Needs Work" },
  ];

  export const scoreLabel = (score0to100: number): string => {
    const band = SCORE_BANDS.find((b) => score0to100 >= b.min);
    return band ? band.label : "Needs Work";
  };

  // Single 1-10 → 0-100 normalizer (clamps out-of-range AI output).
  export const normalizeTo100 = (aiScore1to10: number): number =>
    Math.round(Math.max(0, Math.min(10, aiScore1to10)) * 10);

  // Shared anchored rubric language injected into subjective-scoring prompts so
  // every grader shares the same 1-10 band meaning + calibration anchors.
  export const rubricSnippet = (dimension: string): string =>
    `Rate ${dimension} on a 1-10 scale with these anchors: ` +
    `1-3 = frequent breakdowns that impede understanding; ` +
    `4-6 = message gets across but with clear L1 interference and recurring grammar/vocabulary errors; ` +
    `7-8 = generally accurate and natural with only occasional slips; ` +
    `9-10 = near-native precision, range, and fluency. ` +
    `Be calibrated and consistent across responses; do not inflate.`;
  ```
- [ ] **Step 2:** `tsc` + `eslint lib/rubric.ts` 清。手算核对：`normalizeTo100(7)=70`、`(10)=100`、`(0)=0`、`(12)=100`；`scoreLabel(70)="Fair"`、`(75)="Good"`、`(90)="Excellent"`、`(59)="Needs Work"`。Commit `feat(rubric): centralized 0-100 scale, label, normalizer, prompt anchors`.

### Task 2: `lib/word-align.ts`

**Files:** Create `lib/word-align.ts`

- [ ] **Step 1: 写文件（Needleman-Wunsch 词对齐；产出按目标词位的 entry，含替换的 heardAs 与遗漏的 null）。**
  ```ts
  // Word-level alignment for listening dictation/shadowing accuracy. Replaces
  // the old positional index comparison where a single dropped/inserted word
  // made every subsequent word count wrong. Needleman-Wunsch global alignment:
  // an omission/insertion only affects its local position, and substitutions
  // keep the user's word (heardAs) for display.

  export interface WordDiffEntry {
    word: string; // target word
    heardAs: string | null; // aligned user word (substitution shown), null if omitted
    correct: boolean;
  }

  export interface AlignResult {
    accuracy: number; // 0-100, correct target words / total target words
    original: WordDiffEntry[];
  }

  const normalizeWord = (w: string): string =>
    w.toLowerCase().replace(/[.,!?;:'"]/g, "");

  const tokenize = (text: string): string[] =>
    text.trim().split(/\s+/).filter(Boolean).map(normalizeWord).filter(Boolean);

  export const alignWords = (original: string, userText: string): AlignResult => {
    const a = tokenize(original); // target
    const b = tokenize(userText); // user
    const n = a.length;
    const m = b.length;
    const GAP = -1;
    const MATCH = 1;
    const MIS = -1;

    const dp: number[][] = Array.from({ length: n + 1 }, () =>
      new Array<number>(m + 1).fill(0)
    );
    for (let i = 1; i <= n; i++) dp[i][0] = i * GAP;
    for (let j = 1; j <= m; j++) dp[0][j] = j * GAP;
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const diag = dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? MATCH : MIS);
        dp[i][j] = Math.max(diag, dp[i - 1][j] + GAP, dp[i][j - 1] + GAP);
      }
    }

    const rev: WordDiffEntry[] = [];
    let i = n;
    let j = m;
    while (i > 0 || j > 0) {
      if (
        i > 0 &&
        j > 0 &&
        dp[i][j] === dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? MATCH : MIS)
      ) {
        rev.push({
          word: a[i - 1],
          heardAs: b[j - 1],
          correct: a[i - 1] === b[j - 1],
        });
        i--;
        j--;
      } else if (i > 0 && dp[i][j] === dp[i - 1][j] + GAP) {
        rev.push({ word: a[i - 1], heardAs: null, correct: false }); // omission
        i--;
      } else {
        j--; // insertion (extra user word) — no target entry
      }
    }

    const original2 = rev.reverse();
    const correctCount = original2.filter((e) => e.correct).length;
    const accuracy =
      a.length === 0 ? 0 : Math.round((correctCount / a.length) * 100);
    return { accuracy, original: original2 };
  };
  ```
- [ ] **Step 2:** `tsc` + `eslint lib/word-align.ts` 清。手算核对样例（写进 report）：
  - target "the cat sat on the mat" vs user "the cat sat on the mat" → accuracy 100，6 entries 全 correct。
  - 漏一词：user "the cat sat the mat"（漏 "on"）→ "on" 记 omission(heardAs null, incorrect)，其余 5 词仍 correct（**不级联**），accuracy round(5/6*100)=83（对比旧位置法会把 "on" 之后全判错 → ~50）。
  - 替换：user "the cat sat on the hat" → "mat" entry heardAs "hat" incorrect，其余 correct，accuracy 83。
- [ ] **Step 3:** Commit `feat(word-align): Needleman-Wunsch word alignment (kills cascade in listening accuracy)`.

---

## Phase 2 — 迁移 + 聚合分离（2 文件）

### Task 3: `lib/db.ts` v5 就地 ×10 迁移

**Files:** Modify `lib/db.ts`

- [ ] **Step 1: 加 v5。** 复制 v4 的 `.stores({...})`（schema 不变——无新表/索引），追加 `.upgrade`：
  ```ts
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
  ```
- [ ] **Step 2:** `tsc` + `eslint lib/db.ts` 清。推理核对：v5 stores 与 v4 逐字一致（仅数据迁移）；只 ×10 三处、跳过 assessments/listening；`clamp100` 确定性幂等（绑版本升级只跑一次）；null review 跳过。Commit `feat(db): v5 in-place migrate legacy 1-10 scores to 0-100`.

### Task 4: `getListeningAggregate` 客观 accuracy 分离（评审 I1）

**Files:** Modify `lib/db-helpers.ts`

- [ ] **Step 1:** 现状（`:201-210`）返回 `{count, avgAccuracy}`，无 mode filter 的默认口径**故意计所有 mode**，唯一 no-mode caller 是 `app/roadmap/page.tsx:205`（用 `listeningAll.count` 计"完成 20 次听力"，`:291`）；`listeningAll.avgAccuracy` 无消费者。因此**不能把 prediction 从 `count` 排除**（会静默回退 roadmap 计数）。仅从 `avgAccuracy` 的分子/分母排除主观：
  - 顶部加 `const SUBJECTIVE_LISTENING_MODES = new Set(["prediction"]);`。
  - `count` 仍 = 全部行；`avgAccuracy` 只对**客观 mode**（`!SUBJECTIVE_LISTENING_MODES.has(row.mode)`）的行求均值（无客观行时 avgAccuracy=0）。
  - 读 `:201-210` 实际形态后按其结构最小改（保持返回 shape `{count, avgAccuracy}` 不变）。
- [ ] **Step 2:** `tsc` + `eslint lib/db-helpers.ts` 清。推理核对：`count` 不变（prediction 仍计入，roadmap 计数不回退）；`avgAccuracy` 排除主观 prediction；返回 shape 不变。Commit `refactor(db-helpers): objective-only avgAccuracy (count unchanged)`.

---

## Phase 3 — 写入侧归一 + 同文件展示（5 文件）

> 通用：`import { scoreLabel, normalizeTo100, rubricSnippet } from "@/lib/rubric"`。**关键（评审 I2/I3/I4）**：主观 AI 分不仅在**写入 DB 前**经 `normalizeTo100`，**其从组件 state 直接展示的地方也要归一**（`evaluation.score`/`contentScore`/`review.score` 等 state 持有原始 1-10，只改写入不改展示会显示 "7/100"）。删本地重复 `scoreLabel`；AI schema 仍返回 1-10（**不改** `lib/ai-schemas.ts` min/max）——归一全在消费侧。展示单位统一 `/100`（或 `%`）。prompt 可加 `rubricSnippet`（不破坏 schema）。

### Task 5: writing detail 接线（`app/writing/[id]/page.tsx`）
- [ ] 删本地 `scoreLabel`（`:125-130`）→ 集中版。
- [ ] **round2**：`review.score`（1-10）在 `setReview`（`:412`）**和**存 DB 前都用 `normalizeTo100` 归一（in-session 展示与存储/恢复一致，评审 M4）。展示 `:686`（`{review.score}`）现即 0-100；`:688` `scoreLabel(review.score) · out of 10` → `· out of 100`。
- [ ] **round1 contentScore（评审 I3）**：`setRound1Review(data.object)`（`:336`）处把 `contentScore` 归一（`{...data.object, contentScore: normalizeTo100(data.object.contentScore)}`）；这样恢复占位 `:251`（`contentScore: existingSession.review.score`，迁移后已 0-100）与新算一致；展示 `:605/:608`（`{round1Review.contentScore}` `/ 10`）→ `/ 100`。
- [ ] round2 prompt 可加 `rubricSnippet("overall writing quality")`。`tsc`+`eslint`；Commit `refactor(writing): 0-100 scores (store+state+display) via central rubric`.

### Task 6: translate 接线（`app/translate/page.tsx`）
- [ ] 删本地 `scoreLabel`（`:100-105`）→ 集中版。
- [ ] **写入**：eval 分数存 `TranslationExercise.score`（`:450` 附近）前 `normalizeTo100`。
- [ ] **state 展示（评审 I4）**：`evaluation.score`（state，原始 1-10）在 `:719`（大数字）与 `:721`（`scoreLabel(evaluation.score) · out of 10`）处归一 → `{normalizeTo100(evaluation.score)}` + `scoreLabel(normalizeTo100(evaluation.score)) · out of 100`。
- [ ] **session 均值**：累加器（`:439` 用 `parsed.score`）改累加 `normalizeTo100(parsed.score)`；展示 `:546` `{averageScore}/10` → `/100`。
- [ ] eval prompt 可加 `rubricSnippet("translation accuracy and naturalness")`。`tsc`+`eslint`；Commit `refactor(translate): 0-100 scores (store+state+display)`.

### Task 7: conversation review 接线（`app/conversation/[id]/review/page.tsx`）
- [ ] 4 维分数（fluency/accuracy/vocabulary/complexity）拿到后各 `normalizeTo100` 再存入 `ConversationReview.scores`（写入即 0-100；同一归一对象也用于 in-session 渲染）。渲染（`:294-307`）4 个 tile `X/10` → `X/100`（可加 scoreLabel）。review prompt 各维可加 `rubricSnippet(<dim>)`。`tsc`+`eslint`；Commit `refactor(conversation-review): 0-100 dimension scores`.

### Task 8: listening 接线（diffWords→alignWords + prediction 归一，评审 I5）
**Files:** Modify `app/listening/page.tsx`
- [ ] **删除**本地 `normalizeWord`/`tokenize`（`:112-121`）、`interface WordDiffEntry`（`:123-127`）、`interface DiffResult`（`:129-132`）、`diffWords`（`:134-151`）——全部由 `lib/word-align` 取代（否则重复标识符 TS2300 + 未用 lint 错）。
- [ ] `import { alignWords, type AlignResult } from "@/lib/word-align"`（**不 import `WordDiffEntry`**——UI 从 `result.original` 推断，import 会成未用；评审 I5）。
- [ ] 两处 `useState<DiffResult | null>`（`:182`、`:752`）改 `useState<AlignResult | null>`；所有 `diffWords(...)` 调用改 `alignWords(...)`（dictation + shadowing）。返回 shape `{accuracy, original:[{word,heardAs,correct}]}` 与旧一致，结果 UI 无需改结构。
- [ ] **prediction（评审 I2）**：写入（`:1186`）`parsed.score * 10` → `normalizeTo100(parsed.score)`；**展示 state**：`evaluation.score`（原始 1-10）在 `:1286`（`{evaluation.score}/10`）→ `{normalizeTo100(evaluation.score)}/100`，且 badge 门槛 `:1285` `evaluation.score >= 7` → `normalizeTo100(evaluation.score) >= 70`。
- [ ] `tsc`+`eslint`；推理核对无悬空 diffWords/DiffResult/WordDiffEntry/tokenize/normalizeWord 引用（grep）。Commit `refactor(listening): word-align accuracy + 0-100 prediction (store+state)`.

### Task 9: assessment 主观 section 归一入口（`app/assessment/page.tsx`）
- [ ] writing（`:684`）`Math.round(score*10)` → `normalizeTo100(score)`；conversation（`:778-781`）`avg(...)*10` → `normalizeTo100(avg(...))`（avg 仍 1-10 再归一，**不重复 ×10**）。这些已是 0-100 语义，仅统一入口。**不动** D3 的 composite/合成（D3a）。`tsc`+`eslint`；Commit `refactor(assessment): central normalizeTo100 for subjective sections`.

---

## Phase 4 — 纯 reader 页（迁移后字段已 0-100，必须同步；评审 C1/C2/C3）

> 这些文件**只读**迁移后的字段。不改会显示 "70/10"、roadmap 门控恒真、profile 图表越界。

### Task 10: history 展示单位（`app/history/page.tsx`）
- [ ] `:136` `Fluency ${c.review.scores.fluency}/10` → `/100`；`:160` `Score ${w.review.score}/10` → `/100`；`:183` `Score ${t.score}/10` → `/100`。`tsc`+`eslint`；Commit `fix(history): display migrated scores as /100`.

### Task 11: roadmap 门控 + 单位（`app/roadmap/page.tsx`，评审 C2）
- [ ] 对话流畅度需求（`:234` 读 `c.review.scores.fluency` 的 avgFluency）：`target` 由 6 → **60**，`unit` `/10` → `/100`（否则 `70>=6` 恒真使 conversationDone 恒满足）。写作需求（`:276` 读 `s.review.score` 的 avgWritingScore）：`target` 6 → **60**，`unit` `/10` → `/100`。**读 `:230-246`、`:270-282` 实际 requirement 对象结构后精确改 target/unit/current 三者一致**（current 已是 0-100 均值，无需再乘）。`tsc`+`eslint`；推理核对门控在 0-100 下语义正确（60/100 ≈ 旧 6/10）。Commit `fix(roadmap): rescale conversation/writing gates to 0-100`.

### Task 12: profile 图表 + 能力阈值（`app/profile/page.tsx`，评审 C3-profile）
- [ ] `ScoreTrendChart`（`:127-173`）：`yFor` 的 `(score/10)` → `(score/100)`；Y 轴 gridlines `[0,2.5,5,7.5,10]` → `[0,25,50,75,100]`（或等比）。`scorePoints`（`:242-245`）源字段迁移后已 0-100，无需改取值、仅图表刻度改。`abilityStatements`（`:359` avgConversationScore、`:365` avgWritingScore）比较阈值 `>= 6` → `>= 60`。`tsc`+`eslint`；推理核对图表点落在新 0-100 轴内、能力语句阈值等价。Commit `fix(profile): rescale score-trend chart + ability thresholds to 0-100`.

### Task 13: writing list 页展示（`app/writing/page.tsx`，评审 M1）
- [ ] `:398` `Score: {session.review.score}`（迁移后裸 0-100）→ 统一为 `Score: {session.review.score}/100`（或 `{scoreLabel(session.review.score)}`），与全 app 一致。`tsc`+`eslint`；Commit `fix(writing-list): display score as /100`.

---

## Self-Review（已按评审修订）

- **覆盖**：spec §2/§5 全部；**并据 opus plan-review 补齐迁移波及的全部 reader**——写入侧归一（Phase 3，含 state 展示点 I2/I3/I4）+ 纯 reader 页（Phase 4：history C1 / roadmap 门控 C2 / profile 图表 C3 / writing-list M1）。grep 已确认迁移三字段的 reader 全集：conversation scores → history:136 / roadmap:234 / profile:242-245,359 / page.tsx:385(**relative，安全，不改**)；writing score → history:160 / writing-list:398 / writing-detail:251,686,688 / roadmap:276 / profile:365；translation score → history:183 / translate 展示。
- **getListeningAggregate（I1）**：`count` 保持全 mode（roadmap 计数不回退），仅 `avgAccuracy` 排除主观 prediction。
- **state 展示归一（I2/I3/I4）**：listening prediction、writing contentScore、translate evaluation.score 的 state 展示点与门槛均归一，杜绝 "7/100"。
- **listening 类型清理（I5）**：删 `:112-132`（tokenize/normalizeWord/WordDiffEntry/DiffResult），两处 `useState` 改 `AlignResult`，不 import 未用的 `WordDiffEntry`。
- **迁移安全**：v5 stores 逐字复制 v4；仅数据 ×10 三字段；确定性幂等一次性；null-review/缺字段跳过；跳过 assessments/listening.accuracy（NW 手算 100/83/83 已验证；migration ×10 clamp 已核）。
- **band 语义位移（评审 M3，如实记录）**：集中 `scoreLabel` 带（≥90/75/60）与旧本地带（≥9/7/5×10）不完全等价（旧 70=Good 现=Fair）——spec §2 有意统一，历史 label 会位移，可接受。
- **顺序**：Phase 1 模块 → Phase 2 迁移/聚合 → Phase 3 写入+同文件展示 → Phase 4 纯 reader。Phase 4 依赖 Phase 2 迁移语义（0-100），须在其后。各 task 独立可编译。
- **验证**：tsc+eslint + NW/迁移/门控手算；不起 dev server。
