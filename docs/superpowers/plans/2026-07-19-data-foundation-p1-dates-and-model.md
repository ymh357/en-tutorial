# 数据地基 P1 · 本地日期与数据模型 v4 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为子项目 A 打第一层纯 lib 地基：统一本地时区日期工具，并把数据模型升到 Dexie v4（DailyStats 扩列、新增 assessments 表、profile 的评估/难度字段分离、一次性迁移）。

**Architecture:** 只改 `lib/` 层，不动任何页面（页面消费放 P2/P3）。先落地 `lib/date.ts` 并让所有 lib 层日期用法改用它，消除本地/UTC 分裂；再用一个 Dexie `version(4).upgrade` 事务完成 schema 变更与老数据迁移。全部改动可用 `tsc` + 浏览器 devtools 验证，不引入运行期行为回退。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript strict、Dexie 4（IndexedDB）。

## Global Constraints

- Node/Next 16、React 19、TypeScript strict：模块边界显式类型，局部推断。
- 纯本地架构：无账号、无云端用户数据；所有数据在 IndexedDB + localStorage。
- 每个 phase 触及文件数 ≤ 5。
- 代码注释一律英文。
- 无测试框架：验证以 `npx tsc --noEmit` 零错误 + `npx eslint . --quiet`（若配置）+ 明确的手动核对用例 / 浏览器 devtools 迁移验证为准。
- React 组件用 `const` 箭头函数（本 plan 不涉及组件）。
- 日期一律用**本地时区**。
- Git：每个 task 末尾提交；提交前遵循用户 git 授权；commit message 末尾附：
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SDA8JvMdjpqLaxXC7gLC9M
  ```

## 本 plan 在子项目 A 中的位置

子项目 A（见 `docs/superpowers/specs/2026-07-19-data-correctness-foundation-design.md`）拆为三个 plan，本文件是 **P1**：
- **P1（本文件）**：`lib/date.ts` + 日期调用点统一；数据模型 v4（types/db/db-helpers、assessments 表、profile 字段分离、迁移）。
- P2：`lib/lemma.ts` + 词表；账本统一（听力/翻译入 dailyStats）；profile 字段分离的页面读取点切换；assessment/history 页改用 v4 的 assessments 表；两套 CEFR 阈值统一；测评写回改"需确认"。
- P3：导出/导入备份 + Danger Zone 加固；11 项 P0 bug 止血。

## File Structure

- `lib/date.ts`（新）：本地时区日期工具单一来源。职责：格式化/解析/周起点/日差。
- `lib/db-helpers.ts`（改）：删除内部 `formatDate`/`today`，改用 `lib/date`；扩列初始化；profile 新字段默认；新增 `saveAssessment`/`getAssessments`。
- `lib/task-pool.ts`（改）：删除内部 `formatDate`，改用 `lib/date`。
- `lib/task-pool-generate.ts`（改）：UTC 的 `toISOString().split` 改为本地 `today()`。
- `lib/study-engine.ts`（改）：`daysSince` 改用 `lib/date` 的 `daysBetween` + NaN 防御，保留 999 哨兵。
- `lib/types.ts`（改）：`DailyStats` 扩列、`LearningProfile` 字段分离、新增 `AssessmentResult`。
- `lib/db.ts`（改）：v4 `stores`（加 `assessments`）+ `upgrade` 迁移。

---

## Phase 1 — 本地时区日期工具（5 文件）

### Task 1: 创建 `lib/date.ts`

**Files:**
- Create: `lib/date.ts`

**Interfaces:**
- Produces:
  - `formatDate(d: Date): string` — 本地时区 `YYYY-MM-DD`
  - `today(): string`
  - `parseDate(s: string): Date` — 把 `YYYY-MM-DD` 当**本地**日期解析
  - `startOfWeek(d: Date): Date` — 周一为一周起点
  - `daysBetween(a: Date, b: Date): number` — 向下取整的整日差（b - a）

- [ ] **Step 1: 写 `lib/date.ts`**

```ts
// lib/date.ts
// Local-timezone date utilities. Single source for all "what day is it"
// logic, replacing four divergent copies across the app and removing the
// local/UTC split that made completions not register on the right day.

export const formatDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const today = (): string => formatDate(new Date());

// Parse "YYYY-MM-DD" as a LOCAL date. `new Date("YYYY-MM-DD")` parses as UTC,
// which is exactly the bug this utility removes.
export const parseDate = (s: string): Date => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};

