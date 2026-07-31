# WordCard 接线 W4 成果 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 WordCard 组件加 TTS 单词发音(T1),并让 listening recall 阶段划选挖词存卡 + WordCard/SRS 渲染"听原句原声"按钮(T2),消费 W4 音频 Material 成果。

**Architecture:** T1 复用 `lib/tts.ts` speak。T2a 在 shadowing-tab recall 的原文 `<p>` 上挂划选监听,存 Card(关联 materialId+sentenceIndex)。T2b 新建 `lib/use-audio-clip.ts` hook(轻量 detached `<audio>`,镜像 audio-source.ts 的 autoplay 模式:手势内 play、loadedmetadata 仅 seek),WordCard + SRS 页两处复用。

**Tech Stack:** React 19 + TypeScript + Next.js 16 + Dexie(IndexedDB)+ lib/tts.ts(speak)。

## Global Constraints

- `AGENTS.md`:Next.js 16 有破坏性改动,写码前读 `node_modules/next/dist/docs/` 相关篇。
- 纯客户端 Dexie,单例 profile `id:"singleton"`。
- tsc `npx tsc --noEmit` + eslint `npx eslint . --quiet` 必须 0 error 才能 commit。
- commit 末尾 `Co-Authored-By: Claude <noreply@anthropic.com>`,直接在 main 提交(已授权)。不 push 除非用户要求。
- 不写测试(CLAUDE.md:不写测试除非要求)。验证靠 tsc+eslint+prod 浏览器手动。
- Code comments in English only。

## File Structure

- **Create** `lib/use-audio-clip.ts` — `useAudioClipPlayback` hook:播 audio Material 句片段(手势内 play + loadedmetadata seek + poll endMs pause),非 audio/失败 fallback `speak`。
- **Modify** `lib/types.ts` — `Card` 加 `sentenceIndex?: number`;`CardSource` 加 `"listening"`。
- **Modify** `app/srs/page.tsx` + `app/srs/browse/page.tsx` — `sourceLabels` 补 `listening` 键(编译要求)。
- **Modify** `components/feedback/word-card.tsx` — 删 `audioSrc` 槽位;加 T1 发音按钮;加 `materialId`/`sentenceIndex` props + "听原句"按钮。
- **Modify** `components/listening/shadowing-tab.tsx` — recall 阶段(currentSentence `<p>`)挂划选挖词存卡。
- **Modify** `app/srs/page.tsx` — 当前卡有 materialId 时加"听原句原声"按钮;空 back 回退显 sourceSentence。

---

## Task 1: Card schema + CardSource "listening" + sourceLabels 编译修复

**Files:**
- Modify: `lib/types.ts`(Card 接口 + CardSource 联合)
- Modify: `app/srs/page.tsx`(sourceLabels Record)
- Modify: `app/srs/browse/page.tsx`(sourceLabels Record)

**Interfaces:**
- Produces: `Card.sentenceIndex?: number`、`CardSource` 含 `"listening"`。后续 Task 2/3/4 依赖。

- [ ] **Step 1: 改 `lib/types.ts` CardSource + Card**

读 `lib/types.ts` L1-8 确认当前:
```ts
export type CardType = "vocabulary" | "error" | "expression";
export type CardSource =
  | "conversation"
  | "ielts-part2"
  | "reading"
  | "writing"
  | "translate"
  | "manual";
```

`CardSource` 加 `| "listening"`:
```ts
export type CardSource =
  | "conversation"
  | "ielts-part2"
  | "reading"
  | "writing"
  | "translate"
  | "manual"
  | "listening";
```

读 `lib/types.ts` Card interface(L21-44),在 `materialId?: string` 后加:
```ts
  sentenceIndex?: number; // for listening-mined cards: index into Material.sentences (T2b clip playback)
```

- [ ] **Step 2: 补 `app/srs/page.tsx` sourceLabels**

