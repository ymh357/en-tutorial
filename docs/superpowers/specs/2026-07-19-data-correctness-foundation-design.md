# 子项目 A · 数据与正确性地基 — 设计文档

> 状态：待用户审阅
> 日期：2026-07-19
> 前置决策（已定）：
> - 架构：**接受纯本地**（无账号、无云端用户数据）。
> - 本轮范围：这是"全面改造"拆分出的**第一个子项目**，后续 B（AI 契约与个性化）、C（语音链路）、D（判分与测评效度）各自独立立项。
> - 决策点 1（测评写回等级）：**a — 需用户确认**。
> - 决策点 2（词形还原）：由本文定稿为 `wink-lemmatizer`，待审阅确认。

---

## 1. 目标

为整套应用打一层可信的数据与正确性地基，使后续 B/C/D 有稳定依托，并止住一批会导致崩溃、丢数据、功能不可用或安全问题的高危缺陷。具体交付四类：

1. **数据模型统一**：Dexie v3→v4，账本单一数据源，profile 的"评估等级"与"出题难度"分离。
2. **基础设施统一**：日期/时区、lemma+词表、导出/导入备份。
3. **高危 bug 止血**：一批相互独立、低风险、可立即验证的修复。
4. **迁移**：老数据平滑迁移到新模型，幂等、可回滚验证。

## 2. 架构约束

- Next.js 16 App Router + React 19 + TypeScript strict + Dexie(IndexedDB) + Zustand。沿用现有模式，不引入新框架。
- 所有持久数据在浏览器 IndexedDB + localStorage/sessionStorage。
- 代码注释英文；UI 文案沿用现状（语言策略不在本子项目范围）。
- 验证：无测试框架配置（本项目未配置测试运行器）；以 `npx tsc --noEmit` + `npx eslint . --quiet` 零错误 + 关键路径浏览器手动验证为准。
- 遵循分阶段执行：实现计划按 phase 切，每 phase 触及文件数受控。

## 3. 范围边界

### 3.1 纳入本子项目

- Dexie v3→v4：`DailyStats` 扩列、新增 `assessments` 表、`LearningProfile` 字段分离、迁移。
- `lib/date.ts`：统一日期/时区工具，消灭本地/UTC 分裂。
- 账本统一：听力/翻译完成度归入 IndexedDB，删除 localStorage 聚合。
- `lib/lemma.ts` + 分级词表资产：统一 lemma 派生 + 词形还原。
- `lib/backup.ts` + Settings：全量导出/导入、Danger Zone 加固。
- P0 bug 止血清单（见 §8）。

### 3.2 明确不在本子项目（留给后续，避免同段代码改两遍）

- 语音链路回路 bug（TTS 未 await、Read aloud 绕过互斥、字幕覆盖、权限死循环）、whisper 接入 → **子项目 C**。
- AI 结构化契约（`generateObject`/zod、`maxOutputTokens`、低温）、**成本追踪修正**（服务端回传真实 model+usage）→ **子项目 B**（都要动 route，集中改）。
- 判分对齐算法、测评心理测量学重构（题量/加权/锚题）、SRS 的 leech/新卡队列/relearning → **子项目 D**。
- 任务池的深层设计问题（"展示即完成"、未分配池死代码、按等级出题、按用户去重）→ 归入后续任务池专项或子项目 B；本子项目只修其中的**安全/竞态/幂等**三处（见 §8）。

> 说明：`studyLevel` 字段分离后，"按真实等级出题/生成任务池"的完整改造仍属子项目 B；本子项目只负责把字段准备好并让现有读取点切换到正确字段。

## 4. 数据模型变更（Dexie v3 → v4）

### 4.1 `DailyStats` 扩列

`lib/types.ts` 的 `DailyStats` 增加两个非索引字段：

```
listeningCount: number;
translationCount: number;
```

`lib/db-helpers.ts` 中所有构造空 `DailyStats` 的位置（`getTodayStats`、`updateTodayStats`、`incrementTodayStat`）补齐这两字段初始值 0。

### 4.2 新增 `assessments` 表

- 将 `AssessmentResult` 类型从 `app/assessment/page.tsx` 移到 `lib/types.ts`（`history` 页当前从页面导入该类型，改为从 `lib/types.ts` 导入）。
- v4 `stores` 增加：`assessments: "id, createdAt"`。
- `app/assessment/page.tsx` 的 `saveAssessment` 改写 Dexie `db.assessments`；`app/history/page.tsx` 改从 Dexie 读（配合 `useLiveQuery`，顺带修复"同标签页新测评不刷新"）。

