# 数据地基 P2c · 等级字段切换 + 测评切表/阈值/写回确认 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让全站正确区分"出题难度"(`studyLevel`) 与"展示等级"(`assessedLevel`)；测评结果改存 Dexie `assessments` 表（history/roadmap 一并切换）；统一两套 CEFR 阈值为单一来源；测评定级改为"需用户确认才改出题难度"(decision A)。

**Architecture:** P1 已在 `LearningProfile` 建好 `studyLevel`/`assessedLevel`（`initialCefrLevel` 保留为 legacy）并提供 `dbHelpers.saveAssessment`/`getAssessments` + `assessments` 表。P2c 只做消费侧切换：generation 读 `studyLevel`，display 读 `assessedLevel`；assessment/history/roadmap 从 localStorage 测评改读 Dexie 表；阈值集中到一个源；`finishAssessment` 用现有 `components/ui/dialog.tsx` 做写回确认。

**Tech Stack:** Next.js 16、React 19、TypeScript strict、Dexie（dexie-react-hooks）。

## Global Constraints

- TS strict；纯本地；注释英文。
- 无测试框架：验证 = `npx tsc --noEmit`（零错误）+ `npx eslint <touched files>`（不新增错误）+ grep 残留 + 推理。不起 dev server。
- `const` 箭头函数组件。
- Git：每 task 末尾提交；commit message 末尾附：
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SDA8JvMdjpqLaxXC7gLC9M
  ```

## 本 plan 在子项目 A 中的位置

子项目 A 的 P2 拆 P2a/P2b/P2c；本文件是 **P2c**（最后一个 P2）。前置 P1（字段/表/helper）、P2a（词表）、P2b（账本）已完成。P2c 之后是 P3（备份/导入 + 11 项 P0 bug）。

**背景速查（implementer 必读）**：`/private/tmp/claude-501/-Users-minghao-en-tutorial/3f2a9528-2794-4b9e-a120-c51eeb2a51c7/scratchpad/p2c-consumers.md` — 每个 `initialCefrLevel` 读点的 generation/display 分类、assessment 的 save/load/finish/两套阈值现状、history/roadmap 的测评读取、dialog 组件位置。

## 字段分类（决定每个读点切到哪个字段）

- **generation → `studyLevel`**：`conversation/[id]/page.tsx:152` (system prompt)、`translate/page.tsx:~243`、`listening/page.tsx:~1237`、`assessment/page.tsx:444` (内容生成)、`page.tsx:~248` (池任务生成)、`settings/page.tsx` 等级 select（改的是 studyLevel）。
- **display → `assessedLevel`**（无测评时回退 `studyLevel`，再回退 `initialCefrLevel`）：`conversation/[id]/page.tsx:535` (badge)、`roadmap/page.tsx:~224` (展示串) 与 `:228` (foundation-done gate)、`page.tsx:~606` (dashboard 卡)、`profile/page.tsx:411` (概览卡)。

> `dbHelpers.getProfile()`（P1）已保证 `assessedLevel`/`studyLevel` 有回退值，读点直接用 `profile.studyLevel` / `profile.assessedLevel` 即可。

## 关键设计决策

- **阈值单一来源**：把 `levelBandForScore`（细档 30/45/55/65/75/85/95）与 `cefrFromScore`（粗档 45/65/85）统一——粗档从细档投影。在 assessment 文件内建一个 `CEFR_BANDS` 表，两个函数都从它派生；`roadmap` 的 `B2_ASSESSMENT_THRESHOLD=65` 改引用同一断点（若跨文件不便，至少加注释指明来源，避免三处魔数漂移）。
- **写回确认（decision A）**：`finishAssessment` 始终写 `assessedLevel`；当映射出的粗档 ≠ 当前 `studyLevel` 时，弹 `Dialog`（复用 `components/ui/dialog.tsx`，参照 settings 的 "Clear All Data?" 模式）询问"是否把学习难度更新为 X"，确认才写 `studyLevel`。
- **测评单一数据源**：assessment 写、history 读、roadmap 读全部走 `dbHelpers.saveAssessment`/`getAssessments`（Dexie）。删除 assessment 的 localStorage helpers 与 roadmap 的私有 `readAssessments()`。老 localStorage `en-tutor-assessments` 已由 P1 迁移进表，读侧不再碰它。

## File Structure（9 文件，分 3 phase）

- Phase 1（字段读点，5 文件）：`conversation/[id]/page.tsx`、`translate/page.tsx`、`listening/page.tsx`、`page.tsx`、`profile/page.tsx`。
- Phase 2（assessment 重构，1 文件）：`assessment/page.tsx`。
- Phase 3（收尾，3 文件）：`history/page.tsx`、`roadmap/page.tsx`、`settings/page.tsx`。

---

## Phase 1 — 字段读取点切换（5 文件）

> 每个改动都是把 `profile?.initialCefrLevel` 换成 `profile?.studyLevel`（generation）或 `profile?.assessedLevel`（display），保留原有的 `|| "B1"` / `?? ""` 回退。逐文件确认（见 p2c-consumers.md 的精确行与分类）。

### Task 1: 生成侧读点 → studyLevel（conversation, translate, listening）

**Files:** Modify `app/conversation/[id]/page.tsx`, `app/translate/page.tsx`, `app/listening/page.tsx`

- [ ] **Step 1:** `conversation/[id]/page.tsx`：`buildSystemPrompt` 的 `cefrLevel: profile?.initialCefrLevel ?? ""`（~152）改 `profile?.studyLevel ?? ""`，并更新其 useMemo 依赖（~154）为 `profile?.studyLevel`。`:535` 的 Badge 展示改 `profile?.assessedLevel`（display）——本 task 一并改（同文件）。
- [ ] **Step 2:** `translate/page.tsx`：`const cefrLevel = profile?.initialCefrLevel || "B1"`（~243）改 `profile?.studyLevel || "B1"`。
- [ ] **Step 3:** `listening/page.tsx`：`const cefrLevel = profile?.initialCefrLevel || "B1"`（~1237）改 `profile?.studyLevel || "B1"`。
- [ ] **Step 4:** `npx tsc --noEmit` 清；`npx eslint` 三文件不新增错误。
- [ ] **Step 5:** Commit `refactor(level): generation reads studyLevel (conversation/translate/listening)`

### Task 2: dashboard + profile 读点（page, profile）

**Files:** Modify `app/page.tsx`, `app/profile/page.tsx`

- [ ] **Step 1:** `page.tsx`：池任务生成用的 level（~248，generation）改 `profile.studyLevel`（保留 `|| "B1"`）；dashboard 展示卡（~606-608 / `CEFR_LABELS[profile.initialCefrLevel]`）改 `profile.assessedLevel`（display，回退 studyLevel）。
- [ ] **Step 2:** `profile/page.tsx`：概览卡（~411-412 `CEFR_LABELS[profile.initialCefrLevel]`）改 `profile.assessedLevel`（display）。
- [ ] **Step 3:** `npx tsc --noEmit` 清；eslint 两文件不新增错误。
- [ ] **Step 4:** Commit `refactor(level): dashboard/profile display reads assessedLevel, pool-gen reads studyLevel`

---

## Phase 2 — assessment 重构（1 文件）

### Task 3: assessment 切表 + 阈值统一 + 写回确认

**Files:** Modify `app/assessment/page.tsx`

**Interfaces consumed:** `AssessmentResult` from `@/lib/types`; `dbHelpers.saveAssessment`/`getAssessments`; `useLiveQuery`; `Dialog*` from `@/components/ui/dialog`.

- [ ] **Step 1: 切表读写**
  删除本地 `interface AssessmentResult`（~73-81）、`ASSESSMENTS_STORAGE_KEY`、`loadPreviousAssessments`（~261）、`saveAssessment`（~273）。改为：
  - `import type { AssessmentResult } from "@/lib/types";`
  - previous assessments 用 `const previousAssessments = useLiveQuery(() => dbHelpers.getAssessments(), []) ?? [];`（替换原 `useState(() => loadPreviousAssessments())`）。
  - 保存改为 `await dbHelpers.saveAssessment({ date, readingScore, clozeScore, writingScore, conversationScore, overallScore, levelBand })`（`dbHelpers` 内部补 `id`；`date` 用本地 `formatDate(new Date())`（import from `@/lib/date`）而非 `toISOString()` —— 与 P1 迁移归一后的格式一致）。

- [ ] **Step 2: 阈值单一来源**
  用一个表统一 `levelBandForScore`（细档）与 `cefrFromScore`（粗档）。示例结构（细档标签沿用文件现状，见 p2c-consumers.md）：
  ```ts
  // Single source: ascending score cutoffs → fine band + coarse CEFR.
  const CEFR_BANDS: { minScore: number; band: string; cefr: string }[] = [
    { minScore: 0,  band: "A1", cefr: "A2" },
    { minScore: 30, band: "A2 (Lower)", cefr: "A2" },
    { minScore: 45, band: "A2 (Upper)", cefr: "B1" },
    { minScore: 55, band: "B1 (Lower)", cefr: "B1" },
    { minScore: 65, band: "B1 (Upper)", cefr: "B2" },
    { minScore: 75, band: "B2 (Lower)", cefr: "B2" },
    { minScore: 85, band: "B2 (Upper)", cefr: "C1" },
    { minScore: 95, band: "C1", cefr: "C1" },
  ];
  ```
  然后 `levelBandForScore(score)` 返回匹配区间的 `band`，`cefrFromScore(score)` 返回其 `cefr`。**先读文件现状确认原始细档标签与粗档断点，使统一后的映射与原行为一致（尤其原 cefrFromScore 的 45/65/85 断点必须仍映射到 A2/B1/B2/C1）**——若上表与现状标签有出入，以现状为准调整表内容，勿臆造。

- [ ] **Step 3: 写回确认（decision A）**
  改 `finishAssessment`（~735-764）：
  - 始终 `assessedLevel: cefrFromScore(composite)` 写入 profile（`db.learningProfile.update` 或 `dbHelpers` 现有更新路径）。
  - 若 `cefrFromScore(composite) !== profile.studyLevel`，打开一个确认 `Dialog`（新增状态 `pendingLevel: string | null`）问"本次测评为 X，是否把学习难度更新为 X？"。确认 → 写 `studyLevel = X`；取消 → 只留 assessedLevel。参照 `settings/page.tsx:345-371` 的 Dialog 用法（`import { Dialog, DialogContent, DialogFooter, ... } from "@/components/ui/dialog"`）。
  - 不再写 `initialCefrLevel`。

- [ ] **Step 4:** `npx tsc --noEmit` 清；`npx eslint app/assessment/page.tsx` 不新增错误；grep 确认本文件无 `ASSESSMENTS_STORAGE_KEY`/`loadPreviousAssessments` 残留。推理核对：测评完成 → 结果入 Dexie 表；等级不同才弹确认；阈值细/粗档一致。
- [ ] **Step 5:** Commit `feat(assessment): store to Dexie, unify CEFR thresholds, confirm level write-back`

---

## Phase 3 — history / roadmap / settings 收尾（3 文件）

### Task 4: history 切表

**Files:** Modify `app/history/page.tsx`

- [ ] **Step 1:** 把 `AssessmentResult` 的 import 从 assessment 页改为 `@/lib/types`；测评列表读取从 localStorage 改为 `const assessments = useLiveQuery(() => dbHelpers.getAssessments(), []) ?? [];`（确认 `useLiveQuery`/`dbHelpers` import）。删除原 localStorage 读取逻辑。
- [ ] **Step 2:** `npx tsc --noEmit` 清；eslint 不新增；grep 确认本文件无 `en-tutor-assessments` 残留。
- [ ] **Step 3:** Commit `refactor(history): read assessments from Dexie table`

### Task 5: roadmap 字段 + 测评切表 + 阈值引用

**Files:** Modify `app/roadmap/page.tsx`

- [ ] **Step 1:** display/gate 字段：`currentLevel`（~224）与 foundation-done gate（~228）改用 `profile?.assessedLevel`（回退 studyLevel）。
- [ ] **Step 2:** 私有 `readAssessments()`（直读 `localStorage["en-tutor-assessments"]`）改为 `useLiveQuery(() => dbHelpers.getAssessments(), []) ?? []`；删除该私有函数与其 localStorage key。
- [ ] **Step 3:** `B2_ASSESSMENT_THRESHOLD = 65`（~40）：加注释指明它对应 assessment 的 B1→B2 断点（65）；若可行，导出 assessment 的阈值常量供引用，否则保留 65 并注释来源，避免无源魔数。
- [ ] **Step 4:** `npx tsc --noEmit` 清；eslint 不新增；grep 确认 roadmap 无 `en-tutor-assessments`/`readAssessments` 残留。
- [ ] **Step 5:** Commit `refactor(roadmap): assessedLevel display + assessments from Dexie`

### Task 6: settings 改 studyLevel + 重算 knownWordsBase

**Files:** Modify `app/settings/page.tsx`

- [ ] **Step 1:** `selectedCefrLevel` 的初值（~53）改从 `profile?.studyLevel`（出题难度是用户在此调的）。
- [ ] **Step 2:** `handleSaveCefrLevel`（~67-83）：`db.learningProfile.update` 改为写 `{ studyLevel: selectedCefrLevel, knownWordsBase: getKnownWordsForLevel(selectedCefrLevel as CefrLevel) }`（`import { getKnownWordsForLevel, type CefrLevel } from "@/lib/frequency-list"`）。修复"改等级不重算词表"。检查 update 返回值：为 0（singleton 缺失）时回退 `put` 或提示，不谎报 Saved。
- [ ] **Step 3:** `npx tsc --noEmit` 清；eslint 不新增。推理核对：改等级后 knownWordsBase 随新表重算，覆盖率/isWordKnown 立即反映。
- [ ] **Step 4:** Commit `feat(settings): save studyLevel and recompute knownWordsBase`

---

## Self-Review（已执行）

- **Spec 覆盖（P2c 部分）**：spec §4.3 字段读取点切换（Phase 1 + roadmap/settings 的字段）；§4.2 assessment/history 切表（Task 3/4/5）；§4.4 阈值统一 + 写回确认 decision A（Task 3）；settings 改等级重算 knownWordsBase（Task 6，spec §4.3 末）。roadmap 的 readAssessments（探索新发现的第二个 localStorage 消费者）纳入 Task 5。
- **占位符扫描**：无 TBD；关键新代码（CEFR_BANDS、useLiveQuery、Dialog 写回、settings 重算）给出，其余字段替换给精确行 + 分类 + 引用 p2c-consumers.md；阈值统一明确要求"以文件现状为准，勿臆造标签/断点"。
- **类型一致性**：`AssessmentResult` 统一从 `@/lib/types`（P1 带 id 版）；`saveAssessment(Omit<...,"id">)` 参数与 P1 helper 一致；`studyLevel`/`assessedLevel` 与 P1 字段一致；`getKnownWordsForLevel`/`CefrLevel` 与 frequency-list 一致。
- **风险/取舍**：Phase 1 切字段后、Phase 2/3 未完成前，assessment 仍写 localStorage（老逻辑）——但读侧（Phase 1 不含 assessment 读）不受影响；Phase 2 完成后 assessment 才切表。history/roadmap 的测评读在 Phase 3 切，Phase 2 完成后到 Phase 3 前它们读 Dexie 表可能为空（新测评已入表、旧 localStorage 不再读）——中间态，Phase 3 收口即一致。阈值统一务必保持原 cefrFromScore 的 45/65/85 语义，避免定级漂移。
