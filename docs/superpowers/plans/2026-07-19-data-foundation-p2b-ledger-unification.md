# 数据地基 P2b · 账本页面侧统一 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让听力/翻译的完成度只用 IndexedDB 单一账本（`DailyStats.listeningCount/translationCount` + 明细表），删除并行的 localStorage 聚合，消费方（dashboard、roadmap）改从 Dexie 读，消除双账本漂移。

**Architecture:** 写入侧：listening/translate 完成时调 `dbHelpers.incrementTodayStat("listeningCount"|"translationCount")`（准确率/分数明细继续由现有 `db.listeningExercises`/`db.translationExercises` 写入，保留）；删除 `recordListeningExercise`/`recordTranslation` 及两个 localStorage key。读取侧：dashboard 用新的 `useListeningExercises`/`useTranslationExercises` live-query 取"最近一次日期"（与现有 reading/writing 的取法一致）；roadmap 用新的 `dbHelpers.getListeningAggregate(mode?)` 取听写准确率。

**Tech Stack:** Next.js 16、React 19、TypeScript strict、Dexie（含 dexie-react-hooks）。

## Global Constraints

- TS strict：模块边界显式类型，局部推断。
- 纯本地架构；数据在 IndexedDB + localStorage。
- 代码注释英文。
- 无测试框架：验证 = `npx tsc --noEmit`（零错误）+ `npx eslint <touched files>`（不新增错误）+ 明确手动核对/推理。不起 dev server。
- `const` 箭头函数组件。
- Git：每 task 末尾提交；commit message 末尾附：
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SDA8JvMdjpqLaxXC7gLC9M
  ```

## 本 plan 在子项目 A 中的位置

子项目 A 的 P2 拆为 P2a/P2b/P2c；本文件是 **P2b**。前置 P1（DailyStats 扩列 + 明细表）已落地，P2a（词表/lemma）已完成。P2b 与 P2a 无耦合，可独立执行。P2c（等级字段切换、assessment/history 切表、CEFR 阈值、写回确认）在其后。

**背景速查文件（implementer 必读）**：`/private/tmp/claude-501/-Users-minghao-en-tutorial/3f2a9528-2794-4b9e-a120-c51eeb2a51c7/scratchpad/p2b-consumers.md` — 记录了每个消费点的当前代码与精确改动点（每个 recordListeningExercise 调用点的 mode/accuracy、dashboard 读 localStorage 的位置、roadmap 的 readListeningStats 等）。

## 关键设计决策

- **删 localStorage 聚合**：`en-tutor-listening-stats` / `en-tutor-translation-stats` 无独有数据（准确率/分数明细已在 Dexie 表），全部改为从 Dexie 派生。grep 确认仅下列 4 文件读写这两个 key，同一改动内全部更新即安全。
- **roadmap "Dictation accuracy" 修正**：现状是对全部 4 种 listening mode 的 accuracy 求平均（标签"Dictation"名不副实）。P2b 改为**只对 `mode==="dictation"` 求平均**，使标签名副其实（这是发散阶段列出的"跨 mode 混平均"问题的修复）。
- **lastListening/lastTranslation**：dashboard 已用 `useReadingSessions(1)[0]?.createdAt` 之类取"最近一次日期"，listening/translation 照此模式用新 hook，不引入 localStorage 的 lastDate。
- **stale 注释清理**：`app/page.tsx` 与 `app/roadmap/page.tsx` 中声称"listening/translation 未存 IndexedDB"的注释早已过时（schema v2 起明细表就存了），随代码一并删除。

## File Structure

- `lib/db-helpers.ts`（改）：新增 `getListeningAggregate(mode?)`。
- `hooks/use-db.ts`（改）：新增 `useListeningExercises`/`useTranslationExercises`。
- `app/listening/page.tsx`（改）：4 处完成点改用 `incrementTodayStat("listeningCount")`；删 `recordListeningExercise` 与 localStorage key。
- `app/translate/page.tsx`（改）：完成点改用 `incrementTodayStat("translationCount")`；删 `recordTranslation` 与 localStorage key。
- `app/page.tsx`（改）：dashboard lastListening/lastTranslation 用新 hook；删两个 localStorage 常量/读取/stale 注释。
- `app/roadmap/page.tsx`（改）：听写准确率用 `getListeningAggregate("dictation")`（经 useLiveQuery）；删 `readListeningStats` 与 localStorage 常量/stale 注释。

---

## Phase 1 — 写入侧统一 + 新增读取 helper（4 文件）

### Task 1: db-helpers 新增 `getListeningAggregate`；hooks 新增两个 live-query

**Files:**
- Modify: `lib/db-helpers.ts`
- Modify: `hooks/use-db.ts`

**Interfaces:**
- Produces:
  - `dbHelpers.getListeningAggregate(mode?: ListeningExercise["mode"]): Promise<{ count: number; avgAccuracy: number }>`
  - `useListeningExercises(limit?: number): ListeningExercise[]`
  - `useTranslationExercises(limit?: number): TranslationExercise[]`

- [ ] **Step 1: db-helpers.getListeningAggregate**

在 `lib/db-helpers.ts` 的 import 里补 `ListeningExercise`（若未导入，并入现有 `import type { ... } from "./types"`）。在 `dbHelpers` 对象内新增：

```ts
  async getListeningAggregate(
    mode?: ListeningExercise["mode"]
  ): Promise<{ count: number; avgAccuracy: number }> {
    const rows = mode
      ? await db.listeningExercises.where("mode").equals(mode).toArray()
      : await db.listeningExercises.toArray();
    if (rows.length === 0) return { count: 0, avgAccuracy: 0 };
    const sum = rows.reduce((s, e) => s + e.accuracy, 0);
    return { count: rows.length, avgAccuracy: Math.round(sum / rows.length) };
  },
