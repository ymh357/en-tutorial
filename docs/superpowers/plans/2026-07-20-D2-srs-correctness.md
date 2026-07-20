# 子项目 D / D2 · SRS 正确性（relearning 重入 + lapse-aware + 新卡上限）— Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 修 SRS 四个缺陷：(1) relearning 短步在会话内真正重现（可变队列，有界）；(2) 加 `lapses`/`lapsedInterval` + lapse-aware 毕业间隔（成熟卡失败不从零重建）；(3) 单次 lapse 不塌 "new"（新增 `relearning` mastery 桶）；(4) 每日新卡上限 + new/review 分离（挤占到期复习）。

**Architecture:** `lib/srs-algorithm.ts` 加 lapse 捕获 + relearning 毕业缩放 + relearning 桶。`lib/types.ts` Card +lapses/lapsedInterval、MasteryLevel +relearning、DailyStats +newCardsIntroduced、LearningProfile +dailyNewLimit。`lib/db.ts` v6 backfill。`lib/db-helpers.ts` getDueReviews/getNewCards/getSessionQueue + getVocabCounts。`app/srs/page.tsx` 冻结快照 → 可变会话队列（重入、进度按毕业不同卡数、新卡计数）。settings 新卡上限控件 + srs/browse relearning 显示。

**Tech Stack:** Next.js 16、React 19、TS strict、Dexie。

## Global Constraints

- TS strict；纯本地；注释英文。
- 无测试框架：`tsc --noEmit` + `eslint`（分支现 0 error，保持）+ 推理核对 + 关键逻辑（lapse 毕业、会话重入循环界、新卡预算）手算样例。不起 dev server。
- Git：每 task 提交；用户已授权所有 git 操作。commit 末尾附：
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SDA8JvMdjpqLaxXC7gLC9M
  ```

## 位置 & 依赖

子项目 D 第二个 plan（D1 已完成，DB 现 v5；D2 = v6）。spec §3。背景 file:line: `scratchpad/d-subsystems.md`。

**关键既有事实：**
- `lib/srs-algorithm.ts`：`computeNextReview(card, rating)`（L26-79）读 `card.{easeFactor,interval,repetitions}`；`computeMasteryLevel(interval, repetitions)`（L15-24）；`MINIMUM_EASE=1.3`（已对，不改）。Again→reps=0/interval=0.0007/ease-0.2；Hard reps0→0.007 else max(1,×1.2)；Good reps0→1/reps1→3/else round(×ease)；Easy reps0→4/else round(×ease×1.3)。`getNextIntervals`（L81-87）。
- `app/srs/page.tsx`：`useDueCards(50)`（L73）；`sessionCards` 冻结快照（L81-84）；`index` 前进（L86,130）；`handleRate`（L112-132）computeNextReview→db.update→index++/done；`progressValue=index/totalCards`（L224）；`masteryLabels`（L36-41）；empty/summary/render 分支。
- `lib/db-helpers.ts`：`getDueCards`（L56-63）；`incrementTodayStat`（L110-136，keyof Omit<DailyStats,"id">）；`getVocabCounts`（L148-161，levels 数组 + Record）；empty-DailyStats 字面量 3 处（getTodayStats L73、updateTodayStats L94、incrementTodayStat L121）。
- `hooks/use-db.ts`：`useDueCards`（L22-24）`useLiveQuery(getDueCards(limit))`。
- 新卡创建（`nextReview: new Date()` 即时到期，masteryLevel "new"）：`app/conversation/[id]/review/page.tsx:206`、`app/writing/[id]/page.tsx:478`、`app/translate/page.tsx:504`、`app/srs/browse/page.tsx:142`。
- `app/srs/browse/page.tsx`：`Record<MasteryLevel,…>`（~:35）、filter 列表（~:52-56）。
- `lib/types.ts`：Card（L15-33）、MasteryLevel（L3）、DailyStats（L144-155）、LearningProfile（L132-142）。
- db 迁移模式：`lib/db.ts` 现 v5；v6 照此加（stores 复制 v5 + upgrade）。

## File Structure（分 3 phase）

- Phase 1：`lib/types.ts`、`lib/db.ts`（v6）、`lib/srs-algorithm.ts`。
- Phase 2：`lib/db-helpers.ts`、`hooks/use-db.ts`。
- Phase 3：`app/srs/page.tsx`、`app/srs/browse/page.tsx`、`app/settings/page.tsx`。

---

## Phase 1 — 类型 + 迁移 + 算法（3 文件）

### Task 1: 类型（`lib/types.ts`）
- [ ] `MasteryLevel`（L3）加 `"relearning"`：`"new" | "learning" | "relearning" | "familiar" | "mastered"`。
- [ ] `Card`（L15-33）加：`lapses: number;`（累计失败次数）`lapsedInterval?: number;`（进入 relearning 前的 interval，供毕业缩放；毕业后清）。
- [ ] `DailyStats`（L144-155）加 `newCardsIntroduced: number;`。
- [ ] `LearningProfile`（L132-142）加 `dailyNewLimit?: number; // new SRS cards per day (default 20 when absent)`。
- [ ] `tsc`（会在 srs-algorithm/db-helpers/srs page 报出未处理 relearning/lapses——Phase 1/2/3 逐步补齐；本 task 后单独 `tsc` 可能有依赖报错，属预期，Phase 1 内 Task 3 收敛）。Commit `feat(types): Card lapses/lapsedInterval, relearning mastery, DailyStats.newCardsIntroduced, dailyNewLimit`.

