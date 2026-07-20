# 子项目 D / D3b · 测评 UX 诚实化（客观/主观分离 + 低置信提示 + onboarding A1/C2）— Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把 D3a 已算出但未展示的 `lowConfidence` 呈现为"低置信/建议重测"提示；结果页把**客观**章节（Reading/Cloze，%）与**主观**章节（Writing/Speaking，单次 LLM 判断）明确分离标注（不再呈现为等精度）；onboarding 自述补 **A1/C2**；`initProfile` 把自述记为 `studyLevel` 但 **`assessedLevel` 留空**（自述非心理测量结果，展示回退 studyLevel）。

**Architecture:** 纯 UI/小逻辑，无算法、无迁移。改 `app/assessment/page.tsx`（结果页 render）、`app/onboarding/page.tsx`（LEVELS + A1/C2）、`lib/db-helpers.ts`（initProfile assessedLevel 留空）。

**Tech Stack:** Next.js 16、React 19、TS strict。

## Global Constraints

- TS strict；纯本地；注释英文。`tsc --noEmit` + `eslint`（保持 0）+ 推理核对。不起 dev server。仓库启用 `react/no-unescaped-entities`——JSX 文本内撇号用 `&apos;`。
- Git：每 task 提交；用户已授权。commit 末尾附：
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SDA8JvMdjpqLaxXC7gLC9M
  ```

## 位置 & 依赖

子项目 D 末个 plan（D1/D2/D3a 完成）。spec §4（客观/主观分离、边界提示、onboarding A1/C2 + 诚实 assessedLevel）。无迁移。

**关键既有事实：**
- 结果页 render（`app/assessment/page.tsx:1270` `phase==="results" && finalResult`）：section 明细 tiles（`:1276-1281`：Reading Comprehension/Cloze Test/Writing Task/Conversation）；`abilityScores`（`:1292-1296`：Reading/Cloze/Writing/Speaking）→ `<RadarChart>`（:1369）；overallScore（:1348）/ levelBand（:1352）/ scoreDelta（:1356）；`finalResult.lowConfidence` 已在 state（D3a），**未渲染**。
- 客观 = Reading（9 题正确率%）、Cloze（8 空%）；主观 = Writing/Speaking（单次 LLM 1-10→normalizeTo100）。
- onboarding LEVELS（`app/onboarding/page.tsx:19-45`）：A2/B1/B2/C1（无 A1/C2），`value: CefrLevel`；`handleComplete`（:53-61）`initProfile(selectedLevel, knownWords)`。`CefrLevel`（frequency-list）已含 A1/C2。
- `initProfile`（`lib/db-helpers.ts:43-54`）：`initialCefrLevel`/`assessedLevel`/`studyLevel` 全 = cefrLevel。
- assessedLevel 展示回退：D 调研记 `app/page.tsx:203`、`app/roadmap/page.tsx:214` 在 assessedLevel 空时回退 studyLevel（**Task 2 须 grep 核实所有 assessedLevel 读取点确实容空回退**）。

## File Structure

- Task 1：`app/assessment/page.tsx`（结果页 lowConfidence 提示 + 客观/主观分离标注）。
- Task 2：`app/onboarding/page.tsx`（A1/C2）+ `lib/db-helpers.ts`（initProfile assessedLevel 留空）。

---

## Phase 1 — 测评 UX（2 task）

### Task 1: 结果页 lowConfidence 提示 + 客观/主观分离（`app/assessment/page.tsx`）
- [ ] **Step 1: lowConfidence 提示。** 在 overall band 区（`:1348-1352` overallScore/levelBand 附近）之下，当 `finalResult.lowConfidence` 为真时渲染一条醒目但非报错的提示（`text-sm text-amber-600 dark:text-amber-400` 或 Alert）：`"Low-confidence result: your performance was at the edge of the tested range, or the objective and subjective sections disagreed. Consider retaking the assessment to confirm your level."`（撇号 apostrophe 用 `&apos;` 或改写规避）。
- [ ] **Step 2: 客观/主观分离标注。** section 明细（`:1276-1281`）与/或 radar（`:1369`）处明确标注：Reading + Cloze = **Objective**（measured % correct）；Writing + Speaking = **Subjective**（AI single-shot judgment, less precise）。最简实现：section tiles 分两组渲染并各加小标题（"Objective (measured)" / "Subjective (AI-judged)"），或在 radar 下加一行说明 `text-xs text-muted-foreground`："Reading & Cloze are objective (% correct); Writing & Speaking are AI judgments and less precise." **不改** abilityScores 的数值/radar 结构，只加标注/分组（避免破坏 RadarChart props）。
- [ ] **Step 3:** `tsc` + `eslint app/assessment/page.tsx` 清（含 no-unescaped-entities）。推理核对：lowConfidence 仅在其为真时显示；客观/主观标注不改数据、radar 正常。Commit `feat(assessment-ux): low-confidence retest hint + objective/subjective result separation`.

### Task 2: onboarding A1/C2 + 诚实 assessedLevel（`app/onboarding/page.tsx` + `lib/db-helpers.ts`）
- [ ] **Step 1: LEVELS 补 A1/C2。** `app/onboarding/page.tsx` LEVELS 数组头部加 A1、尾部加 C2（`value: "A1"|"C2"` 均为合法 `CefrLevel`）：
  ```ts
  { value: "A1", label: "A1 - Beginner", description: "I know a few basic words and phrases. I'm just starting out." },
  // ...existing A2/B1/B2/C1...
  { value: "C2", label: "C2 - Proficient", description: "I use English with near-native ease across virtually any context." },
  ```
  （撇号用 `&apos;`——注意这是 JS 字符串字面量传入 description 后作为 JSX 文本渲染；若作为 `{description}` 插值则无需转义，按现有渲染方式定；核实渲染点。）
- [ ] **Step 2: initProfile assessedLevel 留空（诚实）。** `lib/db-helpers.ts:43-54` `initProfile`：`assessedLevel: ""`（自述不作心理测量结果），`studyLevel: cefrLevel`、`initialCefrLevel: cefrLevel` 保持（studyLevel 驱动内容生成）。
- [ ] **Step 3: 核实回退（必须）。** grep 全库 `assessedLevel` 的**读取点**，确认每处在空串时有合理回退（回退 studyLevel 或显示"Not assessed yet"），不会显示空白/崩溃。若有读取点假设非空，本 task 补回退（如 `profile.assessedLevel || profile.studyLevel`）。report 列出所有读取点及其容空情况。
- [ ] **Step 4:** `tsc` + `eslint app/onboarding/page.tsx lib/db-helpers.ts`（相关读取点文件）清。推理核对：新用户 assessedLevel 空 → 展示回退 studyLevel（非空白）；真跑一次 assessment 后 assessedLevel 由 finishAssessment 填。Commit `feat(onboarding): A1/C2 self-report levels + honest empty assessedLevel until assessed`.

---

## Self-Review（已执行）

- **覆盖**：spec §4 剩余（lowConfidence/边界提示展示、客观/主观 UI 分离、onboarding A1/C2、assessedLevel 诚实留空）。算法/定位是 D3a。
- **占位符**：提示文案、LEVELS 项、initProfile 改动给具体；客观/主观分离给"分组或说明行"两种最简实现 + "不改 radar 数据结构"约束；回退核实给"grep 所有读取点 + 容空"明确要求（非占位——目标明确）。
- **类型一致**：`CefrLevel` 已含 A1/C2（D3a verify）；assessedLevel 空串是合法 string（类型不变）。
- **风险/兼容**：assessedLevel 留空依赖所有读取点容空回退（Step 3 grep 核实兜底）——这是唯一实质风险，已作为必做步骤。无迁移、无算法改动。
- **验证**：tsc+eslint（含 no-unescaped-entities）+ 推理核对；不起 dev server。D3b 完成后做 **D 整体 broad whole-branch review**（覆盖 D1+D2+D3a+D3b），再收尾（finishing-a-development-branch，用户决策 merge/PR）。
