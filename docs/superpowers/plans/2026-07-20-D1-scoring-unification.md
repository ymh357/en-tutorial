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

### Task 4: `getListeningAggregate` 客观/主观分离

**Files:** Modify `lib/db-helpers.ts`

- [ ] **Step 1:** 在文件顶部（helpers 处）加 `const SUBJECTIVE_LISTENING_MODES = new Set(["prediction"]);`。改 `getListeningAggregate`（`:201-210`）：默认聚合（无 mode filter 或"全部"口径）**只计客观 mode**（排除 `SUBJECTIVE_LISTENING_MODES`），使主观 prediction 连贯性分不再混入客观 accuracy 均值。若函数已按 mode 参数过滤，则仅在"跨 mode 汇总"分支排除主观。保持按具体 mode 查询时的行为不变。**读 `:201-210` 实际实现后按其形态最小改动**，并在 report 说明改了哪条汇总路径。
- [ ] **Step 2:** `tsc` + `eslint lib/db-helpers.ts` 清。推理核对：客观 dictation/comprehension/shadowing 仍计入；prediction 从跨 mode 均值排除；单 mode 查询不变。Commit `refactor(db-helpers): exclude subjective prediction from objective listening aggregate`.

---

## Phase 3 — 消费页接线（5 文件）

> 通用：`import { scoreLabel, normalizeTo100, rubricSnippet } from "@/lib/rubric"`。主观 AI 分在**写入 DB 前**经 `normalizeTo100`（写入即 0-100）；展示用集中 `scoreLabel`；删本地重复 `scoreLabel`；prompt 用 `rubricSnippet` 注入锚（可选但推荐，至少不破坏现有 schema）。**注意**：AI schema 仍返回 1-10（不改 `lib/ai-schemas.ts` 的 min/max）——归一在消费侧。

### Task 5: writing 接线
**Files:** Modify `app/writing/[id]/page.tsx`
- [ ] 删本地 `scoreLabel`（`:125-130`）→ import 集中版。round2 拿到 `review.score`（1-10）后 `normalizeTo100` 再存入 `WritingSession.review.score`（写入即 0-100）。展示点 `:608,688` 由 /10 改 /100（用 scoreLabel + 显示 `{score}/100` 或 `{score}%`，与全 app 一致）。round2 prompt 可加 `rubricSnippet("overall writing quality")`。`tsc`+`eslint`；Commit `refactor(writing): 0-100 score via central rubric`.

### Task 6: translate 接线
**Files:** Modify `app/translate/page.tsx`
- [ ] 删本地 `scoreLabel`（`:100-105`）→ 集中版。eval 分数 `normalizeTo100` 后存 `TranslationExercise.score`。展示 `:721` /10→/100。session 均值（组件 state）改按 0-100。eval prompt 可加 `rubricSnippet("translation accuracy and naturalness")`。`tsc`+`eslint`；Commit `refactor(translate): 0-100 score via central rubric`.

### Task 7: conversation review 接线
**Files:** Modify `app/conversation/[id]/review/page.tsx`
- [ ] 4 维分数（fluency/accuracy/vocabulary/complexity）拿到后各 `normalizeTo100` 再存入 `ConversationReview.scores`（写入即 0-100）。渲染（`:294-307`）4 个 tile 由 `X/10` 改 `X/100`（可加 scoreLabel）。review prompt 各维可加 `rubricSnippet(<dim>)`。`tsc`+`eslint`；Commit `refactor(conversation-review): 0-100 dimension scores`.

### Task 8: listening 接线（diffWords → alignWords；prediction 归一）
**Files:** Modify `app/listening/page.tsx`
- [ ] 删本地 `diffWords`（`:134-151`）→ `import { alignWords, type AlignResult, type WordDiffEntry } from "@/lib/word-align"`；所有 `diffWords(...)` 调用点改 `alignWords(...)`（dictation + shadowing；返回形状 `{accuracy, original:[{word,heardAs,correct}]}` 与原一致，UI 无需改结构）。prediction eval 分数（`:1186`）用 `normalizeTo100(parsed.score)` 取代 `parsed.score * 10`。展示 `:1286` 如涉 /10 改 /100。`tsc`+`eslint`；推理核对 alignWords 与旧 diffWords 返回形状兼容（`WordDiffEntry` 同字段）。Commit `refactor(listening): word-align accuracy + 0-100 prediction score`.

### Task 9: assessment 接线（×10 → normalizeTo100）
**Files:** Modify `app/assessment/page.tsx`
- [ ] writing 分（`:684`）`Math.round(score*10)` → `normalizeTo100(score)`；conversation（`:778-781`）`avg(...)*10` → `normalizeTo100(avg(...))`（avg 仍 1-10 再归一）。这些已是 0-100 语义，仅统一入口（**不重复 ×10**）。**不动** D3 的合成逻辑（那是 D3a）。`tsc`+`eslint`；Commit `refactor(assessment): use central normalizeTo100 for subjective sections`.

---

## Self-Review（已执行）

- **覆盖**：spec §2（0-100 统一、rubric.ts、word-align、listening 客观/主观分离）、§5（v5 就地 ×10 迁移含对话嵌套、跳过已 0-100/已 ×10、展示点 /10→/100）。level-signal 已按评审砍掉不在此。
- **占位符**：两新文件给完整代码 + 手算核对样例；迁移给完整 upgrade 代码；接线按精确 file:line + 明确变换（归一入口/删重复/展示单位）。`getListeningAggregate` 因需读实际实现，给"读后最小改 + report 说明"的明确约束（非占位——目标明确：跨 mode 汇总排除 prediction）。
- **类型一致**：`alignWords` 的 `WordDiffEntry` 与旧 `diffWords` 同字段（word/heardAs/correct），UI 结构不变；`normalizeTo100` 唯一 ×10 入口；schema 仍 1-10（不改 ai-schemas）。
- **迁移安全**：v5 stores 逐字复制 v4；仅数据 ×10；确定性幂等；绑版本一次性；null-review/缺字段跳过；不碰 assessments/listening.accuracy（避免双迁移）。
- **风险**：alignWords 改变历史 listening accuracy 可比性（新旧算法不同）——单用户可接受，已在 spec §M3 记录；旧存量分迁移后展示单位统一。
- **验证**：tsc+eslint + NW/迁移手算样例；不起 dev server。
- **顺序**：Phase 1（模块）→ Phase 2（迁移/聚合）→ Phase 3（接线）；Phase 3 各 task 独立可编译（同 import 集中模块）。
