# getReusableTask 接线 — 交替重复池接入 5 个生成型消费方

> 设计日期 2026-07-31。先读 `docs/handoff-w4-complete.md`(W4 整体 + 终审)与 `lib/task-pool.ts`。
> 消费 W3 成果:`getReusableTask`(`lib/task-pool.ts`,已接 shadowing)+ 既有各消费方的 fresh 查询。

## 背景

方法论第三招"交替重复":一个语料被消费后不丢弃,跨会话在足够间隔后复现(而非每次 miss 都实时生成一次新内容)。`getReusableTask(type, minIntervalMs)` 实现该机制:挑一个已完成、距上次见面够久的 task,复活(`completed=false` + `assignedDate=today`),返回它或 null。

现状(采证见下):`getReusableTask` **仅**接入 `listening-shadowing`。其余 pool 消费方都是两段式(pool fresh → 实时生成),fresh miss 时已见过内容被一次性丢弃。

## 目标

把 `getReusableTask` 接入 5 个"生成型"消费方,统一为 shadowing 既有三段式:**pool fresh → getReusableTask 复活 → 实时生成**。让这 5 类旧语料跨会话复现,方法论"交替重复"对它们生效。

## Scope(关键抉择)

8 个 pool 消费方分两类:

### 接入(5 个生成型 — 本次 scope)
pool miss 后**实时 LLM 生成**,复活旧内容无语义冲突(与 shadowing 同构):
- `listening-dictation`(`app/listening/page.tsx:82-102`)
- `listening-comprehension`(`app/listening/page.tsx:339-357`)
- `listening-prediction`(`app/listening/page.tsx:618-636`)
- `reading-article` — AiGenerateTab 路径(`app/reader/page.tsx:103-125`)
- `translation-{sentence,paragraph,situational}`(`app/translate/page.tsx:265-296`,一个函数三模式)

### 不接入(2 个每日新卡型 — 留两段式)
pool miss 后**静默隐藏卡片**(不实时生成),`completeTask` 延后到用户点击。它们是"每日**新鲜**内容"语义,复活旧内容会违反预期:
- `reading-article` Today's Article render-gating(`app/reader/page.tsx:678-706`)
- `writing-prompt` Today's Writing Prompt(`app/writing/page.tsx:186-211`)

## 现状采证(Explore agent 报告)

`PoolTaskType`(`lib/types.ts:202-212`),9 成员。fresh 查询谓词 `.and(t => !t.completed && t.assignedDate !== "").first()` 在 10 处复制粘贴(含 2 个不读 content 的 probe)。

shape 守卫覆盖 3/8 消费站:
- 有守卫:comprehension(`isComprehensionData`,`app/listening/page.tsx:302`)、translate 段落/情景(`isTranslationExercise`,`app/translate/page.tsx:105`)、shadowing(`isShadowingData`)。守卫均文件内 `const` 谓词,非共享。
- 无守卫(裸 `as` 强转 + truthiness):reader-AiGenerateTab、dictation、prediction、translate-句子分支。

shadowing 参考三段(`components/listening/shadowing-tab.tsx`):
- fresh(419-441):命中且 `isShadowingData` 过 → 采用 + `completeTask(id,"listening-shadowing")`;命中但守卫失败 → `completeTask(id)` 烧旧行 + fall through(stale pre-W1-T2 shape 清理)。
- reusable(446-456):`getReusableTask("listening-shadowing")` 默认 6h;守卫通过 → 采用 + `completeTask(id,"listening-shadowing")`;null/异常 → fall through。
- realtime(460-483)。

`"listening-shadowing"` 是全 repo 唯一曾传作 `seenIn` 的字符串;其余 9 处 `completeTask` 仅传 id,`lastSeenIn` 留 undefined。

## 设计

### 每站统一改动

在现有 fresh 查询块的 catch 之后、实时生成之前,插入 reusable 段:

```
try {
  const reusable = await getReusableTask(TYPE);
  if (reusable && GUARD(reusable.content)) {
    ADOPT(reusable);
    await completeTask(reusable.id, TYPE);   // seenIn = PoolTaskType literal
    return;
  }
  if (reusable) {
    // 复活的是旧 schema / 坏数据 — 烧掉旧行,不再被反复复活再拒
    await completeTask(reusable.id);
  }
} catch {
  // Fall through to real-time generation
}
// …existing real-time generation, unchanged…
```