```

- [ ] **Step 2: hooks**

在 `hooks/use-db.ts` 的类型 import 里补 `ListeningExercise`、`TranslationExercise`。仿照现有 `useReadingSessions`/`useWritingSessions` 新增：

```ts
export const useListeningExercises = (limit: number = 20): ListeningExercise[] => {
  return (
    useLiveQuery(
      () =>
        db.listeningExercises
          .orderBy("createdAt")
          .reverse()
          .limit(limit)
          .toArray(),
      [limit]
    ) ?? []
  );
};

export const useTranslationExercises = (
  limit: number = 20
): TranslationExercise[] => {
  return (
    useLiveQuery(
      () =>
        db.translationExercises
          .orderBy("createdAt")
          .reverse()
          .limit(limit)
          .toArray(),
      [limit]
    ) ?? []
  );
};
```

- [ ] **Step 3: 验证**

Run: `npx tsc --noEmit` → 无错误。`npx eslint lib/db-helpers.ts hooks/use-db.ts` → 无新错误。
手动核对（推理）：`getListeningAggregate("dictation")` 对空表返回 `{count:0,avgAccuracy:0}`；非空返回四舍五入平均。

- [ ] **Step 4: Commit**

```bash
git add lib/db-helpers.ts hooks/use-db.ts
git commit -m "feat(lib): listening aggregate helper + listening/translation live-query hooks"
```

### Task 2: listening 完成点改用 incrementTodayStat

**Files:**
- Modify: `app/listening/page.tsx`

**Interfaces:**
- Consumes: `dbHelpers.incrementTodayStat` (existing).

- [ ] **Step 1: 删除 localStorage 聚合写入**

删除 `LISTENING_STATS_KEY` 常量（~39）与 `recordListeningExercise` 函数（~41-70，写 localStorage 聚合的整个函数）。保留写明细表的 `saveListeningExercise`（写 `db.listeningExercises`）。若 `dbHelpers` 未导入本文件，补 `import { dbHelpers } from "@/lib/db-helpers";`（确认现有 import；文件已用 `updateStreak` 等，多半已导入）。

- [ ] **Step 2: 4 个完成点改为计数**

把每个 `recordListeningExercise(<x>)` 调用（约 297、562、817、1107 —— 见 p2b-consumers.md 的确切行与各自 mode）替换为：

```ts
await dbHelpers.incrementTodayStat("listeningCount");
```

（准确率仍随该完成点已有的 `saveListeningExercise({ ...accuracy... })` 进入明细表，不丢失。确保这些完成点原本的 `saveListeningExercise` 与 `dbHelpers.updateStreak()` 调用保持不变。若某完成点在非 async 上下文，用 `void dbHelpers.incrementTodayStat("listeningCount")` 或将其纳入已有的 async 流程——参照该函数现状，遵循其现有 await 风格。）

- [ ] **Step 3: 验证**

Run: `npx tsc --noEmit` → 无错误。`npx eslint app/listening/page.tsx` → 无新错误。grep 确认本文件已无 `en-tutor-listening-stats` / `recordListeningExercise` 残留。

- [ ] **Step 4: Commit**

```bash
git add app/listening/page.tsx
git commit -m "refactor(listening): count completions via DailyStats, drop localStorage aggregate"
```

### Task 3: translate 完成点改用 incrementTodayStat

**Files:**
- Modify: `app/translate/page.tsx`

- [ ] **Step 1: 删除 localStorage 聚合写入**

删除 `TRANSLATION_STATS_KEY` 常量（~104）与 `recordTranslation` 函数（~106-119）。保留写 `db.translationExercises` 明细。确认/补 `import { dbHelpers } from "@/lib/db-helpers";`。

- [ ] **Step 2: 完成点改为计数**

把 `recordTranslation()` 调用（~498）替换为：

```ts
await dbHelpers.incrementTodayStat("translationCount");
```

保持该完成点原有的明细写入与 `updateStreak()` 不变，遵循其现有 await 风格。

- [ ] **Step 3: 验证**

Run: `npx tsc --noEmit` → 无错误。`npx eslint app/translate/page.tsx` → 无新错误。grep 确认无 `en-tutor-translation-stats` / `recordTranslation` 残留。

- [ ] **Step 4: Commit**

```bash
git add app/translate/page.tsx
git commit -m "refactor(translate): count completions via DailyStats, drop localStorage aggregate"
```

---

## Phase 2 — 消费侧改读 Dexie（2 文件）

### Task 4: dashboard lastListening/lastTranslation 用 hook

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `useListeningExercises`, `useTranslationExercises` (Task 1).

- [ ] **Step 1: 用 hook 取最近日期**

在组件内加：

```tsx
const recentListening = useListeningExercises(1);
const recentTranslation = useTranslationExercises(1);
```

（放在其它 `use*` hooks 附近。）用 `recentListening[0]?.createdAt ?? null` 作为 `lastListening`、`recentTranslation[0]?.createdAt ?? null` 作为 `lastTranslation`，传入 `generateStudyPlan`（替换当前从 localStorage 解析 lastDate 的逻辑，见 p2b-consumers.md 中 ~423-450 的现状）。

- [ ] **Step 2: 删除 localStorage 读取与常量/注释**

删除 `LISTENING_STATS_KEY`/`TRANSLATION_STATS_KEY` 常量（~81-82）、读取这两个 key 的代码块（~423-450）、以及 ~78-79 声称"listening/translation 未存 IndexedDB"的过时注释。确保 `generateStudyPlan` 的 `lastListening`/`lastTranslation` 参数改由 Step 1 的值提供。

- [ ] **Step 3: 验证**

Run: `npx tsc --noEmit` → 无错误。`npx eslint app/page.tsx` → 无新错误。grep 本文件确认无 `en-tutor-listening-stats`/`en-tutor-translation-stats` 残留。手动核对（推理）：做过听力后 `recentListening[0].createdAt` 为今天 → study-engine 视听力为"今天做过"。

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "refactor(dashboard): derive last listening/translation dates from Dexie"
```

