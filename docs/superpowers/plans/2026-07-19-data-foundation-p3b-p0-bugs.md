# 数据地基 P3b · 11 个 P0 bug 止血 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复一批相互独立的高危缺陷：崩溃、数据丢失、安全绕过、功能不可用、竞态。

**Architecture:** 每个 bug 一处局部修复，互不耦合。当前代码与修复方向的权威来源是 `/private/tmp/claude-501/-Users-minghao-en-tutorial/3f2a9528-2794-4b9e-a120-c51eeb2a51c7/scratchpad/p3-bugs.md`（含每个 bug 的 file:line 与最小修复方向）——implementer 必读，并在改前 re-read 目标文件确认当前代码（行号可能因前序 plan 漂移）。

**Tech Stack:** Next.js 16、React 19、TS strict、Dexie；`@vercel/blob`（cron）；Node 网络 API（extract）。

## Global Constraints

- TS strict；纯本地；注释英文。
- 无测试框架：验证 = `npx tsc --noEmit`（零错误）+ `npx eslint <touched files>`（不新增；部分大文件有 pre-existing 项，确认非本次引入）+ 明确的手动/推理核对。不起 dev server。
- `const` 箭头函数组件。
- Git：每 task 末尾提交；用户已授权所有 git 操作，按 brief commit。commit message 末尾附：
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SDA8JvMdjpqLaxXC7gLC9M
  ```

## 本 plan 在子项目 A 中的位置

子项目 A 的 P3 的第二半（P3a 备份已完成）。P3b 完成后子项目 A 全部完成。这些 bug 是 P1-P2c 明确 defer 到 P3 的（语音回路 bug 属子项目 C，不在此）。

## File Structure（7 文件，3 phase）

- Phase 1（崩溃/数据丢失）：`app/reader/[id]/page.tsx`、`app/srs/page.tsx`、`app/conversation/[id]/page.tsx`。
- Phase 2（安全/功能/竞态）：`app/api/cron/generate-tasks/route.ts`、`app/api/extract/route.ts`、`app/page.tsx`。
- Phase 3（测评持久化）：`app/assessment/page.tsx`。

---

## Phase 1 — 崩溃 / 数据丢失（3 文件）

### Task 1: reader/[id] — Hooks 规则违规（崩溃）+ 词-句定位取错

**Files:** Modify `app/reader/[id]/page.tsx`  (p3-bugs.md items 1 & 9)

- [ ] **Step 1 (#1 Hooks 崩溃):** `useRef`（`lookupPanelRef`，~629）与 scrollIntoView 的 `useEffect`（~632）位于早期 `return`（loading/not-found，~571/579/591）之后 → 渲染间 hook 数量变化会触发 React "rendered fewer/more hooks" 崩溃。把这两个 hook 移到组件内**所有早期 return 之前**（与其它 hooks 同组）。注意 P2a 已在此区加过 `lemmaReady` hook——放在同组即可。
- [ ] **Step 2 (#9 词-句):** `handleWordClick(word, position)` 当前用渲染期累加的 `occurrenceCounterRef` 总数当 `occurrenceIndex` 传给 `findSentenceForWord` → 恒定位到该词最后一次出现的句子（并写进 SRS 卡 context）。改用**已传入但未使用的 `position`** 定位句子：让 `findSentenceForWord` 依据 `position`（字符偏移）找到包含该位置的句子；移除对 `occurrenceCounterRef` 的错误依赖（保留渲染，只改定位逻辑）。见 p3-bugs.md 的当前代码。
- [ ] **Step 3:** `npx tsc --noEmit` 清；`npx eslint app/reader/[id]/page.tsx` → hooks-order 报错应消失（这正是本 task 修的），其余 pre-existing（unused/prefer-const）不增。
- [ ] **Step 4:** Commit `fix(reader): hooks-order crash + word→sentence by position`

### Task 2: srs — 会话遍历随 live-query 收缩的数组导致跳卡/提前结束

**Files:** Modify `app/srs/page.tsx`  (p3-bugs.md item 2)

- [ ] **Step 1:** 现状：`dueCards[index]` 取自 live query `useDueCards`，`handleRate` 更新 `nextReview` 使卡离开 due 集 → 数组左移 + `setIndex(i+1)` 跳卡；`index+1>=totalCards` 用收缩前长度提前判定 sessionDone。改：**会话开始时把到期集合快照到本地 state 一次**（如 `const [sessionCards, setSessionCards] = useState<Card[]>([])`，在 dueCards 首次非空时 `setSessionCards(dueCards)`，之后遍历 `sessionCards` 不随 live query 变动）；index 遍历快照；进度/剩余/sessionDone 基于快照长度。评级仍写 db（下次会话重新快照）。见 p3-bugs.md 的当前 index/rating/session-done 逻辑。
- [ ] **Step 2:** `npx tsc --noEmit` 清；eslint 不新增。推理核对：N 张到期卡逐张走完不跳、不提前结束；Again 评级的卡本会话内不因 live query 变动被重复/跳过（按快照顺序走）。
- [ ] **Step 3:** Commit `fix(srs): snapshot due set at session start (no skipped cards / early end)`

### Task 3: conversation/[id] — createdAt 每次重置 + 已复盘对话被覆盖

**Files:** Modify `app/conversation/[id]/page.tsx`  (p3-bugs.md items 3 & 4)

- [ ] **Step 1 (#3 createdAt):** 持久化 effect（~333-359）与 `handleEndAndReview`（~467-517）都 `put({... createdAt: new Date()})`，每轮把创建时间刷成"现在"。改：**首存后保留原 createdAt** —— put 前用已加载的现有记录的 createdAt（若存在），或用一个在挂载/首存时捕获的 `createdAtRef`；仅当记录不存在时才用 `new Date()`。
- [ ] **Step 2 (#4 review 覆盖):** 深链到已复盘对话（`existing.review` 存在）时，恢复 effect 跳过 setMessages 以空白开始，用户一发消息持久化 effect 就 `put({... review: null})` 覆盖复盘 → 数据丢失。改：**当已存在的记录带 review 时，禁止在聊天页覆盖它**（持久化 effect 与 handleEndAndReview 在 existing.review 存在时不写 review:null；或恢复时若 review 存在则重定向到 review 页 / 只读）。以最小改动阻断覆盖路径为准。见 p3-bugs.md。
- [ ] **Step 3:** `npx tsc --noEmit` 清；eslint 不新增。推理核对：多轮对话后 createdAt 不变；打开已复盘对话的 chat URL 不清空复盘。
- [ ] **Step 4:** Commit `fix(conversation): preserve createdAt; never overwrite a reviewed conversation`

---

## Phase 2 — 安全 / 功能 / 竞态（3 文件）

### Task 4: cron — 鉴权绕过 + blob 非幂等

**Files:** Modify `app/api/cron/generate-tasks/route.ts`  (p3-bugs.md items 5 & 8-blob)

- [ ] **Step 1 (#5 鉴权):** 现状 `authHeader === \`Bearer ${CRON_SECRET}\``，`CRON_SECRET` 未配置时字面量 `"Bearer undefined"` 可通过。改：**`CRON_SECRET` 缺失时直接拒绝**（返回 500/401，不进行比较）；配置了才比较。
- [ ] **Step 2 (#8 blob):** `put(...)` 未传 `allowOverwrite` → 同日重跑先烧完 AI 调用再抛 "blob already exists"。改：`put(path, body, { access: "public", allowOverwrite: true, ... })`（`@vercel/blob` v2）。
- [ ] **Step 3:** `npx tsc --noEmit` 清；eslint 不新增。推理核对：未配置密钥时任意请求被拒；同日重跑可覆盖不报错。
- [ ] **Step 4:** Commit `fix(cron): reject when CRON_SECRET unset; allowOverwrite on blob put`

### Task 5: extract — URL 导入 TLS 失败 + 3xx 直接拒绝

**Files:** Modify `app/api/extract/route.ts`  (p3-bugs.md item 6)

- [ ] **Step 1:** 现状把 `pinnedUrl.hostname` 改写为解析出的 IP 再 fetch → HTTPS 下 SNI/证书用 IP 校验失败，几乎所有 https 站点 TLS 报错；且 `redirect: "manual"` 遇 3xx 直接返回错误（http→https、加 www 等常见 301 全失败）。改（**保留 SSRF 防护**）：
  - 不改写 hostname。改用 Node 层固定已校验 IP 的方式：`https.request`/`fetch` 配合自定义 `lookup`（`dns` 结果 pin 到先前校验过的 IP，servername 保持原 hostname），或 undici `Agent` 的 `connect.lookup`。保证 SNI/证书用真实 hostname。
  - 受控地跟随重定向（同源或校验通过的安全目标），对**每一跳**重新做 SSRF 校验（DNS 解析 + 私网/环回/链路本地拒绝），限制最大跳数（如 5）。不再对所有 3xx 直接失败。
  - 保留现有的 5MB/超时/私网拒绝上限。
- [ ] **Step 2:** `npx tsc --noEmit` 清；eslint 不新增。推理核对：常见 https 文章 URL（含 http→https 301）能成功；私网/环回 URL 与重定向到私网仍被拒。若该 Node 网络方案在本运行时环境实现受阻，报 DONE_WITH_CONCERNS 并说明所用方案与残留风险。
- [ ] **Step 3:** Commit `fix(extract): keep hostname for TLS + follow safe redirects with per-hop SSRF checks`

### Task 6: dashboard — 池预热竞态 + streak 打开即打卡 + Daily Goal 未接入

**Files:** Modify `app/page.tsx`  (p3-bugs.md items 8-prewarm, 10, 11)

- [ ] **Step 1 (#8 prewarm 竞态):** 池预热的 `get→add` 非原子 + 过大的 catch，双标签/StrictMode 双挂载会 `add` 抛 ConstraintError 被吞后误入"本地生成"分支 → 双倍内容 + 8 次 AI 调用。改：落库改 **`bulkPut`（幂等）**；**缩小 try/catch 只包 fetch**（不把 add/生成分支裹进同一 catch）。见 p3-bugs.md 的当前预热代码。
- [ ] **Step 2 (#10 streak):** Dashboard 挂载 effect 无条件 `dbHelpers.updateStreak()` → "打开 app"即打卡。**移除挂载处的调用**（streak 只应在真实练习完成处更新——各练习页已调 updateStreak，保持不动）。
- [ ] **Step 3 (#11 Daily Goal):** `generateStudyPlan(...)` 未传 `targetMinutes`，恒用默认 20。改：读 `localStorage["en-tutor-daily-goal"]`（数字，防 NaN/缺失回退默认），作为 `targetMinutes` 传入 `generateStudyPlan`。
- [ ] **Step 4:** `npx tsc --noEmit` 清；eslint 不新增。推理核对：双挂载不产生重复池任务、不重复计费；仅打开 Dashboard 不做练习 streak 不 +1；改每日目标后计划总时长随之变化。
- [ ] **Step 5:** Commit `fix(dashboard): idempotent pool prewarm; no streak on mount; wire daily goal`

---

## Phase 3 — 测评持久化（1 文件）

### Task 7: assessment — 进度易丢 + 刷新题目错配 + 遗留标签

**Files:** Modify `app/assessment/page.tsx`  (p3-bugs.md item 7 + bonus label)

- [ ] **Step 1 (#7 进度):** 进度存 `sessionStorage`（关标签页即丢 15-20 分钟作答）→ 改 `localStorage`（带一个过期时间戳，如 24h，过期则丢弃；避免陈旧进度永久残留）。`writingPrompt`/`conversationTopic` 用 `useState(() => WRITING_PROMPTS[random])` 初始化、不在快照里 → 刷新后重新随机与已恢复的作答错配。改：把 `writingPrompt`/`conversationTopic` **纳入持久化快照**，恢复时从快照读回（无快照才随机）。见 p3-bugs.md 的当前 progress 持久化（注意 P2c 动过本文件——以当前代码为准）。
- [ ] **Step 2 (bonus 标签):** `dimensionComparisons`（~1195）仍有遗留标签 `"Listening/Cloze"`（上次只修了 RadarChart 的 ~1186）。改为与雷达图一致的 `"Cloze"`（该测评的第二部分是 Cloze，非听力）。
- [ ] **Step 3:** `npx tsc --noEmit` 清；`npx eslint app/assessment/page.tsx` 不新增。推理核对：写到一半关标签页再进能恢复且题目与作答一致；过期快照被丢弃；"Compared to Last Time" 标签为 Cloze。
- [ ] **Step 4:** Commit `fix(assessment): durable progress with prompt/topic snapshot; fix stale Cloze label`

---

## Self-Review（已执行）

- **覆盖**：11 个 P0（p3-bugs.md 全 open）：#1/#9 Task1、#2 Task2、#3/#4 Task3、#5/#8blob Task4、#6 Task5、#8prewarm/#10/#11 Task6、#7 Task7；bonus 标签 Task7。语音回路 bug 明确不在此（子项目 C）。
- **占位符扫描**：每个 bug 给明确 fix 方向 + 验收 + 指向 p3-bugs.md 的当前代码；extract（#6）方向明确并允许在运行时受阻时 DONE_WITH_CONCERNS。
- **独立性**：7 个 task 各自局部、互不耦合，可独立 review。
- **风险**：extract 的 Node 网络 pin-IP + 逐跳 SSRF 是本 plan 最复杂项（Task 5），若环境限制需如实报告；srs 快照改动要保证"评级仍写 db、下次会话重新快照"的语义不丢。
