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

- [ ] **Step 0（verify-only，评审 Minor 6）:** `lib/frequency-list.ts:3` `CefrLevel` **已是** `"A1"|"A2"|"B1"|"B2"|"C1"|"C2"`，且 `getKnownWordsForLevel` 已处理 A1（slice(0,1000)）与 C2（返回全部）。**仅确认，勿改**（勿动 `BAND_MAX_RANK` 等）。report 记确认结果。
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
    if (subtests.length === 0) return { level: "B1", atCeiling: false, atFloor: true }; // defensive; schema .min(2) prevents in practice
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
    // score===100 (only reachable when loc.level is C2, since the hard clamp
    // caps a lower-located score at range.max+width < 100) matches no half-open
    // range → `?? range` returns the located C2 range, keeping band consistent.
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
      level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]), // requested target level (scoring pairs by app's requested order, not this echo)
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

- [ ] **Step 1: 删死代码 band 设施（评审 Finding 1）。** `CEFR_BANDS`（:180-189）、`bandForScore`（:191-198）、`levelBandForScore`/`cefrFromScore`（:200-201）唯一使用点是 finishAssessment `:803`/`:814`——Step 5 会用 `computeFinalBand` 取代它们。history（`app/history/page.tsx:194`）渲染的是 **stored** `a.levelBand`/`a.overallScore` 字符串，**不调**这些函数。故 Step 5 替换后这四个成为未用 module-scope 声明 → `no-unused-vars` 破 eslint-0。**直接删除这四个**（`CEFR_BANDS`/`bandForScore`/`levelBandForScore`/`cefrFromScore`）。band/cefr 全部改由 `lib/assessment-scoring` 的 `computeFinalBand`（内部用 `CEFR_RANGES`，A1-C2）产出。删去 page.tsx 里对 `assessmentReadingGenSchema` 的 import（改用 graded schema；旧 schema 在 ai-schemas 仍是 export，不报未用）。
- [ ] **Step 2: reading 分级生成。** `startReading`：`import { spreadLevels, cefrIndex, type Cefr } from "@/lib/assessment-scoring"`；`const cefr = (profile?.studyLevel || "B1") as Cefr;`（**评审 Minor 9：显式 cast**）`const levels = spreadLevels(cefr);`；system prompt 要求为 `levels` 每级各 1 段 ~150 词 passage + 恰好 3 MCQ、**明确"make each successive level's passage and questions clearly harder"**，用 `assessmentGradedReadingSchema`。**类型改动（评审 Minor 10，须一并改否则悬空）**：`interface ReadingData`/`ReadingQuestion`（:67-76）→ graded（`{ subtests: Array<{ level: string; passage: string; questions: ReadingQuestion[] }> }`）；`object?: ReadingData`（:531）；`readingData` state；`readingAnswers` 由 `Record<number,number>` → `Record<string, number>`（键 `"${subtestIdx}-${qIdx}"`）；`AssessmentProgress.readingData`（:205）同步。
- [ ] **Step 3: reading UI + 定位（评审 Finding 2——按请求顺序配对，勿信 LLM 回显 level）。** reading phase 渲染各 subtest（passage + 3 题 4 选项），答案记入 `readingAnswers["subIdx-qIdx"]`。`submitReading` 改：**用 app 请求的 `levels` 按 index 配对，而非 `subtest.level`（LLM 字符串不可信）**：
  ```ts
  const subtests: SubtestScore[] = readingData.subtests
    .slice(0, levels.length)
    .map((st, si) => ({
      level: levels[si], // canonical requested Cefr — NOT st.level
      correct: st.questions.filter((q, qi) => readingAnswers[`${si}-${qi}`] === q.correctIndex).length,
      total: st.questions.length,
    }));
  const location = locateLevel(subtests);
  setLocation(location);
  // 0-100 readingScore for AssessmentResult display = overall correct% over all offered questions
  const totalQ = subtests.reduce((n, s) => n + s.total, 0);
  const totalC = subtests.reduce((n, s) => n + s.correct, 0);
  setReadingScore(totalQ === 0 ? 0 : Math.round((totalC / totalQ) * 100));
  ```
  （`levels` 须在 submit 时可得——存为 state 或由 `spreadLevels(cefr)` 重算，cefr 从 profile 得；report 说明。）继续 `startCloze`。
- [ ] **Step 4: cloze @located level。** `startCloze` 的目标 level 改用 `location.level`（而非 studyLevel）；其余不变（8 blanks）。`submitCloze` 不变（clozeScore 0-100）。
- [ ] **Step 5: finishAssessment 桥接。** 改：
  ```ts
  const subjectiveAvg = Math.round((writingScore + finalConversationScore) / 2); // both 0-100 (D1)
  const final = computeFinalBand(location, clozeScore, subjectiveAvg);
  const result = {
    date: formatDate(new Date()),
    readingScore, clozeScore, writingScore,
    conversationScore: finalConversationScore,
    overallScore: final.overallScore, // consistent with final.band by construction
    levelBand: final.band,
  };
  ```
  `assessedLevel`/`pendingLevel` 用 `final.cefr`（替换旧 `cefrFromScore(composite)`）。`lowConfidence` 存入 `finalResult` 组件 state（供 D3b 结果页），DB 不持久（AssessmentResult 无该字段，无迁移；spec M5 精神）。`import { computeFinalBand, locateLevel, type SubtestScore, type Location } from "@/lib/assessment-scoring"`。
