# 子项目 D · 判分对齐 / 测评心理测量 / SRS 调度 — 设计文档

> 状态：自主定稿（沿用 A/B/C 的"你审"授权模式）；已过一轮 opus 设计评审并据此修订（C1/C2/C3 + I1-I8 + Minor）。
> 日期：2026-07-20
> 分支：feat/data-correctness-foundation（A、B、C 已完成，D 在此叠加）
> 背景调研：`scratchpad/d-subsystems.md`（三子系统现状与缺陷，含精确 file:line）

## 0. 纯本地约束对"心理测量"的界定

本 app 单用户、纯本地、无服务端、无群体作答数据。因此**做不到群体标定的 IRT/CAT**（难度/区分度参数需大样本）。D 的"心理测量改良"= 务实工程改良：显式分级难度锚、基础自适应定位、诚实的客观/主观分离、加权、信度 caveat 与边界重测。所有"非真正 IRT"处如实标注。

## 1. 目标

1. **判分对齐（D1）**：消灭三种不兼容量表混用（统一 0-100）；集中 rubric（锚定分档 + 共享 label + prompt 校准片段 + 唯一归一入口）；修 `diffWords` 位置索引级联 bug（改编辑距离对齐）；修 listening `accuracy` 伪同名（mode 派生，零迁移）。
2. **SRS 正确性（D2）**：修 relearning 会话重入死代码（具体策略）；加 `lapses` + `lapsedInterval` + lapse-aware 毕业间隔；每日新卡上限 + new/review 分离；修单次 lapse 塌 "new"（relearning 桶）。
3. **测评重设计（D3）**：打破"在用户自身 level 生成题目"的自指循环（reading 分级谱定位）；客观定位 + 主观带标注调整（不等权平均）；边界重测；客观/主观 UI 分离；onboarding 补 A1/C2 且诚实标注自述未验证；CEFR_BANDS 补 A1/C2。

**顺序与 DB 版本（评审 I1）**：**D1 → D2 → D3**（D3 的合成消费 D1 的 `normalizeTo100`/rubric，且分数迁移须先落地）。预留 Dexie 版本：**D1 = v5，D2 = v6，D3 = v7**（后落地者据实 rebase 版本号，不并行抢占）。

## 2. D1 · 判分对齐设计

- **统一量表 = 0-100（存储 + 展示 + 聚合）**。主观 AI 打分仍让模型返回 **1-10**（LLM 小整数量表更稳），经**集中 `normalizeTo100`** 立即转 0-100。文档明记：1-10×10 仅 10 个可辨级、信度低于客观 %，**禁止与客观 % 等权平均**（D3 落实）。
- **新 `lib/rubric.ts`**：
  - `SCORE_BANDS` + `scoreLabel(score0to100)`：唯一实现（90-100 Excellent / 75-89 Good / 60-74 Fair / <60 Needs Work），替换 `app/writing/[id]/page.tsx:125-130` 与 `app/translate/page.tsx:100-105` 的两份逐字重复。
  - `rubricSnippet(dimension)`：给主观打分 prompt 注入**共享锚定分档语言 + 1-2 few-shot 校准锚**（如"7=达意但有母语腔与偶发语法错；9=接近母语流畅准确"），消除 8 个 prompt 各自即兴。
  - `normalizeTo100(aiScore1to10)`：唯一 ×10 归一入口（不再散落各页 `*10`）。
- **`diffWords` 对齐修复**（新 `lib/word-align.ts`，听写/跟读共用；`app/listening/page.tsx` diffWords 改调它）：位置索引 → **LCS/编辑距离对齐**，"漏一/插一词"只影响该处而非级联。**注（M3）**：新旧算法使历史 `accuracy` 行不完全可比，`getListeningAggregate` 会在切换点出现可见不连续——单用户可接受，如实记录。
- **listening `accuracy` 伪同名修复（评审 I3，零迁移）**：不新增字段。在 `lib/db-helpers.ts` 定义 `SUBJECTIVE_LISTENING_MODES = new Set(["prediction"])`；`getListeningAggregate` 默认只聚合客观 mode（dictation/comprehension/shadowing），subjective（prediction 连贯性）分开返回或排除，不再混平均。`accuracy` 的客观性完全由既有 `mode` 决定。
- **（评审 I8）不做 `lib/level-signal.ts`**：滚动"建议调级"引擎与测评自带的 level 建议（`app/assessment/page.tsx:813-818`，已用户确认）功能重复、且可能发出冲突提示——移出 D，defer。日常成绩回流 level 交给 D3 的测评（用户主动跑）。