### Task 2: v6 迁移 backfill（`lib/db.ts`）
- [ ] 加 `db.version(6)`：`.stores({...})` **逐字复制 v5**（无索引变化——lapses/lapsedInterval/newCardsIntroduced/dailyNewLimit 均非索引字段）；`.upgrade` backfill 使既有行带上 required 新字段：
  ```ts
  db.version(6)
    .stores({
      // identical stores to v5 (no schema change; data-only backfill)
      cards: "id, type, lemma, source, sourceId, nextReview, masteryLevel, createdAt",
      conversations: "id, scenarioType, createdAt",
      readingSessions: "id, source, createdAt",
      writingSessions: "id, taskType, createdAt",
      learningProfile: "id",
      dailyStats: "id",
      listeningExercises: "id, mode, createdAt",
      translationExercises: "id, mode, createdAt",
      poolTasks: "id, type, assignedDate, completed, createdAt",
      assessments: "id, date",
    })
    .upgrade(async (tx) => {
      // Backfill required new fields on existing rows (non-indexed additions).
      const cards = tx.table("cards");
      for (const row of await cards.toArray()) {
        if (typeof row.lapses !== "number") {
          await cards.put({ ...row, lapses: 0 });
        }
      }
      const daily = tx.table("dailyStats");
      for (const row of await daily.toArray()) {
        if (typeof row.newCardsIntroduced !== "number") {
          await daily.put({ ...row, newCardsIntroduced: 0 });
        }
      }
      // lapsedInterval stays undefined (optional); dailyNewLimit defaults in code.
    });
  ```
- [ ] `tsc` + `eslint lib/db.ts` 清。推理核对：v6 stores 逐字 = v5；backfill 幂等（typeof guard）；lapsedInterval/dailyNewLimit 不 backfill（optional）。Commit `feat(db): v6 backfill cards.lapses + dailyStats.newCardsIntroduced`.

### Task 3: 算法（`lib/srs-algorithm.ts`）
- [ ] `computeMasteryLevel` 加 lapses 参数 + relearning 桶：
  ```ts
  const computeMasteryLevel = (
    interval: number,
    repetitions: number,
    lapses: number
  ): MasteryLevel => {
    if (repetitions === 0 && lapses === 0) return "new";
    // A lapsed card sitting on a short interval is relearning, not brand-new.
    if (lapses > 0 && interval < 7) return "relearning";
    if (interval < 7) return "learning";
    if (interval < 30) return "familiar";
    if (repetitions >= 3) return "mastered";
    return "familiar";
  };
  ```
