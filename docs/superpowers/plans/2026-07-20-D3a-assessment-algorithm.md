# 子项目 D / D3a · 测评算法核心（破循环 + 加权/定位 + CEFR A1-C2）— Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 打破"在用户自身 studyLevel 生成题目"的自指循环：reading 改为在**分级谱**（current−1/current/current+1 各 3 题）生成并**定位** level；cloze 在定位 level 确认（档内 Upper/Lower）；writing/conversation 作**有界主观调整**（客观主导、不等权平均）；CEFR_BANDS 扩到 A1-C2；低置信/触边标记。纯本地启发式（非群体 IRT，如实标注）。

**Architecture:** 新纯函数模块 `lib/assessment-scoring.ts`（CEFR 阶梯、spread、locate、桥接合成 → 隔离算法便于审阅/手算）。`lib/ai-schemas.ts` 加 `assessmentGradedReadingSchema`（3 子测 × 3 题）。`app/assessment/page.tsx` reading 段改分级生成 + 3 passage UI + 定位；cloze 在定位 level；`finishAssessment` 用桥接合成。`AssessmentResult` 形状不变（overallScore 反推与 levelBand 一致 → history 兼容），**无 v7 迁移**。D3b 处理结果页客观/主观分离 + 边界提示 + onboarding A1/C2。

**Tech Stack:** Next.js 16、React 19、TS strict、Dexie、ai@7/zod schema。

## Global Constraints