- [ ] **Step 6: state/progress（评审 Finding 5——版本化 key 防旧格式崩溃）。** 新增 `location: Location | null` state；`finalResult` 类型加 `lowConfidence`。**`ASSESSMENT_PROGRESS_KEY` 改名（如 `"en-tutor-assessment-progress-v2"`）**——旧格式快照（单 passage readingData、无 location）在新 UI/`computeFinalBand(null)` 下会崩；改 key 使旧快照被忽略（等效丢弃，短命进度可接受）。progress save/restore 带上 graded readingData + location（留 localStorage，不迁 Dexie）。
- [ ] **Step 7: roadmap B2 阈值重校（评审 Finding 4）。** `app/roadmap/page.tsx:44` `B2_ASSESSMENT_THRESHOLD = 65`（注释"mirrors B1→B2 breakpoint"）——旧梯 B2 起 65，新 `CEFR_RANGES` B2 起 **50**。改该字面量为 `50`（或从 `CEFR_RANGES.find(r=>r.level==="B2").min` 派生）并更新注释，否则真 B2 用户（overallScore ~50-58）失败该门。读 `:40-50`、`:297`（bestAssessmentScore）确认口径。
- [ ] **Step 8:** `tsc --noEmit`（全库 0）+ `eslint app/assessment/page.tsx app/roadmap/page.tsx`（含全库 `--quiet` 0）。**推理核对（report）**：定位破循环（题目在 studyLevel±1 生成、按 app 请求 level 配对定位，不信 LLM 回显、不锚自身）；触边→lowConfidence；主观有界≤±1 sub-band；overallScore↔levelBand 由构造一致（history 旧行的 stored levelBand/overallScore 字符串照常渲染）；readingScore/clozeScore 仍 0-100；roadmap B2 门阈对齐新梯；无悬空旧 ReadingData/band-fn 引用（grep）。Commit `refactor(assessment): graded-spread localization + cloze@located + bounded subjective bridge + A1-C2 (roadmap B2 gate recalibrated)`.

---

## Self-Review（已按 plan-review 修订）

- **覆盖**：spec §4 D3a 部分（破循环 reading 分级定位、cloze@located、主观有界调整不等权、CEFR A1-C2、低置信/触边、启发式如实标注）。结果页客观/主观 UI 分离 + 边界提示展示 + onboarding A1/C2 是 **D3b**，不在此（D3a 保证 lowConfidence/location 数据可喂入）。
- **plan-review 修订**：Finding1 删死代码 band 函数（非保留）；Finding2 定位按 app 请求 `levels` 按 index 配对（+ schema level enum），不信 LLM 回显；Finding4 roadmap B2_ASSESSMENT_THRESHOLD 65→50 重校（Step 7）；Finding5 ASSESSMENT_PROGRESS_KEY 版本化防旧格式崩；Minor 6/7/9/10 已并入（frequency-list verify-only、locateLevel 空守卫、Cefr cast、类型改动枚举）。
- **占位符**：纯算法模块完整代码 + 手算样例；schema 完整；页面接线精确 file:line + 明确变换 + submit 配对代码。reading UI 给"渲染 subtests、按 `subIdx-qIdx` 记答案"明确结构（依既有单 passage UI 扩展）。
- **类型一致**：`Cefr`/`CEFR_LADDER`/`CEFR_RANGES` 集中于 assessment-scoring；CefrLevel 已含 A1/C2（verify）；overallScore 由 `computeFinalBand` 内部 `finalRange` 反推 → 与返回 band **构造性一致**（history 旧行渲染 stored 字符串，不受影响）。
- **风险（如实标注，呼应 plan-review I7）**：AI 生成题目非标定，LLM 逐级难度校准不稳 → 定位可能噪声；故 reading 定位 + cloze 双客观信号 + 触边 lowConfidence 提示重测；检测每次仅 ±1 档（spread 跨 current±1），跨度大者需多次测评收敛（D3b 展示）。3 题/级纯猜 ≥2 对约 15.6%（4 选），粗但由 cloze 交叉 + lowConfidence 缓解。主观单次 LLM 有界 ≤±1 sub-band，不推翻客观定位。纯本地不做群体 IRT。
- **overallScore 尺度断点（评审 Finding 3，如实记录，仿 D1 M3）**：新 overallScore（定位中点±有界偏移）与历史等权合成 overallScore 不同尺度；跨 D3a 的趋势 delta（`app/assessment/page.tsx:1230` scoreDelta vs priorResult、`app/roadmap/page.tsx:297` bestAssessmentScore max）不可直接比较——单用户可接受，首次 D3a 后一次 run 的 delta 可能出现假跳变，如实标注，不做历史回填。
- **兼容/无迁移**：AssessmentResult 形状不变；无 v7（lowConfidence 仅 session state）。progress key 版本化（旧快照忽略）。
- **验证**：tsc+eslint + 算法手算（spread/locate/桥接边界）；不起 dev server、不实跑 0g。D3b 后做 D 整体 broad review（覆盖 D1+D2+D3）。
