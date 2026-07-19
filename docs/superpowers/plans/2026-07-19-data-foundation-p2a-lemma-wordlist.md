# 数据地基 P2a · 词形还原 + 分级高频词表 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用真实高频分级词表 + 英语词形还原替换占位小词表，修复词汇覆盖率与 `isWordKnown` 的系统性失真。

**Architecture:** 词表作为构建期 JSON（`lib/data/wordlist.json`，来自 google-10000-english 频率表，按 rank 近似分 CEFR band）import，保持 `frequency-list.ts` 同步 API 不变。词形还原用 `wink-lemmatizer` 经动态 `import()` 懒加载（词典不进主 bundle），提供 `ensureLemmatizer()` 预加载 + 同步 `lemmatize()`（未加载时回退小写）。消费点（reader 覆盖率/点词、srs/browse、db-helpers.isWordKnown）改用统一的 `lib/lemma`，并在匹配前做词形还原。

**Tech Stack:** Next.js 16、React 19、TypeScript strict、Dexie。新依赖：`wink-lemmatizer`。

## Global Constraints

- TypeScript strict：模块边界显式类型，局部推断。
- 纯本地架构；数据在 IndexedDB + localStorage。
- 代码注释英文。
- 无测试框架：验证 = `npx tsc --noEmit`（零错误）+ `npx eslint .`（`eslint.config.mjs` 已配置）+ 明确手动核对。不起 dev server。
- `const` 箭头函数组件。
- Git：每 task 末尾提交；commit message 末尾附：
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SDA8JvMdjpqLaxXC7gLC9M
  ```

## 本 plan 在子项目 A 中的位置

子项目 A 的 P2（页面层与词表）拆为三个独立 plan；本文件是 **P2a**：
- **P2a（本文件）**：`lib/lemma.ts` + 词表资产 + `frequency-list.ts` 重写 + 覆盖率/点词/isWordKnown 消费点。
- P2b：账本页面侧统一（listening/translate 写 `incrementTodayStat`，删 localStorage 聚合，roadmap/dashboard/profile 改读 Dexie）。
- P2c：profile 字段读取点切换（`initialCefrLevel` → `studyLevel`/`assessedLevel`），assessment/history 切到 `assessments` 表，CEFR 阈值统一，测评写回改"需确认"。

依赖：P1 已落地（Dexie v4、`lib/date.ts`）。P2a 依赖其中的 `Card.masteryLevel`、`LearningProfile.knownWordsBase`（均已存在）。

## File Structure

- `lib/lemma.ts`（新）：wink-lemmatizer 懒加载封装。职责：`ensureLemmatizer()` + `lemmatize()`。
- `lib/data/wordlist.json`（新）：频率排序的高频词数组（构建期 import）。
- `lib/frequency-list.ts`（重写）：基于 `wordlist.json` 的 `getKnownWordsForLevel`/`getWordLevel`，保留 `CefrLevel` 类型与同步签名。
- `app/reader/[id]/page.tsx`（改）：覆盖率用词形还原、区分"已掌握/学习中"；点词 `lemmatize` 改用 `lib/lemma`。
- `app/srs/browse/page.tsx`（改）：本地 `lemmatize` 改用 `lib/lemma`。
- `lib/db-helpers.ts`（改）：`isWordKnown` 做词形还原后匹配。
- `app/onboarding/page.tsx`（验证，可能零改动）：`getKnownWordsForLevel` 词数随新表变化，确认无回归。

---

## Phase 1 — 词表资产 + lib 层（4 文件）

### Task 1: 安装 wink-lemmatizer 并创建 `lib/lemma.ts`

**Files:**
- Modify: `package.json`
- Create: `lib/lemma.ts`

**Interfaces:**
- Produces: `ensureLemmatizer(): Promise<void>`、`lemmatize(word: string): string`.

- [ ] **Step 1: 安装依赖**

Run: `npm install wink-lemmatizer@3.0.4`
Expected: `package.json` dependencies 增加 `"wink-lemmatizer": "^3.0.4"`；`package-lock.json` 更新（含传递依赖 `wink-lexicon`、`wink-porter2-stemmer`）。

- [ ] **Step 2: 写 `lib/lemma.ts`**

```ts
// lib/lemma.ts
// English lemmatizer wrapping wink-lemmatizer, loaded lazily via dynamic
// import so its dictionary stays out of the main bundle. Callers that need
// accurate lemmas must `await ensureLemmatizer()` once before relying on
// `lemmatize()`; before load (or if load fails) `lemmatize()` falls back to
// a lowercased trim so callers never break.

