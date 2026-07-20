# 子项目 D · 判分对齐 / 测评心理测量 / SRS 调度 — 设计文档

> 状态：自主定稿（沿用 A/B/C 的"你审"授权模式）
> 日期：2026-07-20
> 分支：feat/data-correctness-foundation（A、B、C 已完成，D 在此叠加）
> 背景调研：`scratchpad/d-subsystems.md`（三子系统现状与缺陷，含精确 file:line）

## 0. 纯本地约束对"心理测量"的界定

本 app 单用户、纯本地、无服务端、无群体作答数据。因此**做不到群体标定的 IRT/CAT**（题目难度/区分度参数需大样本估计）。D 的"心理测量改良"= 务实工程改良：固定/显式分级的难度锚、基础自适应、诚实的客观/主观分离、加权合成、信度caveat与边界重测。所有"不做真正 IRT"处如实标注，不宣称超出本地能力的严谨性。

## 1. 目标

1. **判分对齐（D1）**：消灭三种不兼容量表混用；建立集中 rubric（锚定分档 + 共享 label + prompt 片段）；修 `diffWords` 位置索引级联 bug；修 listening `accuracy` 伪同名；把日常成绩轻量回流为一个"建议 level"信号。
2. **SRS 正确性（D2）**：修 relearning 会话重入死代码；加 `lapses` + lapse-aware 间隔；每日新卡上限 + new/review 分离；修单次 lapse 塌 "new"。
3. **测评重设计（D3）**：打破"在用户自身 level 生成题目"的自指循环；加权合成（客观 > 单次主观）；边界重测；客观/主观 UI 分离；进度迁 Dexie；onboarding 补 A1/C2 且诚实标注自述未验证。

## 2. D1 · 判分对齐设计

- **统一量表 = 0-100（存储 + 展示 + 聚合）**。决策：主观 AI 打分仍让模型返回 **1-10**（LLM 在小整数量表上更稳），但经**集中归一化**立即转 0-100 存/显/聚合。文档明记：1-10×10 只有 10 个可辨级、方差/信度低于客观百分比，**禁止与客观 % 等权平均**（合成时分权重 + 标注，见 D3）。
- **新 `lib/rubric.ts`**：
  - `SCORE_BANDS`（0-100 → 锚定分档 + 描述，如 90-100 Excellent / 75-89 Good / 60-74 Fair / <60 Needs Work，替换 writing/translate 各自重复的 `scoreLabel`）。
  - `scoreLabel(score0to100)`：唯一实现，writing + translate + （新增）conversation 复盘统一用。
  - `rubricSnippet(dimension)`：给各主观打分 prompt 注入**共享的锚定分档语言 + 1-2 个 few-shot 校准锚**（如"7=能达意但有明显母语腔与偶发语法错；9=接近母语流畅准确"），消除 8 个 prompt 各自即兴。
  - `normalizeTo100(aiScore1to10)`：唯一的 ×10 归一入口（不再散落各页 `*10`）。
- **`diffWords` 对齐修复**（`app/listening/page.tsx`）：位置索引改为 **LCS/编辑距离对齐**，使"漏一词/插一词"只影响该处而非级联后续全错——accuracy 反映真实词重叠。抽到 `lib/rubric.ts` 或新 `lib/word-align.ts`（听写/跟读共用）。
- **listening `accuracy` 伪同名修复**：给 `ListeningExercise` 加 `scoreKind: "objective" | "subjective"`（migration）；`getListeningAggregate`（`lib/db-helpers.ts`）默认只聚合 objective，subjective（prediction 连贯性）分开或排除，不再混平均。
- **成绩回流"建议 level"（保守）**：新 `lib/level-signal.ts` 计算近 N 次跨模式表现的滚动指标 → **仅生成一个"建议调整 studyLevel"的提示**（用户确认才改），绝不静默覆盖 studyLevel（避免一串简单题误升级）。回流入口：dashboard/settings 显示"近期表现偏高/低，建议重测或调级"。

## 3. D2 · SRS 正确性设计

- **relearning 会话重入（最大 bug）**：`app/srs/page.tsx` 会话不再一次性冻结 `sessionCards`。改为**动态队列**：评 Again/Hard 且新 interval 短（< 阈值，如 <1 天）的卡在本会话内按其 due 顺序**重新入队**，短 relearning 步真正生效；review/new 卡完成即出队。保持"不无限循环"（Again 的 1min 步在会话内至多重现有限次，或以"本会话已重现"标记 + 时间推进为界）。
- **`lapses` 字段 + lapse-aware**（`lib/types.ts` Card + `lib/db.ts` migration + `lib/srs-algorithm.ts`）：Again 时 `lapses += 1`；post-lapse interval **按 pre-lapse interval 缩放**（如 `max(relearnStep, round(prevInterval * LAPSE_FACTOR))`，LAPSE_FACTOR 如 0.2），成熟卡失败不再与新卡首错等同归零。
- **mastery 不塌 "new"**：`computeMasteryLevel` 加 **`relearning`** 桶——lapses>0 且当前 interval 短的卡显示 relearning（非 new），browse/`getVocabCounts` 相应区分。
- **每日新卡上限 + new/review 分离**：`getDueCards` 拆为 `getDueReviews` + `getNewCards(dailyNewLimit)`；会话按"先 review 后 new、新卡受每日上限"组装（上限存 settings，默认如 20/天）。避免一次加 200 新卡挤占到期复习。

