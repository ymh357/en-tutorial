# 子项目 D 背景调研 — 判分 / 测评 / SRS 现状与缺陷

> 来源：Explore 只读测绘（2026-07-20）。纯本地约束（单用户、无服务端、无总体校准数据）——决定了"心理测量"在此只能是务实改良，非群体标定 IRT。

## 1. 判分对齐（scoring）

**每个 AI/客观打分点、量表、来源：**
| 面 | 位置 | 量表 | 来源 |
|---|---|---|---|
| 对话复盘 | `lib/ai-schemas.ts:34-40` conversationReviewSchema；渲染 `app/conversation/[id]/review/page.tsx:294-307` | 4 维各 **1-10** | 单次 LLM 直给 fluency/accuracy/vocabulary/complexity；不合成、不入 profile |
| 写作 round1 | `lib/ai-schemas.ts:103-109` | contentScore **1-10** | 整体单次；被丢弃（只存 round2） |
| 写作 round2 | `lib/ai-schemas.ts:123-133`；`app/writing/[id]/page.tsx:389-398` | score **1-10** | 整体 LLM；`scoreLabel()` L125-130（≥9/≥7/≥5 阈值）；存 WritingSession.review.score；不入 profile |
| 翻译评估 | `lib/ai-schemas.ts:156-169`；`app/translate/page.tsx:100-105` | score **1-10** | 整体 LLM；`scoreLabel()` 与写作**逐字重复**；存 TranslationExercise.score；session 均值仅组件 state |
| 测评-阅读 | `app/assessment/page.tsx:556-564` | **0-100** | 客观 correct/total*100（5 MCQ） |
| 测评-完形 | `app/assessment/page.tsx:632-640` | **0-100** | 客观串匹配（8 空） |
| 测评-写作 | `lib/ai-schemas.ts:243-246`；`app/assessment/page.tsx:684` | AI 1-10 → `*10` | 主观整体，×10 塞进 0-100 合成 |
| 测评-对话 | `lib/ai-schemas.ts:248-253`；`app/assessment/page.tsx:778-781` | AI 3×1-10 → avg×10 | 仅 5 轮 |
| 听力-听写/跟读 | `app/listening/page.tsx:134-151` diffWords | **0-100** | 客观**位置索引**词匹配（无对齐/编辑距离——漏一词后续全错级联） |
| 听力-理解 | `app/listening/page.tsx:529-537` | **0-100** | 客观 3 MCQ |
| 听力-预测 | `lib/ai-schemas.ts:212-215`；`app/listening/page.tsx:1186` | AI 1-10 → `*10`，**存进与客观模式同一个 `ListeningExercise.accuracy` 字段** | 主观连贯性判断被贴上"accuracy"标签 |

**跨切缺陷：**
1. **三种不兼容量表混用且被平均**：原始 1-10、客观 0-100%、1-10×10 派生的 0-100。×10 让它们"看起来"可比但方差/可靠度不同；`finishAssessment`（`app/assessment/page.tsx:791-802`）把主观 writing×10 与客观 reading% 当同类平均。
2. **无共享 rubric**：~8 个打分 prompt 各自即兴（"Score 1-10 based on..."），无锚定分档描述、无 few-shot 校准样例。ai-schemas 只集中了 *shape*（zod）不含 *rubric*。
3. **原始 AI 数字零校准**：无自一致性重采样、无锚点、无 clamp（仅 zod min/max）。单次 LLM 数字直入 DB/UI 当真值。
4. **成绩几乎不回流 profile**：仅 Assessment（`app/assessment/page.tsx:815,827`）+ settings 手动写 assessedLevel/studyLevel。对话/写作/翻译/听力成绩**从不**影响 studyLevel（studyLevel 被 translate:208 / listening:1333 / conversation:122 消费）→ 日常表现对后续内容难度零影响，直到用户手动跑月度测评。
5. **`scoreLabel()` 逐字重复** 于 writing:125-130 与 translate:100-105（对话复盘则无 label 只裸数字）。
6. **`ListeningExercise.accuracy` 是伪同名字段**（`lib/types.ts:157-164`）：按 mode 有三种语义（词转写准确度 / MCQ% / 主观连贯×10）；`dbHelpers.getListeningAggregate()`（`lib/db-helpers.ts:201-210`）无 mode filter 时把它们混平均。

## 2. 测评心理测量（`app/assessment/page.tsx`）

