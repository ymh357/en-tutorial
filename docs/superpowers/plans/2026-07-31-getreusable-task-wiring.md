# getReusableTask 接线 5 个生成型消费方 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `getReusableTask` 交替重复池接入 5 个生成型 pool 消费方,统一为 fresh → reusable → 实时生成三段式,让已见语料跨会话复现。

**Architecture:** 每站插入一个 reusable 段(镜像 `components/listening/shadowing-tab.tsx:446-456`):fresh miss 后 `getReusableTask(type)` 命中且 shape 守卫通过 → 采用 + `completeTask(id, type)`;守卫失败 → `completeTask(id)` 烧旧行 + fall through;null/异常 → fall through。4 个无守卫站先补文件内 shape 谓词,fresh 路径同步改用守卫(消除裸 `as` 强转,接受集不变)。

**Tech Stack:** Next.js 16 + React 19(函数组件/hooks),纯客户端 Dexie/IndexedDB,`lib/task-pool.ts`。

## Global Constraints

- Next.js 16 有破坏性改动,写码前读 `node_modules/next/dist/docs/` 相关篇。
- React 19 严格 effect 规则:effect 主体仅 ref/定时器,setState 仅在回调。reusable 段在生成函数/事件处理内,**非** effect 主体。
- 纯客户端 Dexie,单例 profile `id:"singleton"`,无服务端 DB。
- tsc `npx tsc --noEmit` + eslint `npx eslint . --quiet` 必须 0 error 才能 commit。
- Code comments English only。不写测试(CLAUDE.md)。
- `seenIn` = 该站 `.equals()` 用的 PoolTaskType 字面量(如 `"listening-dictation"`)。
- `getReusableTask` 用默认 6h 间隔,**不**传第二参。
- 守卫复用各站现有 truthiness 接受逻辑显式化,fresh 路径接受集**不变**。
- 守卫失败:reusable 段烧旧行(`completeTask(id)` 无 seenIn)+ fall through;fresh 段守卫失败保持现状(fall through 不烧,与各站 fresh 现有一致)。
- 不抽共享 `fetchFresh` helper(YAGNI)。不接 reader-Today's Article / writing-Today's Prompt(每日新卡语义)。不接 probe 站。
- commit 末尾 `Co-Authored-By: Claude <noreply@anthropic.com>`,直接 main 提交(已授权)。push 需用户授权。

## File Structure

