# 直接听懂方法论落地 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. 每阶段独立可交付、有验证点。

**Goal:** 把 YouTube 视频《简单3招带你直接听懂英语》(uOl0Fihfk34, 作者 海明) 的方法论落地到本项目。方法论核心:听到英语声音 → 大脑浮现画面 → 直接理解(不翻译),靠"声音细胞与画面细胞同时点燃 → 连线加粗"(赫布理论)。三招——①限制范围(只听感兴趣的原版素材,单一主题到 98% 再扩展);②练习时每句走 3 步(理解画面→听清声音→直接听懂),水平决定步骤精细度,全程专注;③练完后遗忘正常、不管理复习计划、靠相同语料在不同场景交替重复。

**Architecture:** 项目当前是"AI 生成教材 + Anki 式 SRS 排期"双地基。方法论与这两者多处路线级相反。本方案分 5 阶段(W0 前置类型→W1 听力三招→W2 评估回流+单词语境→W3 SRS 并存双轨+语料交替重复池→W4 原版素材三级)。SRS 不推翻,与 fluency 听力线并存双轨。原版素材做到视频(4a 文本/4b 音频/4c 视频)。

**Tech Stack:** Next.js 16.2.10(注意 AGENTS.md:有破坏性改动,写码前读 `node_modules/next/dist/docs/`)、React 19.2、TS strict、Dexie(IndexedDB, 现已 v7)、zustand、Vercel AI SDK `ai@7.0.29`、`edge-tts-universal@1.4.0`、`@vercel/blob@2`、0G/DeepSeek V4。

## Global Constraints

- TS strict;纯本地单机(Dexie, 无服务端 DB);注释英文;无多用户(单例 profile)。
- 无测试框架:`tsc --noEmit` + `eslint` 必过;不起 dev server 除非显式要求。
- 每个结构改动 `>300 LOC` 的文件先按 Step 0 规则清死代码、单独提交。
- 多文件阶段每 phase ≤5 文件;>5 独立文件用并行 sub-agent。
- Git:每 task 提交,commit 末尾附 `Co-Authored-By: Claude <noreply@anthropic.com>`。
- 改 schema/prompt 注意:**三处独立维护**(client prompt `lib/task-pool-generate.ts` / cron prompt `app/api/cron/generate-tasks/route.ts` / schema 映射 `lib/ai-schemas.ts` `poolTaskSchemas`)——必须三处同步,漏一处静默丢数据(`task-pool-generate.ts:142-144` 空 catch 吞错)。

## 承重墙实证(审核已逐行核实,方案地基可信)