## 3. D2 · SRS 正确性设计

- **relearning 会话重入（最大 bug；评审 I4 具体策略）**：`app/srs/page.tsx` 不再一次性冻结 `sessionCards`、也不再从 live `useDueCards` 派生。改为组件内**可变会话队列（state）**：
  - 会话开始把 due 集拍入队列；完成一张前进。
  - 评 **Again**（或 Hard 且新 interval < 1 天）的卡**重新追加到队列尾**，短 relearning 步在本会话真正生效。
  - **循环上界**：每张卡本会话至多重现 **N=2** 次；超过后即便再评 Again 也不再本会话重入（留给下次会话），防"每次都 Again"无限循环。
  - **进度条（`app/srs/page.tsx:224` `index/totalCards` 会因队列增长失真）**：重定义为 **已毕业不同卡数 / 本会话不同卡总数**（重入不增总数、不倒退进度）。
- **`lapses` + `lapsedInterval` 字段 + lapse-aware（评审 C2）**（`lib/types.ts` Card + `lib/db.ts` v6 migration，backfill 既有卡 `lapses:0`、`lapsedInterval` 省略/0 + `lib/srs-algorithm.ts`）：
  - 评 **Again** 时：`lapses += 1`；**记录 `lapsedInterval = <本次 lapse 前的 interval>`**；interval 设为短 relearning 步（~1min）。
  - **LAPSE_FACTOR 在 relearning 毕业时应用**（非 lapse 瞬间）：卡从 relearning 步毕业（下一次评 Good/Easy）时，间隔 = `max(relearnGraduateStep, round(lapsedInterval * LAPSE_FACTOR))`（LAPSE_FACTOR≈0.3），成熟卡失败后不再从零重建。毕业后清 `lapsedInterval`。
- **mastery 不塌 "new"（relearning 桶；评审 M1）**：`MasteryLevel` 加 **`"relearning"`**；`computeMasteryLevel`：`lapses>0 && interval < 7` → `relearning`（而非 `new`）。**须同步更新**：`app/srs/page.tsx:36`、`app/srs/browse/page.tsx:35` 的 `Record<MasteryLevel,…>`、`lib/db-helpers.ts:144` 的 `levels` 数组、`app/srs/browse/page.tsx:52-56` 的 filter 列表、`getVocabCounts` 返回（`lib/db-helpers.ts:150-155`）。**注（M2）**：既有因过去 lapse 而 `reps=0` 的卡无 lapse 历史，仍显示 "new" 直至再复习——可接受。
- **每日新卡上限 + new/review 分离（评审 I5）**：`getDueCards` 拆为 `getDueReviews()` + `getNewCards(remainingNewBudget)`。
  - **新卡计数**：`DailyStats` 加 `newCardsIntroduced`（v6 migration，backfill 0）；引入一张新卡时 +1；`remainingNewBudget = dailyNewLimit − today.newCardsIntroduced`。
  - `getNewCards` 按 **`masteryLevel === "new"`** 筛（**非** `reps===0`——relearning 卡也 reps=0，勿误计为新）。
  - 会话组装：**先 review（含 relearning）后 new，新卡受每日上限**。`dailyNewLimit` 存 settings（默认 20），新增 settings 控件。

## 4. D3 · 测评重设计

**（评审 C3）择一评分模型：客观章节定位 level，主观章节作带标注调整——不做等权 0-100 平均。**