### 4.3 `LearningProfile` 字段分离

`lib/types.ts` 的 `LearningProfile` 增加：

```
assessedLevel: string;  // 最近一次测评得出的等级，仅用于展示
studyLevel: string;     // 出题 / 内容难度，可手动调整
```

保留 `initialCefrLevel`（历史留痕，不再作为难度来源）。

**读取点切换**（把"当前难度来源"从 `initialCefrLevel` 改为 `studyLevel`）：
- 出题/内容难度：`app/conversation/[id]/page.tsx`（`buildSystemPrompt`）、`app/reader/*`、`app/writing/*`、`app/listening/*`、`app/translate/*`、`app/assessment/page.tsx`（生成用）、任务池本地生成 `lib/task-pool-generate.ts`。
- 展示等级：`app/profile`、`app/roadmap`、`app/settings`、Dashboard。用 `assessedLevel`（无测评时回退 `studyLevel`）。
- `app/settings/page.tsx` 手动改等级 → 改的是 `studyLevel`；并同步重算 `knownWordsBase`（修复"改等级不重算词表"）。

### 4.4 测评写回策略（决策点 1 = a：需确认）

`app/assessment/page.tsx` 的 `finishAssessment`：
- 始终更新 `assessedLevel`（= `cefrFromScore(总分)`）。
- 若 `cefrFromScore` 结果 ≠ 当前 `studyLevel`，弹确认对话框："本次测评为 X，是否将学习难度更新为 X？"。用户确认才写 `studyLevel`，否则只留 `assessedLevel`。
- 顺带统一两套 CEFR 阈值：`levelBandForScore` 与 `cefrFromScore` 从**单一阈值源**派生粗/细两种粒度（消除展示与存储不一致）。

### 4.5 迁移（`db.version(4).upgrade`）

在一个幂等的 upgrade 事务里：
1. 遍历 `dailyStats`，为缺失的记录补 `listeningCount`/`translationCount` = 0；随后从 `listeningExercises`/`translationExercises` 明细表按 `createdAt` 的本地日期聚合，回填对应日的计数。（`en-tutor-listening-stats`/`en-tutor-translation-stats` 两个 localStorage 聚合无独有数据，无需迁移，迁移后停止写入。）
2. 从 `localStorage["en-tutor-assessments"]` 读旧测评历史 → 写入 `assessments` 表；成功后保留 localStorage 原值一个版本周期（不立即删，降风险），代码不再读它。
3. 现有 `learningProfile` singleton：`studyLevel = assessedLevel = initialCefrLevel`（为空时回退默认）。

迁移全部走"读旧→写新→不破坏旧"，可重复执行不产生重复数据（回填计数前先归零当日聚合基线，或用"来自明细的确定性重算"而非累加）。

## 5. 基础设施统一

### 5.1 `lib/date.ts`

抽出并统一（当前在 `app/page.tsx`、`app/profile/page.tsx`、`lib/db-helpers.ts`、`lib/task-pool.ts` 四处重复）：

```
formatDate(d): string        // YYYY-MM-DD，本地时区
today(): string
parseDate(s): Date
startOfWeek(d): Date
daysBetween(a, b): number
daysSince(d): number         // 含损坏日期的 NaN 防御
```

**全站统一使用本地时区**。修复点：
- `app/page.tsx`（池预热 gate、听力/翻译完成检测均改本地日期）、`lib/task-pool-generate.ts`、`lib/study-engine.ts`（`daysSince` 的 NaN 防御）。
- 服务端 `app/api/cron/generate-tasks` 与 `app/api/tasks/today`：cron 生成的任务按"目标日"标注；客户端按**客户端本地日期**匹配拉取；cron 调度时间提前到能覆盖东八区 0 点（`vercel.json`）。回退到前一天 blob 时，导入的任务标记为"今天"而非昨天（避免立即 overdue）。

> 注：任务池的完整重构（展示即完成等）不在此；这里只把日期口径拉齐，消除 UTC/本地混用导致的"当天不亮勾/立即过期"。

### 5.2 `lib/lemma.ts` + 词表资产