| # | 假设 | 实证 `file:line` |
|---|---|---|
| 1 | Shadowing 原文无条件直显、无字幕三态、无学习阶段机 | `app/listening/page.tsx:906-908` `<p>{currentSentence}</p>` 直显;`:691` `RecStatus=idle\|recording\|transcribing` 是设备态非学习态;`:923` 硬编码 `-40%` 慢速;`:996` "not a pronunciation score";流程是 `Listen→Record→Check→Next` 扁平循环,`index`(`:695`)是唯一进度游标 |
| 2 | tts 无 `playbackRate`,客户端变速可行 | `lib/tts.ts:37-57` `playBlob` 用 `new Audio()`,无 playbackRate。现有慢速走服务端 `rate`(`:19,23` body `{text,rate}`)。L1-3 在此加 `audio.playbackRate` 最省网络 |
| 3 | shadowing schema 无语境字段,改需动三处 | `lib/ai-schemas.ts:204` `listeningShadowingSchema=z.array(z.string())`(裸数组,注释 `:202-203` 明确需 array mode);`poolTaskSchemas`(`:277-287`)注册它;`poolTaskSchemas:272-275` 注释明说"应迁移但未迁",三处独立 |
| 4 | 盲点不落库,只存 accuracy | `lib/types.ts:167-174` `ListeningExercise` 仅 `mode/prompt/userAnswer/accuracy/createdAt`;`alignWords`(`lib/word-align.ts:24`)逐词 diff 只在内存渲染(`app/listening/page.tsx:973-990`) |
| 5 | SRS priority=100 永不裁剪 | `lib/study-engine.ts:100` priority 100;`:232` `if (last.type==="srs") break; // never drop SRS`;`:92` 注释 "always first"。并存分流点在此 |
| 6 | completeTask 标死、语料不重现 | `lib/task-pool.ts:76-78` 只置 `completed:true`;`:16` `.and(!completed)` 过滤;无 `exposureCount/lastSeenAt` |
| 7 | study-engine 收 profile 但不读 level | `lib/study-engine.ts:79-87` 解构无 `profile`(`:29` opts 有,`:87` 跳过)。listening 只是 gap 轮换候选(`:137-144`, priority `50+gapDays`) |
| 8 | Dexie 升级模式清晰,现 v7 | `lib/db.ts:253-266` v7 加 `part2Sessions`;v6(`:236-251`)`.upgrade()` backfill 范式可复用。索引规范:只能索引标量,`content:Record<string,unknown>` 不可索引(`:202`) |
| 9 | AssessmentResult 无 locatedLevel | `lib/types.ts:208-217` 仅 6 分 + `levelBand` + `date`;`locatedLevel/atCeiling/atFloor/lowConfidence` 是 session-only(`app/assessment/page.tsx:452-458` 注释亲口承认) |
| 11 | cron 恒 B1、无用户态、教材式 | `app/api/cron/generate-tasks/route.ts:10` `DEFAULT_LEVEL="B1"`;`:12-50` 9 类 prompt 全 `"You are an English teacher"` + 主题 `random`(`:44`);cron 是无状态 `GET`(`:60`),与单机 studyLevel 脱钩;`poolTaskSchemas` 数组 schema + `generateObject` 无 array mode(`route.ts:95`),shadowing 路径理论风险 |

## 阻点定案(审核中暴露,已拍板)

### 阻点 A — cron 无用户态恒 B1(架构矛盾)
cron 无状态服务端定时任务,与单机 studyLevel 脱钩。pool 命中=永远 B1,W2 水平驱动在 pool 路径失效。
**定案(用户选 A):** cron 生成**多水平梯度**——每类任务按 A1/A2/B1/B2/C1 各生成一份(或按用户实际出现的 studyLevel 子集),用户按 `studyLevel` 取对应那份。保留服务端预生成速度,解决脱钩。

### 阻点 B — 顶层数组 schema + 无 array mode
`app/api/review/route.ts:82-90` 与 `cron/route.ts:95` 都没传 array mode;`review/route.ts` 返回 `{object}`。
**查证消解:** `ai@7.0.29` 已确认 `generateObject`(deprecated 但可用)、`Output.array`、`generateText` 均存在。但 `Output.array` 的 `element` 需 object schema,纯 `z.array(z.string())` 不适配。
**定案:** W1 把 `listeningShadowingSchema` 从裸字符串数组改成 **object 形态** `{ topic, context, sentences: [{ text, translation, imageryHint }] }]`——既满足方法论语境字段,又落在 object/array API 都支持的形态,绕开纯字符串数组尴尬。三处(client/cron/`poolTaskSchemas`)同步改。

### 阻点 C — 三处独立维护
见 Global Constraints。每个 schema/prompt 改动三处同步。

## 外部依赖实证(已查清,无暗雷)