// Week starts on Monday.
export const startOfWeek = (d: Date): Date => {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (date.getDay() + 6) % 7; // days since Monday
  date.setDate(date.getDate() - diff);
  return date;
};

// Whole-day difference (b - a), computed on local calendar days.
export const daysBetween = (a: Date, b: Date): number => {
  const msPerDay = 1000 * 60 * 60 * 24;
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db.getTime() - da.getTime()) / msPerDay);
};
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: 手动核对（devtools 或临时脚本）**

核对用例（本地时区）：
- `formatDate(new Date(2026, 0, 5))` → `"2026-01-05"`
- `parseDate("2026-01-05").getMonth()` → `0`（不是 UTC 偏移后的日期）
- `daysBetween(parseDate("2026-01-01"), parseDate("2026-01-08"))` → `7`
- `startOfWeek(new Date(2026, 0, 7 /* Wed */)).getDate()` → `5`（周一）

- [ ] **Step 4: Commit**

```bash
git add lib/date.ts
git commit -m "feat(lib): add local-timezone date utilities"
```

### Task 2: `lib/db-helpers.ts` 改用 `lib/date`

**Files:**
- Modify: `lib/db-helpers.ts`

**Interfaces:**
- Consumes: `formatDate`, `today` from Task 1.
- Produces: 行为不变的 `dbHelpers`（内部日期改走统一工具）。

- [ ] **Step 1: 删除内部日期函数，改为 import**

删除文件顶部的本地 `formatDate` 与 `today`（当前定义于文件开头）。在 import 区加入：

```ts
import { formatDate, today } from "./date";
```

其余对 `today()` / `formatDate(...)` 的调用保持不变（`getTodayStats`、`updateTodayStats`、`incrementTodayStat`、`getStatsRange` 用不到、`updateStreak` 里的 `yesterdayStr = formatDate(yesterday)` 均沿用新 import）。

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误（`today`/`formatDate` 现由 `./date` 提供）。

- [ ] **Step 3: 手动核对**

在 devtools 触发一次 `dbHelpers.getTodayStats()`，确认返回记录的 `id` 是本地当天 `YYYY-MM-DD`。

- [ ] **Step 4: Commit**

```bash
git add lib/db-helpers.ts
git commit -m "refactor(lib): db-helpers uses shared date utils"
```

### Task 3: `lib/task-pool.ts` 与 `lib/task-pool-generate.ts` 用本地日期

**Files:**
- Modify: `lib/task-pool.ts`
- Modify: `lib/task-pool-generate.ts`

**Interfaces:**
- Consumes: `today` from Task 1.

- [ ] **Step 1: `lib/task-pool.ts` 删除内部 `formatDate`，改 import**

删除文件顶部本地 `formatDate`；加入 `import { formatDate, today } from "./date";`。将 `getTodayTasks` 里的 `const today = formatDate(new Date());` 改为 `const todayStr = today();` 并把随后 `.below(today)` / `.equals(today)` 改用 `todayStr`（避免与函数名 `today` 冲突）。`assignTasks` 内 `formatDate(date)` 沿用新 import。

- [ ] **Step 2: `lib/task-pool-generate.ts` UTC → 本地**

把 `const today = new Date().toISOString().split("T")[0];` 改为：

```ts
import { today } from "./date";
// ...
const todayStr = today();
```

并将写入处 `assignedDate: today` 改为 `assignedDate: todayStr`。

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: 手动核对**

devtools 调 `getTodayTasks()`，确认按本地当天匹配；确认 `generatePoolTasks` 写入的 `assignedDate` 是本地当天而非 UTC 日期。

- [ ] **Step 5: Commit**

```bash
git add lib/task-pool.ts lib/task-pool-generate.ts
git commit -m "fix(lib): task pool uses local date instead of UTC"
```

### Task 4: `lib/study-engine.ts` 的 `daysSince` 加 NaN 防御

**Files:**
- Modify: `lib/study-engine.ts`

**Interfaces:**
- Consumes: `daysBetween` from Task 1.
- Produces: `daysSince(date): number` — 无效/缺失日期返回 `NEVER_DONE_GAP`（999），否则本地整日差。

- [ ] **Step 1: 替换 `daysSince` 实现**

在 import 区加入 `import { daysBetween } from "./date";`。把现有 `daysSince`（内部手算 `msPerDay` 的版本）整体替换为：

```ts
const daysSince = (date: Date | null | undefined): number => {
  if (!date) return NEVER_DONE_GAP;
  if (Number.isNaN(date.getTime())) return NEVER_DONE_GAP; // corrupt lastDate
  return Math.max(0, daysBetween(date, new Date()));
};
```