L30-36 当前:
```ts
const sourceLabels: Record<CardSource, string> = {
  conversation: "Conversation",
  "ielts-part2": "IELTS Part 2",
  reading: "Reading",
  writing: "Writing",
  translate: "Translation",
  manual: "Manual",
};
```
加 `listening: "精听",` 一行(在 manual 后)。

- [ ] **Step 3: 补 `app/srs/browse/page.tsx` sourceLabels**

同样在它的 `sourceLabels` Record(约 L28)加 `listening: "精听",`。

- [ ] **Step 4: tsc + eslint 验证**

Run: `npx tsc --noEmit && npx eslint . --quiet`
Expected: 0 error(CardSource exhaustive Record 现在两处都齐)。

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts app/srs/page.tsx app/srs/browse/page.tsx
git commit -m "feat(card): add Card.sentenceIndex + CardSource 'listening' + sourceLabels

Wire-up for WordCard authentic-audio clip playback (W4 consumption).
sentenceIndex links a listening-mined card to Material.sentences for clip
bounds. CardSource 'listening' tags cards mined in the listening recall
stage. Both exhaustive sourceLabels Records (srs/page, srs/browse) updated.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: `useAudioClipPlayback` hook

**Files:**
- Create: `lib/use-audio-clip.ts`

**Interfaces:**
- Consumes: `db.materials.get(id)` from `lib/db`、`Material` from `lib/types`(字段 `mediaType`/`sourceUrl`/`sentences[i].audioStartMs`/`audioEndMs`)、`speak` from `lib/tts`。
- Produces: `useAudioClipPlayback(): { play(materialId, sentenceIndex, fallbackText) => Promise<void>; playing: boolean }`。Task 3/4 用。

- [ ] **Step 1: 写 `lib/use-audio-clip.ts`**

```ts
// lib/use-audio-clip.ts
// Plays a single audio-Material sentence clip for WordCard / SRS review.
// Lightweight vs createAudioPlayer (no per-sentence/AB/onStateChange contract):
// just seek+play one bounded clip. Mirrors audio-source.ts's autoplay fix —
// play() is fired in the user-gesture call stack (the button onClick → hook
// play), and loadedmetadata only re-seeks; calling play() from loadedmetadata
// would be rejected by the autoplay policy (silent).

"use client";

import { useEffect, useRef, useState } from "react";
import { db } from "@/lib/db";
import { speak } from "@/lib/tts";
import type { Material } from "@/lib/types";

export function useAudioClipPlayback(): {
  play: (
    materialId: string,
    sentenceIndex: number,
    fallbackText: string
  ) => Promise<void>;
  playing: boolean;
} {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [playing, setPlaying] = useState(false);

  const cleanup = (): void => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.onloadedmetadata = null;
      a.onerror = null;
      a.src = "";
      a.removeAttribute("src");
      a.load();
      audioRef.current = null;
    }
  };

  useEffect(() => cleanup, []);

  const play = async (
    materialId: string,
    sentenceIndex: number,
    fallbackText: string
  ): Promise<void> => {
    // Tear down any prior playback before starting a new one.
    cleanup();

    let material: Material | undefined;
    try {
      material = await db.materials.get(materialId);
    } catch {
      void speak(fallbackText);
      return;
    }

    const sentence = material?.sentences?.[sentenceIndex];
    const startMs = sentence?.audioStartMs;
    const endMs = sentence?.audioEndMs;
    // Only audio materials with a bounded clip (both start+end) can play a
    // real clip; anything else (video, missing bounds, no material) falls
    // back to TTS so the learner still hears the sentence.
    if (
      !material ||
      material.mediaType !== "audio" ||
      !material.sourceUrl ||
      startMs == null ||
      endMs == null
    ) {
      void speak(fallbackText);
      return;
    }

    const audio = new Audio(material.sourceUrl);
    audioRef.current = audio;
    let started = false;

    // Fire play() in the user-gesture call stack (this hook's play is invoked
    // synchronously from a button onClick). loadedmetadata may not be ready
    // yet, but play() can start; the seek happens once metadata loads.
    audio.onloadedmetadata = () => {
      if (started) audio.currentTime = startMs / 1000;
    };
    audio.onerror = () => {
      cleanup();
      setPlaying(false);
      void speak(fallbackText);
    };

    try {
      started = true;
      setPlaying(true);
      await audio.play();
      // If metadata already loaded by now, seek immediately; otherwise the
      // onloadedmetadata handler will seek.
      if (audio.readyState >= 1) audio.currentTime = startMs / 1000;

      // Poll to pause at endMs (clip bound).
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => {
        if (audio.currentTime * 1000 >= endMs) {
          audio.pause();
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          setPlaying(false);
        }
      }, 100);
    } catch {
      cleanup();
      setPlaying(false);
      void speak(fallbackText);
    }
  };

  return { play, playing };
}
```