约束:
- **seenIn** = 该站 `.equals()` 用的 PoolTaskType 字面量(如 `"listening-dictation"`)。镜像 shadowing 用 `"listening-shadowing"`。让 `lastSeenIn` 跟踪生效于 5 类。
- **间隔** 复用 `getReusableTask` 默认 6h,不传第二参。与 shadowing 一致。
- 5 站均已有 `completeTask` import;新增 `getReusableTask` 到同 import 语句。
- 控制流 fall-through 在每段(与 shadowing 一致):fresh catch → reusable try → reusable catch/null → realtime。

### shape 守卫补齐(4 站无守卫)

reusable 段必须守卫(复活的内容更老,更可能是 schema 变更前 shape;裸 `as` 会静默渲染坏内容)。补文件内 `const isFooData = (c): c is Shape => …` 谓词,**复用各站现有 truthiness 接受逻辑**,显式化(不改变当前 fresh 路径接受集)。fresh 路径同步改用守卫(消除裸 `as` 强转 + truthiness 的既有隐患):

- **reader-AiGenerateTab**:`isReadingArticleData` — 验 `string` title、`string` content、`comprehensionQuestions` 可选数组(每元素 question/options/correctIndex)。当前 fresh:`if (content.title && content.content)` + `?? []`。
- **dictation**:`isDictationData` — 验 `sentences: string[]` 非空。当前 fresh:`content.sentences && content.sentences.length > 0`。
- **prediction**:`isPredictionData` — 验 `firstHalf/secondHalf/topic` 均为 `string`。当前 fresh:三字段 truthiness。
- **translate-句子分支**:`isTranslationSentenceSetData` — 验 `items: TranslationExercise[]` 非空(复用既有 `TranslationExercise` 接口字段)。当前 fresh:`items` truthiness + `items[0]`。复用既有 `isTranslationExercise`(单元素守卫)派生集合守卫。

3 站已有守卫(comprehension/translate-段落情景/shadowing),reusable 段直接复用,不新增。

### 不做

- **不抽共享 `fetchFresh` helper**:10 处查询谓词虽同,但内容采用/fall-through 各异,helper 只省谓词、守卫仍在调用方,DRY 收益薄却拆散既有三段控制流(违反 YAGNI)。
- **不接 reader-Today's Article / writing-Today's Prompt**:每日新卡语义,复活旧内容违反预期。
- **不改 `getReusableTask` 签名/默认间隔**。
- **不接 probe 站**(`app/listening/page.tsx:882` tab 选择器、`app/translate/page.tsx:350` mode 选择器):它们不读 content、不 `completeTask`,接线无意义且会双查同一行。
- **不改 `assignTasks`/cron/`getTodayTasks`**。
- **不补 shared guard 模块**:各 guard 文件内,与既有三 guard 一致。

## 风险与缓解

- **复活旧内容 = 重复练习同一篇**:这是方法论本意(交替重复),非缺陷。6h 间隔防刚做完就重做。生成型场景无"每日新鲜"预期(对比每日新卡型已排除)。
- **守卫收紧改变 fresh 接受集**?设计明确:守卫复用现有 truthiness 逻辑,接受集不变。review 需核各守卫不拒绝当前 fresh 会接受的行。
- **烧旧行误删好数据**?仅当复活行 shape 守卫失败才烧——即旧 schema/坏数据,本就该清理(镜像 shadowing:437 stale 处理)。fresh 路径守卫失败**不**烧(各站 fresh 守卫失败保持现状:fall through 不烧,与 reader-AiGenerateTab 现有一致)——只有 reusable 段烧,因为 reusable 主动复活了它、失败则须阻止反复复活。

## 数据流

```
消费方 mount/生成 button
 → fresh query(type): 命中+守卫 → 采用 + completeTask(id,type)
 → miss → getReusableTask(type): 命中+守卫 → 采用 + completeTask(id,type)
                                  命中-守卫失败 → completeTask(id) 烧 + fall through
                                  null/异常 → fall through
 → 实时 LLM 生成(不变)
```

## 验证

- tsc `npx tsc --noEmit` + eslint `npx eslint . --quiet` 0 error。
- Code Reviewer 审:各守卫不改变 fresh 接受集;reusable 段控制流 fall-through 正确;seenIn 用 PoolTaskType 字面量;无新 React 19 effect 主体 setState 违规(reusable 段在生成函数/事件处理内,非 effect 主体)。
- prod 浏览器(可选,需造数据):某站先消费一条 pool(完成),清空当日 fresh 池,6h 后再访问 → 应复活该条而非实时生成;造一条旧 schema 行 → 应被烧 + fall through 到实时生成。