- **reading = 主定位器（打破循环，评审 C3/I7）**：题目不在 `profile.studyLevel` 单点生成，而在**显式分级谱** `{current−1, current, current+1}` 各 **3 题 MCQ = 9 题**生成（每档 3 题，够粗定位、AI 成本可控）。**定位规则**：located level = 用户答对 ≥2/3 的**最高**档；命中谱边缘（最高/最低档仍 ≥2/3，或最低档都 <2/3）→ 标"触顶/触底，建议再测一次以收敛"（检测范围**每次 ±1 档**，如实告知，非全程定位）。**失败模式如实标注（I7）**：题目为 AI 生成非标定，LLM 对"难度"（尤其 MCQ 干扰项）校准不稳，可能信号反转；故 reading 定位 + cloze 确认双客观信号互校。
- **cloze = 客观确认**：在 located level 生成 1 篇 8 空；其 % 在带内微调（Upper/Lower 子档）。
- **writing + conversation = 主观带标注调整（不等权平均）**：各出 1-10 → `normalizeTo100`。二者合成一个**低权重 confidence/adjustment**：仅能把最终子档 **±1** 微调，并设**低置信标记**（当主观与客观定位分歧大时，UI 明示"主观项与客观定位不一致，结果置信低，建议重测"）。**绝不**把主观 0-100 与客观 % 等权平均进 composite。
- **CEFR_BANDS 补 A1/C2（评审 I6）**：现 `app/assessment/page.tsx:179-188` 底 A2、顶 C1。扩到 **A1…C2**，与 onboarding 新增的 A1/C2 自述一致（否则 C2 自述者永远被测评"降级"）。分档注释标注为**启发式**（非群体标定），如可向公开 CEFR/CEFR-J 描述粗对齐并注明。
- **边界处理**：located level 命中谱边缘或主客观分歧 → 标"低置信"+ 提示重测/取靠低档，不静默跨带。
- **客观/主观 UI 分离**：结果页/radar（`app/assessment/page.tsx:1233-1238`）标注哪些轴客观（%）、哪些主观（LLM 单次判断），不再呈现为等精度四轴。
- **onboarding 诚实化（评审 M5，无新字段）**：`app/onboarding/page.tsx` 自述卡补 **A1/C2**；`initProfile`（`lib/db-helpers.ts:38-49`）把自述记入 `studyLevel`，但 **`assessedLevel` 留空**直到真跑一次 assessment（展示处已回退到 `studyLevel`：`app/page.tsx:203`、`app/roadmap/page.tsx:214`）——不把自述当心理测量结果同权重，无需新增置信字段。
- **（评审 M4）测评进行中进度保持 localStorage**：迁 Dexie 会把同步 `useState` 初始化（`app/assessment/page.tsx:366-370`）变异步、为 24h 短命快照引入 loading/restore 复杂度，边际价值低——defer，保留 localStorage。
- **（评审建议）D3 拆两 plan**：D3a = reading 分级谱定位 + cloze 确认 + 主观带标注调整 + CEFR_BANDS 扩展（算法核心）；D3b = 客观/主观 UI 分离 + 边界提示 + onboarding A1/C2。降低单 plan 体量与 churn。

## 5. 数据 / 迁移

- **分数就地迁移（评审 C1，v5）**：既有 1-10 存量分数在 Dexie 升级时**就地 ×10**（一次性、确定性、幂等——绑版本升级只跑一次），迁后字段统一 0-100，新写入一律 0-100。**不采用读取处兼容**（同字段混两量表、存 `7` 歧义，不可辩护）。
  - 迁移目标：`writingSessions[].review.score`、`translationExercises[].score`、**`conversationReviews` 的 `scores.{fluency,accuracy,vocabulary,complexity}`（评审 I2，嵌套对象，逐字段 ×10）**。
  - **勿重复迁移**：`AssessmentResult.writingScore`（已 0-100，`app/assessment/page.tsx:684`）、`ListeningExercise.accuracy` 的 prediction（已 ×10，`:1186`）——不同表/字段，跳过。
  - **展示点从 /10 翻 /100（随迁移一并改）**：`app/history/page.tsx:136,160,183`、`app/writing/[id]/page.tsx:608,688`、`app/translate/page.tsx:721`、`app/listening/page.tsx:1286`。
- **D2（v6）**：Card 加 `lapses:number`（默认 0）、`lapsedInterval?:number`；DailyStats 加 `newCardsIntroduced:number`（默认 0）。backfill 既有行。
- **D3（v7）**：无新增持久字段（scoreKind 已砍、进度留 localStorage、profile 无新字段）；仅逻辑/UI + CEFR_BANDS 扩展。
- 迁移正确性靠代码走查（沿用 A 的标准：确定性 backfill、幂等、Dexie 版本升级合法、嵌套字段完整枚举）。