type WinkLemmatizer = {
  noun: (w: string) => string;
  verb: (w: string) => string;
  adjective: (w: string) => string;
};

let lemmatizer: WinkLemmatizer | null = null;
let loadPromise: Promise<void> | null = null;

export const ensureLemmatizer = async (): Promise<void> => {
  if (lemmatizer) return;
  if (!loadPromise) {
    loadPromise = import("wink-lemmatizer")
      .then((mod) => {
        const m =
          (mod as { default?: WinkLemmatizer }).default ??
          (mod as unknown as WinkLemmatizer);
        lemmatizer = m;
      })
      .catch(() => {
        // Leave lemmatizer null so lemmatize() keeps its lowercase fallback;
        // allow a later retry by clearing the promise.
        loadPromise = null;
      });
  }
  await loadPromise;
};

// Synchronous. Tries noun → verb → adjective, returning the first base form
// that differs from the input; otherwise the lowercased word.
export const lemmatize = (word: string): string => {
  const w = word.trim().toLowerCase();
  if (!w || !lemmatizer) return w;
  const n = lemmatizer.noun(w);
  if (n !== w) return n;
  const v = lemmatizer.verb(w);
  if (v !== w) return v;
  return lemmatizer.adjective(w);
};
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。（`wink-lemmatizer` 无类型声明时，动态 import 的 `mod` 经上面的 `as` 断言处理，不需 `@types`。若 tsc 报"找不到模块声明"，在 `lib/lemma.ts` 顶部加 `// @ts-expect-error - wink-lemmatizer ships no types` 于 import 行上方，或在项目新增 `types/wink-lemmatizer.d.ts` 声明 `declare module "wink-lemmatizer"`. 优先后者：创建 `types/wink-lemmatizer.d.ts` 内容 `declare module "wink-lemmatizer" { const noun: (w: string) => string; const verb: (w: string) => string; const adjective: (w: string) => string; export { noun, verb, adjective }; const _default: { noun: typeof noun; verb: typeof verb; adjective: typeof adjective }; export default _default; }` — 若新增此文件则把它计入本 task 的 Files。)

- [ ] **Step 4: 手动核对（一次性脚本，跑后删除）**

写临时脚本核对（可用 `node --experimental-vm-modules` 或简单 require）：
- `require("wink-lemmatizer").noun("knives")` → `"knife"`
- `.verb("running")` → `"run"`
- `.adjective("easier")` → `"easy"`
删除脚本后再提交。

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json lib/lemma.ts types/wink-lemmatizer.d.ts 2>/dev/null; git add package.json package-lock.json lib/lemma.ts
git commit -m "feat(lib): add wink-lemmatizer wrapper (lazy dynamic import)"
```

### Task 2: 生成 `lib/data/wordlist.json` 并重写 `frequency-list.ts`

**Files:**
- Create: `lib/data/wordlist.json`
- Modify: `lib/frequency-list.ts`

**Interfaces:**
- Consumes: `lib/data/wordlist.json` (string[]).
- Produces (signatures UNCHANGED from current): `getKnownWordsForLevel(level: CefrLevel): string[]`、`getWordLevel(lemma: string): CefrLevel | null`、`type CefrLevel`.

- [ ] **Step 1: 下载并转换词表**

Run (from repo root):
```bash
mkdir -p lib/data
curl -sL https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-no-swears.txt -o /tmp/g10k.txt
node -e "const fs=require('fs');const w=fs.readFileSync('/tmp/g10k.txt','utf8').split(/\r?\n/).map(s=>s.trim().toLowerCase()).filter(Boolean);fs.writeFileSync('lib/data/wordlist.json',JSON.stringify(w));console.log('words:',w.length)"
```
Expected: prints `words: <N>` where N is roughly 9800; `lib/data/wordlist.json` is a JSON array of lowercase words in frequency order. If the download fails or N < 3000, STOP and report BLOCKED (need a working source for the wordlist).

- [ ] **Step 2: 确认 tsconfig 允许 JSON import**

Read `tsconfig.json`. If `resolveJsonModule` is not already `true` (Next.js 默认开启), do NOT edit tsconfig — instead verify the import compiles in Step 4; Next.js/TS 16 enables it by default.

- [ ] **Step 3: 重写 `lib/frequency-list.ts`**

Replace the ENTIRE file with:

```ts
import WORDLIST from "./data/wordlist.json";