## 4. D3 · 测评重设计

- **打破自指循环（核心）**：题目不再全在 `profile.studyLevel` 生成。改为在**显式目标 level 谱**生成一组分级题（如 current−1 / current / current+1 各若干），据"表现在哪一档开始下滑"定位 → 真正能探测高于/低于当前 level。纯本地不建群体 IRT，如实标注为"启发式分级探测"。
- **加权合成**：`finishAssessment` 不再等权平均。**客观章节（reading/cloze）权重高于单次主观章节（writing/conversation）**（反映信度差异）；权重值 + 依据写进代码注释与 UI 说明。
- **边界处理**：composite 落在带边界 ±阈值内 → 标"低置信"并提示重测/取靠低档，不静默跨带。
- **客观/主观 UI 分离**：radar/结果页标注哪些轴客观（%）、哪些主观（LLM 单次判断），不再呈现为等精度四轴。
- **进度迁 Dexie**：assessment 进行中进度从 localStorage 迁到 IndexedDB（与全 app 一致）；保留过期清理。
- **onboarding 诚实化**：`app/onboarding/page.tsx` 自述卡补 **A1/C2**；`initProfile` 把自述记为 `studyLevel` 但 `assessedLevel` 标"未验证"（或留空/低置信），直到真跑一次 assessment——不把自述当心理测量结果同权重。
- **CEFR 阈值出处**：保留分档但注释其为**启发式**（非群体标定）；如可，向公开 CEFR 描述/CEFR-J 粗对齐并注明。

## 5. 数据/迁移

- Card 加 `lapses: number`（默认 0）；ListeningExercise 加 `scoreKind`；可能 LearningProfile 加"assessedLevel 置信/来源"标记。均走 `lib/db.ts` 版本升级（沿用 A 的 v4 迁移模式，backfill 既有行）。
- 既有 1-10 存量分数（WritingSession.review.score、TranslationExercise.score）：迁移时归一到 0-100 或在读取处经 `normalizeTo100` 兼容（决策在 D1 plan 定，倾向读取处兼容 + 新写入存 0-100，避免破坏历史）。

## 6. 决策记录

- 量表：统一 0-100；主观 AI 仍出 1-10 后集中归一；主观不与客观等权。
- rubric：集中 `lib/rubric.ts`（分档 + label + prompt 锚 + 归一）。
- diffWords：改编辑距离对齐（消级联）。
- listening accuracy：加 scoreKind 区分客观/主观，聚合不混。
- 成绩回流：仅"建议调级"提示，不静默改 studyLevel。
- SRS：动态会话队列修 relearning；lapses + lapse-aware；relearning mastery 桶；每日新卡上限 + new/review 分离。
- 测评：分级谱探测破循环；加权合成；边界重测；客观/主观分离；Dexie 进度；onboarding A1/C2 + 诚实 assessedLevel。
- 纯本地：不做群体 IRT/CAT，所有分级/难度为启发式并如实标注。

## 7. 拆分为 plan

- **D1 · 判分统一**：`lib/rubric.ts`（新）+ `lib/word-align.ts`（新，或并入 rubric）+ 各页归一化接线（conversation review / writing / translate / listening / assessment 的 ×10 与 label）+ `diffWords` 对齐修复 + ListeningExercise `scoreKind`（migration）+ `getListeningAggregate` 分离 + `lib/level-signal.ts`（新，建议调级）。
- **D2 · SRS 正确性**：`lib/srs-algorithm.ts`（lapses、lapse-aware、relearning 桶）+ `app/srs/page.tsx`（动态会话重入队列）+ `lib/db.ts`（Card.lapses migration）+ `lib/db-helpers.ts`（getDueReviews/getNewCards + 每日新卡上限）+ settings 新卡上限控件。
- **D3 · 测评重设计**：`app/assessment/page.tsx`（分级谱探测、加权合成、边界、客观/主观分离、Dexie 进度）+ `app/onboarding/page.tsx`（A1/C2 + 诚实 assessedLevel）+ 相关 schema/db-helpers。

## 8. 验证策略

- 无测试框架：`tsc --noEmit` + `eslint`（分支现 0 error，保持）+ 推理核对 + 关键算法（编辑距离对齐、lapse 间隔、会话重入、加权合成）的代码走查与手算样例。
- migration 正确性靠代码走查（沿用 A 的迁移评审标准：确定性 backfill、幂等、Dexie 版本升级合法）。
- 不起 dev server。

## 9. 非目标

不做：群体标定 IRT/CAT（纯本地不可行，如实标注）；重写 study-engine 活动调度（仅 D2 顺带修 SRS 时间上限低估如低成本）；语音/prompt 教学内容（子项目 C 已处理语音）；新学习模式。D 只做"判分可比可信 + 测评可辩护 + SRS 调度正确"。