保留原有的 `NEVER_DONE_GAP = 999` 常量（`generateStudyPlan` 的 priority 计算依赖有限哨兵，不能改成 Infinity）。

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: 手动核对**

- 传入 `null` → 999。
- 传入 `new Date("bogus")`（Invalid Date）→ 999（不再是 `NaN` 导致的静默 false）。
- 传入昨天的 Date → 1。

- [ ] **Step 4: Commit**

```bash
git add lib/study-engine.ts
git commit -m "fix(lib): guard study-engine daysSince against invalid dates"
```

---

## Phase 2 — 数据模型 v4（3 文件）

### Task 5: `lib/types.ts` 类型变更

**Files:**
- Modify: `lib/types.ts`

**Interfaces:**
- Produces:
  - `DailyStats` 增加 `listeningCount: number`、`translationCount: number`
  - `LearningProfile` 增加 `assessedLevel: string`、`studyLevel: string`
  - 新增 `AssessmentResult`（带 `id`，供 Dexie 表使用）

- [ ] **Step 1: `DailyStats` 扩列**

在 `DailyStats` 接口中加入两字段（放在 `srsReviewed` 附近）：

```ts
  listeningCount: number;
  translationCount: number;
```

- [ ] **Step 2: `LearningProfile` 字段分离**

在 `LearningProfile` 接口中，`initialCefrLevel` 保留（历史留痕），新增：

```ts
  assessedLevel: string; // most recent assessed level, for display only
  studyLevel: string;    // difficulty used for generation/content, user-adjustable
```

- [ ] **Step 3: 新增 `AssessmentResult`**

在文件末尾追加（与 assessment 页面现有的同名 local interface 相比多一个 `id`，页面切换到该类型在 P2 处理）：

```ts
export interface AssessmentResult {
  id: string;
  date: string; // YYYY-MM-DD
  readingScore: number;
  clozeScore: number;
  writingScore: number;
  conversationScore: number;
  overallScore: number;
  levelBand: string;
}
```

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 会在 `lib/db-helpers.ts` 构造 `DailyStats` 的位置报"缺少 listeningCount/translationCount"，以及 `DEFAULT_PROFILE` 缺 `assessedLevel/studyLevel` — 这些在 Task 7 修复。**本步骤允许出现这些预期错误**；确认没有其它无关错误后进入下一步。

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts
git commit -m "feat(types): DailyStats columns, profile level split, AssessmentResult"
```

### Task 6: `lib/db.ts` 升级到 v4 + 迁移

**Files:**
- Modify: `lib/db.ts`

**Interfaces:**
- Consumes: `AssessmentResult` (Task 5), `formatDate` (Task 1).
- Produces: `db.assessments` 表；`version(4)` 迁移把明细回填到 `dailyStats` 计数、分离 profile 等级、搬 localStorage 测评入表。

- [ ] **Step 1: 表类型声明**

在 import 区加入 `AssessmentResult`（并入现有 `import type { ... } from "./types"`）与 `import { formatDate } from "./date";`。在数据库类型交叉里加入：

```ts
  assessments: EntityTable<AssessmentResult, "id">;
```

- [ ] **Step 2: 追加 v4 schema**

在现有 `db.version(3)...` 之后追加：

```ts
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
                date: a.date,
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
```

> 说明：老 `en-tutor-assessments` 值不在迁移中删除（留一个版本周期降风险，P2 让页面停止读它）。迁移只在 v3→v4 触发一次，重复打开应用不会重搬。

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: `db.ts` 无错误（`daily`/`profiles`/`table` 用 `tx.table(name)` 的宽松类型，`put` 接受上述对象）。仍可能残留 Task 5 引入的 `db-helpers` 错误，Task 7 修复。

- [ ] **Step 4: 迁移验证（浏览器）**

在一个含 v3 数据（有 listeningExercises / translationExercises / learningProfile / 旧 localStorage 测评）的库上加载应用触发升级，然后在 devtools：
- `await db.dailyStats.toArray()` — 对应日期有正确的 `listeningCount`/`translationCount`。
- `(await db.learningProfile.get("singleton"))` — `assessedLevel`/`studyLevel` = 原 `initialCefrLevel`。
- `await db.assessments.toArray()` — 条数等于旧 `en-tutor-assessments` 数组长度。
- 刷新再次加载不产生重复 assessments。

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts
git commit -m "feat(db): v4 schema + migration (counts, profile split, assessments table)"
```