- [ ] **Step 2: tsc + eslint 验证**

Run: `npx tsc --noEmit && npx eslint lib/use-audio-clip.ts --quiet`
Expected: 0 error。

- [ ] **Step 3: Commit**

```bash
git add lib/use-audio-clip.ts
git commit -m "feat(audio): useAudioClipPlayback hook for card sentence-clip playback

Lightweight detached-<audio> clip player for WordCard/SRS: plays an audio
Material's sentence range (startMs..endMs) and falls back to TTS speak for
non-audio/missing-bounds. Mirrors audio-source.ts's autoplay fix — play()
fires in the gesture stack, loadedmetadata only re-seeks.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: WordCard — T1 发音按钮 + T2b "听原句"按钮 + 删 audioSrc

**Files:**
- Modify: `components/feedback/word-card.tsx`

**Interfaces:**
- Consumes: `speak` from `lib/tts`、`useAudioClipPlayback` from `lib/use-audio-clip`、`Volume2`/`Headphones` from `lucide-react`、`db` not needed here(hook 内部查)。
- Produces: `WordCard` 新增可选 props `materialId?: string`、`sentenceIndex?: number`;删除 `audioSrc` prop。

- [ ] **Step 1: 改 imports + props 类型**

`components/feedback/word-card.tsx` 顶部 imports 加:
```ts
import { Headphones, Plus, Check, Volume2 } from "lucide-react";
import { speak } from "@/lib/tts";
import { useAudioClipPlayback } from "@/lib/use-audio-clip";
```
(原 `import { Check, Plus } from "lucide-react"` 替换为上面的 Headphones/Plus/Check/Volume2 顺序。)

`WordCardProps` 删除 `audioSrc?: string` 行 + 其注释;加:
```ts
  /** Audio Material this card was mined from + the sentence index — enables
   *  "听原句原声" clip playback (T2b). Only present for listening-mined cards. */
  materialId?: string;
  sentenceIndex?: number;
