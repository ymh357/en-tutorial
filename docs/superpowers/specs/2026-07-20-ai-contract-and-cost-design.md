# 子项目 B · AI 契约 + 成本追踪 — 设计文档

> 状态：待用户审阅（用户已授权自主定稿，沿用子项目 A 的"你审"模式）
> 日期：2026-07-20
> 分支：feat/data-correctness-foundation（子项目 A 已完成，B/C/D 在此叠加）
> 背景调研：`scratchpad/b-consumers.md`（所有 AI 调用点、各响应形状、成本记账现状）

## 1. 目标

1. **结构化输出**：把全站"`generateText` + 'return ONLY JSON' + 客户端剥 ```json``` 围栏 + `JSON.parse`"的脆弱模式，换成 AI SDK 的结构化输出（`generateObject` + JSON schema），并为评分/批改类加 `maxOutputTokens` 与低 `temperature`。消除 ~10 处重复的 fence-strip 解析和"模型多说一句就崩"的失败面。
2. **成本追踪修正**：服务端返回**真实** model id + token usage；客户端 `recordCost` 记真实值（替换 9 处硬编码 `"claude-sonnet-5"` 与对话的字符估算）；补记此前完全不记账的 AI 调用（pool 生成、reader 文章生成兜底），并对服务端无法调用客户端 `recordCost` 的路径（cron）明确标注。

## 2. 架构（决策：Option a）

`/api/review` 保持通用端点，但**接受请求体里可选的 `schema`（JSON Schema 对象）**；给了 schema 时路由用 `generateObject({ schema: jsonSchema(schema), ... })` 返回验证过的对象，没给时回退现有 `generateText`（平滑迁移，未迁移的调用点不受影响）。

- 依据（见 b-consumers.md D 节）：`ai@7.0.29` 导出 `generateObject`/`jsonSchema`/`zodSchema`；`@ai-sdk/openai-compatible@3.0.11` 有 `supportsStructuredOutputs` 标志。即便该标志保持默认 `false`，`generateObject` 也会降级为"schema 注入 prompt + SDK 侧校验/重试"，仍严格优于当前手工解析。
- 0g 后端是否原生支持 `response_format: json_schema` **未验证** —— B1 先 smoke-test，能用则开 `supportsStructuredOutputs` 拿原生保证，不能用则留默认降级模式（功能仍成立）。
- 拒绝 Option (b)（只修解析，不消除重复的 fence-strip）与 (c)（每功能独立端点，过度侵入通用端点）。

**Schema 集中**：新增 `lib/ai-schemas.ts`，用 zod 定义全部响应 schema（客户端传给 route 时用 `zodToJsonSchema` 或 AI SDK 的 `zodSchema` → JSON Schema）；复用 `lib/types.ts` 已有的 `ConversationReview`/`WritingReview` 等，其余（reader 理解题、translate 评估、listening 各模式、assessment 各部分、8 种 PoolTaskType）新建。客户端调用点 import schema、传给 `/api/review`、直接拿到 typed 对象——删掉本地 `parse*` + fence-strip。

## 3. 成本修正设计

- **`/api/review`**：`generateObject`/`generateText` 的结果含 `response.modelId` 与 `usage`（promptTokens/completionTokens）。route 在响应 JSON 里返回 `{ object|content, usage, model }`（真实 model id）。
- **`/api/chat`**：`streamText` 的 `onFinish` 回调可拿 `usage`/`response.modelId`；通过 `toUIMessageStreamResponse` 的 message metadata 或一个流末事件把 usage+model 传回客户端，替换对话页的字符估算。（若流式回传 usage 在本 SDK 版本不便，退而在对话结束时用 `usage` 不可得则明确标注为估算——但优先真实值。）
- **客户端 `recordCost`**：所有调用点改用服务端回传的真实 `model` + `usage`（删除硬编码 `"claude-sonnet-5"`）。`lib/cost-tracker.ts` 的 `MODEL_PRICING` 保留 deepseek-v4-flash/pro（真实模型），`claude-sonnet-5` 项可留作未来但不再被误用。
- **补记账**：`lib/task-pool-generate.ts` 的池生成补 `recordCost(module: "pool")`；`app/reader/page.tsx` 文章生成兜底补 `recordCost`。
- **cron**（`app/api/cron/generate-tasks`）：服务端环境无法调用只在浏览器工作的 `recordCost`——**明确标注**其成本不进客户端面板（在 cost-tracker 注释与 Settings 文案说明"服务端 cron 生成不计入"），不假装覆盖。
- **累计口径**：`getCostSummary` 的 500 条裁剪导致 "Total" 静默缩水（子项目 A 未碰）——B 顺带用一个独立累计计数器（总额/总调用数不受明细裁剪影响），明细仍裁剪。

## 4. 顺带修复（shared schema 的自然收益）

`listening-comprehension` 的 cron/pool 生成器缺 `topic` 字段、而 live 消费者要求它 → 池内容静默校验失败、每次回退到 live 重生成（b-consumers.md 的实测 bug）。统一到 `lib/ai-schemas.ts` 的单一 schema 后，生成与消费用同一形状，该 drift 消除。

## 5. 决策记录

- 结构化输出架构：**Option a**（客户端传 JSON Schema，route `generateObject`）。
- 0g 原生 json_schema：B1 smoke-test 决定是否开 `supportsStructuredOutputs`；默认降级模式作为保底。
- 成本策略：**修正为真实数据**（用户在发散阶段已选），服务端回传真实 model+usage。
- 兼容迁移：route 对未带 schema 的请求保持旧行为，消费点逐个迁移，任一时刻应用可编译可用。

## 6. 拆分为 plan

- **B1 · route 结构化 + schema 库 + 成本回传（lib/服务端层）**：`app/api/review/route.ts`（接受 schema、`generateObject`、返回 real model+usage）、`app/api/chat/route.ts`（onFinish 回传 usage+model）、`lib/ai.ts`（supportsStructuredOutputs smoke-test 结论）、`lib/ai-schemas.ts`（新，全部 zod schema）、`lib/cost-tracker.ts`（累计计数器 + 注释口径）。含 0g 原生/降级的 smoke-test。
- **B2 · 消费点迁移（页面层，分批 ≤5 文件/phase）**：conversation review、reader、writing、translate、listening、assessment、task-pool-generate、cron 逐个改为传 schema + 直接拿对象 + 删本地 parse/fence-strip + 真实成本记账。listening-comprehension topic drift 在此并入统一 schema。

（B2 涉及 ~8 个大页面文件，将在其 plan 内按 phase 切，每 phase ≤5 文件。）

## 7. 验证策略

- 无测试框架：`tsc --noEmit` + `eslint` + 手动/推理核对（不起 dev server）。
- B1 的 0g 结构化输出 smoke-test：用一个最小 schema 实调 `/api/review`（这是唯一需要真实网络的验证；若环境不允许，明确标注为未验证并保留降级模式）。
- 每个迁移的消费点：确认删除本地 parse 后 tsc 通过、typed 对象字段与原 parse 期望一致（防字段名漂移）。
- 成本：确认 recordCost 用真实 model（deepseek-*）而非 claude-sonnet-5；补记点确实记账。

## 8. 非目标

不做：语音/whisper（子项目 C）、判分算法/测评心理测量/SRS 调度（子项目 D）、prompt 教学质量重写（AI 利用度的个性化回流属更后续）。B 只做"AI 调用的结构契约 + 成本记账真实性"，不改各 prompt 的教学内容。