- **章节**：Reading(5 MCQ) → Cloze(8 空) → Writing(≥30 词，静态 5 选 1) → Conversation(5 轮主观)。
- **合成/映射**：`finishAssessment` L791-823 = 4 章**等权平均**（可靠度差异极大：5 项 vs 8 项 vs 1 篇 vs 5 轮单次主观）。CEFR = 硬编码 lookup（`CEFR_BANDS` L179-188，8 档，阈值 0/30/45/55/65/75/85/95）**无出处**（非 CEFR-J / 非 IELTS 换算），像肉眼取整——即席。
- **核心结构缺陷——难度不建模 + 循环性**：阅读/完形 passage 在**用户自己当前 studyLevel** 生成（L507，`cefrLevel = profile?.studyLevel || "B1"` L374）。无固定分级题库、无 IRT 难度/区分度、无自适应分支 → 测题难度锚定在"想确认的那个 level"，**结构上无法探测用户高于/低于当前 level**（天花板/地板效应）→ 用户可能永远被钉在起点 level。
- **无信度/误差估计**：题量极小（5/8/1/5），单次猜对/歧义题即摆动 20%；无 CI/SEM/多式平均。
- **无边界处理**：`bandForScore()` L190-197 仅走升序取最后达标阈值；44 vs 45 = A2 vs B1 无重测提示。
- **初始 level 100% 自述**：`app/onboarding/page.tsx:19-45` 选 4 张静态卡（A2/B1/B2/C1，无 A1/C2），`initProfile()`（`lib/db-helpers.ts:38-49`）直接把自述当 assessedLevel（与后续心理测量结果同权重）。
- **客观/主观混入同一 composite/radar**（`RadarChart` L1233-1238）：无精度差异标注。
- **进度存 localStorage**（`ASSESSMENT_PROGRESS_KEY` L226-251，1 天过期）——与全 app Dexie-first 不一致。

净判：合格的练习 quiz UX，但非可辩护的分级工具（无题目标定、无自适应、无信度、任意合成权重、自指难度循环）。

## 3. SRS（`lib/srs-algorithm.ts`, `app/srs/page.tsx`, `lib/db-helpers.ts`, `lib/types.ts`）

- **算法** `computeNextReview`（`lib/srs-algorithm.ts:26-79`）= 4 键（Again/Hard/Good/Easy）**Anki 式**（非教科书 SM-2 的 0-5 质量公式）；固定每键增量。ease 下限 `MINIMUM_EASE=1.3` **已正确实现**（L41/44/53/64）。
  - Again→reps=0, interval≈1min, ease-0.2；Hard→ease-0.15, ×1.2；Good→ease+0.05, reps0→1d/1→3d/else round(×ease)；Easy→ease+0.15, reps0→4d/else round(×ease×1.3)。`nextReview = now + interval 天`（instant ms 数学，**无时区 bug**，正确）。
  - `computeMasteryLevel` L15-24：reps=0→new；interval<7→learning；<30→familiar；≥30 且 reps≥3→mastered。
- **due 查询** `getDueCards(limit=50)`（`lib/db-helpers.ts:51-58`）= `cards.where("nextReview").belowOrEqual(now).limit(50)`。**无 new/review 分队列、无每日新卡上限、无交错比例控制**。

**具体 bug / 过简：**
1. ease 下限已对——**不需修**。
2. **最大 bug：relearning 步实际是死代码**。`app/srs/page.tsx:81-84,96-97` 会话开始**一次性**快照 due 集入 `sessionCards`，只前进 `index`；评 Again 的卡写回 DB（`handleRate` L112-132）~1min 后到期但**从不重新插回当前会话队列** → 1min/10min 短步只在下次开 /srs（多半次日）才生效，relearning 名存实亡。
3. **无 lapse 计数/无 lapse severity**：`Card`（`lib/types.ts:15-33`）无 `lapses` 字段。成熟卡失败与新卡首次失败被同等处理（reps=0, 固定~1min），不按 pre-lapse interval 缩放。
4. **单次 lapse 即塌回 "new"**：`computeMasteryLevel` reps=0→"new"，Again 必致 → mastered 卡一次错评即在 `getVocabCounts()`/browse 显示为全新，无 relearning 中间桶。
5. **无每日新卡上限 / 无 new-vs-review 交错**：唯一上限是 `getDueCards(50)`。新卡创建即 `nextReview: new Date()`（立即到期——`app/conversation/[id]/review/page.tsx:206`, `app/writing/[id]/page.tsx:478`, `app/translate/page.tsx:504`, `app/srs/browse/page.tsx:142`）→ 一次加 200 新卡会按时间戳挤占 50 卡会话、压过真正到期的旧复习。
6. `getNextIntervals`（L81-87）每卡渲染重算 4 次——纯函数、无害、小低效。
7. SRS 引擎本身**无时区 bug**（instant 数学）。`study-engine.ts` 的 `daysSince` 用 `lib/date.ts` 日历日——已正确迁移，无 bug。
8. **`study-engine.ts` 不是 SRS 算法**：`generateStudyPlan` L76-238 是"今天建议哪些活动"的时间盒/轮转调度；硬编码 `SRS_MINUTES_PER_CARD=1/3`、SRS 建议时间上限 5min（`SRS_MAX_MINUTES`）无视 backlog，大 backlog 会低估。

## D 设计要点（纯本地务实）
- **判分**：统一 0-100 量表 + 集中 rubric 模块（锚定分档 + few-shot）；客观/主观显式分开不混平均；`scoreLabel` 抽共享；修 listening accuracy 伪同名（按 mode 分字段或分开聚合）；成绩回流一个滚动 level 估计（轻量）。
- **测评**：打破循环性——题目在**显式目标 level 谱**（低/平/高于当前）生成而非用户自身 level；简单自适应起点 + 分档；诚实客观/主观分离；合成加权（客观权重高于单次主观）；边界重测提示；进度迁 Dexie。纯本地不做群体 IRT（如实标注）。
- **SRS**：修 relearning 队列（Again 卡当会话内重插）；加 `lapses` 字段 + lapse-aware 间隔；每日新卡上限 + new/review 分离/交错；修单次 lapse 塌 new（加 relearning 桶）。