### Task 7: `lib/db-helpers.ts` 补齐新字段与 assessments helper

**Files:**
- Modify: `lib/db-helpers.ts`

**Interfaces:**
- Consumes: `AssessmentResult` (Task 5), `db` (Task 6).
- Produces:
  - 所有空 `DailyStats` 构造含 `listeningCount: 0`、`translationCount: 0`
  - `DEFAULT_PROFILE` 含 `assessedLevel: ""`、`studyLevel: ""`
  - `initProfile(cefrLevel, knownWords)` 设 `assessedLevel = studyLevel = cefrLevel`
  - `saveAssessment(result: Omit<AssessmentResult, "id">): Promise<void>`
  - `getAssessments(): Promise<AssessmentResult[]>`（按 `date` 倒序）

- [ ] **Step 1: 空 DailyStats 补两列**

在三处构造空 `DailyStats` 的对象字面量（`getTodayStats` 的 `empty`、`updateTodayStats` 的 `put` 兜底、`incrementTodayStat` 的 `put` 兜底）各加入：

```ts
      listeningCount: 0,
      translationCount: 0,
```

- [ ] **Step 2: DEFAULT_PROFILE 与 profile helper**

`DEFAULT_PROFILE` 加入：

```ts
  assessedLevel: "",
  studyLevel: "",
```

`initProfile` 改为：

```ts
  async initProfile(cefrLevel: string, knownWords: string[]): Promise<void> {
    await db.learningProfile.put({
      ...DEFAULT_PROFILE,
      initialCefrLevel: cefrLevel,
      assessedLevel: cefrLevel,
      studyLevel: cefrLevel,
      knownWordsBase: knownWords,
    });
  },
```

`getProfile` 的兜底返回补上新字段（避免旧库未迁移时字段缺失）：

```ts
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
```

- [ ] **Step 3: 新增 assessments helper**

在 import 区把 `AssessmentResult` 并入 `import type { ... } from "./types"`。在 `dbHelpers` 对象内新增：

```ts
  async saveAssessment(result: Omit<AssessmentResult, "id">): Promise<void> {
    await db.assessments.add({ id: crypto.randomUUID(), ...result });
  },

  async getAssessments(): Promise<AssessmentResult[]> {
    const all = await db.assessments.toArray();
    return all.sort((a, b) => b.date.localeCompare(a.date));
  },
```

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误（Task 5 引入的报错此时全部消除）。

- [ ] **Step 5: Lint**

Run: `npx eslint . --quiet`
Expected: 无错误（若项目未配置 eslint，则记录"未配置"并跳过）。

- [ ] **Step 6: 手动核对**

devtools：`await dbHelpers.saveAssessment({date:"2026-07-19",readingScore:80,clozeScore:70,writingScore:75,conversationScore:72,overallScore:74,levelBand:"B1 (Upper)"})` 后 `await dbHelpers.getAssessments()` 返回含该条且倒序。

- [ ] **Step 7: Commit**

```bash
git add lib/db-helpers.ts
git commit -m "feat(lib): db-helpers new columns, profile defaults, assessment helpers"
```

---

## Self-Review（已执行）

- **Spec 覆盖（P1 应覆盖部分）**：`lib/date.ts` 与四处调用点统一（Task 1-4，spec §5.1）；DailyStats 扩列（Task 5/7，§4.1）；assessments 表（Task 5/6，§4.2）；profile 字段分离（Task 5/6/7，§4.3）；v4 迁移（Task 6，§4.5）。P1 不含的 §4.4 测评写回、§5.2 lemma/词表、§6 备份、§8 P0 —— 归 P2/P3，已在"本 plan 位置"注明。
- **占位符扫描**：无 TBD/TODO；每个代码步骤含完整代码。
- **类型一致性**：`AssessmentResult`（含 `id`）在 Task 5 定义，Task 6 表声明与迁移、Task 7 helper 一致；`saveAssessment` 参数为 `Omit<AssessmentResult,"id">`、内部补 `id`，与迁移里手动补 `id` 一致；`DailyStats` 两新列在 Task 5 定义并在 Task 6 迁移、Task 7 三处构造点补齐；`daysSince` 保留 `NEVER_DONE_GAP` 语义未改签名。
- **已知取舍**：Task 5 之后到 Task 7 之前 `tsc` 会有预期报错（新字段未在 db-helpers 补齐），已在 Task 5 Step 4 显式说明，Task 7 收口。
