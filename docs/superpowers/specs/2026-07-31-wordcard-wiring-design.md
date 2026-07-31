# WordCard 接线 W4 成果 — TTS 单词发音 + listening 挖词原声

> 设计日期 2026-07-31。先读 `docs/handoff-w4-audio-final.md` + `docs/handoff-w4-continuation.md`。
> 消费 W4 成果:W4-T2 audio Material(blob URL 可播片段)+ W1 TTS 基建(`lib/tts.ts` speak)。

## 目标

W2 在 `Card`/`WordCard` 预留了 `imageryHint`/`audioSrc` 槽位(TODO(W4),声明但未渲染),因当时无 authentic 音频/画面数据源。W4-T2 音频 Material + TTS 已就绪。本设计接线这两个成果,交付:

1. **T1 — 单词发音(所有卡)**:WordCard 加"听单词"按钮,复用 TTS `speak(word)`。零数据依赖,conversation/ielts/reader/listening 所有卡可用。
2. **T2 — 真实语境原声(listening 挖词卡)**:listening 三招 recall 阶段加划选挖词入口,存关联 audio Material + 句索引的 Card;WordCard 渲染"听原句原声"按钮,播该 Material 该句的 audio 片段。

## 范围取舍

- T2 仅接 **audio Material**(blob URL 可播片段)。Video Material 的 YouTube iframe 无法在 WordCard 内播句片段,留给 listening 页。
- **跳过 imageryHint 渲染**:audio Material 的 `materialToShadowingData` 把 imageryHint 填空串(W4-T3 设计,imagine 用标题替代),无内容可显。槽位保留,待未来有 imageryHint 数据源再渲染。T2 只做"听原句原声"按钮。
- T2 挖词**无 LLM、无释义**:划选文本 = Card.front + sourceSentence(整句)。`back`/`definition` 留空。保持简单,YAGNI。
- T2b 播放用**轻量内联 `new Audio`**(seek + play + 到 endMs pause),不复用 `createAudioPlayer`(WordCard 只需播单一片段,不需逐句/AB/poll 的完整 MediaSource)。

## T1 — WordCard TTS 单词发音

### 现状澄清

SRS 页(`app/srs/page.tsx`)复习卡片时**已有自己的 TTS 发音**(`speak(currentCard.front)` + Volume2 按钮,line 122/294),用的是 SRS 页内联渲染而非 `WordCard` 组件。`WordCard` 组件(conversation/ielts review 页用)目前**无发音按钮**。T1 补这个缺口,仅针对 `WordCard` 组件,不动 SRS 页(SRS 页已 self-sufficient)。

### 改动

`components/feedback/word-card.tsx`:
- 加 `Volume2` icon import(lucide-react)
- 在词头行(word + phonetic)右侧加"听单词"按钮:喇叭图标,点击 `speak(word)`(从 `lib/tts` import)
- 按钮 `type="button"`,`aria-label="Pronounce ${word}"`
- 省略 playing 状态机——speak 是 fire-and-forget(自带 blob 缓存,重复点击无害,缓存命中无网络),按钮点击即调,无状态(最简)
- 无新 prop——发音逻辑内联(word prop 已有)。YAGNI,未来需外部控制再加 `onSpeak?`

### 验证

- conversation review / ielts part2 / reader 的 WordCard 自动获得发音按钮(零消费方改动)
- tsc + eslint 0 error

## T2a — listening recall 划选挖词存卡

### 改动

`components/listening/shadowing-tab.tsx` recall 阶段:
- **生效前提**:仅 `subtitleMode === "english" | "bilingual"` 时挂挖词入口(`currentSentence` 仅在这些模式渲染;`hidden` 模式显示"字幕已隐藏"占位中文,无可挖文本,不挂 onMouseUp)。hidden 模式下用户想挖词须先切回 english/bilingual。
- 给当前句原文文本加 `onMouseUp`(或 `onPointerUp`)处理:读 `window.getSelection().toString().trim()`,若非空且 `currentSentence.includes(sel)` → 在句下方浮一个"存为生词卡"小按钮
- 点"存为生词卡"(media 路径,有 `material`):
  - `front` = 划选文本(trim)
  - `sourceSentence` = 当前句整句(`currentSentence`)
  - `materialId` = `material.id`
  - `sentenceIndex` = `index`(新增 Card 字段,见下;仅 media 路径存,指向 Material.sentences 同索引)
  - `sourceId` = `material.id`(Card.sourceId 是**必需字段**,media 路径用 material.id 填)
  - `source` = `"listening"`(新增 CardSource 值,见下)
  - `lemma` = 划选文本(无 LLM 提取,直接用)
  - `type` = `"vocabulary"`(现有 CardType)
  - `back`/`context`/`definition` 留空
  - 存 `db.cards.add`
  - 清选区(`window.getSelection()?.removeAllRanges()`)
  + 视觉反馈(短暂"已存")