- [ ] `computeNextReview` 返回类型加 `lapses: number; lapsedInterval?: number;`。逻辑：一张卡"在 relearning"iff `card.lapses > 0 && card.repetitions === 0`；`LAPSE_FACTOR = 0.3`。
  ```ts
  export const computeNextReview = (card, rating) => {
    let { easeFactor, interval, repetitions } = card;
    let lapses = card.lapses ?? 0;
    let lapsedInterval = card.lapsedInterval;
    const inRelearning = lapses > 0 && repetitions === 0;

    if (rating === 0) {
      // Again: enter/stay relearning. Capture pre-lapse interval only when
      // coming from a graduated state (repetitions > 0), so repeated Agains in
      // relearning don't overwrite it with the ~1min step.
      if (repetitions > 0) lapsedInterval = interval;
      lapses += 1;
      repetitions = 0;
      interval = 0.0007; // ~1 min
      easeFactor = Math.max(MINIMUM_EASE, easeFactor - 0.2);
    } else if (inRelearning && (rating === 2 || rating === 3)) {
      // Graduate from relearning: scale off the pre-lapse interval.
      const base = lapsedInterval ?? 1;
      const factor = rating === 3 ? LAPSE_FACTOR * 1.3 : LAPSE_FACTOR;
      interval = Math.max(1, Math.round(base * factor));
      easeFactor =
        rating === 3
          ? Math.max(MINIMUM_EASE, easeFactor + 0.15)
          : Math.max(MINIMUM_EASE, easeFactor + 0.05);
      repetitions = 1;
      lapsedInterval = undefined; // graduated; clear
    } else if (rating === 1) {
      // Hard: relearning → repeat ~10min step (stay reps 0); else reduce ease, ×1.2.
      easeFactor = Math.max(MINIMUM_EASE, easeFactor - 0.15);
      if (repetitions === 0) {
        interval = 0.007; // ~10 min (relearning/learning step, will re-queue)
      } else {
        interval = Math.max(1, interval * 1.2);
        repetitions += 1;
      }
    } else if (rating === 2) {
      easeFactor = Math.max(MINIMUM_EASE, easeFactor - 0.05 + 0.1);
      if (repetitions === 0) interval = 1;
      else if (repetitions === 1) interval = 3;
      else interval = Math.round(interval * easeFactor);
      repetitions += 1;
    } else {
      easeFactor = Math.max(MINIMUM_EASE, easeFactor + 0.15);
      if (repetitions === 0) interval = 4;
      else interval = Math.round(interval * easeFactor * 1.3);
      repetitions += 1;
    }

    const nextReview = new Date();
    nextReview.setTime(nextReview.getTime() + interval * 24 * 60 * 60 * 1000);
    const masteryLevel = computeMasteryLevel(interval, repetitions, lapses);
    return { easeFactor, interval, repetitions, nextReview, masteryLevel, lapses, lapsedInterval };
  };
  ```
  加常量 `const LAPSE_FACTOR = 0.3;`（near MINIMUM_EASE）。注意 relearning 分支须在 `rating===1` 之前判（Hard 在 relearning 也走 ~10min 重复，不毕业——上面 inRelearning 只拦 Good/Easy，Hard 落到 `rating===1` 的 reps===0 分支得 ~10min 重复，正确）。**important**：Good/Easy 的 `inRelearning` 分支必须先于普通 `rating===2/3`——已用 else-if 顺序保证（inRelearning 判断在前）。
- [ ] `getNextIntervals` 无需改（仍调 computeNextReview）。
- [ ] `tsc` + `eslint lib/srs-algorithm.ts` 清。**手算样例（写进 report）**：
  - 成熟卡（interval 30, reps 3, lapses 0）评 Again → lapses 1, lapsedInterval 30, reps 0, interval ~1min, mastery relearning。再评 Good（inRelearning）→ interval max(1, round(30×0.3))=9, reps 1, lapsedInterval cleared, mastery familiar（interval 9≥7, lapses>0 但 ≥7 非 relearning）。对比旧逻辑：Good 从 reps0 → interval 1（从零重建）——新逻辑保留了成熟度记忆。
  - 新卡（reps 0, lapses 0）评 Hard → interval 0.007（~10min，会话内重现），reps 0（learning step）；评 Good → interval 1, reps 1, mastery learning。
  - relearning 卡评 Again 两次不覆盖 lapsedInterval（repetitions 已 0，不满足 repetitions>0 捕获条件）。
- [ ] Commit `feat(srs): lapse-aware relearning graduation + relearning mastery bucket`.

---

## Phase 2 — 队列组装（2 文件）