### Task 5: roadmap 听写准确率用 getListeningAggregate("dictation")

**Files:**
- Modify: `app/roadmap/page.tsx`

**Interfaces:**
- Consumes: `dbHelpers.getListeningAggregate` (Task 1).

- [ ] **Step 1: 用 useLiveQuery 取听写聚合**

删除 `LISTENING_STATS_KEY` 常量（~39）与 `readListeningStats` 函数（~63-76）。在组件内用现有的响应式方式取聚合。若文件已用 `useLiveQuery`（dexie-react-hooks），加：

```tsx
const dictation = useLiveQuery(
  () => dbHelpers.getListeningAggregate("dictation"),
  []
) ?? { count: 0, avgAccuracy: 0 };
```

（确认 `import { dbHelpers } from "@/lib/db-helpers";` 与 `useLiveQuery` 已导入；若未用 useLiveQuery，参照文件现有数据读取模式引入。）

- [ ] **Step 2: 替换听写准确率用法**

把 ~302/309 处原先基于 `readListeningStats()` 的听写准确率（此前是全 mode 混平均）改为 `dictation.avgAccuracy`（现在只统计 `mode==="dictation"`，与 "Dictation accuracy" 标签一致）。若阶段还用到 listening 次数，用 `dictation.count` 或另取全量 `getListeningAggregate()` 的 count——按该阶段 requirement 的语义选择（见 p2b-consumers.md 的现状说明），并在 report 中说明所选口径。