- **依赖**：`wink-lemmatizer@3.0.4`（MIT）。运行时传递依赖：`wink-lexicon`、`wink-porter2-stemmer`（均 winkjs 家族，纯 JS，无 native）。因 `wink-lexicon` 含英文词典有体积，**通过动态 `import()` 做代码分割**，只在需要 lemma 的路径加载，不进主 bundle。
- `lib/lemma.ts` 暴露单一 `lemmatize(word): string`（名词/动词/形容词还原，回退小写 trim）。全站三处不一致的 lemma 派生（`app/srs/browse`、`app/writing/[id]`、`app/conversation/[id]/review` 的"前 N 词"）统一走它。
  - 例外：错误/表达类卡片的 key 不适合用 lemma（是短语不是词），改为不做 lemma 去重、用来源+原文本身作 key（见 §8 相关项）。
- **词表资产**：引入完整分级词表替换 `lib/frequency-list.ts` 的占位小表。推荐 **NGSL（New General Service List，约 2800 核心词，含高频功能词）+ CEFR 映射**，放 `public/` 按需 `fetch`。
  - 待实现第一步核实：确切词表文件来源、词数与授权（NGSL 为公开词表，需确认许可证并在仓库标注出处）。
  - `getKnownWordsForLevel`/`getWordLevel`/覆盖率/`isWordKnown` 全部改用新表 + `lemmatize` 后匹配。覆盖率的"已知词"= `knownWordsBase` ∪ `mastered` 卡的 lemma；`learning`/`familiar` 卡另作"学习中"单独统计并在 UI 区分展示，不混入"已知"（不再是当前"只认 mastered"的单一口径）。

## 6. 导出 / 导入备份

### 6.1 `lib/backup.ts`

- **导出**：把 Dexie 全部 9 张表 `toArray()` + 下列存储键打包成单个 JSON（含 `schemaVersion`、`exportedAt`）：
  - localStorage：`en-tutor-app`、`en-tutor-assessments`（迁移期内仍导）、`en-tutor-cost-records`、`en-tutor-daily-goal`、`en-tutor-dict-history`、`en-tutor-last-pool-gen`、`en-tutor-reading-questions-*`、`en-tutor-writing-draft-*`。
  - 不导出 `en-tutor-listening-stats`/`en-tutor-translation-stats`：账本统一后这两个聚合无独有数据（可从 Dexie 明细表完全重算），停止写入、不再导出；导入时若遇旧备份含这两个键则忽略。
  - sessionStorage：`en-tutor-assessment-progress`、`en-tutor-session-*`（skippedSteps，可选）。
  - 触发浏览器下载 `entutor-backup-YYYY-MM-DD.json`。
- **导入**：读文件 → 校验 `schemaVersion` 兼容 → **覆盖式**写回（Dexie 事务清表后 `bulkPut`；localStorage/sessionStorage 按键写回）→ reload。导入前二次确认（会覆盖现有数据）。版本不兼容时拒绝并提示。

### 6.2 Settings 与 Danger Zone

- Settings 增"导出全部数据 / 导入备份"入口。
- Danger Zone 清库：先提示"建议先导出"；改 **type-to-confirm**（输入指定词）；`db.delete()` 加超时兜底（当前多标签占用连接会无限挂起，"Clearing..." 永不结束）。

## 7. 受影响文件清单（概览）

- 类型/DB：`lib/types.ts`、`lib/db.ts`、`lib/db-helpers.ts`
- 基础设施：`lib/date.ts`(新)、`lib/lemma.ts`(新)、`lib/backup.ts`(新)、`lib/frequency-list.ts`(重写)、`public/` 词表(新)
- 账本统一：`app/listening/page.tsx`、`app/translate/page.tsx`、`app/roadmap/page.tsx`、`app/profile/page.tsx`、`app/page.tsx`、`hooks/use-db.ts`
- 字段分离读取点：`app/conversation/[id]/page.tsx`、`app/reader/*`、`app/writing/*`、`app/assessment/page.tsx`、`app/settings/page.tsx`、`app/onboarding/page.tsx`、`lib/task-pool-generate.ts`
- 备份：`app/settings/page.tsx`
- P0 止血：见 §8（各自文件）
- 部署：`vercel.json`（cron 时间）

> 实现时按 phase 切分（每 phase 聚焦一个主题、受控文件数）。

## 8. P0 bug 止血清单

每项：定位 → 修复方向 → 验证。