| 项 | 查证来源 | 结论 | 影响 |
|---|---|---|---|
| `@vercel/blob` 音频 | 实装 `@vercel/blob@2`;Vercel docs `/docs/functions/limitations` | function **请求体 4.5MB 上限**;包 250MB(标准)/5GB(Large Functions beta) | W4b 音频不经 function body;**客户端直传 blob**(SDK 支持直传)。不经服务端转 |
| YouTube 字幕服务端 | Vercel docs + 本会话 curl 实证 | yt-dlp 在 serverless 别扭(需 Large Functions、Hobby 300s 不够、4.5MB body 限);**纯 HTTP 抓 `timedtext` 字幕无需 yt-dlp**(已验证可从 watch HTML 解析带签名字幕 baseUrl) | **W4c 路线:服务端纯 HTTP 抓字幕文本(不下载视频),前端 YouTube iframe 播放**。无二进制/超时风险,视频文件不落 blob |
| Edge-TTS 口音 | `edge-tts-universal@1.4.0` 实装,导出 `UniversalVoicesManager`/`listVoices`,含多音色常量 | 多口音可用 | W1 可加口音选择,改 `app/api/tts/route.ts:28` 固定 `en-US-AriaNeural` |
| AI SDK array mode | `ai@7.0.29` 实装 + context7(`/vercel/ai`) | `generateObject` 弃用但可用,`Output.array` 可用(element 需 object) | 阻点 B 消解见上 |
| SRS 并存 | 用户定案 | 双轨:fluency 线(语料交替重复)+ mastery 线(现有 SRS 完整保留) | W3 不动 `nextReview` 索引及其消费者 |
| 原版素材范围 | 用户定案 | 三级全做(4a 文本+4b 音频+4c 视频) | W4 三阶段渐进 |
| 部署约束 | 用户"你来查" | 已查清(见 YouTube 行) | W4c 技术路线定 |

---

## W0 — 前置清理与类型扩展(不动逻辑)

**依赖:** 无。**影响面:** `lib/types.ts`、`lib/db.ts`、死代码清理。**目的:** 后续各阶段消费的类型前置就位。

### W0-T1 清死代码
- [ ] 确认 `app/reader/[id]/page.tsx:113-141` `parseWordLookupResponse` 是否死代码(当前查词已改用 dictionaryapi.dev);若是,移除。
- [ ] `components/feedback/word-card.tsx` 三个死 prop(`phonetic/partOfSpeech/level` 从无调用者传值):W2-T4 决定接线还是先移除。本 task 仅标注,不擅自删(可能在 W2 接线)。
- [ ] `tsc --noEmit` + `eslint` 过。

### W0-T2 类型扩展(后续各阶段前置条件)
- [ ] `lib/types.ts` `ListeningExercise`(`:167-174`) 加 `stage?: string`、`missedWords?: string[]`、`subjectiveComprehension?: number`(1-3 自评画面是否浮现)、`listensCount?: number`、`materialId?: string`。
- [ ] `lib/types.ts` `AssessmentResult`(`:208-217`) 加 `locatedLevel?: string`、`atCeiling?: boolean`、`atFloor?: boolean`、`lowConfidence?: boolean`。
- [ ] `lib/types.ts` `PoolTask`(`:198-206`) 加 `topic?: string`、`mediaType?: "text"|"audio"|"video"`、`sourceKind?: "authentic"|"generated"`、`exposureCount?: number`、`lastSeenAt?: Date`、`lastSeenIn?: string`。`completed` 保留(不再是唯一生命周期标志)。理顺 `assignedDate: string|null`(`:203` 注释 null)与 `task-pool.ts:50` 用 `""` 查询的不一致。
- [ ] `lib/types.ts` `Card`(`:21-41`) 加 `sourceSentence?: string`(真实原句,与 `context`/`example` 分离)、`imageryHint?: string`、`materialId?: string`。
- [ ] `lib/types.ts` `LearningProfile`(`:140-151`) 加 `interests?: string[]`、`activeTopic?: string`、`primaryTrack?: "fluency"|"mastery"`(默认 `"fluency"`)。
- [ ] `lib/types.ts` 新增统一 `Material` 实体:`{ id, topic, mediaType, sourceKind, sourceUrl?, title, content, sentences?: [{text, translation?, imageryHint?, audioStartMs?, audioEndMs?}], difficulty?, vocabCoverage?, exposureCount, lastSeenAt, createdAt }`。当前素材散落无统一实体——"同素材反复精听/跨场景重现"的前提。
- [ ] `tsc --noEmit` 过(类型新增不破坏存量)。

### W0-T3 Dexie v8 升级
- [ ] `lib/db.ts` 加 `db.version(8).stores({ ... v7 全部表, materials: "id, topic, mediaType, createdAt", poolTasks: "id, type, assignedDate, completed, createdAt, topic" })`。注:`topic` 加进 poolTasks 索引串(交替重复池要按 topic 查);`exposureCount/lastSeenAt/lastSeenIn` 是非索引标量不需入索引串。
- [ ] `.upgrade(async tx => {...})` backfill:给存量 `poolTasks` 行补 `exposureCount: 0`;`cards` 补无;profile 补 `primaryTrack: "fluency"`, `interests: []`。参照 v6(`:236-251`)范式。
- [ ] `EntityTable<Material,"id">` 加入 `db` 类型声明(`:17-29`)。
- [ ] `tsc --noEmit` + `eslint` 过。提交。