## 6. 决策记录

- 量表：统一 0-100；主观 AI 出 1-10 后集中 `normalizeTo100`；主观不与客观等权。存量分数**就地 ×10 迁移**（含对话复盘嵌套分）。
- rubric：集中 `lib/rubric.ts`（分档 + label + prompt 锚 + 归一）。
- diffWords：改编辑距离对齐（消级联，新 `lib/word-align.ts`）。
- listening accuracy：**mode 派生**区分客观/主观（`SUBJECTIVE_LISTENING_MODES`），零迁移。
- **不做** level-signal（与测评建议重复）。
- SRS：可变会话队列修 relearning（≤2 次重入/会话、进度按毕业不同卡数）；`lapses`+`lapsedInterval`，LAPSE_FACTOR 在**毕业时**应用；relearning mastery 桶；每日新卡上限（DailyStats.newCardsIntroduced 计数）+ new/review 分离（getNewCards 按 masteryLevel==="new"）。
- 测评：reading 分级谱（±1 档，每档 3 题）定位 + cloze 确认 + 主观带标注 ±1 微调（不等权平均）；CEFR_BANDS 扩 A1-C2；边界/分歧标低置信重测；客观/主观 UI 分离；进度留 localStorage；onboarding A1/C2 + assessedLevel 留空至真测。
- 顺序：D1→D2→D3；DB 版本 v5/v6/v7。
- 纯本地：不做群体 IRT/CAT，分级/难度为启发式并如实标注失败模式。

## 7. 拆分为 plan

- **D1 · 判分统一（v5）**：`lib/rubric.ts`（新：SCORE_BANDS/scoreLabel/rubricSnippet/normalizeTo100）+ `lib/word-align.ts`（新：编辑距离对齐）+ 分数就地 ×10 迁移（`lib/db.ts` v5，含 conversationReviews 嵌套）+ 各页归一化接线（conversation review / writing / translate / listening / assessment 的 ×10 与 label 统一）+ `diffWords` 改调 word-align + `getListeningAggregate` 客观/主观分离（`SUBJECTIVE_LISTENING_MODES`）+ 展示点 /10→/100。
- **D2 · SRS 正确性（v6）**：`lib/srs-algorithm.ts`（lapses/lapsedInterval/LAPSE_FACTOR 毕业应用、relearning 桶）+ `app/srs/page.tsx`（可变会话队列重入、进度重定义）+ `lib/db.ts` v6（Card.lapses/lapsedInterval、DailyStats.newCardsIntroduced）+ `lib/db-helpers.ts`（getDueReviews/getNewCards 按 masteryLevel、新卡计数、mastery 数组更新）+ settings 每日新卡上限控件。
- **D3a · 测评算法核心（v7）**：`app/assessment/page.tsx` reading 分级谱定位 + cloze 确认 + 主观带标注 ±1 + 加权/合成重写 + CEFR_BANDS 扩 A1-C2 + 相关 schema（`lib/ai-schemas.ts` 分级 reading 生成）。
- **D3b · 测评 UX 诚实化**：`app/assessment/page.tsx` 客观/主观 UI 分离 + 边界/低置信提示；`app/onboarding/page.tsx` A1/C2 + `initProfile` assessedLevel 留空。

## 8. 验证策略

- 无测试框架：`tsc --noEmit` + `eslint`（分支现 0 error，保持）+ 推理核对 + 关键算法（编辑距离对齐、lapse 毕业间隔、会话重入循环界、分级定位、加权）的代码走查与手算样例。
- migration 正确性靠代码走查（确定性/幂等/版本升级合法/嵌套字段枚举完整；分数 ×10 只跑一次）。
- 不起 dev server。

## 9. 非目标

不做：群体标定 IRT/CAT（纯本地不可行，如实标注）；`lib/level-signal.ts` 滚动建议引擎（defer，与测评建议重复）；测评进度迁 Dexie（边际价值低，留 localStorage）；重写 study-engine 活动调度；语音/prompt 教学内容（C 已处理）；新学习模式。D 只做"判分可比可信 + 测评可辩护 + SRS 调度正确"。
