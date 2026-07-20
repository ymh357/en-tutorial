# 子项目 B / B2 · 消费点迁移到结构化输出 + 真实成本记账 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把 8 个 AI 消费页面从"手工剥 fence + JSON.parse"迁移到 B1 的结构化契约（传 schema → 拿 `data.object`），并把所有 `recordCost` 从硬编码 `"claude-sonnet-5"` 改为服务端回传的真实 `model` + `usage`；补记此前未记账的 AI 调用。

**Architecture:** B1 已提供 `lib/ai-schemas.ts`（zod schema）+ `/api/review`（带 `schema` 走 `generateObject` 返回 `{object, usage, model}`；不带 schema 保持旧行为）+ `/api/chat`（messageMetadata 回传 usage+model）+ cost-tracker 累计。B2 逐个消费点接线。

**Tech Stack:** Next.js 16、React 19、TS strict、`ai@7`、zod。

## Global Constraints

- TS strict；纯本地；注释英文。
- 无测试框架：`tsc --noEmit` + `eslint`（分支现为 0 error，保持）+ 推理核对。唯一需真实网络的是 Phase 0 的 0g smoke-test。不起 dev server（smoke-test 直连 0g API，非起 Next）。
- Git：每 task 提交；用户已授权所有 git 操作。commit 末尾附：
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SDA8JvMdjpqLaxXC7gLC9M
  ```

## 位置 & 依赖

子项目 B 的第二个 plan（B1 已完成，lib/server 地基就位）。响应形状与调用点清单见 `scratchpad/b-consumers.md`；B1 终审的 **B2 checklist** 见 `.superpowers/sdd/progress.md`（B1 final review 段），要点内嵌如下。

## 通用迁移模式（每个消费点照此，除非另有说明）

1. `import { <schema> } from "@/lib/ai-schemas"`；调用时 `schema: z.toJSONSchema(<schema>)` 放进 `/api/review` 请求体（`import { z } from "zod"`）。
2. POST body：`{ prompt, system, schema, maxOutputTokens?, temperature? }`。
3. 响应用 `data.object`（已校验、typed），**删除本地 `parse*` / fence-strip / `JSON.parse`**。
4. `recordCost({ model: data.model, inputTokens: data.usage.inputTokens, outputTokens: data.usage.outputTokens, module: "<x>" })` —— 用真实值替换硬编码 `"claude-sonnet-5"`。
5. **B2 checklist 内嵌**：
   - **[B2-1] 大输出必须显式传 `maxOutputTokens`**（schema 路径默认 4096 会截断）：reader 文章生成(`content`)、writing round2(`polishedVersion` 整篇)、长对话 review —— 传更大值（如 8192）。
   - **[B2-2] 顶层 array/string schema 不走结构化路由**：`listeningShadowingSchema`(array)、`readerSentenceAnalysisSchema`(string) 保持现有 `generateText` 文本路径 + 客户端解析（不迁 schema）。其余 object schema 正常迁。
   - **[B2-3] 计价 key**：Phase 0 smoke-test 得到的真实 `response.modelId` 若带版本后缀，Phase 0 已在 `MODEL_PRICING` 规范化/加 key（迁移点直接用 `data.model` 即可）。
   - **[B2-4] `acceptAlso` 等 optional 字段**：消费 `data.object` 时保留现有 `?? []` 归一化（如 assessment cloze 的 `blank.acceptAlso ?? []`），别假设 optional 字段一定在。
6. 迁移后该文件应无 `"claude-sonnet-5"`、无手工 fence-strip。

## File Structure（分 4 phase）

- Phase 0：`lib/ai.ts`、`lib/cost-tracker.ts`（smoke-test 结论 + 计价 key/警告）。
- Phase 1：`app/conversation/[id]/review/page.tsx`、`app/reader/[id]/page.tsx`、`app/writing/[id]/page.tsx`。
- Phase 2：`app/translate/page.tsx`、`app/listening/page.tsx`、`app/assessment/page.tsx`。
- Phase 3：`lib/task-pool-generate.ts`、`app/api/cron/generate-tasks/route.ts`、`app/reader/page.tsx`（补 article-gen recordCost）。

---

## Phase 0 — 0g smoke-test + 计价 key（2 文件）

### Task 1: smoke-test 真实 modelId + native json_schema，定 pricing key

**Files:** Modify `lib/ai.ts`, `lib/cost-tracker.ts`

- [ ] **Step 1: smoke-test（真实网络，唯一允许）。** 用 `.env.local` 的 `OG_API_KEY`/`OG_API_BASE_URL`（production 默认 `router-api.0g.ai/v1`）直连 `POST /chat/completions`：(a) 普通请求，记录返回体的 `model` 字段确切字符串（对 `deepseek-v4-pro` 与 `deepseek-v4-flash` 各一次）；(b) 带 `response_format: { type: "json_schema", ... }` 的请求，看 production 是否接受（决定能否开 native）。用 `curl` 或一次性 node 脚本（跑后删）。把确切 modelId 字符串与 native 支持结论写进 report。若无网络，报 DONE_WITH_CONCERNS 并保留降级模式 + 现有 MODEL_PRICING keys。
- [ ] **Step 2: pricing key（cost-tracker）。** 依据 Step 1 的真实 modelId：若与现有 `MODEL_PRICING` key（`deepseek-v4-flash`/`deepseek-v4-pro`）一致则无需改；若带后缀，在 `MODEL_PRICING` 加规范化（`recordCost` 里 `model.startsWith("deepseek-v4-pro")` 之类映射）或加 key。并把未知 model 的静默 `?? flash` fallback 改为 `console.warn`（不再悄悄按最便宜计）。
- [ ] **Step 3: native flag（lib/ai.ts）。** 若 Step 1(b) 确认 production 支持 native json_schema，则 `supportsStructuredOutputs: true`（更强保证）；否则保持 `false`（降级仍可用）。注释记录 smoke-test 结果。
- [ ] **Step 4:** `tsc` + `eslint` 清。Commit `feat(ai): 0g modelId smoke-test → pricing keys + native flag decision`.

---

## Phase 1 — conversation review / reader / writing（3 文件）

### Task 2: conversation review 迁移
**Files:** Modify `app/conversation/[id]/review/page.tsx`
- [ ] 用 `conversationReviewSchema` 传 schema，拿 `data.object`（= ConversationReview），删 `parseReviewResponse`/fence-strip；`recordCost` 用真实 model+usage（module `conversation`）。长对话 review → 显式 `maxOutputTokens: 8192`（[B2-1]）。`tsc`+`eslint`；Commit `refactor(conversation): structured review + real cost`.

### Task 3: reader 迁移
**Files:** Modify `app/reader/[id]/page.tsx`
- [ ] 句分析（`readerSentenceAnalysisSchema` 是 string）→ **保持文本路径**（[B2-2]，不迁 schema）。理解题评估 → `readerComprehensionEvalSchema` 结构化。两处 `recordCost` 用真实 model+usage（module `reader`）。`tsc`+`eslint`；Commit `refactor(reader): structured comprehension eval + real cost`.

### Task 4: writing 迁移
**Files:** Modify `app/writing/[id]/page.tsx`
- [ ] round1 → `writingRound1Schema`；round2 → `writingReviewSchema`，删 `parseRound1Response`/`parseReviewResponse`/fence-strip；两处 `recordCost` 真实值（module `writing`）。round2 → 显式 `maxOutputTokens: 8192`（polishedVersion 整篇，[B2-1]）。`tsc`+`eslint`；Commit `refactor(writing): structured two-round review + real cost`.

---

## Phase 2 — translate / listening / assessment（3 文件）

### Task 5: translate
**Files:** Modify `app/translate/page.tsx`
- [ ] 生成 → `translateGenSchema`/`translateSentenceBatchSchema`；评估 → `translateEvalSchema`。删本地 parse；`recordCost` 真实值（module `translate`）。`tsc`+`eslint`；Commit `refactor(translate): structured gen+eval + real cost`.

### Task 6: listening
**Files:** Modify `app/listening/page.tsx`
- [ ] dictation → `listeningDictationSchema`；comprehension → `listeningComprehensionSchema`（**含 topic**）；prediction → `listeningPredictionSchema`/`listeningPredictionEvalSchema`。**shadowing 若是顶层 array → 保持文本路径**（[B2-2]）。删本地 parse；`recordCost` 真实值（module `listening`）。`tsc`+`eslint`；Commit `refactor(listening): structured modes + real cost`.

### Task 7: assessment
**Files:** Modify `app/assessment/page.tsx`
- [ ] reading-gen/cloze-gen/writing-score/conversation-score 各用对应 schema。**cloze 消费 `data.object` 时保留 `blank.acceptAlso ?? []` 归一化**（[B2-4]）。删本地 parse；`recordCost` 真实值（module `assessment`）。`tsc`+`eslint`；Commit `refactor(assessment): structured sections + real cost`.

---

## Phase 3 — task-pool-generate / cron / reader article-gen（3 文件）

### Task 8: 池生成（客户端）
**Files:** Modify `lib/task-pool-generate.ts`
- [ ] 8 种 PoolTaskType 用 `poolTaskSchemas[type]` 传 schema、拿 object；删本地 parse。creative 类（writing-prompt/reading-article/translation-situational）显式传 `temperature`（避免 schema 路径默认 0 降低多样性）。补 `recordCost(module: "pool")`（此前未记账）。`tsc`+`eslint`；Commit `refactor(pool-gen): structured pool tasks + cost recording`.

### Task 9: cron（服务端）
**Files:** Modify `app/api/cron/generate-tasks/route.ts`
- [ ] 8 种 PoolTaskType 用 `poolTaskSchemas[type]`（服务端可直接 `generateObject` 或复用统一 schema）；确保生成形状与 live 消费一致（**listening-comprehension 含 topic**，drift 根除）。服务端无法调客户端 `recordCost` —— 保持注释说明不计入客户端面板（B1 已注）。`tsc`+`eslint`；Commit `refactor(cron): structured pool generation (shared schemas)`.

### Task 10: reader article-gen 补记账
**Files:** Modify `app/reader/page.tsx`
- [ ] 文章生成兜底路径（`readerArticleGenSchema`）迁结构化 + 显式 `maxOutputTokens: 8192`（整篇 content，[B2-1]）；补 `recordCost`（此前完全无 recordCost import — 真 gap）。`tsc`+`eslint`；Commit `refactor(reader-home): structured article gen + cost recording`.

---

## Self-Review（已执行）

- **覆盖**：spec §2/§3 的消费点迁移（8 文件）+ 真实成本记账 + 补记（pool/reader-home）+ cron shared schema（topic drift 根除）。B1 checklist 的 4 项全部内嵌到通用模式与具体 task。
- **占位符**：通用迁移模式给出确切步骤 + 每 task 点名 schema 与 module；未逐行贴代码（8 个大文件），但每处有明确的 schema 名、删除目标（parse/fence-strip）、recordCost 真实值、checklist 注意点，implementer 据 b-consumers.md + ai-schemas.ts 实施。
- **类型一致性**：schema 均来自 B1 的 `lib/ai-schemas.ts`；`data.object` 类型由 schema 推导，字段应与原 parse 期望一致（迁移时逐字段核对，防漂移）。
- **兼容/风险**：array/string schema 保持文本路径（不强迁）；大输出显式 maxOutputTokens；modelId 计价在 Phase 0 定；每个消费点迁移后独立可编译（route 双模式支持）。cron 服务端成本不计入客户端面板（如实标注）。
- **顺序**：Phase 0（smoke-test/计价）必须先，其余消费点 phase 之间无强依赖，可按批 review。