- [ ] **Step 3: 删除 stale 注释**

删除 ~25-27 声称"listening/translation 未存 IndexedDB"的过时注释。

- [ ] **Step 4: 验证**

Run: `npx tsc --noEmit` → 无错误。`npx eslint app/roadmap/page.tsx` → 无新错误。grep 确认无 `en-tutor-listening-stats`/`readListeningStats` 残留。手动核对（推理）：只有 dictation 记录参与 "Dictation accuracy" 阈值判定。

- [ ] **Step 5: Commit**

```bash
git add app/roadmap/page.tsx
git commit -m "refactor(roadmap): dictation accuracy from Dexie, filtered to dictation mode"
```

---

## Self-Review（已执行）

- **Spec 覆盖（P2b 部分）**：spec 的"账本统一：所有完成度只写 IndexedDB，删 localStorage 聚合，聚合实时从 Dexie 派生"——Task 2/3（写入侧）、Task 4/5（读取侧）、Task 1（新 helper/hook）。DailyStats 的 `listeningCount`/`translationCount` 由 P1 已加，本 plan 只填写入方。
- **占位符扫描**：新 helper/hook 给完整代码；页面消费点给明确改动 + 引用 p2b-consumers.md 的精确现状（避免逐行贴大文件），每处附验收与 grep 残留检查——非占位。
- **类型一致性**：`getListeningAggregate(mode?)` 用 `ListeningExercise["mode"]`，与 types.ts 一致；hooks 返回 `ListeningExercise[]`/`TranslationExercise[]`，与现有 hook 风格一致；`incrementTodayStat("listeningCount"|"translationCount")` 的 field 名与 P1 加的 DailyStats 列一致。
- **行为变更（有意）**：roadmap "Dictation accuracy" 从全 mode 混平均改为 dictation-only —— 修正误标，已在"关键设计决策"记录，供最终 review 知晓（非回归，是修复）。
- **风险**：删 localStorage 聚合后老用户历史听力/翻译"次数"不再计入（明细表有记录，但 DailyStats 的 listeningCount 仅从 P1 迁移时按明细回填过一次，之后靠 incrementTodayStat 累加）——迁移已在 P1 回填历史计数，故不丢历史；本 plan 只改今后的写入路径。