- `app/listening/page.tsx` — dictation + comprehension + prediction 三站(各加 reusable 段;dictation/prediction 补守卫;comprehension 复用既有 `isComprehensionData`)
- `app/reader/page.tsx` — AiGenerateTab 一站(AiGenerateTab,加 reusable 段 + 补 `isReadingArticleData` 守卫;**不动** Today's Article render-gating 682 站)
- `app/translate/page.tsx` — translate 一站(三模式分一个 reusable 段;补 `isTranslationSentenceSetData`;复用既有 `isTranslationExercise`)
- `lib/types.ts` — 不改(`PoolTaskType` 已有全部需要的字面量)
- `lib/task-pool.ts` — 不改

---

### Task 1: dictation 接线 + 守卫

**Files:**
- Modify: `app/listening/page.tsx`(import 行 ~34,fresh 块 82-102,补守卫函数)

**Interfaces:**
- Consumes: `getReusableTask` from `@/lib/task-pool`;`PoolTaskType` literal `"listening-dictation"`.
- Produces: none（无下游消费者）。

- [ ] **Step 1: 改 import,加 getReusableTask**

`app/listening/page.tsx` 约 34 行现有:
```ts
import { completeTask } from "@/lib/task-pool";
```
改为:
```ts
import { completeTask, getReusableTask } from "@/lib/task-pool";
```

- [ ] **Step 2: 补 isDictationData 守卫**

在 `app/listening/page.tsx` 文件内（与 `isComprehensionData` 同区域,约 302 行附近的 guard 区,或 dictation 组件上方）加:
```ts
// Local shape guard for the dictation pool-task content (mirrors the
// fresh-path truthiness check, made explicit so the reused-content path can
// validate older rows without trusting a bare \`as\` cast).
const isDictationData = (value: unknown): value is { sentences: string[] } => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.sentences) && v.sentences.length > 0 &&
    v.sentences.every((s) => typeof s === "string");
};
```

- [ ] **Step 3: fresh 路径改用守卫**

把 fresh 块(89-99)的:
```ts
      if (poolTask) {
        const content = poolTask.content as { sentences: string[] };
        if (content.sentences && content.sentences.length > 0) {
          setPoolSentences(content.sentences);
          setSentenceIndex(0);
          setSentence(content.sentences[0]);
          await completeTask(poolTask.id);
          setIsLoading(false);
          return;
        }
      }
```
改为:
```ts
      if (poolTask && isDictationData(poolTask.content)) {
        const { sentences } = poolTask.content;
        setPoolSentences(sentences);
        setSentenceIndex(0);
        setSentence(sentences[0]);
        await completeTask(poolTask.id, "listening-dictation");
        setIsLoading(false);
        return;
      }
```

- [ ] **Step 4: 插入 reusable 段**

在 fresh 块的 `} catch {` 之后、`// Fallback to real-time generation` 之前(约 102 与 104 行之间),插入:
```ts
    // Alternating repetition (W3): no fresh pool item, so revive a previously-
    // seen one rather than discarding it. Still falls through to real-time
    // generation if none eligible or the revived row is stale.
    try {
      const reusable = await getReusableTask("listening-dictation");
      if (reusable && isDictationData(reusable.content)) {
        const { sentences } = reusable.content;
        setPoolSentences(sentences);
        setSentenceIndex(0);
        setSentence(sentences[0]);
        await completeTask(reusable.id, "listening-dictation");
        setIsLoading(false);
        return;
      }
      if (reusable) {
        // Revived a stale/old-shape row — burn it so it isn't re-revived.
        await completeTask(reusable.id);
      }
    } catch {
      // Fall through to real-time generation
    }
```

- [ ] **Step 5: 验证 + commit**

Run: `npx tsc --noEmit && npx eslint app/listening/page.tsx --quiet`
Expected: 0 error。
```bash
git add app/listening/page.tsx
git commit -m "feat(pool): wire getReusableTask into dictation (+ shape guard)"
```

---

### Task 2: comprehension 接线(复用既有守卫)

**Files:**
- Modify: `app/listening/page.tsx`(import 已在 Task 1 加;fresh 块 339-357)

**Interfaces:**
- Consumes: `getReusableTask`;`"listening-comprehension"`;既有 `isComprehensionData`(约 302 行)。

- [ ] **Step 1: fresh 段 seenIn 补齐**

把 fresh 块(346-354)里:
```ts
          await completeTask(poolTask.id);
```
改为:
```ts
          await completeTask(poolTask.id, "listening-comprehension");
```
（fresh 块其余结构与守卫不变 — `isComprehensionData` 已在用。）

- [ ] **Step 2: 插入 reusable 段**

在 fresh 块 catch 之后、`// Fallback to real-time generation`（约 357 与 359 之间）之前,插入（注意需复用 fresh 块同样的采用逻辑 — 阅读现有 fresh 命中分支 348-354 取准确字段:`setPassage`/`setComprehensionQuestions` 等,以现有 fresh 命中分支为模板,仅把 `poolTask` 换 `reusable`、`completeTask(poolTask.id, ...)` 换 `completeTask(reusable.id, "listening-comprehension")`）:
```ts
    // Alternating repetition (W3): no fresh item — revive a previously-seen
    // comprehension passage rather than discarding it.
    try {
      const reusable = await getReusableTask("listening-comprehension");
      if (reusable && isComprehensionData(reusable.content)) {
        // Mirror the fresh-hit adoption (use the same setters/fields as the
        // fresh branch above), then mark seen.
        /* SAME-AS-FRESH-ADOPTION: copy the fresh-hit body, swap poolTask→reusable,
           completeTask(reusable.id, "listening-comprehension"), setIsLoading(false); return; */
      }
      if (reusable) {
        await completeTask(reusable.id);
      }
    } catch {
      // Fall through to real-time generation
    }
```
**实现者注意:** 上面 `SAME-AS-FRESH-ADOPTION` 注释是占位指示 — 实际写代码时,**逐字复制 fresh 命中分支(348-354)的采用语句**,只做两处替换:`poolTask`→`reusable`、`completeTask` 的 id 与 seenIn。不要省略任何 fresh 命中分支里的 setter。

- [ ] **Step 3: 验证 + commit**

Run: `npx tsc --noEmit && npx eslint app/listening/page.tsx --quiet`
Expected: 0 error。
```bash
git add app/listening/page.tsx
git commit -m "feat(pool): wire getReusableTask into comprehension (reuse guard)"
```

---

### Task 3: prediction 接线 + 守卫

**Files:**
- Modify: `app/listening/page.tsx`(import 已在 Task 1 加;fresh 块 618-636;补守卫)

- [ ] **Step 1: 补 isPredictionData 守卫**

在 dictation/comprehension 守卫同区域加:
```ts
const isPredictionData = (value: unknown): value is { firstHalf: string; secondHalf: string; topic: string } => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.firstHalf === "string" && typeof v.secondHalf === "string" && typeof v.topic === "string";
};
```

- [ ] **Step 2: fresh 路径改用守卫 + seenIn**

把 fresh 块(625-633):
```ts
      if (poolTask) {
        const content = poolTask.content as { firstHalf: string; secondHalf: string; topic: string };
        if (content.firstHalf && content.secondHalf && content.topic) {
          setPassage(content);
          await completeTask(poolTask.id);
          setIsLoading(false);
          return;
        }
      }
```
改为:
```ts
      if (poolTask && isPredictionData(poolTask.content)) {
        setPassage(poolTask.content);
        await completeTask(poolTask.id, "listening-prediction");
        setIsLoading(false);
        return;
      }
```

- [ ] **Step 3: 插入 reusable 段**

在 fresh catch 后、realtime 前插入:
```ts
    // Alternating repetition (W3): no fresh item — revive a previously-seen
    // prediction passage rather than discarding it.
    try {
      const reusable = await getReusableTask("listening-prediction");
      if (reusable && isPredictionData(reusable.content)) {
        setPassage(reusable.content);
        await completeTask(reusable.id, "listening-prediction");
        setIsLoading(false);
        return;
      }
      if (reusable) {
        await completeTask(reusable.id);
      }
    } catch {
      // Fall through to real-time generation
    }
```

- [ ] **Step 4: 验证 + commit**

Run: `npx tsc --noEmit && npx eslint app/listening/page.tsx --quiet`
Expected: 0 error。
```bash
git add app/listening/page.tsx
git commit -m "feat(pool): wire getReusableTask into prediction (+ shape guard)"
```

---

### Task 4: reader AiGenerateTab 接线 + 守卫

**Files:**
- Modify: `app/reader/page.tsx`(import 行 29,fresh 块 103-125,补守卫)

- [ ] **Step 1: 改 import**

`app/reader/page.tsx` 约 29 行:
```ts
import { completeTask } from "@/lib/task-pool";
```
改为:
```ts
import { completeTask, getReusableTask } from "@/lib/task-pool";
```

- [ ] **Step 2: 补 isReadingArticleData 守卫**

在文件内合适位置（AiGenerateTab 组件上方或 reading-article 相关 helper 区）加。注意 `comprehensionQuestions` 在 fresh 路径是可选(用 `?? []`),守卫接受可选数组:
```ts
type ReaderArticleContent = {
  title: string;
  content: string;
  comprehensionQuestions?: ComprehensionQuestion[];
};
const isReadingArticleData = (value: unknown): value is ReaderArticleContent => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.title !== "string" || typeof v.content !== "string") return false;
  if (v.comprehensionQuestions !== undefined && !Array.isArray(v.comprehensionQuestions)) return false;
  return true;
};
```

- [ ] **Step 3: fresh 路径改用守卫 + seenIn**

把 fresh 块(110-122):
```ts
      if (poolTask) {
        const content = poolTask.content as { title: string; content: string; comprehensionQuestions: ComprehensionQuestion[] };
        if (content.title && content.content) {
          setGenerated({
            title: content.title,
            content: content.content,
            comprehensionQuestions: content.comprehensionQuestions ?? [],
          });
          await completeTask(poolTask.id);
          setIsGenerating(false);
          return;
        }
      }
```
改为:
```ts
      if (poolTask && isReadingArticleData(poolTask.content)) {
        const c = poolTask.content;
        setGenerated({
          title: c.title,
          content: c.content,
          comprehensionQuestions: c.comprehensionQuestions ?? [],
        });
        await completeTask(poolTask.id, "reading-article");
        setIsGenerating(false);
        return;
      }
```

- [ ] **Step 4: 插入 reusable 段**

在 fresh catch 后、`// Fallback to real-time generation`(约 125 与 127 之间）前插入:
```ts
    // Alternating repetition (W3): no fresh article — revive a previously-
    // seen one rather than discarding it.
    try {
      const reusable = await getReusableTask("reading-article");
      if (reusable && isReadingArticleData(reusable.content)) {
        const c = reusable.content;
        setGenerated({
          title: c.title,
          content: c.content,
          comprehensionQuestions: c.comprehensionQuestions ?? [],
        });
        await completeTask(reusable.id, "reading-article");
        setIsGenerating(false);
        return;
      }
      if (reusable) {
        await completeTask(reusable.id);
      }
    } catch {
      // Fall through to real-time generation
    }
```

- [ ] **Step 5: 验证 + commit**

Run: `npx tsc --noEmit && npx eslint app/reader/page.tsx --quiet`
Expected: 0 error。
```bash
git add app/reader/page.tsx
git commit -m "feat(pool): wire getReusableTask into reader AiGenerateTab (+ shape guard)"
```

---

### Task 5: translate 接线 + 句子分支守卫

**Files:**
- Modify: `app/translate/page.tsx`(import 行 36,fresh 块 265-296,补守卫)

**Interfaces:**
- Consumes: `getReusableTask`;`poolTypeMap`(259-263,`Record<ExerciseMode,string>` — 但 `getReusableTask` 要 `PoolTaskType`)。因 `poolTypeMap` 值是字面量联合,需在调用处 `as PoolTaskType` 或把 map 类型收窄。**最稳:把 `poolTypeMap` 类型改为 `Record<ExerciseMode, PoolTaskType>`**(值本就是 pool type 字面量,收窄后 `.equals()` 与 `getReusableTask` 都类型安全)。

- [ ] **Step 1: 改 import + 收窄 poolTypeMap**

约 36 行:
```ts
import { completeTask } from "@/lib/task-pool";
```
改为:
```ts
import { completeTask, getReusableTask } from "@/lib/task-pool";
```
约 259-263 `poolTypeMap`:
```ts
    const poolTypeMap: Record<ExerciseMode, string> = {
      sentence: "translation-sentence",
      paragraph: "translation-paragraph",
      situational: "translation-situational",
    };
```
改为:
```ts
    const poolTypeMap: Record<ExerciseMode, PoolTaskType> = {
      sentence: "translation-sentence",
      paragraph: "translation-paragraph",
      situational: "translation-situational",
    };
```
（需 import `PoolTaskType` from `@/lib/types` — 确认该文件已 import types,否则加。）

- [ ] **Step 2: 补 isTranslationSentenceSetData 守卫**

在既有 `isTranslationExercise`(105-113)旁加,复用其单元素校验:
```ts
// Sentence pool bundles multiple exercises under { items: [...] }; validate
// the wrapper + each element via isTranslationExercise.
const isTranslationSentenceSetData = (value: unknown): value is { items: TranslationExercise[] } => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.items) || v.items.length === 0) return false;
  return v.items.every((it) => isTranslationExercise(it));
};
```

- [ ] **Step 3: fresh 路径改用守卫 + seenIn**

把 fresh 块句子分支(275-283):
```ts
        if (targetMode === "sentence") {
          const items = content.items as TranslationExercise[] | undefined;
          if (items && items.length > 0) {
            setExercise(items[0]);
            await completeTask(poolTask.id);
            setIsGenerating(false);
            return;
          }
        } else {
```
改为:
```ts
        if (targetMode === "sentence") {
          if (isTranslationSentenceSetData(poolTask.content)) {
            setExercise(poolTask.content.items[0]);
            await completeTask(poolTask.id, "translation-sentence");
            setIsGenerating(false);
            return;
          }
        } else {
```
段落/情景分支(284-291)的 `completeTask(poolTask.id)` 改 `completeTask(poolTask.id, poolTypeMap[targetMode])`（复用收窄后的 map,seenIn 随模式）。其余（`isTranslationExercise` 守卫、`setExercise(content)`）不变。

- [ ] **Step 4: 插入 reusable 段**

在 fresh catch(294-296)后、`// Fallback to real-time generation`(298)前插入。注意三模式分一个 reusable 段,sentence 分支用 `isTranslationSentenceSetData`+`items[0]`,其余用 `isTranslationExercise`:
```ts
    // Alternating repetition (W3): no fresh item — revive a previously-seen
    // translation exercise rather than discarding it.
    try {
      const reusable = await getReusableTask(poolTypeMap[targetMode]);
      if (reusable) {
        if (targetMode === "sentence") {
          if (isTranslationSentenceSetData(reusable.content)) {
            setExercise(reusable.content.items[0]);
            await completeTask(reusable.id, "translation-sentence");
            setIsGenerating(false);
            return;
          }
        } else if (isTranslationExercise(reusable.content)) {
          setExercise(reusable.content);
          await completeTask(reusable.id, poolTypeMap[targetMode]);
          setIsGenerating(false);
          return;
        }
        // Revived a stale/old-shape row — burn it so it isn't re-revived.
        await completeTask(reusable.id);
      }
    } catch {
      // Fall through to real-time generation
    }
```

- [ ] **Step 5: 验证 + commit**

Run: `npx tsc --noEmit && npx eslint app/translate/page.tsx --quiet`
Expected: 0 error。
```bash
git add app/translate/page.tsx
git commit -m "feat(pool): wire getReusableTask into translate (+ sentence-set guard)"
```

---

### Task 6: 全量验证 + final review

**Files:** none（验证 only）

- [ ] **Step 1: 全量 tsc + eslint**

Run: `npx tsc --noEmit && npx eslint . --quiet`
Expected: 0 error。

- [ ] **Step 2: 派 Code Reviewer 审整条 plan（whole-branch）**

审点:各守卫不改变 fresh 接受集;reusable 段控制流 fall-through 正确(命中-采用-return / 守卫失败-烧-fallthrough / null-异常-fallthrough);seenIn 用 PoolTaskType 字面量;无新 React 19 effect 主体 setState 违规;translate `poolTypeMap` 收窄无回归;reader 未误动 Today's Article 682 站;listening 未误动 probe 888 站。

- [ ] **Step 3: 修复 review 发现 + 复审**

## Self-Review

- **Spec coverage**:5 生成型消费方(dictation/comprehension/prediction/reader-AiGenerateTab/translate)各有 task;4 无守卫站补守卫(dictation-isDictationData / prediction-isPredictionData / reader-isReadingArticleData / translate-isTranslationSentenceSetData);3 有守卫站复用。scope 排除项(2 每日新卡型、2 probe、共享 helper、getReusableTask 改动)在"不做"与各 task 明示。覆盖。
- **Placeholder scan**:Task 2 comprehension reusable 段有 `SAME-AS-FRESH-ADOPTION` 指示注释 — 这是给实现者的明确复制指令(逐字复制 fresh 命中分支 + 两处替换),非"TBD"。其余步骤含完整代码。无占位。
- **Type consistency**:`getReusableTask(type: PoolTaskType)`;各 literal 是 `PoolTaskType` 成员;translate `poolTypeMap` 收窄为 `Record<ExerciseMode, PoolTaskType>` 使 `.equals()` 与 `getReusableTask` 类型安全一致。守卫返回 `value is Shape` 与采用处解构一致。一致。