**W0 验证:** 类型扩展不破坏存量,`tsc --noEmit` 0 error,Dexie v8 升级跑通(本地既有 DB 能升级)。

---

## W1 — 听力模块落地"直接听懂"三招(L1)

**依赖:** W0。**影响面:** `app/listening/page.tsx`(先抽组件)、`components/listening/`(新)、`lib/tts.ts`、`lib/ai-schemas.ts`、两处 prompt、`app/api/tts/route.ts`。**目的:** 方法论主战场。

### W1-T1 抽出 ShadowingTab(先抽再加功能)
Step 0: `app/listening/page.tsx` 1400 行,先把 `ShadowingTab`(`:693-1026`,334 行)抽到 `components/listening/shadowing-tab.tsx`,行为不变。单独提交。
- [ ] 抽 `ShadowingTab` + 其依赖(`RecStatus`、`parseShadowingSentences`、`callReview` 包装)到 `components/listening/shadowing-tab.tsx`。
- [ ] `app/listening/page.tsx` import 回去,行为不变。
- [ ] `tsc --noEmit` + `eslint` 过。提交。

### W1-T2 shadowing schema 改 object 形态(阻点 B 定案)
- [ ] `lib/ai-schemas.ts` 改 `listeningShadowingSchema`(`:204`) 为 `z.object({ topic: z.string(), context: z.string(), sentences: z.array(z.object({ text: z.string(), translation: z.string(), imageryHint: z.string() })) })`。
- [ ] 同步 client prompt `lib/task-pool-generate.ts:60-64`:`buildPrompt` 的 listening-shadowing 分支改为要求生成该 object(含 topic/context/每句 translation/imageryHint)。
- [ ] 同步 cron prompt `app/api/cron/generate-tasks/route.ts:25-29`:`TASK_PROMPTS["listening-shadowing"]` 同步。
- [ ] `poolTaskSchemas`(`ai-schemas.ts:277-287`) 自动引用新 schema(已绑定)。
- [ ] 消费侧 `shadowing-tab.tsx`:`poolTask.content as unknown as string[]` 双重 cast 改为按 object 读取;运行时守卫相应更新。
- [ ] `tsc --noEmit` 过。提交。

### W1-T3 3 步学习阶段状态机
- [ ] `shadowing-tab.tsx` 新增 `Stage = "imagine" | "listen" | "recall"`,与 `RecStatus` 正交。参照 `app/assessment/page.tsx:70` 的 `Phase` 机器范式。
- [ ] `imagine` 阶段:展示 `topic`+`context`(语境/背景),引导用户脑中构造画面,**不露英文原文**(方法论核心:先有画面)。
- [ ] `listen` 阶段:播放声音(可变速 W1-T5)、可重听计数。
- [ ] `recall` 阶段:才允许露英文文本/中文 translation、可录音复述(现有 Record→Check 逻辑挪到此阶段)。
- [ ] 阶段推进 UI(下一步按钮按阶段而非纯 index+1)。
- [ ] `tsc --noEmit` 过。

### W1-T4 字幕三态门控
- [ ] `shadowing-tab.tsx` 加 `subtitleMode = "hidden" | "english" | "bilingual"` state。`imagine` 阶段强制 `hidden`;`recall` 阶段允许 `english`/`bilingual`。
- [ ] 替换当前 `:906-908` 无条件直显为按 mode 门控。参照 Comprehension 的 `{submitted && ...}` 门控模式(`app/listening/page.tsx:594-598`)。
- [ ] 中文 translation 字段已在 W1-T2 schema 中。