### Task 4: db-helpers（`lib/db-helpers.ts`）
- [ ] 3 处 empty-DailyStats 字面量（getTodayStats L73、updateTodayStats L94、incrementTodayStat L121）各加 `newCardsIntroduced: 0,`。
- [ ] `getVocabCounts`（L148-161）levels 数组加 `"relearning"`，Record 返回加 `relearning: results[i]`（按新顺序）。
- [ ] 新增：
  ```ts
  async getDueReviews(limit = 50): Promise<Card[]> {
    const now = new Date();
    return db.cards.where("nextReview").belowOrEqual(now)
      .and((c) => c.masteryLevel !== "new")
      .limit(limit).toArray();
  },
  async getNewCards(limit: number): Promise<Card[]> {
    if (limit <= 0) return [];
    const now = new Date();
    return db.cards.where("nextReview").belowOrEqual(now)
      .and((c) => c.masteryLevel === "new")
      .limit(limit).toArray();
  },
  // Reviews first, then new cards capped by the remaining daily new-card budget.
  async getSessionQueue(dailyNewLimit: number): Promise<Card[]> {
    const reviews = await this.getDueReviews(50);
    const stats = await this.getTodayStats();
    const remainingNew = Math.max(0, dailyNewLimit - (stats.newCardsIntroduced ?? 0));
    const newCards = await this.getNewCards(remainingNew);
    return [...reviews, ...newCards];
  },
  ```
  保留 `getDueCards`（其它消费者如 roadmap 若用；grep 确认——若仅 srs 页用则可留作兼容）。
- [ ] `tsc` + `eslint lib/db-helpers.ts` 清。推理核对：getDueReviews 排除 new、getNewCards 仅 new 且预算 0 时空；getSessionQueue reviews 优先、new 受当日剩余预算。Commit `feat(db-helpers): getDueReviews/getNewCards/getSessionQueue + relearning vocab count`.

### Task 5: hook（`hooks/use-db.ts`）
- [ ] 加 `useSessionQueue`：
  ```ts
  export const useSessionQueue = (dailyNewLimit: number): Card[] =>
    useLiveQuery(() => dbHelpers.getSessionQueue(dailyNewLimit), [dailyNewLimit]) ?? [];
  ```
  保留 `useDueCards`（若他处用）。`tsc` + `eslint hooks/use-db.ts` 清。Commit `feat(hooks): useSessionQueue (reviews + budgeted new cards)`.

---

## Phase 3 — 会话重入 + UI（3 文件）

### Task 6: srs 会话可变队列（`app/srs/page.tsx`）
- [ ] `masteryLabels`（L36-41）加 `relearning: "Relearning",`。
- [ ] 读 dailyNewLimit：`const profile = useProfile();`（import `useProfile`）；`const dailyNewLimit = profile?.dailyNewLimit ?? 20;`。用 `useSessionQueue(dailyNewLimit)` 取代 `useDueCards(50)`。
- [ ] **可变队列取代冻结快照 + index**。删 `sessionCards`/`index`，改：
  ```ts
  const [queue, setQueue] = useState<CardType[] | null>(null);
  const [reappear, setReappear] = useState<Record<string, number>>({});
  const [graduated, setGraduated] = useState<Set<string>>(new Set());
  const [totalDistinct, setTotalDistinct] = useState(0);
  // init once (render-time derive, same pattern as before):
  if (queue === null && sessionQueue.length > 0) {
    setQueue(sessionQueue);
    setTotalDistinct(sessionQueue.length);
  }
  const currentCard = queue?.[0];
  ```
  `handleRate`：
  ```ts
  const handleRate = async (rating: Rating): Promise<void> => {
    if (!currentCard || !queue) return;
    const wasNew = currentCard.masteryLevel === "new";
    const result = computeNextReview(currentCard, rating);
    await db.cards.update(currentCard.id, { ...result, lastReviewedAt: new Date() });
    await dbHelpers.incrementTodayStat("srsReviewed");
    if (wasNew) await dbHelpers.incrementTodayStat("newCardsIntroduced");
    setReviewedCount((c) => c + 1);
    setShowAnswer(false);

    // Short interval = a learning/relearning step → re-queue in-session, bounded.
    const isShortStep = result.interval < 1;
    const seen = reappear[currentCard.id] ?? 0;
    const willReappear = isShortStep && seen < 2;

    const rest = queue.slice(1);
    const nextQueue = willReappear
      ? [...rest, { ...currentCard, ...result }]
      : rest;
    setQueue(nextQueue);
    if (willReappear) {
      setReappear((r) => ({ ...r, [currentCard.id]: seen + 1 }));
    } else {
      setGraduated((g) => new Set(g).add(currentCard.id));
    }
    if (nextQueue.length === 0) {
      setFinishedAt(getNow());
      setSessionDone(true);
      const streakResult = await dbHelpers.updateStreak();
      setStreak(streakResult);
    }
  };
  ```