- 划选校验:`currentSentence.includes(sel.trim())`(防跨句/跨元素误存;跨元素选区 toString 含 `\n`,includes 判否,正确挡住)

### text 路径取舍(不开挖词入口)

text 路径(`material` undefined,`genData` 是 LLM 产物)**不开挖词入口**。原因:① `Card.sourceId` 必需,但 text 路径无稳定 id 可填(genData 无 id、不持久化);② `sentenceIndex` 指向不持久化的 genData 数组,是死数据;③ text 路径无 audio Material,挖出的卡无原声价值,只有 T1 TTS 发音——而 text 路径的句子本就是 LLM 生成、用 TTS 听即可,不值得存卡。挖词入口仅 media 路径(video+audio),与 T2b 原声/索引语义自洽。

### Card schema 改动

`lib/types.ts` `Card`:
- 加 `sentenceIndex?: number`(关联 Material.sentences 的索引,用于 T2b 取 audio 片段;仅 media 路径存)
- `CardSource`(当前 `"conversation"|"ielts-part2"|"reading"|"writing"|"translate"|"manual"`)加 `"listening"`

`lib/db.ts`:Card 表 schema 不需改(sentenceIndex 是非索引字段,Dexie 透传)。Dexie version 不改(非索引字段 structuredClone 透传)。

### CardSource "listening" 同步消费方(exhaustive Record)

`CardSource` 加 `"listening"` 会破坏两处 `Record<CardSource, string>` exhaustive 映射,必须同步补键(否则 tsc 编译失败):
- `app/srs/page.tsx` `sourceLabels`(约 L30)加 `listening: "精听"`
- `app/srs/browse/page.tsx` `sourceLabels`(约 L28)加 `listening: "精听"`
- grep 确认无其他 exhaustive 消费者(审查已 grep,仅此两处)

### 不做

- 不调 LLM 提取 lemma/释义/imageryHint
- 不在 imagine/listen 阶段挖词(仅 recall,因 recall 显原文)
- 不做 text 路径挖词(见上"text 路径取舍")
- listening 挖词入口对 video/audio 都开(存 materialId+sentenceIndex),T2b 渲染时只对 audio Material 显示原声按钮。video 卡走 T1 的 TTS 发音即可。

## T2b — "听原句原声"按钮(audio Material 卡,WordCard + SRS 两处)

### UI 落点(两处,复用同一 hook)

1. **`WordCard` 组件**(conversation/ielts/reader review 页):listening 挖的卡若回流到这些页则显原声按钮;非 listening 卡无 materialId→无按钮。
2. **SRS 页**(`app/srs/page.tsx`):复习主战场。SRS 页有自己的卡片渲染(非 WordCard),已有 TTS 发音(line 122/294 `speak(currentCard.front)`)。在此渲染加"听原句原声"按钮——仅当当前卡有 `materialId` 时显示。audio 播片段,非 audio/无 Material fallback 已有的 `speak(front)`。

### `useAudioClipPlayback` hook(新建 `lib/use-audio-clip.ts`)