```

- [ ] **Step 2: 改解构 + 加 hook**

函数解构删 `imageryHint,` `audioSrc,` 中的 `audioSrc`(保留 `imageryHint`),加 `materialId` `sentenceIndex`:
```ts
function WordCard({
  className,
  word,
  phonetic,
  partOfSpeech,
  level,
  definition,
  example,
  sourceSentence,
  // imageryHint is a reserved slot (methodology: mental-picture cue); not
  // rendered yet — audio materials have empty imageryHint today.
  imageryHint,
  materialId,
  sentenceIndex,
  onAdd,
  added = false,
  addDisabled = false,
  ...props
}: WordCardProps) {
  const clip = useAudioClipPlayback();
  const meta = [partOfSpeech, level].filter(Boolean).join(" · ");
```

- [ ] **Step 3: 加 T1 发音按钮(词头行右侧)**

把词头行(L61-70)改为在 phonetic 旁加发音按钮:
```tsx
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="font-heading text-[20px] leading-tight font-bold">
          {word}
        </h4>
        <div className="flex items-center gap-2">
          {phonetic ? (
            <span className="font-mono text-[12.5px] text-muted-foreground">
              {phonetic}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void speak(word)}
            aria-label={`Pronounce ${word}`}
            className="text-muted-foreground hover:text-primary transition-colors"
          >
            <Volume2 className="size-4" aria-hidden />
          </button>
        </div>
      </div>
```

- [ ] **Step 4: 加 T2b "听原句"按钮(sourceSentence 行下方)**

在 sourceSentence 块(L80-85)之后、fresh-example 块之前,加(仅当 materialId 存在):
```tsx
      {materialId != null && sentenceIndex != null ? (
        <button
          type="button"
          onClick={() =>
            void clip.play(materialId, sentenceIndex, sourceSentence ?? word)
          }
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-primary"
        >
          <Headphones className="size-3.5" aria-hidden />
          {clip.playing ? "播放中…" : "听原句原声"}
        </button>
      ) : null}
```

- [ ] **Step 5: tsc + eslint 验证**

Run: `npx tsc --noEmit && npx eslint components/feedback/word-card.tsx --quiet`
Expected: 0 error。确认无消费方传 `audioSrc`(grep `audioSrc` 应无命中除了已删的定义)。

Run: `grep -rn "audioSrc" components/ app/ lib/` — Expected: 无命中。

- [ ] **Step 6: Commit**

```bash
git add components/feedback/word-card.tsx
git commit -m "feat(word-card): TTS pronounce button + authentic-clip button, drop audioSrc

T1: Volume2 button speaks the word via TTS (fills the gap vs SRS page which
already had its own). T2b: when materialId+sentenceIndex are present
(listening-mined cards), a Headphones button plays the audio Material's
sentence clip via useAudioClipPlayback, falling back to TTS. Removed the
unused audioSrc slot (superseded by materialId+sentenceIndex).

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: listening recall 划选挖词存卡(T2a)

**Files:**
- Modify: `components/listening/shadowing-tab.tsx`

**Interfaces:**
- Consumes: `db.cards.add` from `lib/db`、`Card`/`CardSource` from `lib/types`(已加 "listening")、组件内 `material`/`index`/`currentSentence`/`isMedia`/`subtitleMode`。
- Produces: recall 阶段划选 → 存 Card。Task 5 的 SRS 按钮靠这些卡的 materialId+sentenceIndex。

- [ ] **Step 1: 加挖词 state + 处理函数**

在 shadowing-tab 组件内(已有 finished state 附近)加:
```ts
  // T2a: text selection in the recall sentence → store a vocabulary card
  // linked to this media Material + sentence index (for clip playback).
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [justSavedCard, setJustSavedCard] = useState(false);

  const handleSentenceMouseUp = (): void => {
    if (!isMedia) return;
    if (stage !== "recall") return;
    if (subtitleMode === "hidden") return;
    const sel = window.getSelection()?.toString().trim() ?? "";
    if (sel.length === 0 || !currentSentence.includes(sel)) {
      setPendingSelection(null);
      return;
    }
    setPendingSelection(sel);
  };

  const handleSaveCard = async (): Promise<void> => {
    if (!material || !pendingSelection) return;
    const front = pendingSelection;
    try {
      await db.cards.add({
        front,
        back: "",
        type: "vocabulary",
        lemma: front,
        context: "",
        sourceSentence: currentSentence,
        source: "listening",
        sourceId: material.id,
        materialId: material.id,
        sentenceIndex: index,
        easeFactor: 2.5,
        interval: 0,
        repetitions: 0,
        nextReview: new Date(),
        masteryLevel: "new",
        createdAt: new Date(),
        lastReviewedAt: null,
      });
      setJustSavedCard(true);
      setTimeout(() => setJustSavedCard(false), 1500);
    } catch (err) {
      console.error("save card failed", err);
    }
    setPendingSelection(null);
    window.getSelection()?.removeAllRanges();
  };
```

读 `lib/types.ts` Card interface 确认字段名(`front/back/type/lemma/context/sourceSentence/source/sourceId/materialId/easeFactor/interval/repetitions/nextReview/masteryLevel/createdAt/lastReviewedAt`)与 conversation 存卡(L215-230)一致。`db` 已在 shadowing-tab import(L21 `import { db } from "@/lib/db"`)。

- [ ] **Step 2: 给 recall 原文 `<p>` 挂 onMouseUp + 加存卡按钮**

定位 recall 的原文渲染(L894-897 区域):
```tsx
                  {subtitleMode !== "hidden" && (
                    <p className="text-base font-medium text-center py-2">
                      {currentSentence}
                    </p>
                  )}
```
改为挂 onMouseUp + 在其下方条件渲染存卡按钮:
```tsx
                  {subtitleMode !== "hidden" && (
                    <p
                      className="text-base font-medium text-center py-2"
                      onMouseUp={handleSentenceMouseUp}
                    >
                      {currentSentence}
                    </p>
                  )}
                  {pendingSelection ? (
                    <div className="flex justify-center">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleSaveCard()}
                      >
                        存为生词卡：{pendingSelection}
                      </Button>
                    </div>
                  ) : null}
                  {justSavedCard ? (
                    <p className="text-xs text-center text-primary">已存</p>
                  ) : null}
```

`Button` 已 import(L10)。

- [ ] **Step 3: tsc + eslint 验证**

Run: `npx tsc --noEmit && npx eslint components/listening/shadowing-tab.tsx --quiet`
Expected: 0 error。

- [ ] **Step 4: Commit**

```bash
git add components/listening/shadowing-tab.tsx
git commit -m "feat(listening): recall-stage text-selection mining → vocabulary card

Selecting text in the recall sentence (english/bilingual modes only) shows a
'store as vocabulary card' button. The card links to the media Material +
sentence index (materialId, sourceId, sentenceIndex) so its authentic clip can
play in SRS/WordCard. No LLM — front is the selection, back empty, source
'listening'. Text path (no material) is unaffected: mining is media-only.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: SRS 页 — "听原句原声"按钮 + 空 back 回退

**Files:**
- Modify: `app/srs/page.tsx`

**Interfaces:**
- Consumes: `useAudioClipPlayback` from `lib/use-audio-clip`、`currentCard`(Card entity,含 materialId/sentenceIndex/sourceSentence/back/front)、`Headphones` from `lucide-react`、现有 `speak` + `Volume2`。

- [ ] **Step 1: 加 imports + hook**

`app/srs/page.tsx` imports区:已有 `import { Library, PartyPopper, Volume2 } from "lucide-react"`(L5) → 改为加 `Headphones`:
```ts
import { Headphones, Library, PartyPopper, Volume2 } from "lucide-react";
```
加:
```ts
import { useAudioClipPlayback } from "@/lib/use-audio-clip";
```

在组件内(已有 currentCard 逻辑附近,约 L110)加:
```ts
  const clip = useAudioClipPlayback();
```

- [ ] **Step 2: 在卡片正面区加"听原句原声"按钮(仅 materialId 卡)**

定位现有发音按钮(约 L290-295,`<Volume2 />` 按 `speak(currentCard.front)` 那个)。读确认其 JSX 后,在其同级加一个条件按钮(仅当 `currentCard.materialId` 存在):
```tsx
                {currentCard.materialId && currentCard.sentenceIndex != null ? (
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      void clip.play(
                        currentCard.materialId!,
                        currentCard.sentenceIndex!,
                        currentCard.sourceSentence ?? currentCard.front
                      )
                    }
                    aria-label="Play authentic sentence clip"
                  >
                    <Headphones className="size-4" aria-hidden />
                  </Button>
                ) : null}
```
(放在现有 Volume2 发音按钮旁,同一 flex 容器内。读现有按钮的父容器 className 以匹配布局。)

- [ ] **Step 3: 空 back 回退显 sourceSentence**

定位 back 渲染(约 L300 `<p className="text-base font-medium">{currentCard.back}</p>`)。改为:
```tsx
              <p className="text-base font-medium">
                {currentCard.back || currentCard.sourceSentence || ""}
              </p>
```
(空 back → 显 sourceSentence 作为"真实语境"复习面;都无则空串。)

- [ ] **Step 4: tsc + eslint 验证**

Run: `npx tsc --noEmit && npx eslint app/srs/page.tsx --quiet`
Expected: 0 error。

- [ ] **Step 5: Commit**

```bash
git add app/srs/page.tsx
git commit -m "feat(srs): authentic-clip button for listening-mined cards + empty-back fallback

When the current review card has materialId+sentenceIndex (listening-mined),
a Headphones button plays the audio Material's sentence clip via
useAudioClipPlayback (falls back to TTS). Empty-back cards (listening-mined
have no definition) fall back to showing sourceSentence as the answer face.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: 部署 + 浏览器手动验证 + review

**Files:** 无代码改动(验证 + 修复)。

- [ ] **Step 1: 全量 tsc + eslint**

Run: `npx tsc --noEmit && npx eslint . --quiet`
Expected: 0 error。

- [ ] **Step 2: 部署 prod**

Run: `vercel --prod --yes`
等 Ready + `curl -s -o /dev/null -w "%{http_code}" "https://en-tutorial.vercel.app/listening/import"` 返 200。

- [ ] **Step 3: 浏览器验证 T1(conversation WordCard 发音)**

打开任一 conversation review 页(有 WordCard),点词头喇叭按钮 → 确认触发 TTS(无 error alert)。用 chrome-devtools snapshot 确认按钮存在。

- [ ] **Step 4: 浏览器验证 T2a(listening recall 挖词)+ T2b(WordCard/SRS 原声)**

1. 打开 `/listening/audio/<某 audio material id>`(用之前上传的或新上传一个)。
2. imagine → listen → 揭示原文进 recall。
3. 在原文句中划选一个词 → 确认"存为生词卡：xxx"按钮出现 → 点击 → 确认"已存"。
4. 进 `/srs` → 翻到该卡 → 确认"听原句原声"(Headphones)按钮出现 → 点击 → 确认触发播放(clip.playing 视觉反馈;非 audio/失败 fallback TTS)。用 chrome-devtools evaluate 确认无 error alert。
5. 确认空 back 卡显示 sourceSentence 作为答案面。

- [ ] **Step 5: 派 Code Reviewer 审 Task 1-5 改动**

派 Code Reviewer(`Agent` 工具)审 commits(Task 1-5)。修复全部发现。tsc+eslint 0 error 后 commit 修复。

- [ ] **Step 6: push(需用户授权)**

确认后:`git push origin main`。

---

## Self-Review

**Spec coverage:**
- T1 WordCard TTS 发音 → Task 3 Step 3 ✓
- T2a listening recall 划选挖词(english/bilingual only,sourceId,无 text 路径)→ Task 4 ✓
- T2b useAudioClipPlayback(autoplay 手势内 play + loadedmetadata seek + endMs poll + fallback speak + startMs+endMs 齐全要求)→ Task 2 ✓
- T2b WordCard 按钮 → Task 3 Step 4 ✓
- T2b SRS 按钮 → Task 5 Step 2 ✓
- Card.sentenceIndex + CardSource listening + sourceLabels 两处 → Task 1 ✓
- 删 audioSrc → Task 3 Step 1/2 ✓
- 空 back 回退 sourceSentence → Task 5 Step 3 ✓
- hidden 模式不挂挖词 → Task 4 handleSentenceMouseUp 守卫 ✓
- text 路径不开挖词 → Task 4 `if (!isMedia) return` ✓

**Placeholder scan:** 无 TBD/TODO/“添加错误处理”。每步有具体代码。

**Type consistency:** `useAudioClipPlayback` 签名在 Task 2 定义,Task 3/5 消费一致(`play(materialId, sentenceIndex, fallbackText)`)。`Card.sentenceIndex?: number`、`materialId?: string` 跨任务一致。`CardSource "listening"` Task 1 定义,Task 4 用 `"listening"`。