- [ ] 进度/剩余重定义（评审防失真）：`const totalCards = totalDistinct;`（summary 用 reviewedCount 不变）；`const progressValue = totalDistinct === 0 ? 0 : (graduated.size / totalDistinct) * 100;`；`const remaining = totalDistinct - graduated.size;`。`nextIntervals` 仍 `getNextIntervals(currentCard)`。
- [ ] empty/summary/render 分支相应改（empty 检查 `sessionQueue.length===0 && queue===null`；`if (!currentCard || !nextIntervals) return null;` 保留）。
- [ ] `tsc` + `eslint app/srs/page.tsx` 清。**推理核对（report）**：Again/短-Hard 卡在会话内重现、每卡至多 2 次（seen<2）后出队 → 有界不死循环；单卡反复 Again 队列长度维持 1、2 次后出队→空→done；进度按 graduated 不因重入倒退/超 100；新卡首次评分（wasNew）计 newCardsIntroduced。Commit `feat(srs): in-session relearning re-queue + progress by graduated cards + new-card counting`.

### Task 7: browse relearning 显示（`app/srs/browse/page.tsx`）
- [ ] `Record<MasteryLevel,…>`（~:35）加 `relearning` 项（label 如 "Relearning"，配色沿用既有风格）；filter 列表（~:52-56）加 `"relearning"`。`tsc` + `eslint`（相关）。Commit `feat(srs-browse): show relearning bucket`.

### Task 8: settings 每日新卡上限（`app/settings/page.tsx`）
- [ ] 加一个 dailyNewLimit 控件（读 `profile.dailyNewLimit ?? 20`，写 `db.learningProfile.update("singleton", { dailyNewLimit: value })`）。用现有 settings 页的输入控件风格（数字/滑块，范围如 0-100）。**读 settings 页实际结构后按其 pattern 加**（不新建抽象）。`tsc` + `eslint app/settings/page.tsx` 清。Commit `feat(settings): daily new-card limit control`.

---

## Self-Review（已执行）

- **覆盖**：spec §3 全 4 项（relearning 会话重入 Task 6 + lapse-aware 毕业 Task 3 + relearning 桶 Task 3/4/6/7 + 每日新卡上限/分离 Task 4/5/6/8）。ease 下限已对不改。
- **占位符**：算法/迁移/队列/db-helpers 给完整代码 + 手算样例；settings/browse 因需读实际结构给"读后按 pattern 加"的明确约束（目标明确）。
- **类型一致**：MasteryLevel +relearning 贯穿（srs-algorithm/db-helpers levels+Record/srs masteryLabels/browse Record+filter——全列出）；computeNextReview 返回 +lapses/lapsedInterval，handleRate 存回；Card.lapses required（v6 backfill 保证既有行有值）。
- **迁移安全**：v6 stores 逐字 = v5；backfill 幂等 typeof guard；非索引字段。
- **循环界**：会话重入 seen<2 硬界，单卡至多重现 2 次；`isShortStep=interval<1` 只对 Again/首次-Hard 为真。
- **风险**：relearning 桶定义（lapses>0 && interval<7）可能把刚毕业到短间隔（如 base 10×0.3=3）的卡标 relearning——可接受（近期失败、短间隔，语义合理，spec §M1 记录）。既有因过去 lapse 而 reps=0 的卡无 lapse 历史仍显示由 masteryLevel 字段既存值决定（backfill 只加 lapses=0，不重算 mastery）——即历史卡 lapses=0 → 不会误标 relearning，安全。
- **验证**：tsc+eslint + 手算（lapse 毕业/循环界/预算）；不起 dev server。D2 后 D3；D 整体 broad review 在 D3 后。