### W1-T5 连续变速(客户端 playbackRate)
- [ ] `lib/tts.ts:37-57` `playBlob` 给 `new Audio()` 加 `audio.playbackRate` 参数(0.5–2.0),`speak()`/`fetchTtsBlob` 透传 rate 选项。客户端连续调速省网络。
- [ ] `shadowing-tab.tsx` `listen` 阶段:变速控件(0.5x/0.75x/1x/1.25x/1.5x/2x)替掉固定 Normal/Slow 两档(`:911-927`)。方法论:听不清减速→能听清后加速到 1.5x/2x 增加强度→回常速。
- [ ] 保留服务端 `rate` 路径作"音质优先固定慢速"可选(不强制)。
- [ ] `tsc --noEmit` 过。

### W1-T6 盲点持久化
- [ ] `shadowing-tab.tsx` `stopAttempt()`/`checkAnswer`:除 `accuracy`,把 `alignWords` 的 `result.original.filter(e=>!e.correct).map(e=>e.word)` 存入 `missedWords[]`。
- [ ] `saveListeningExercise` 扩展写 `stage`/`missedWords`/`listensCount`/`subjectiveComprehension`(recall 阶段加个 1-3 自评)
- [ ] `app/history/page.tsx:167-174` 摘要展示同步(可选,W2 再做)。

### W1-T7 长句切短语(listening 也要有入口)
- [ ] `lib/ai-schemas.ts` 新增 `sentenceChunkSchema = z.object({ chunks: z.array(z.object({ phrase: z.string(), meaning: z.string(), role: z.string() })) })`。
- [ ] `shadowing-tab.tsx` `listen` 阶段"实在听不懂"分支:调 `/api/review` 切短语逐个理解。替代 reader 的 `readerSentenceAnalysisSchema = z.string()`(`ai-schemas.ts:79`)散文式为结构化。
- [ ] reader 路径后续 W2 评估是否一并迁移(不强制本 task)。

### W1-T8 走神/专注处理
- [ ] 复用 `lib/speech.ts:371-538` `startBargeInListen` 的 RMS onset 做"静默过久提示拉回注意力";或轻量做"走神点按钮重置阶段"。方法论要求全程 100% 专注。
- [ ] 每次走神点重置,计 `focusResets`(可选展示)。

### W1-T9 口音选择(可选,清单 14)
- [ ] `app/api/tts/route.ts:28` 固定 `en-US-AriaNeural` 改为接受 `voice` 参数;用 `edge-tts-universal` `listVoices` 提供多口音(en-GB/en-AU/en-IN 等)。
- [ ] `lib/tts.ts` 透传 voice 选项。`shadowing-tab.tsx` 加口音选择 UI(方法论提到口音训练)。

**W1 验证:** listening/shadowing 在 `imagine(语境不露原文)→listen(变速)→recall(露文本录音)` 三步下完整跑通;字幕三态生效;盲点入库;tsc+eslint 0 error。

---

## W2 — 评估回流驱动精细度 + 单词真实语境(L2)

**依赖:** W0、W1(可与 W1 部分并行)。**目的:** 方法论"水平决定步骤精细度"+ 单词绑定真实原句。

### W2-T1 评估结果入库
- [ ] `lib/types.ts` 已加字段(W0-T2)。`app/assessment/page.tsx:847-859` `saveAssessment` 写入 `locatedLevel/atCeiling/atFloor/lowConfidence`。当前 session-only(`:452-458`)。

### W2-T2 study-engine 读 level + 派生精细度
- [ ] `lib/study-engine.ts:79-87` 解构加入 `profile`。由 `profile.assessedLevel`(或 `studyLevel`)派生 `stepGranularity: "fine"|"medium"|"coarse"`(低水平 fine,高水平 coarse)。
- [ ] `StudyStep` 加 `stepGranularity?` 字段(`:12-20`)。
- [ ] listening/reader 等消费 `stepGranularity`:fine → `imagine` 强制展示语境、`listen` 默认降速、长句自动切短语;coarse → 跳过语境引导、原速起、不切短语。对照方法论"新手步骤繁琐、老手简化"。

### W2-T3 listening 消费精细度
- [ ] `shadowing-tab.tsx` 读 `stepGranularity` 决定 W1-T3 的阶段步骤数(fine 多步、coarse 少步)。