```
export function useAudioClipPlayback(): {
  play: (materialId: string, sentenceIndex: number, fallbackText: string) => Promise<void>;
  playing: boolean;
}
```
export function useAudioClipPlayback(): {
  play: (materialId: string, sentenceIndex: number, fallbackText: string) => Promise<void>;
  playing: boolean;
}
```
- 内部持 `audioRef`(HTMLAudioElement,`new Audio`,detached)、清理上次
- `play(materialId, sentenceIndex, fallbackText)`:
  - `const m = await db.materials.get(materialId)`
  - `m?.mediaType === "audio"` + 有 sourceUrl + `sentences[sentenceIndex]` 同时有 `audioStartMs` 与 `audioEndMs` → 走片段播放(见下)
  - 否则(video/无 Material/缺 `audioStartMs` 或 `audioEndMs`)→ `speak(fallbackText)`(缺 endMs 时不能播片段,否则会播整段 audio 到结尾;fallback TTS)
- **片段播放的 autoplay 正确模式(镜像 audio-source.ts 的 playInternal+pendingPlay,勿重蹈覆辙)**:
  - hook 的 `play` 在按钮 onClick(用户手势)内被调,但 `db.materials.get` 是 await——await 之后已脱离手势栈。故 `audio.play()` 必须在 await 之前的手势段发起,或在 await 后用一个"用户激活"残留窗口。**最稳:复用 audio-source.ts 已验证的模式**——在 `play` 入口同步(手势内)就 `audio.play()`(metadata 未就绪也启动),把 startMs 存入 pendingSeek,`loadedmetadata` 回调里只 `audio.currentTime = startMs`(不调 play)。poll 到 audioEndMs pause + clearPoll。
  - 即:手势内 `audio.play().catch(fallback)`;`loadedmetadata` 回调 `audio.currentTime = audioStartMs/1000`;poll `currentTime*1000 >= audioEndMs` → pause + clearPoll。
  - 任一步失败 → `speak(fallbackText)`
- `playing` state 供按钮视觉反馈
- unmount:`audio.pause(); audio.src=""; audio.load()` 清理(复用 audio-source.ts 的清理教训)
- 轻量:不复用 `createAudioPlayer`(WordCard/SRS 只需播单一片段,不需逐句/AB/onStateChange 的完整 MediaSource 契约)

### WordCard 组件改动

- 加可选 props:`materialId?: string`、`sentenceIndex?: number`
- **删除** 现有 `audioSrc?: string` 槽位(L23,TODO W4 注释)——它从未被渲染,被 `materialId+sentenceIndex` 机制取代;留着是 dangling 死槽位,困惑读者。同步删 `WordCardProps` 的 audioSrc + 解构。`imageryHint` 保留(未来有数据源再渲染)。
- 渲染:若 `materialId` 存在 → 在 sourceSentence 行下方渲染"听原句"按钮
- onClick:`useAudioClipPlayback().play(materialId, sentenceIndex, sourceSentence ?? word)`
- `playing` 反馈

### SRS 页改动

- `app/srs/page.tsx`:当前卡(`currentCard`)若有 `materialId` → 在卡片渲染区加"听原句原声"按钮(与现有 Volume2 TTS 发音按钮并列)
- onClick:同 hook
- 无 materialId 的卡(conversation/reading 等)不显此按钮,只显现有 TTS 发音
- **空 back 卡复习 UX**:listening 挖词卡 `back` 留空,SRS 页 L300 无条件渲染 `{currentCard.back}` 会显空白。改:`back` 为空时回退显示 `sourceSentence`(标"真实语境")作为复习面,避免"词→空白"退化体验。

### 消费方

- conversation/ielts/reader review 的 WordCard 用法**不改**(无 materialId → 无原声按钮,但有 T1 发音按钮);但**移除 audioSrc prop 传递**(若有)。grep 确认消费方未传 audioSrc(审查未发现传递,应均未用)。
- SRS 页透传 Card 全字段?SRS 用 `currentCard` 直接读 Card entity 字段(含 materialId/sentenceIndex),无需改消费逻辑——加按钮渲染即可

## 数据流

```
listening recall(media 路径)划选 → shadowing-tab 存 Card(materialId, sourceId=material.id, sentenceIndex, sourceSentence, front=选词, source="listening")
  ↓ Dexie
SRS/WordCard 渲染(传 materialId, sentenceIndex, sourceSentence)
  ↓ 点"听原句"
useAudioClipPlayback → db.materials.get(materialId) → audio 且有 startMs+endMs? 手势内 audio.play()+loadedmetadata seek+poll endMs pause : speak(sourceSentence)
```

## CardSource 加 "listening"

`lib/types.ts` `CardSource` 当前:`"conversation" | "reader" | ...`。加 `"listening"`。核对现有值,补上。

## 不改/不动

- Material schema 不改(sentenceIndex 在 Card 侧)
- Dexie version 不改(非索引字段透传)
- shadowing-tab 的 text 路径零改动(text 路径不开挖词入口,见 T2a "text 路径取舍";挖词入口仅 media 路径 recall 的 english/bilingual 模式)
- SRS 算法/nextReview 不动

## 验证

- tsc + eslint 0 error
- Code Reviewer 审查
- prod 浏览器:conversation WordCard 显发音按钮 + 点击有声;listening audio recall 划选存卡 → SRS 页该卡显"听原句" + 点击播 audio 片段