export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

const CEFR_ORDER: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

// Frequency-rank upper bounds (exclusive) mapping google-10000 rank to an
// approximate CEFR band. This is a pragmatic high-frequency proxy, NOT a
// certified CEFR list — good enough for coverage / known-word estimates.
const BAND_MAX_RANK: Record<CefrLevel, number> = {
  A1: 1000,
  A2: 2000,
  B1: 3500,
  B2: 5500,
  C1: 7500,
  C2: Number.POSITIVE_INFINITY,
};

const words = WORDLIST as string[];

const RANK = new Map<string, number>();
words.forEach((w, i) => {
  if (!RANK.has(w)) RANK.set(w, i);
});

const bandForRank = (rank: number): CefrLevel => {
  for (const level of CEFR_ORDER) {
    if (rank < BAND_MAX_RANK[level]) return level;
  }
  return "C2";
};

// All words at or below `level` (cumulative), i.e. every word whose rank is
// under that level's upper bound.
export const getKnownWordsForLevel = (level: CefrLevel): string[] => {
  const max = BAND_MAX_RANK[level];
  if (!Number.isFinite(max)) return [...words];
  return words.slice(0, max);
};

export const getWordLevel = (lemma: string): CefrLevel | null => {
  const rank = RANK.get(lemma.toLowerCase());
  return rank === undefined ? null : bandForRank(rank);
};
```

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误（JSON import 解析成功）。若报 JSON import 相关错误，确认 `tsconfig.json` 的 `compilerOptions.resolveJsonModule` 与 `esModuleInterop` 为 true（Next 默认）；仅在缺失时补 `resolveJsonModule: true`（则把 tsconfig.json 计入本 task Files）。

- [ ] **Step 5: 手动核对**

一次性脚本（跑后删）：
- `getKnownWordsForLevel("A1")` 长度约 1000，包含 `"the"`, `"and"`, `"you"`。
- `getKnownWordsForLevel("B1")` 长度约 3500 且是 A1 的超集。
- `getWordLevel("the")` → `"A1"`；`getWordLevel("zzzznotaword")` → `null`。

- [ ] **Step 6: Commit**

```bash
git add lib/data/wordlist.json lib/frequency-list.ts
git commit -m "feat(lib): real frequency-graded wordlist replaces placeholder list"
```

---

## Phase 2 — 消费点切换到词形还原（4 文件）

### Task 3: reader 覆盖率用词形还原 + 区分已掌握/学习中

**Files:**
- Modify: `app/reader/[id]/page.tsx`

**Interfaces:**
- Consumes: `lemmatize`, `ensureLemmatizer` from `@/lib/lemma`.

- [ ] **Step 1: 替换本地 lemmatize，引入 lib/lemma**

删除文件内本地定义 `const lemmatize = (word: string): string => word.trim().toLowerCase();`（约 line 103）。在 import 区加 `import { lemmatize, ensureLemmatizer } from "@/lib/lemma";`。所有原先调用 `lemmatize(...)`（点词 handleWordClick ~331、渲染 ~773）保持调用不变（现在解析到 lib 版）。

- [ ] **Step 2: 预加载 lemmatizer 并触发覆盖率重算**

在组件内加入状态与 effect（放在其它 hooks 附近，遵守 Hooks 规则——须在任何早期 `return` 之前；本文件的早期 return 问题属 P3，本 task 只需把新 hook 放在现有 hooks 同区）：

```tsx
const [lemmaReady, setLemmaReady] = useState(false);
useEffect(() => {
  let alive = true;
  ensureLemmatizer().then(() => {
    if (alive) setLemmaReady(true);
  });
  return () => {
    alive = false;
  };
}, []);
```

- [ ] **Step 3: 覆盖率与已知集用词形还原**

将 `knownWordsSet`（~300）改为对 `knownWordsBase` 逐词 `lemmatize`：

```tsx
const knownWordsSet = useMemo(() => {
  const set = new Set<string>();
  for (const word of profile?.knownWordsBase ?? []) set.add(lemmatize(word));
  return set;
}, [profile, lemmaReady]);
```

`masteredLemmaSet`（~306）保持（card.lemma 已是 lemma；但为一致，对其再 `lemmatize` 无害，可留原样）。新增 `learningLemmaSet`（learning/familiar）：

```tsx
const learningLemmaSet = useMemo(() => {
  const set = new Set<string>();
  for (const card of srsLemmas ?? []) {
    if (card.masteryLevel === "learning" || card.masteryLevel === "familiar") {
      set.add(card.lemma);
    }
  }
  return set;
}, [srsLemmas]);
```

将 `vocabCoverage`（~314）改为对每个唯一词 `lemmatize` 后匹配已知集，并额外算"学习中"占比：

```tsx
const { vocabCoverage, learningCoverage } = useMemo(() => {
  if (!session) return { vocabCoverage: 0, learningCoverage: 0 };
  const words = session.content.match(WORD_RE) ?? [];
  if (words.length === 0) return { vocabCoverage: 0, learningCoverage: 0 };
  const uniqueLemmas = new Set(words.map((w) => lemmatize(w)));
  let known = 0;
  let learning = 0;
  for (const lem of uniqueLemmas) {
    if (knownWordsSet.has(lem) || masteredLemmaSet.has(lem)) known += 1;
    else if (learningLemmaSet.has(lem)) learning += 1;
  }
  const size = uniqueLemmas.size;
  return {
    vocabCoverage: Math.round((known / size) * 100),
    learningCoverage: Math.round((learning / size) * 100),
  };
}, [session, knownWordsSet, masteredLemmaSet, learningLemmaSet, lemmaReady]);
```

（`vocabCoverage` 仍用于持久化 session（~521/530）与展示（~759），保持这些用法；新增的 `learningCoverage` 仅用于展示。）

- [ ] **Step 4: 展示区分已掌握/学习中**

在覆盖率展示处（~759，`Vocab Coverage: X%`）追加"学习中"：例如在其后加一段 `· Learning: {learningCoverage}%`（跟随现有文案样式）。确保"已知"口径 = 已掌握(mastered)+基线词，"学习中"单列，不再混入。

- [ ] **Step 5: 验证**

Run: `npx tsc --noEmit` → 无错误。`npx eslint app/reader/[id]/page.tsx` → 不新增错误（本文件的 pre-existing hooks-order 问题属 P3，不在本 task 修复范围；若 eslint 报的是该 pre-existing 项，记录但不视为本 task 回归）。
手动核对（推理即可，不起 server）：文本含 "running"、`knownWordsBase` 含 "run" → lemmatize 后命中，覆盖率提升；说明 `lemmaReady` 翻转会触发 useMemo 重算。

- [ ] **Step 6: Commit**

```bash
git add app/reader/[id]/page.tsx
git commit -m "feat(reader): lemmatized vocab coverage; distinguish learning vs known"
```

### Task 4: srs/browse 与 db-helpers 统一词形还原

**Files:**
- Modify: `app/srs/browse/page.tsx`
- Modify: `lib/db-helpers.ts`

**Interfaces:**
- Consumes: `lemmatize`, `ensureLemmatizer` from `@/lib/lemma`.

- [ ] **Step 1: srs/browse 用 lib/lemma**

删除本地 `const lemmatize = (word: string): string => word.trim().toLowerCase();`（~74）。加 `import { lemmatize, ensureLemmatizer } from "@/lib/lemma";`。在 AddCardDialog 组件挂载时预加载：加一个 `useEffect(() => { ensureLemmatizer(); }, []);`（无需等待 state；用户输入到提交之间通常已加载完，未加载则回退小写——可接受）。原 `lemmatize(...)` 调用（~98、~112）保持。

- [ ] **Step 2: db-helpers.isWordKnown 词形还原匹配**

在 `lib/db-helpers.ts` import 区加 `import { lemmatize, ensureLemmatizer } from "./lemma";`。将 `isWordKnown`（~147-152）改为：

```ts
  async isWordKnown(lemma: string): Promise<boolean> {
    await ensureLemmatizer();
    const key = lemmatize(lemma);
    const profile = await this.getProfile();
    if (profile.knownWordsBase.some((w) => lemmatize(w) === key)) return true;
    const card = await this.getCardByLemma(key);
    return card?.masteryLevel === "mastered";
  },
