# 子项目 B / B1 · review route 结构化 + schema 库 + 成本回传 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把 `/api/review` 升级为可选结构化输出（`generateObject` + 客户端传入的 JSON Schema），建立集中的 zod schema 库，并让两个 AI 路由回传真实 model id + token usage（供成本记账修正）。消费点迁移在 B2。

**Architecture:** `/api/review` 保持通用：带 `schema` 时走 `generateObject`、不带时走原 `generateText`（平滑迁移）。schema 集中在 `lib/ai-schemas.ts`（zod）。路由响应统一带 `usage` + 真实 `model`。`/api/chat` 用 `onFinish` 回传 usage+model。

**Tech Stack:** Next.js 16、TS strict、`ai@7`、`@ai-sdk/openai-compatible@3`；新依赖 `zod`（AI SDK 已间接依赖，显式 pin）。

## Global Constraints

- TS strict；纯本地；注释英文。
- 无测试框架：`tsc --noEmit` + `eslint` + 推理核对；唯一需真实网络的验证是 0g 结构化输出 smoke-test（若环境不允许则标注未验证、保留降级模式）。不起 dev server。
- Git：每 task 提交；用户已授权所有 git 与依赖变更。commit 末尾附：
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SDA8JvMdjpqLaxXC7gLC9M
  ```

## 位置

子项目 B（spec: `docs/superpowers/specs/2026-07-20-ai-contract-and-cost-design.md`）的第一个 plan。B1 = lib/服务端层（不改任何消费页面——那是 B2）。响应形状清单见 `scratchpad/b-consumers.md`。

## File Structure

- `lib/ai-schemas.ts`（新）：全部响应 zod schema + 一个 `toJsonSchema()` 桥接。
- `app/api/review/route.ts`（改）：接受 `schema`，`generateObject`，返回 `{object|content, usage, model}`。
- `lib/ai.ts`（改）：`supportsStructuredOutputs` smoke-test 结论（开或留默认降级）。
- `app/api/chat/route.ts`（改）：`onFinish` 回传 usage+model。
- `lib/cost-tracker.ts`（改）：独立累计计数器（Total 不受 500 条裁剪影响）+ 口径注释。

---

## Phase 1 — schema 库 + review route 结构化（3 文件）

### Task 1: `lib/ai-schemas.ts` — 集中 zod schema

**Files:** Create `lib/ai-schemas.ts`；`npm install zod`（pin 已安装版本，读 `node_modules/zod/package.json`）。

- [ ] **Step 1: 装 zod**（显式 pin；AI SDK 已间接依赖，取其已解析版本）。
- [ ] **Step 2: 写 schema 库。** 为 b-consumers.md 列出的每种响应定义一个 zod schema。复用 `lib/types.ts` 的形状（`ConversationReview`、`WritingReview`/`WritingAnnotation`），其余按 b-consumers.md 的字段新建。**清单（必须全部覆盖，字段以 b-consumers.md / types.ts 为准）**：`conversationReviewSchema`、`readerSentenceAnalysisSchema`、`readerComprehensionEvalSchema`、`readerArticleGenSchema`、`writingRound1Schema`、`writingReviewSchema`、`translateGenSchema`、`translateEvalSchema`、`listeningDictationSchema`、`listeningComprehensionSchema`（**含 `topic` 字段——修 b-consumers.md 发现的 drift**）、`listeningPredictionSchema`、`assessmentReadingGenSchema`、`assessmentClozeGenSchema`、`assessmentWritingScoreSchema`、`assessmentConversationScoreSchema`、以及 8 个 `PoolTaskType` 生成 schema。示例：
  ```ts
  import { z } from "zod";
  export const conversationReviewSchema = z.object({
    scores: z.object({ fluency: z.number(), accuracy: z.number(), vocabulary: z.number(), complexity: z.number() }),
    errors: z.array(z.object({ original: z.string(), corrected: z.string(), explanation: z.string() })),
    improvements: z.array(z.object({ original: z.string(), improved: z.string(), context: z.string() })),
    highlights: z.array(z.object({ text: z.string(), reason: z.string() })),
    newVocabulary: z.array(z.object({ word: z.string(), lemma: z.string(), definition: z.string(), example: z.string(), collocations: z.array(z.string()).optional(), wordFamily: z.string().optional() })),
  });
  export const listeningComprehensionSchema = z.object({
    passage: z.string(), topic: z.string(), // topic previously missing in generator — fixed here
    questions: z.array(z.object({ question: z.string(), options: z.array(z.string()), correctIndex: z.number() })),
  });
  ```
  用数字分数区间时用 `.min()/.max()` 收紧（如评分 1-10）。
- [ ] **Step 3: 桥接。** 导出把 zod → JSON Schema 的方式供客户端调用时传给 route：优先用 AI SDK 的 `zodSchema` 或 `zod-to-json-schema`（若前者不便则装后者，pin）。提供一个 `toReviewSchema(schema: z.ZodType)` 或直接让消费点 import zod schema 并在调用侧转 JSON Schema——B2 用。本 task 至少确保 schema 可被 `generateObject` 与"转 JSON Schema 传输"两种方式消费。
- [ ] **Step 4:** `tsc --noEmit` + `eslint lib/ai-schemas.ts` 清。Commit `feat(ai): centralized zod response schemas (fixes listening topic drift)`.

### Task 2: `/api/review` 结构化 + 真实 model/usage

**Files:** Modify `app/api/review/route.ts`, `lib/ai.ts`

- [ ] **Step 1: route 接受 schema、generateObject。**
  ```ts
  import { generateObject, generateText, jsonSchema } from "ai";
  import { qualityModel } from "@/lib/ai";
  // body: { prompt, system?, schema?, temperature?, maxOutputTokens? }  (schema = JSON Schema object)
  const { prompt, system, schema, temperature, maxOutputTokens } = body;
  if (schema) {
    const { object, usage, response } = await generateObject({
      model: qualityModel, schema: jsonSchema(schema), system, prompt,
      temperature: temperature ?? 0, maxOutputTokens: maxOutputTokens ?? 2048,
    });
    return Response.json({ object, usage, model: response.modelId });
  }
  const { text, usage, response } = await generateText({
    model: qualityModel, system, prompt, maxOutputTokens: maxOutputTokens ?? 2048,
  });
  return Response.json({ content: text, usage, model: response.modelId });
  ```
  保留现有 100KB body 上限与 maxDuration 120。`usage` 字段名以 SDK 实际为准（`promptTokens`/`completionTokens` 或 `inputTokens`/`outputTokens`——读 node_modules 确认并在 report 记录）。
- [ ] **Step 2: 0g smoke-test（lib/ai.ts）。** 判断 0g 是否原生支持 json_schema：临时对一个最小 schema 实调（或读 provider 文档/尝试），据结果决定 `createOpenAICompatible` 是否传 `supportsStructuredOutputs: true`。若无法实网验证，保留默认（降级模式，`generateObject` 仍用 schema 注入 + 校验），在 lib/ai.ts 注释与 report 标注"native json_schema 未验证，用降级模式"。
- [ ] **Step 3:** `tsc --noEmit` + `eslint` 清。手动核对：带 schema 的请求返回 `object`（typed），不带的返回 `content`（旧行为），两者都带 `usage` + 真实 `model`。Commit `feat(api): /api/review structured output + real model/usage`.

---

## Phase 2 — chat usage 回传 + cost-tracker 累计（2 文件）

### Task 3: `/api/chat` 回传 usage + model

**Files:** Modify `app/api/chat/route.ts`

- [ ] **Step 1:** 在 `streamText` 加 `onFinish({ usage, response })`，通过 `toUIMessageStreamResponse` 的 message metadata（或 SDK 支持的流末 data）把 `{ usage, model: response.modelId }` 传给客户端，供对话页替换字符估算（消费在 B2）。若本 SDK 版本流式回传 usage 不便，report 记录并保留（B2 决定 fallback）。
- [ ] **Step 2:** `tsc` + `eslint` 清。Commit `feat(api): surface usage+model from chat stream onFinish`.

### Task 4: `lib/cost-tracker.ts` 累计计数器

**Files:** Modify `lib/cost-tracker.ts`

- [ ] **Step 1:** 现状：明细裁剪到 500 条，`getCostSummary` 只对存量求和 → 超 500 次后 Total 静默缩水。加一个独立的累计存储（`en-tutor-cost-totals`：`{ totalCostA0GI, totalCalls, totalInputTokens, totalOutputTokens, byModule, byModel }`），`recordCost` 同时更新它；`getCostSummary` 的 Total/byModule/byModel 从累计读，`records`（最近 100）仍从裁剪的明细读。保留 `MODEL_PRICING`（deepseek-*；claude-sonnet-5 项保留但 B2 起不再被误传）。更新注释：说明 cron 服务端生成不计入客户端面板。
- [ ] **Step 2:** `tsc` + `eslint` 清。手动核对：>500 次调用后 Total 不缩水；累计与明细口径一致。Commit `feat(cost): durable cumulative totals independent of detail trim`.

---

## Self-Review（已执行）

- **覆盖**：spec §2（route 结构化 Option a + schema 库）、§3（真实 model/usage 回传 + 累计口径）、§4（listening topic drift 并入 schema）。消费点迁移与逐点 recordCost 修正是 B2，不在此。
- **占位符**：route 给完整代码；schema 库给清单 + 2 示例 + 明确"字段以 b-consumers.md/types.ts 为准"（15 种全列名）；smoke-test 有明确的"验证或降级+标注"路径。
- **依赖**：zod（显式 pin；AI SDK 已间接用）；可能 zod-to-json-schema（若 AI SDK 的 zodSchema 桥接不便）——用户已授权依赖。
- **兼容**：route 对无 schema 请求保持旧行为 → B1 落地后所有现有消费点（尚未迁移）仍正常工作；B2 逐个迁移。
- **风险**：0g 原生 json_schema 未知（smoke-test + 降级保底）；SDK 的 usage 字段名需读 node_modules 核实；chat 流式回传 usage 的可行性待 Task 3 确认。