### W2-T4 单词绑定真实原句
- [ ] `app/conversation/[id]/review/page.tsx:72` system prompt 加 `sourceSentence` 字段(保留另造 `example`,两者并存,不删真实语境)。`:473` 同时存 `sourceSentence` + `example` 到 `Card`。
- [ ] `app/ielts/part2/[id]/page.tsx:520` 同改。
- [ ] `lib/types.ts` `Card.sourceSentence`(W0-T2 已加)。
- [ ] reader 路径本就存真实原句(`app/reader/[id]/page.tsx:366`),对照确认统一。

### W2-T5 WordCard 升级 + 复用
- [ ] `components/feedback/word-card.tsx` 加 `audioSrc?`/`sourceSentence?`/`imageryHint?` 槽位。接上 W0-T1 的三个死 prop(`phonetic/partOfSpeech/level`)实际传值。
- [ ] 让 `app/reader/[id]/page.tsx`(:695-730 内联 popup)和 `app/srs/page.tsx`(:286-321 内联)复用 WordCard,替掉两处内联。
- [ ] `tsc --noEmit` + `eslint` 过。提交。

**W2 验证:** 评估结果入库可读;`study-engine` 派生 granularity 并驱动 listening 流程;conversation/IELTS 的 Card 同时存真实原句与另造句;WordCard 在 reader/srs 复用。

---

## W3 — SRS 并存双轨 + 语料交替重复池(L3-SRS)

**依赖:** W0。**原则:** 不动 SRS 的 `nextReview` 索引及消费者(`db-helpers.ts:59,176,186`、`app/srs/`、`app/page.tsx:444`、`srs-algorithm.ts` 全保留)。新建语料级交替重复池与之并行。

### W3-T1 study-engine 双轨分流
- [ ] `lib/study-engine.ts` 新增 `primaryTrack` 分流(`profile.primaryTrack`)。mastery 模式:SRS 保留 `priority:100` 置顶(`:92-104`)。fluency 模式:SRS 让位给语料池(降优先级或不强制第一)。
- [ ] `:232` `if (last.type==="srs") break` 在 fluency 模式下解除"SRS 永不裁剪"。
- [ ] 文案 `:101-103`(overdue 告警)在 fluency 模式下降级或隐藏。

### W3-T2 语料交替重复池
- [ ] `lib/task-pool.ts` `completeTask`(`:76-78`) 改为:不只置 `completed`,而是 `exposureCount++`、`lastSeenAt=now`、`lastSeenIn=<模块>`。
- [ ] 调度(`task-pool.ts:9-59`)从"日历派发+overdue 追账"改为"按 topic 从池抽取 + 允许已见素材按 `exposureCount` 重现"。保留 `assignedDate` 但不再追账式 overdue 置顶(fluency 模式)。
- [ ] 跨模块复用:listening/reader 等都能命中同一 `Material`(W0 `Material` 实体)。查询不再 `.and(!completed)` 一刀切过滤,而是按 `exposureCount`/`lastSeenAt` 决定重现概率。
- [ ] `getPoolStatus`(`:62-73`)同步。

### W3-T3 cron 多水平梯度(阻点 A 定案)
- [ ] `app/api/cron/generate-tasks/route.ts:10` 去掉 `DEFAULT_LEVEL="B1"`,改为对每类任务按 A1/A2/B1/B2/C1(或用户实际出现的 studyLevel 子集)各生成一份,带 `difficulty` 标记。
- [ ] 客户端按 `profile.studyLevel` 取对应水平的 pool 任务。`app/page.tsx:200-275` 同步过滤。
- [ ] `TASK_PROMPTS`(`:12-50`)参数化 level。

### W3-T4 文案分层
- [ ] `app/guide/page.tsx:323-324`("SRS 永远优先")、`:711-780`("按科学间隔安排复习""每天坚持复习")降为 SRS(mastery)模式内局部主张;新增 fluency 线叙事(遗忘正常、交替重复)。
- [ ] 顺手修正 `:617-620`(说浏览器 TTS 实为 Edge TTS)、`:625`(说三种模式实为四种)、`:634-636`(说发音分但代码标非发音分)等已过期文案。