1. **reader 详情页违反 Hooks 规则（会崩溃）** — `app/reader/[id]/page.tsx` 的 `useRef`/`useEffect` 在多个提前 `return` 之后。修：hooks 全部上移到任何 `return` 之前。验证：loading→loaded 切换不报错。
2. **SRS 会话跳卡 + 提前结束** — `app/srs/page.tsx` 用递增 index 遍历随 live query 收缩的数组。修：会话开始把到期集合快照到本地 state，一次性遍历，不随 live query 变动。验证：N 张到期卡能全部逐张过完。
3. **对话 `createdAt` 每次存盘被重置** — `app/conversation/[id]/page.tsx` 持久化用 `put` 整条替换。修：首存后保留原 `createdAt`。验证：多轮对话后"最近"列表日期不变为当前时刻。
4. **深链已复盘对话被 `review:null` 覆盖（丢数据）** — 同文件恢复逻辑。修：存在 `review` 时禁止在聊天页覆盖（只读或跳 review）。验证：打开已复盘对话的 chat URL 不清空复盘。
5. **cron 鉴权可被 `"Bearer undefined"` 绕过（安全）** — `app/api/cron/generate-tasks/route.ts`。修：`CRON_SECRET` 未配置时直接拒绝（500/401），不做字面量比较。验证：未配置密钥时任意请求被拒。
6. **URL 导入 TLS 必败 + 3xx 直接失败（功能不可用）** — `app/api/extract/route.ts` 把 hostname 改写为 IP。修：保留原 hostname 走正常 DNS，用受控 dispatcher/lookup 固定已校验 IP（保留 SNI）；受控跟随同源/安全重定向并逐跳 SSRF 校验。验证：常见 https 文章 URL（含 301）能成功导入。
7. **测评进度易丢 + 刷新题目错配** — `app/assessment/page.tsx`。修：进度 `sessionStorage`→`localStorage`（带过期）；`writingPrompt`/`conversationTopic` 纳入持久化快照，恢复时读回。验证：写到一半刷新/关标签页再进，题目与已写内容一致。
8. **Dashboard 池预热竞态双倍生成 + cron 无幂等** — `app/page.tsx` 的 get→add 非原子、catch 过大误入本地生成分支；`app/api/cron/generate-tasks` 的 blob `put` 无 `allowOverwrite`。修：预热改 `bulkPut`（幂等）+ 缩小 catch 只包 fetch；cron `put({ allowOverwrite: true })`。验证：双标签/重复触发不产生重复任务、不重复计费。
9. **词-句关联计数器取错句** — `app/reader/[id]/page.tsx` 把"总出现次数"当 occurrenceIndex。修：改用已传入但未使用的 `position` 定位句子。验证：点击某词，SRS 卡 context 是该词所在句而非最后一句。
10. **streak "打开即打卡"** — `app/page.tsx` 挂载即 `updateStreak`。修：移除挂载处调用，仅保留真实完成动作里的调用。验证：只打开 Dashboard 不做任何练习，streak 不 +1。
11. **Daily Goal 设置无消费方** — `app/page.tsx` 调 `generateStudyPlan` 未传 `targetMinutes`。修：读 `en-tutor-daily-goal` 传入。验证：改每日目标后计划时长随之变化。

> 关联小修（随 §5.2 lemma 统一一并处理）：写作/翻译 "Add to SRS" 在 lemma 已存在时静默不加却显示 "Added!" → 改为提示"已在词库"；错误/表达卡不用 lemma 去重。

## 9. 依赖变更

- 新增 `wink-lemmatizer@3.0.4`（MIT；传递依赖 `wink-lexicon`、`wink-porter2-stemmer`，纯 JS）。动态 import，代码分割。
- 新增词表数据文件（NGSL 或等价，放 `public/`）——非 npm 依赖，随仓库提交，标注出处与授权。

（遵"新依赖需确认"：以上待用户审阅本 spec 时确认后再安装。）

## 10. 错误处理原则

- 所有新增/改动的 Dexie 写入路径加 `catch`，失败给用户可见反馈，不静默丢进度。
- 迁移失败不阻塞应用启动（降级：缺列按默认值处理），并可重跑。
- 导入失败给明确原因（版本不兼容/文件损坏），不半写。

## 11. 验证策略

- `npx tsc --noEmit` 与 `npx eslint . --quiet` 必须零错误（若无 eslint 配置则说明）。
- 迁移：在含 v3 数据的库上执行 v4 升级，核对计数回填、assessments 迁入、profile 字段分离正确；重复打开应用不产生重复。
- 备份往返：导出 → 清库 → 导入，数据完整还原（浏览器手动）。
- 每个 P0 项按其"验证"步骤逐一手动复现确认。

## 12. 非目标（重申）

不做：语音/whisper、AI 结构化输出与成本修正、判分算法重写、测评题量与心理测量重构、SRS leech/新卡队列、任务池"展示即完成"等设计层重构、UI 语言策略。这些在 B/C/D 及后续专项处理。