- TS strict；纯本地；注释英文。无测试框架：`tsc --noEmit` + `eslint`（保持 0）+ 推理核对 + 算法手算样例。不起 dev server；无 0g 实网调用（生成靠既有 /api/review 契约，不实跑）。
- Git：每 task 提交；用户已授权。commit 末尾附：
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SDA8JvMdjpqLaxXC7gLC9M
  ```

## 位置 & 依赖

子项目 D 第三个 plan（D1/D2 完成）。spec §4。背景 file:line: `scratchpad/d-subsystems.md §2`。

**关键既有事实：**
- `cefrLevel`（`app/assessment/page.tsx:374` 附近）= `profile?.studyLevel || "B1"`（自指源）。
- `CEFR_BANDS`（`:180-189`）8 档，A2(Lower)0 → C1(Upper)95，无 A1/C2；`bandForScore`（:191-198）升序取最后达标；`levelBandForScore`/`cefrFromScore`（:200-201）。
- reading：`startReading`（:504-555）单 passage 5 MCQ @cefrLevel（`assessmentReadingGenSchema`）；`submitReading`（:557-565）correct/5*100 → readingScore。
- cloze：`startCloze`（:568-631）8 blanks @cefrLevel（`assessmentClozeGenSchema`）；`submitCloze`（:633-641）→ clozeScore。
- writing/conversation：主观，D1 后经 `normalizeTo100` 存 0-100（`:684`/`:778-781`）。
- `finishAssessment`（:792-824）：`composite = round((reading+cloze+writing+conv)/4)`（等权）；`overallScore=composite`；`levelBand=levelBandForScore(composite)`；`cefr=cefrFromScore(composite)` → 存 AssessmentResult + assessedLevel + pendingLevel。
- `confirmStudyLevelUpdate`（:826-833）`getKnownWordsForLevel(pendingLevel as CefrLevel)`——`CefrLevel` 类型须含 A1/C2（Task 1 核实/扩展 `lib/frequency-list.ts`）。
- state（:377-459）：readingData/readingAnswers/readingScore、clozeData/…、writingScore、conversationScore、finalResult、progress(localStorage)。
- 结果页 radar `abilityScores`（:1234）/`RadarChart`（:255,:1311）——**D3b 处理分离**，D3a 只保证数据可喂入。

## File Structure（分 2 phase）

- Phase 1：`lib/assessment-scoring.ts`（新，纯函数）+ `lib/ai-schemas.ts`（graded reading schema）+ `lib/frequency-list.ts`（CefrLevel A1/C2 核实）。
- Phase 2：`app/assessment/page.tsx`（reading 分级 + 定位 + cloze@located + finishAssessment 桥接 + CEFR_BANDS 扩 + state/UI）。

---

## Phase 1 — 纯算法模块 + schema（3 文件）

### Task 1: `lib/assessment-scoring.ts`（新，纯函数——隔离便于审阅/手算）

**Files:** Create `lib/assessment-scoring.ts`; verify/extend `lib/frequency-list.ts` `CefrLevel`.

- [ ] **Step 0:** 读 `lib/frequency-list.ts` 确认 `CefrLevel` 是否含 `"A1"`/`"C2"`；若无则扩展为 `"A1" | "A2" | "B1" | "B2" | "C1" | "C2"` 并确保 `getKnownWordsForLevel` 对 A1/C2 有合理返回（A1 最小已知集、C2 最大）。report 说明。
- [ ] **Step 1: 写模块。**
  ```ts
  // Pure, local, heuristic assessment scoring. NOT group-calibrated IRT (a
  // single-user local app has no population data) — the leveling is a
  // heuristic spread-probe: generate items one level below / at / above the
  // user's current level, locate where performance drops, then let cloze pick
  // the within-level sub-band and subjective sections nudge it (bounded, so an
  // unreliable single-shot LLM judgment can never override the objective
  // location by more than one sub-band).

  export type Cefr = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
  export const CEFR_LADDER: Cefr[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

  // Representative 0-100 midpoint + [min,max] range for each CEFR level, so a
  // located level maps to a score (for AssessmentResult.overallScore / history
  // trend) and back (levelBand). Evenly partitions 0-100 across 6 levels.
  export interface CefrRange { level: Cefr; min: number; mid: number; max: number; }
  export const CEFR_RANGES: CefrRange[] = CEFR_LADDER.map((level, i) => {
    const width = 100 / CEFR_LADDER.length; // ~16.67
    const min = Math.round(i * width);
    const max = Math.round((i + 1) * width);
    return { level, min, mid: Math.round((min + max) / 2), max };
  });

  export const cefrIndex = (level: Cefr): number => {
    const i = CEFR_LADDER.indexOf(level);
    return i < 0 ? CEFR_LADDER.indexOf("B1") : i; // default B1 if unknown
  };

  // The 3-level spread around the user's current level, clamped to ladder ends.
  export const spreadLevels = (current: Cefr): Cefr[] => {
    const i = cefrIndex(current);
    const lo = Math.max(0, i - 1);
    const hi = Math.min(CEFR_LADDER.length - 1, i + 1);
    const out: Cefr[] = [];
    for (let k = lo; k <= hi; k++) out.push(CEFR_LADDER[k]);
    return out; // 2 (at an end) or 3 levels
  };

  export interface SubtestScore { level: Cefr; correct: number; total: number; }
  export interface Location {
    level: Cefr;
    atCeiling: boolean; // passed the hardest offered level → may be higher
    atFloor: boolean;   // failed even the easiest offered level → may be lower
  }

  // Locate = highest offered level with >= passMark (default 2/3) correct.
  // Ceiling/floor flags drive a "retest to converge" hint (detection is ±1
  // level per run — the spread only spans current±1).
  export const locateLevel = (
    subtests: SubtestScore[],
    passRatio = 2 / 3
  ): Location => {
    const ordered = [...subtests].sort(
      (a, b) => cefrIndex(a.level) - cefrIndex(b.level)
    );
    const passed = (s: SubtestScore): boolean =>
      s.total > 0 && s.correct / s.total >= passRatio;
    let located = ordered[0].level;
    let anyPassed = false;
    for (const s of ordered) {
      if (passed(s)) { located = s.level; anyPassed = true; }
    }
    const hardest = ordered[ordered.length - 1];
    const easiest = ordered[0];
    return {
      level: anyPassed ? located : easiest.level,
      atCeiling: passed(hardest),
      atFloor: !passed(easiest),
    };
  };

  export interface FinalBand {
    overallScore: number; // 0-100 for AssessmentResult (consistent w/ band)
    cefr: Cefr;
    band: string;         // e.g. "B1 (Upper)"
    lowConfidence: boolean;
  }

  // Bridge: located level = anchor. cloze% picks within-level sub-band
  // (Upper/Lower). subjective (writing+conversation avg, 0-100) nudges bounded
  // to +/- half a level, and the TOTAL deviation from the located midpoint is
  // clamped to +/- one level width, so subjective never overrides location by
  // more than a sub-band. lowConfidence when subjective disagrees strongly with
  // the objective location, or reading hit a ceiling/floor edge.
  export const computeFinalBand = (
    loc: Location,
    clozePct: number,       // 0-100
    subjectiveAvg: number   // 0-100 (already-normalized writing+conversation avg)
  ): FinalBand => {
    const range = CEFR_RANGES[cefrIndex(loc.level)];
    const width = range.max - range.min;
    // cloze within-level: 50% → midpoint, 100% → top of level, 0% → bottom.
    const clozeOffset = (clozePct / 100 - 0.5) * width; // [-w/2, +w/2]
    let score = range.mid + clozeOffset;
    // subjective bounded nudge toward its own value, capped at +/- width/2.
    const subjDelta = Math.max(-width / 2, Math.min(width / 2, (subjectiveAvg - score) * 0.3));
    score += subjDelta;
    // hard clamp: never leave the located level +/- one level width.
    score = Math.max(range.min - width, Math.min(range.max + width, score));
    score = Math.max(0, Math.min(100, Math.round(score)));
    const lowConfidence =
      loc.atCeiling || loc.atFloor || Math.abs(subjectiveAvg - range.mid) > width;
    const finalRange = CEFR_RANGES.find((r) => score >= r.min && score < r.max) ?? range;
    const cefr = finalRange.level;
    const sub = score >= finalRange.mid ? "Upper" : "Lower";
    return { overallScore: score, cefr, band: `${cefr} (${sub})`, lowConfidence };
  };
  ```
- [ ] **Step 2:** `tsc` + `eslint lib/assessment-scoring.ts` 清。**手算样例（report——实现者须按写出的代码实算并核对，勿照抄；6 级均分 width=100/6≈16.67，故 CEFR_RANGES：A1[0,17]mid9 / A2[17,33]mid25 / B1[33,50]mid42 / B2[50,67]mid59 / C1[67,83]mid75 / C2[83,100]mid92）**：
  - locateLevel：current B1 → spreadLevels ["A2","B1","B2"]；subtests A2 3/3, B1 2/3, B2 0/3 → locate B1（B1 passed 2/3≥2/3，B2 0/3 not），atCeiling false（B2 fail），atFloor false（A2 pass）。
  - computeFinalBand（within-level 例）：loc B1（range{33,42,50} width 17）, cloze 60%, subjectiveAvg 45 → clozeOffset=(0.6−0.5)*17=1.7 → 43.7；subjDelta=clamp(±8.5,(45−43.7)*0.3=0.39)=0.39 → 44.09 → clamp[16,67] ok → round 44；finalRange 44∈B1[33,50]，44≥mid42 → **"B1 (Upper)"**，overallScore 44，lowConfidence false。
  - computeFinalBand（跨 ±1 sub-band 例，设计允许，band 仍自洽）：loc B1, cloze 80%, subjectiveAvg 60 → clozeOffset=5.1 → 47.1；subjDelta=clamp(±8.5,(60−47.1)*0.3=3.87)=3.87 → 50.97 → round 51；51∈B2[50,67]，51<mid59 → **"B2 (Lower)"**，overallScore 51（cloze+主观合计把 B1-located 上推约 1 sub-band 越界到 B2 Lower——有界且 band 与 overallScore 自洽，符合"主观 ≤±1 sub-band"设计）。
  - 触顶：current C2 → spreadLevels ["C1","C2"]（clamp，2 档）；全 pass → atCeiling true → lowConfidence true。触底：current A1 → ["A1","A2"]。
  - 空/边界：subtest total=0 时 passed 为 false（不 /0）；subjectiveAvg 极端仍被 clamp 到 ±width/2 且总偏移 clamp 到 ±width。
- [ ] **Step 3:** Commit `feat(assessment-scoring): heuristic spread-probe leveling + bounded subjective bridge`.

### Task 2: graded reading schema（`lib/ai-schemas.ts`）
- [ ] 加 `assessmentGradedReadingSchema`：3 子测，各含 level 标签 + passage + 恰好 3 题 MCQ。
  ```ts
  export const assessmentGradedReadingSchema = z.object({
    subtests: z.array(z.object({
      level: z.string(), // CEFR level label the subtest targets
      passage: z.string(),
      questions: z.array(z.object({
        question: z.string(),
        options: z.array(z.string()).length(4),
        correctIndex: z.number().int().min(0).max(3),
      })).length(3),
    })).min(2).max(3), // 3 normally; 2 at a ladder end
  });
  ```
  保留旧 `assessmentReadingGenSchema`（其它处若用；grep 确认——若仅 assessment 用可留兼容）。`tsc` + `eslint lib/ai-schemas.ts` 清。Commit `feat(ai-schemas): assessmentGradedReadingSchema (3-level spread)`.

---

## Phase 2 — 测评页接线（1 文件）

### Task 3: assessment reading 分级 + 定位 + cloze@located + finishAssessment 桥接 + CEFR_BANDS 扩

**Files:** Modify `app/assessment/page.tsx`

- [ ] **Step 1: CEFR_BANDS 扩 A1-C2。** 用 `lib/assessment-scoring` 的 `CEFR_RANGES` 驱动，或就地把 `CEFR_BANDS`（:180-189）扩为 12 子档（A1 Lower/Upper … C2 Lower/Upper），阈值按 `CEFR_RANGES`（每级 ~16.67，子档半级）。**推荐**：删本地 CEFR_BANDS，改用 assessment-scoring 的 `computeFinalBand`/`CEFR_RANGES` 作为唯一档源；`levelBandForScore`/`cefrFromScore` 改为基于 `CEFR_RANGES` 的等价查询（供 history 展示旧 overallScore→band 仍一致）。保留这两个函数名（history 等消费）。
- [ ] **Step 2: reading 分级生成。** `startReading` 改：`import { spreadLevels } from "@/lib/assessment-scoring"`；`const levels = spreadLevels(cefr)`（cefr 从 studyLevel 得，用 cefrIndex/ladder）；system prompt 要求为 `levels` 每级生成 1 段 ~150 词 passage + 恰好 3 MCQ，用 `assessmentGradedReadingSchema`（`schema: toJsonSchema(assessmentGradedReadingSchema)`），prompt 明确"make each level's passage and questions clearly harder than the previous"。state：`readingData` 改为 graded 结构（subtests[]）；`readingAnswers` 改为按 (subtestIndex, questionIndex) 键。
- [ ] **Step 3: reading UI（3 passage / 9 题）。** reading phase 渲染 subtests（顺序或分段），每题 4 选项；答案记入 readingAnswers。`submitReading` 改：算每子测 correct → `SubtestScore[]` → `locateLevel(...)` → 存 `location`（新 state）；readingScore（存 AssessmentResult 的 0-100）取"定位档 subtest 的正确率%"或整体正确率%（择一，report 说明；建议整体 9 题正确率作 readingScore 展示值）。继续 `startCloze`。
- [ ] **Step 4: cloze @located level。** `startCloze` 的 `cefrLevel` 改用 `location.level`（而非 studyLevel）；其余不变（8 blanks，`assessmentClozeGenSchema`）。`submitCloze` 不变（clozeScore = 0-100）。
- [ ] **Step 5: finishAssessment 桥接。** 改：
  ```ts
  const subjectiveAvg = Math.round((writingScore + finalConversationScore) / 2); // both 0-100 (D1)
  const final = computeFinalBand(location, clozeScore, subjectiveAvg);
  const result = {
    date: formatDate(new Date()),
    readingScore, clozeScore, writingScore,
    conversationScore: finalConversationScore,
    overallScore: final.overallScore, // consistent with final.band
    levelBand: final.band,
  };
  ```
  `assessedLevel`/`pendingLevel` 用 `final.cefr`。存 `lowConfidence`？AssessmentResult 无该字段（无迁移）——D3a 把 lowConfidence 存入 `finalResult` 组件 state 供结果页（D3b）用；DB 不持久（可接受，spec M5 精神）。
- [ ] **Step 6: state/progress。** 新增 `location` state + finalResult 加 lowConfidence（Omit 类型相应调整）。progress(localStorage) 保存/恢复相应带上 readingData(graded)/location（保持 localStorage，不迁 Dexie——spec M4）。
- [ ] **Step 7:** `tsc --noEmit` + `eslint app/assessment/page.tsx` 清。**推理核对（report）**：定位破循环（题目在 studyLevel±1 生成、按表现定位，非锚定自身）；触边→lowConfidence；主观有界（不超 ±1 档）；overallScore↔levelBand 一致（history 不破）；readingScore/clozeScore 仍 0-100。Commit `refactor(assessment): graded-spread reading localization + cloze@located + bounded subjective composite + A1-C2 bands`.

---

## Self-Review（已执行）

- **覆盖**：spec §4 D3a 部分（破循环 reading 分级定位、cloze@located、主观有界调整不等权、CEFR A1-C2、低置信/触边、启发式如实标注）。结果页客观/主观 UI 分离 + 边界提示展示 + onboarding A1/C2 是 **D3b**，不在此（D3a 保证 lowConfidence/location 数据可喂入）。
- **占位符**：纯算法模块给完整代码 + 手算样例；schema 给完整定义；页面接线按精确 file:line + 明确变换。reading UI（3 passage）因需依页面既有 UI 风格，给"渲染 subtests、按 (subtest,question) 记答案"的明确结构（实现者依既有单 passage UI 扩展）。
- **类型一致**：`Cefr`/`CEFR_LADDER`/`CEFR_RANGES` 集中于 assessment-scoring；CefrLevel（frequency-list）Task 1 核实含 A1/C2；overallScore 反推经 CEFR_RANGES 与 levelBand 一致（history 的 levelBandForScore/cefrFromScore 改基于同源）。
- **风险（如实标注，呼应 plan-review I7）**：AI 生成题目非标定，LLM 对"逐级更难"校准不稳 → 定位可能噪声；故 reading 定位 + cloze 确认双客观信号 + 触边 lowConfidence 提示重测；检测范围每次仅 ±1 档（spread 只跨 current±1），跨度大的用户需多次测评收敛——如实告知（D3b 展示）。主观单次 LLM 判断有界（≤±1 档），不能推翻客观定位。纯本地不做群体 IRT。
- **兼容/无迁移**：AssessmentResult 形状不变（overallScore/levelBand 一致），history 兼容；无 v7（D3 无持久新字段，lowConfidence 仅 session state）。progress 留 localStorage。
- **验证**：tsc+eslint + 算法手算（spread/locate/桥接边界）；不起 dev server、不实跑 0g。D3b 后做 D 整体 broad review（覆盖 D1+D2+D3）。