**W3 验证:** fluency 模式下 SRS 不再无条件第一;语料可跨场景重现(exposureCount 增长);cron 多水平梯度生效;文案分层;tsc+eslint 0 error。SRS 词卡复习功能完整保留可用。

---

## W4 — 原版素材三级(L3-素材)

**依赖:** W0 `Material` 实体。三级渐进,每级独立可交付。

### W4-T1 文本原版(4a)
- [ ] 把 reader 的 `/api/extract`(`@mozilla/readability`+`linkedom`)入口扩到 listening:抓取真实英文文本用 Edge-TTS 朗读。
- [ ] `app/listening/page.tsx` 新增"从 URL/粘贴导入真实素材"入口(参照 `app/reader/page.tsx:402-461`+`:348`)。
- [ ] onboarding(`app/onboarding/page.tsx:19-57`,当前只选 CEFR)加兴趣/主题选择步;`LearningProfile.interests`(W0-T2)持久化。
- [ ] `vocabCoverage`(`app/reader/[id]/page.tsx:341-354`)按 topic 聚合(存进 `Material.vocabCoverage`),实现"单一主题到 98% 再扩展"。`app/roadmap/page.tsx:259-264` 展示主题级进度。
- [ ] 素材标 `sourceKind:"authentic"`、`mediaType:"text"`,入 `Material` 表。

### W4-T2 音频原版(4b)
- [ ] 客户端直传音频到 `@vercel/blob`(不经 function body——4.5MB 限制)。blob 存 url 到 `Material.sourceUrl`。
- [ ] 字幕(srt/vtt)解析 + 与音频对齐校验(复用 `lib/word-align.ts` 对齐思路)。`Material.sentences` 带 `audioStartMs/audioEndMs`。
- [ ] listening 音频播放器(逐句跳转、变速、AB 循环)。有声书/播客可用。
- [ ] 素材标 `mediaType:"audio"`。

### W4-T3 视频原版(4c)
- [ ] 服务端纯 HTTP 抓 YouTube 字幕文本:解析 watch HTML 拿 `captionTracks` baseUrl(本会话已 curl 验证可行)→ fetch `timedtext` json3 → 落 `Material.sentences`。**不下载视频文件**(Vercel serverless 部署约束:大文件/超时风险)。
- [ ] 前端 YouTube iframe 嵌入播放(按主题:房车旅行/隐士生活等,方法论原话)。
- [ ] 字幕即 listening 素材:边看视频边按句精听(W1 三招流程复用)。
- [ ] 素材标 `mediaType:"video"`、`sourceUrl=watch URL`。
- [ ] 服务端 `app/api/youtube-captions/route.ts`(新):接受 videoId,返回字幕数组。注意 YouTube 反爬/签名时效(本会话验证签名 URL 有 `expire` 字段)。

**W4 验证:** 文本真实素材可朗读精听;音频上传+字幕对齐播放;YouTube 字幕可服务端抓取并配 iframe 播放;主题兴趣选择+98% 门槛进度可见。

---

## 风险点(贯穿各阶段)

1. **Next.js 16 破坏性改动**(AGENTS.md):W1 抽组件、W4 加 route 前读 `node_modules/next/dist/docs/` 相关篇。
2. **prompt 三处硬编码**:每个 schema 改动同步 client(`task-pool-generate.ts`)/cron(`generate-tasks/route.ts`)/`poolTaskSchemas`。
3. **顶层数组 schema**:W1-T2 改 object 形态后消解;勿再新增裸 `z.array(z.string())`。
4. **Dexie 索引只能标量**:W0-T3 `topic` 入索引串,`exposureCount` 等非索引;`content:Record<string,unknown>` 不可索引。
5. **cron 签名时效**:W4-T3 YouTube 字幕 baseUrl 带 `expire`,服务端抓取要实时解析而非缓存签名。
6. **Vercel 4.5MB body 限**:W4-T2 音频直传 blob,不经 function。

## 执行顺序

W0 → W1(主战场) ‖ W2(可与 W1 并行) → W3 → W4(4a→4b→4c)。每阶段独立可交付、独立验证、独立提交。