```

（注意：`getCardByLemma(key)` 用 lemmatized key；卡片 lemma 亦应是 lemma，一致。`knownWordsBase.some(...lemmatize...)` 在 knownWordsBase 较大时是 O(n)，但仅在 isWordKnown 调用时且 n≈几千，可接受；若后续成为热点再优化。）

- [ ] **Step 3: 验证**

Run: `npx tsc --noEmit` → 无错误。`npx eslint app/srs/browse/page.tsx lib/db-helpers.ts` → 不新增错误。
手动核对：`lemmatize("cats")` 加卡去重能与已存在的 "cat" 卡对齐（加载后）。

- [ ] **Step 4: Commit**

```bash
git add app/srs/browse/page.tsx lib/db-helpers.ts
git commit -m "feat(lib): unify lemma derivation in srs/browse and isWordKnown"
```

### Task 5: onboarding 回归确认（预期零/极小改动）

**Files:**
- Modify (only if needed): `app/onboarding/page.tsx`

- [ ] **Step 1: 确认词数展示**

`app/onboarding/page.tsx` 用 `getKnownWordsForLevel(selectedLevel).length`（~97）显示"N common words"。新表下 N 会明显变大（A1≈1000、B1≈3500）——这是预期改进，文案 "common words" 仍准确。无需改代码，除非文案写死了旧数量级。Read the file around line 90-100 and confirm no hard-coded count/assumption. If none, no change.

- [ ] **Step 2: 验证**

Run: `npx tsc --noEmit` → 无错误。
手动核对：onboarding 选 B1 显示约 3500 common words（合理）。

- [ ] **Step 3: Commit（仅当有改动）**

```bash
# only if a change was made:
git add app/onboarding/page.tsx
git commit -m "chore(onboarding): confirm wordlist count copy under new list"
```

若无改动，跳过提交并在报告中说明"onboarding 无需改动"。

---

## Self-Review（已执行）

- **Spec 覆盖（P2a 部分）**：spec §5.2 的"引入完整分级词表 + 词形还原 + 全站统一 lemma + 覆盖率把 learning/familiar 另计"——Task 1（lemma）、Task 2（词表）、Task 3（reader 覆盖率 + learning 区分）、Task 4（srs/browse + isWordKnown 统一）、Task 5（onboarding）。spec 提到的错误/表达卡不用 lemma 去重、"Added!" 误导——属对话/写作复盘页，归 P3/后续，不在 P2a 文件范围。
- **占位符扫描**：无 TBD；新文件（lemma.ts、frequency-list.ts）给完整代码；消费点给明确的目标代码或精确改动规格 + 验收。
- **类型一致性**：`lemmatize`/`ensureLemmatizer` 签名在 Task 1 定义，Task 3/4 一致消费；`getKnownWordsForLevel`/`getWordLevel`/`CefrLevel` 签名与现有调用点（onboarding、settings 的类型 import）保持不变。
- **已知取舍**：词表用 google-10000 频率近似 CEFR band（非认证 CEFR），已在 frequency-list 注释与本 plan 说明；老用户已存的 `knownWordsBase`（旧占位表）不在 P2a 更新，settings 改等级重算归 P2c。
- **依赖**：新增 `wink-lemmatizer@3.0.4`（MIT，动态 import 代码分割），用户已授权。
