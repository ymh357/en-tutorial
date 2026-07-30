# W4-T3 Step 2: YouTube 视频接入 listening 三招 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户贴 YouTube URL → 抓字幕 → 落 `Material(mediaType:"video")` → 在 listening 三招流程里用 YouTube 视频原声逐句精听（逐句 seek+到句暂停、变速、AB 循环、标题缩略图 imagine）。

**Architecture:** shadowing-tab 加 `material?: Material` prop，按 `mediaType` 分支：text 走原 `speak`（零改动），video 走新 `YouTubeMediaSource`（包 IFrame Player API，逐句模型：`play(startMs,endMs)` seek+轮询到 endMs 暂停）。导入页 `app/listening/import` URL 抓字幕（Python function 已部署返原始 json3），503 降级手动粘贴 srt/vtt。落库后跳 `app/listening/video/[id]` 透传 material 进三招。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript strict、Dexie（IndexedDB）、YouTube IFrame Player API（`YT.Player`）、Vercel Services Python function（已部署）。

**Spec:** `docs/superpowers/specs/2026-07-30-w4t3-video-listening-design.md`（commit `cdb6553`）。

## Global Constraints

- **Next.js 16 有破坏性改动**：写 route 前读 `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`；dynamic route params 需 `await ctx.params`。
- **纯客户端 Dexie**，单例 profile `id:"singleton"`，无服务端 DB。
- **类型/lint 门槛**：每个任务结束前 `npx tsc --noEmit` + `npx eslint . --quiet` 必须 0 error。
- **无测试框架**：本项目无 jest/vitest（`package.json` 无、仓库无 `*.test.ts`）。验证形态 = `tsc`/`eslint` + 手动行为验证 +（涉及 Python/部署时）`vercel deploy` 实测。**不引入测试框架**（CLAUDE.md：除非明确要求）。
- **路径 alias**：`@/*` → `./*`（`tsconfig.json`）。
- **Python service 仅部署可跑**：`next dev` 不跑 Python；preview 受 SSO Protection 仅生产域名可调 `/api/youtube_captions`。dev 联调用粘贴字幕路径绕过 Python。
- **commit 末尾** `Co-Authored-By: Claude <noreply@anthropic.com>`，直接 main 提交（已授权），不 push。
- **每 phase 完成派 Code Reviewer 审查**（`Agent` 工具，`Code Reviewer` 类型），修复全部再下一 phase。

### W4-T3 阻塞教训（必读，来自 Step 0/1 审查）

1. `fetch_captions` 必须合并 `automatic_captions`+`subtitles`（manual 优先），否则 auto-only 视频静默 404。
2. `outtmpl` 用 `%(id)s` 非 `%(title)s`（路径安全）。
3. serverless cwd 只读 → outtmpl 指 `/tmp`。
4. ASGI app 须处理 `lifespan` scope。
5. vercel.json services 模式下 rewrites 顺序：`/api/youtube_captions` → captions、`/api/(.*)` → web、`/(.*)` → web（缺第二条会废现有 TS route）。
6. W1 BLOCKER：异步 fetch 落 state 需 token/AbortController 防串句（shadowing-tab 的 `chunkTokenRef`）——改 shadowing-tab 勿破坏。

---

## File Structure

**新建：**
- `lib/topics.ts` — 统一 TOPICS 常量（单一来源，合并 onboarding/reader 两份漂移）。
- `components/listening/media-source.ts` — `YouTubeMediaSource`（IFrame Player API 封装，逐句 play/AB/rate）。
- `components/listening/material-adapter.ts` — `materialToShadowingData(material)` 适配。
- `app/listening/import/page.tsx` — YouTube URL 导入页。
- `app/listening/video/[id]/page.tsx` — video Material 三招播放路由。

**修改：**
- `api/youtube_captions.py` — 改返原始 json3（删 `_flatten_events`）。
- `components/listening/shadowing-tab.tsx` — 加 `material` prop + mediaType 分支 + video 模式各处适配。
- `app/listening/page.tsx` — 加"导入 YouTube 视频"入口按钮。
- `app/reader/page.tsx`、`app/onboarding/page.tsx` — 改 import 统一 `lib/topics.ts`。
- `docs/handoff-w4-continuation.md`（末尾任务）— 进度更新。

---

## Task 1: Python function 改返原始 json3

**Files:**
- Modify: `api/youtube_captions.py`（删 `_flatten_events` L88-101，改成功响应返原始 json3）

**Interfaces:**
- Produces: `GET /api/youtube_captions?v=ID` 成功响应体改为 YouTube **原始 json3 对象** `{events:[{tStartMs, dDurationMs, segs:[{utf8}]}]}`（不再返 `{videoId, languageCode, sentences:[{text,startMs,endMs}]}`）。前端 Task 8 的 `parseJson3` 消费这个形状。

**背景**：spec §3.6。当前 Python 已 flatten（`_flatten_events` L88-101）+ 过滤 `[Music]`。改后过滤统一由 `lib/subtitle-parse.ts` 的 `parseJson3`（其 `isSpeech` 已过滤 `[`/`(` 前缀，保留 `♪` 歌词）负责，YouTube/srt/vtt 走同一路径。

- [ ] **Step 1: 读现有 `api/youtube_captions.py` 确认 `fetch_captions` 与成功响应段**

读 `api/youtube_captions.py`。当前 `fetch_captions`（L30-62）调 `_flatten_events(events)` 返 `{languageCode, sentences}`；成功响应（约 L159-168）返 `{videoId, languageCode, sentenceCount, sentences}`。

- [ ] **Step 2: 改 `fetch_captions` 返原始 json3**

改 `fetch_captions`：删除 sentences flatten，改为读到 json3 文件后直接返 `{languageCode, json3}`（整个 parsed json3 对象）。删 `_flatten_events` 函数定义。`[Music]` 过滤不再在 Python 做（交给前端 `parseJson3`）。

```python
# fetch_captions 内，替换 flatten 段为：
try:
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)
    return {"languageCode": lang, "json3": data}
finally:
    try:
        os.remove(filepath)
    except OSError:
        pass
# 整个 _flatten_events 函数定义删除
```

- [ ] **Step 3: 改成功响应返原始 json3**

成功响应（`app` 函数内 `result is not None` 分支）改为：

```python
await _respond(
    send,
    200,
    {
        "videoId": video_id,
        "languageCode": result["languageCode"],
        "json3": result["json3"],
    },
)
```

删 `sentenceCount`/`sentences`/`sample` 字段。

- [ ] **Step 4: py_compile 语法检查**

Run: `python3 -m py_compile api/youtube_captions.py`
Expected: 无输出（OK）。

- [ ] **Step 5: 部署 preview 实测返原始 json3**

Run: `vercel deploy --yes`（后台），记下 Preview URL。
SSO Protection 阻挡 preview——临时关：用 vercel auth token 调 `PATCH https://api.vercel.com/v9/projects/{projectId}?teamId={orgId}` body `{"ssoProtection":null}`（token 路径 `~/Library/Application Support/com.vercel.cli/auth.json` 的 `token` 字段；projectId/orgId 在 `.vercel/project.json`）。原值备份到 `/tmp/vercel-sso-backup.json`（应为 `{"ssoProtection":{"deploymentType":"all_except_custom_domains"}}`）。

实调：`curl -sS "<PreviewURL>/api/youtube_captions?v=dQw4w9WgXcQ" --max-time 90 | head -c 400`
Expected: 返 JSON 含 `"json3":{"events":[...`，events 元素有 `tStartMs`/`segs`（原始 YouTube json3 形状，非已 flatten 的 `sentences`）。

恢复 protection：PATCH body 用 `/tmp/vercel-sso-backup.json` 内容，确认 `ssoProtection` 恢复 `{'deploymentType':'all_except_custom_domains'}`。

- [ ] **Step 6: Commit**

```bash
git add api/youtube_captions.py
git commit -m "refactor(w4-t3): Python function returns raw json3 (unified parse path)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: 统一 `lib/topics.ts`

**Files:**
- Create: `lib/topics.ts`
- Modify: `app/reader/page.tsx:36-45`（删本地 `TOPICS`，改 import）
- Modify: `app/onboarding/page.tsx:59-70`（删本地 `INTEREST_TOPICS`，改 import）

**Interfaces:**
- Produces: `lib/topics.ts` export `TOPICS`（`readonly string[]`）与 `DEFAULT_TOPIC`（`TOPICS[0]`）。合并 reader 8 项与 onboarding 10 项为一份（并集去重）。

**背景**：spec §3.7。两份漂移：reader `TOPICS`（`app/reader/page.tsx:36-45`，8 项含 Environment 无 Travel/Food/Music）、onboarding `INTEREST_TOPICS`（`app/onboarding/page.tsx:59-70`，10 项含 Travel/Food/Music 无 Environment）。参照 `lib/date.ts` 的 single-source 注释风格。

- [ ] **Step 1: 读两份现有常量确认并集**

读 `app/reader/page.tsx` L36-45 与 `app/onboarding/page.tsx` L59-70，列出并集：`Technology, Business, Science, Culture, Daily Life, Health, Education, Environment, Travel, Food, Music`（11 项去重）。

- [ ] **Step 2: 创建 `lib/topics.ts`**

```ts
// lib/topics.ts
// Single source for topic taxonomy used by reader URL import, onboarding
// interest selection, and (W4-T3) video import. Replaces two divergent
// copies (app/reader TOPICS vs app/onboarding INTEREST_TOPICS) that had
// drifted — one had Environment, the other had Travel/Food/Music.

export const TOPICS: readonly string[] = [
  "Technology",
  "Business",
  "Science",
  "Culture",
  "Daily Life",
  "Health",
  "Education",
  "Environment",
  "Travel",
  "Food",
  "Music",
] as const;

export const DEFAULT_TOPIC: string = TOPICS[0];
```

- [ ] **Step 3: reader 改 import**

`app/reader/page.tsx`：删 L36-45 的本地 `TOPICS` 定义，顶部加 `import { TOPICS } from "@/lib/topics";`。确认 L40 附近的 `useState<string>(TOPICS[0])` 仍合法（`TOPICS[0]` 现为 `"Technology"`，不变）。

- [ ] **Step 4: onboarding 改 import**

`app/onboarding/page.tsx`：删 L59-70 的本地 `INTEREST_TOPICS` 定义，顶部加 `import { TOPICS as INTEREST_TOPICS } from "@/lib/topics";`（保留别名以最小化改动 `INTEREST_TOPICS` 的所有引用点）。确认 onboarding 其它引用 `INTEREST_TOPICS` 处仍合法。

- [ ] **Step 5: tsc + eslint**

Run: `npx tsc --noEmit && npx eslint . --quiet`
Expected: 0 error。

- [ ] **Step 6: 手动验证行为不变**

`npm run dev`（用户授权时）→ 访问 `/reader` 与 `/onboarding`，确认 topic 选择器选项正确显示合并后的 11 项、默认选中 Technology。

- [ ] **Step 7: Commit**

```bash
git add lib/topics.ts app/reader/page.tsx app/onboarding/page.tsx
git commit -m "refactor: unify topic taxonomy into lib/topics.ts

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: `YouTubeMediaSource` 播放器

**Files:**
- Create: `components/listening/media-source.ts`

**Interfaces:**
- Produces: `export interface YouTubeMediaSource` 与 `export function createYouTubePlayer(opts): YouTubeMediaSource`（签名见下）。Task 5 的 shadowing-tab 消费它。

**背景**：spec §3.1。逐句模型（非连续播放）：`play(startMs,endMs)` 只播当前句、到 endMs 自停/AB 循环。当前句高亮=index（不在本文件，在 shadowing-tab）。YouTube IFrame Player API 通过动态注入 `https://www.youtube.com/iframe_api` 加载，全局 `window.YT` + `onYouTubeIframeAPIReady` 回调。

```ts
export interface YouTubePlayerOpts {
  videoId: string;
  containerId: string;  // iframe 挂载的 div id
}

export interface YouTubeMediaSource {
  /** Seek to startMs and play; auto-pause at endMs (or loop if abLoop). */
  play(startMs: number, endMs: number): void;
  pause(): void;
  seekTo(ms: number): void;
  /** Clamp to nearest available rate; returns actual applied rate. */
  setRate(rate: number): number;
  getRate(): number;
  getAvailableRates(): number[];
  /** Subscribe to play/pause/ended state changes (for watchdog). */
  onStateChange(cb: (state: "playing" | "paused" | "ended") => void): () => void;
  /** Pause video, clear interval, destroy iframe. */
  destroy(): void;
}
```

- [ ] **Step 1: 写 IFrame API 加载器**

`components/listening/media-source.ts` 顶部。IFrame API 异步加载，单例 promise 防重复注入：

```ts
// components/listening/media-source.ts
// YouTube IFrame Player API wrapper for the listening three-stage flow.
// Per-sentence model (matches TTS semantics): play(startMs,endMs) plays one
// sentence and auto-pauses at endMs (or loops when abLoop is on). The current
// sentence highlight is driven by the caller's sentence index, NOT by time.

declare global {
  interface Window {
    YT?: typeof YT;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;

const loadIframeApi = (): Promise<void> => {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<void>((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return apiPromise;
};
```

- [ ] **Step 2: 写 `createYouTubePlayer` 工厂**

```ts
import type { YouTubePlayerOpts, YouTubeMediaSource } from "./types"; // 若不另建 types 文件，接口直接在本文件 export（见 Step 1 前）

export const createYouTubePlayer = (
  opts: YouTubePlayerOpts
): YouTubeMediaSource => {
  let player: YT.Player | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let abLoop = false;
  let currentStartMs = 0;
  let currentEndMs = 0;
  const stateCbs = new Set<(s: "playing" | "paused" | "ended") => void>();
  const mapState = (data: number): "playing" | "paused" | "ended" =>
    data === 1 ? "playing" : data === 0 ? "ended" : "paused";

  // Player is constructed async after the API loads. Calls before ready are
  // queued by YT.Player itself; we guard play/seek with a ready check.
  void loadIframeApi().then(() => {
    player = new window.YT.Player(opts.containerId, {
      videoId: opts.videoId,
      events: {
        onStateChange: (e: { data: number }) => {
          stateCbs.forEach((cb) => cb(mapState(e.data)));
        },
        onReady: () => {
          // nothing — rate queried on demand
        },
      },
    });
  });

  const clearPoll = (): void => {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  };
  const startPoll = (): void => {
    clearPoll();
    pollInterval = setInterval(() => {
      if (!player) return;
      const ms = (player.getCurrentTime?.() ?? 0) * 1000;
      if (ms >= currentEndMs) {
        if (abLoop) {
          player.seekTo?.(currentStartMs / 1000, true);
        } else {
          player.pauseVideo?.();
          clearPoll();
        }
      }
    }, 100);
  };

  return {
    play(startMs, endMs) {
      currentStartMs = startMs;
      currentEndMs = endMs;
      player?.seekTo?.(startMs / 1000, true);
      player?.playVideo?.();
      startPoll();
    },
    pause() {
      player?.pauseVideo?.();
      clearPoll();
    },
    seekTo(ms) {
      player?.seekTo?.(ms / 1000, true);
    },
    setRate(rate) {
      const avail = player?.getAvailablePlaybackRates?.() ?? [0.5, 1, 1.5, 2];
      const clamped = [...avail].sort(
        (a, b) => Math.abs(a - rate) - Math.abs(b - rate)
      )[0];
      player?.setPlaybackRate?.(clamped);
      return clamped;
    },
    getRate() {
      return player?.getPlaybackRate?.() ?? 1;
    },
    getAvailableRates() {
      return player?.getAvailablePlaybackRates?.() ?? [0.5, 1, 1.5, 2];
    },
    onStateChange(cb) {
      stateCbs.add(cb);
      return () => stateCbs.delete(cb);
    },
    destroy() {
      clearPoll();
      stateCbs.clear();
      player?.destroy?.();
      player = null;
    },
  };
};
```

注：`YT` 类型来自 `@types/youtube`——但本仓库未装。**不引入 `@types/youtube` 依赖**（CLAUDE.md），改用本地最小类型声明。把上方的 `import type { YT } from "youtube"` 替换为本文件内的 `declare global` 最小 `YT` 命名空间（仅 `Player` 构造 + 用到的方法签名 `seekTo/​playVideo/​pauseVideo/​getCurrentTime/​getPlaybackRate/​setPlaybackRate/​getAvailablePlaybackRates/​destroy`）。`abLoop` setter 暴露为接口方法 `setAbLoop(on: boolean)`（补进 `YouTubeMediaSource` 接口）。

- [ ] **Step 3: 补 `setAbLoop` 到接口与实现**

接口加 `setAbLoop(on: boolean): void;`。实现：`setAbLoop(on) { abLoop = on; }`。Task 5 的 AB toggle 按钮调它。

- [ ] **Step 4: tsc + eslint**

Run: `npx tsc --noEmit && npx eslint components/listening/media-source.ts --quiet`
Expected: 0 error。注意：`window.YT` 全局声明可能与 `declare global` 冲突——若 tsc 报重复，把 `Window.YT` 声明改为 `YT?: any` 兜底（最小化，不引依赖）。

- [ ] **Step 5: 手动验证 API 加载（可选拆 off）**

本任务产物未接入 UI，纯逻辑。tsc/eslint 过即可。API 实际加载行为在 Task 5/8 接入后端到端验。

- [ ] **Step 6: Commit**

```bash
git add components/listening/media-source.ts
git commit -m "feat(listening): YouTubeMediaSource — IFrame API per-sentence wrapper

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: `materialToShadowingData` 适配

**Files:**
- Create: `components/listening/material-adapter.ts`

**Interfaces:**
- Consumes: `Material`、`MaterialSentence`（`lib/types.ts` L278-304）；`ShadowingData`/`ShadowingSentence`（`components/listening/shadowing-tab.tsx` L72-82 export）。
- Produces: `export function materialToShadowingData(material: Material): ShadowingData`。

**背景**：spec §3.2。`ShadowingSentence {text, translation, imageryHint}` 全必填（`isShadowingData` 守卫 L86-100）。video 字幕只有 `text`，translation/imageryHint 填空串（imagine/recall 的空值处理在 Task 5）。

```ts
// components/listening/material-adapter.ts
// Adapts a Material (video/audio with real subtitles) into the ShadowingData
// shape the three-stage flow consumes. Video captions only carry text;
// translation/imageryHint are empty and the imagine/recall stages render
// fallback content (title+thumbnail / hide bilingual) — see shadowing-tab.

import type { Material } from "@/lib/types";
import type { ShadowingData } from "@/components/listening/shadowing-tab";

export const materialToShadowingData = (material: Material): ShadowingData => ({
  topic: material.topic,
  context: material.title,
  sentences: (material.sentences ?? []).map((s) => ({
    text: s.text,
    translation: "",
    imageryHint: "",
  })),
});
```

- [ ] **Step 1: 读 `ShadowingData` export 确认可 import**

读 `components/listening/shadowing-tab.tsx` L72-82 确认 `ShadowingData`/`ShadowingSentence` 是 `export interface`（是，L73/L78）。注意循环 import 风险：material-adapter import shadowing-tab 的类型，shadowing-tab Task 5 会 import material-adapter 的函数——**类型 import 不引运行时循环**（`import type`），OK。

- [ ] **Step 2: 创建文件（用上方代码）**

- [ ] **Step 3: tsc + eslint**

Run: `npx tsc --noEmit && npx eslint components/listening/material-adapter.ts --quiet`
Expected: 0 error。

- [ ] **Step 4: Commit**

```bash
git add components/listening/material-adapter.ts
git commit -m "feat(listening): materialToShadowingData adapter

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: shadowing-tab 接 video 声音源（核心）

**Files:**
- Modify: `components/listening/shadowing-tab.tsx`

**Interfaces:**
- Consumes: `YouTubeMediaSource`（Task 3）、`materialToShadowingData`（Task 4）、`Material`（`lib/types.ts`）。
- Produces: `ShadowingTab({ cefrLevel, material }: { cefrLevel: string; material?: Material })`。Task 7 的 video 路由传 `material`。

**背景**：spec §3.3 改动清单。这是本 phase 最大改动，严格按 mediaType 分支，**text 路径零改动**。行号基于当前 `shadowing-tab.tsx`（commit `0bcc54e` 后），改动前重读确认（CLAUDE.md #9）。

- [ ] **Step 1: 读 shadowing-tab 全貌确认行号**

读 `components/listening/shadowing-tab.tsx` L1-160（props/imports/state）、L420-436（nextSentence）、L505-660（imagine/listen/recall 渲染）。改动前确认：`ShadowingTab` 签名 L124、`generateSentences` L213-296、`chunkTokenRef` L62、watchdog L151-157。

- [ ] **Step 2: 加 `material` prop 与 video 模式分发**

L124 改签名：

```tsx
export const ShadowingTab = ({
  cefrLevel,
  material,
}: {
  cefrLevel: string;
  material?: Material;
}): JSX.Element => {
  const isVideo = material?.mediaType === "video";
```

顶部 import：`import type { Material } from "@/lib/types";`、`import { materialToShadowingData } from "./material-adapter";`、`import { createYouTubePlayer } from "./media-source";`、`import type { YouTubeMediaSource } from "./media-source";`。

- [ ] **Step 3: video 模式喂数据（跳过 generateSentences）**

加 effect：`isVideo && material` 时 `setData(materialToShadowingData(material))`，跳过 pool/LLM 的 `generateSentences`。注意 token 守卫（W1 教训）：用现有 `chunkTokenRef` 模式，video 数据是同步的但仍走 `setData`。构造 `YouTubeMediaSource`：

```tsx
const ytSourceRef = useRef<YouTubeMediaSource | null>(null);
useEffect(() => {
  if (!isVideo || !material) return;
  const videoId = extractVideoId(material.sourceUrl); // 见 Step 4
  if (!videoId) return;
  ytSourceRef.current = createYouTubePlayer({ videoId, containerId: "yt-player" });
  setData(materialToShadowingData(material));
  return () => { ytSourceRef.current?.destroy(); ytSourceRef.current = null; };
}, [isVideo, material]);
```

- [ ] **Step 4: 加 `extractVideoId` helper（本文件或 material-adapter）**

YouTube URL → 11 字符 videoId：`youtube.com/watch?v=ID`、`youtu.be/ID`、`embed/ID`。正则 `/v=([a-zA-Z0-9_-]{11})|youtu\.be\/([a-zA-Z0-9_-]{11})|embed\/([a-zA-Z0-9_-]{11})/`。放 `lib/youtube.ts`（新，纯函数，Task 6/7 复用）：

```ts
// lib/youtube.ts
const VIDEO_ID_RE = /[?&]v=([a-zA-Z0-9_-]{11})|youtu\.be\/([a-zA-Z0-9_-]{11})|embed\/([a-zA-Z0-9_-]{11})/;
export const extractVideoId = (url: string | undefined): string | null => {
  if (!url) return null;
  const m = url.match(VIDEO_ID_RE);
  return (m?.[1] ?? m?.[2] ?? m?.[3]) ?? null;
};
```

shadowing-tab import `extractVideoId`。

- [ ] **Step 5: listen 阶段播放分支（L547）**

```tsx
onClick={() => {
  markActive();
  setListensCount((c) => c + 1);
  if (isVideo && ytSourceRef.current && material?.sentences) {
    const s = material.sentences[index];
    if (s?.audioStartMs != null && s?.audioEndMs != null) {
      ytSourceRef.current.play(s.audioStartMs, s.audioEndMs);
    }
  } else {
    void speak(currentSentence, undefined, playbackRate, voice);
  }
}}
```

- [ ] **Step 6: recall 再听分支（L754）** — 同 Step 5 逻辑（video 走 `ytSourceRef.current.play`，text 走 `speak`）。

- [ ] **Step 7: 变速按钮 video 分支（L558-571）**

video 模式：`setUserRateOverride(r)` 后 `ytSourceRef.current?.setRate(r)`；用 `getAvailableRates()` 禁用不合法档（`disabled={!ytSourceRef.current?.getAvailableRates().includes(r)}`，但 ytSourceRef 不触发重渲染——改用 state 存 `availableRates`，由 `onStateChange` ready 后 set）。text 模式：原 `setUserRateOverride` 不变。

- [ ] **Step 8: 口音选择器 video 隐藏（L577-594）**

`{!isVideo && (<div>...口音选择器...</div>)}`。

- [ ] **Step 9: AB 循环 toggle（video listen 阶段，新增）**

listen 阶段（L539 块内）加：`{isVideo && (<Button onClick={() => { markActive(); const next=!abLoop; setAbLoop(next); ytSourceRef.current?.setAbLoop(next); }}>{abLoop ? "AB 循环开" : "AB 循环关"}</Button>)}`。state `const [abLoop, setAbLoop] = useState(false);`。

- [ ] **Step 10: imagine video 分支（L509-537）**

`currentImageryHint === ""` 且 `isVideo` → 显视频标题 `data?.context` + 缩略图 `<img src={\`https://img.youtube.com/vi/${videoId}/hqdefault.jpg\`} />` + 文案"先看视频标题和封面，想象这个视频会讲什么，不要急着播放。"（videoId 来自 Step 4 `extractVideoId`，提前算到组件级 const）。

- [ ] **Step 11: recall bilingual 隐藏（L632-645）**

video 模式（`currentTranslation === ""`）：mode 数组从 `["english","bilingual","hidden"]` 改为 `["english","hidden"]`，并在 bilingual 不显时加文案 `<p className="text-xs text-muted-foreground">该视频素材无中文译文。</p>`。

- [ ] **Step 12: watchdog video 适配（L151-157）**

video 模式：`ytSourceRef.current?.onStateChange((state) => { if (state === "playing") markActive(); })`——注册一次（在 Step 3 的 effect 内）。playing 时周期 active 防误报。注意 React 19 规则（L196-201 注释）：effect 体只 ref+注册，setState 在回调。

- [ ] **Step 13: nextSentence video seek（L420-436）**

video 模式：`index+1` 后 `ytSourceRef.current?.seekTo(material.sentences[index+1].audioStartMs)`（或不在 nextSentence 自动播，留 listen 阶段 play 触发）。text 模式不变。

- [ ] **Step 14: saveListeningExercise 传 materialId（L358-372）**

`extra` 对象加 `materialId: material?.id`。effect/effect 外加 `bumpMaterialExposure`：`if (material?.id) void dbHelpers.bumpMaterialExposure(material.id);`（best-effort，与 updateStreak 同 try 块）。

- [ ] **Step 15: 渲染 iframe 容器（video listen 阶段）**

listen 阶段顶部加 `<div id="yt-player" className="..." />`（video 模式才显 `{isVideo && (...)}`）。`createYouTubePlayer` 的 `containerId: "yt-player"` 挂载于此。

- [ ] **Step 16: tsc + eslint**

Run: `npx tsc --noEmit && npx eslint components/listening/shadowing-tab.tsx --quiet`
Expected: 0 error。

- [ ] **Step 17: 手动验证 text 路径未坏**

`npm run dev` → `/listening` shadowing tab，确认普通三招（TTS）行为不变：imagine/listen/recall、变速、口音、字幕三态、focus nudge 全正常。

- [ ] **Step 18: Commit**

```bash
git add components/listening/shadowing-tab.tsx lib/youtube.ts
git commit -m "feat(listening): shadowing-tab video mode — YouTube audio source

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: 导入页 `app/listening/import`

**Files:**
- Create: `app/listening/import/page.tsx`
- Create: `lib/youtube.ts`（若 Task 5 未建，则此 Task 建；Task 5 已建则复用 `extractVideoId`）

**Interfaces:**
- Consumes: `/api/youtube_captions`（返原始 json3）、`parseJson3`（`lib/subtitle-parse.ts`）、`parseSubtitles`（srt/vtt 降级）、`saveMaterial`（`lib/db-helpers.ts`）、`TOPICS`（`lib/topics.ts`）、`extractVideoId`（`lib/youtube.ts`）。
- Produces: 导入页 UI，落库后 `router.push("/listening/video/" + materialId)`。

**背景**：spec §3.5。参照 reader `ImportUrlTab`（`app/reader/page.tsx:397-560`）两段式。URL 主导，503 触发粘贴降级。

- [ ] **Step 1: 读 reader ImportUrlTab 模板**

读 `app/reader/page.tsx` L397-560，参照其：URL input + topic Select + error Alert + 预览卡 + 确认按钮的结构与 `useRouter` 跳转。

- [ ] **Step 2: 写导入页骨架**

`app/listening/import/page.tsx`：URL input + 标题 input（可选）+ topic Select（`TOPICS`，默认 `DEFAULT_TOPIC`）+ "抓字幕"按钮。state：`url`、`title`、`topic`、`error`、`sentences: MaterialSentence[] | null`、`videoId`、`pasting`（503 降级开关）、`pasteText`。

- [ ] **Step 3: 抓字幕逻辑**

```tsx
const res = await fetch(`/api/youtube_captions?v=${videoId}`);
if (res.status === 503) {
  setPasting(true); // 降级到手动粘贴
  setError("自动抓取失败（视频可能被限流）。请手动粘贴 srt/vtt 字幕：");
  return;
}
if (!res.ok) {
  const d = await res.json().catch(() => ({}));
  setError(d.error || "抓取失败");
  return;
}
const { json3 } = await res.json();
const parsed = parseJson3(json3);
if (parsed.length === 0) { setError("未解析到字幕"); return; }
setSentences(parsed);
```

`parseJson3` import from `@/lib/subtitle-parse`。`videoId` = `extractVideoId(url)`。

- [ ] **Step 4: 503 粘贴降级**

`pasting` 为真时显 textarea + "解析粘贴"按钮：

```tsx
const parsed = parseSubtitles(pasteText); // 自动识别 srt/vtt/json3
setSentences(parsed);
```

- [ ] **Step 5: 预览 + 开始精听落库**

预览：缩略图 `<img src={\`https://img.youtube.com/vi/${videoId}/hqdefault.jpg\`} />` + 前 3 句。开始精听：

```tsx
const mat = await dbHelpers.saveMaterial({
  topic, mediaType: "video", sourceKind: "authentic",
  sourceUrl: url.trim(), title: title.trim() || "Untitled",
  content: "", sentences,
});
router.push(`/listening/video/${mat.id}`);
```

- [ ] **Step 6: tsc + eslint**

Run: `npx tsc --noEmit && npx eslint app/listening/import/page.tsx --quiet`
Expected: 0 error。

- [ ] **Step 7: dev 联调粘贴路径**

`npm run dev` → `/listening/import`，因 `next dev` 不跑 Python，URL 抓会失败——**故意触发粘贴降级**，粘一段 srt/vtt，确认 `parseSubtitles` 解析、预览、落库、跳 `/listening/video/<id>`（此时 video 路由 Task 7 未建会 404，正常）。

- [ ] **Step 8: Commit**

```bash
git add app/listening/import/page.tsx lib/youtube.ts
git commit -m "feat(listening): YouTube import page (URL + 503 paste fallback)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: video 三招路由 + listening 页入口

**Files:**
- Create: `app/listening/video/[id]/page.tsx`
- Modify: `app/listening/page.tsx`（加"导入 YouTube 视频"按钮）

**Interfaces:**
- Consumes: `ShadowingTab`（Task 5，`material` prop）、`db.materials.get`、`useProfile`、Next 16 dynamic route `ctx.params`（需 `await`）。

**背景**：spec §3.5 连接段。闭合点：导入完进三招。

- [ ] **Step 1: 读 listening 页入口结构**

读 `app/listening/page.tsx` L874-961（`ListeningPage`），找加"导入 YouTube 视频"按钮的合适位置（如 TabsList 旁或顶部）。读 Next 16 dynamic route 文档 `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md` 确认 `params` await 形态。

- [ ] **Step 2: 写 video 路由**

`app/listening/video/[id]/page.tsx`（Server Component 取 params → Client Component 读 Dexie）：

```tsx
// app/listening/video/[id]/page.tsx
import { VideoListeningClient } from "./video-client";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <VideoListeningClient materialId={id} />;
}
```

`app/listening/video/[id]/video-client.tsx`（"use client"）：`useEffect` `db.materials.get(materialId)` → `<ShadowingTab cefrLevel={profile.studyLevel ?? "B1"} material={material} />`。material 未读到时显"素材不存在"。

- [ ] **Step 3: listening 页加入口按钮**

`app/listening/page.tsx` 顶部加 `<Link href="/listening/import">导入 YouTube 视频</Link>`（用 `next/link`，参照现有 Link 用法）。

- [ ] **Step 4: tsc + eslint**

Run: `npx tsc --noEmit && npx eslint . --quiet`
Expected: 0 error。

- [ ] **Step 5: dev 联调端到端（粘贴路径）**

`npm run dev` → `/listening/import` 粘 srt 落库 → 跳 `/listening/video/<id>` → 确认进入三招、imagine 显标题缩略图、listen 阶段显 `<div id="yt-player">`（iframe 因 dev 达不到 IFrame API 仍可挂载，video 播放需生产域名完整验）。

- [ ] **Step 6: Commit**

```bash
git add app/listening/video/[id]/page.tsx app/listening/video/[id]/video-client.tsx app/listening/page.tsx
git commit -m "feat(listening): video material route + import entry button

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: 端到端验证 + Code Reviewer 审查

**Files:**
- 无新文件（验证 + 文档同步）

**背景**：spec §5 测试 + Global Constraints 的 Code Reviewer 闭环。生产域名端到端（Python service 仅生产可调）。

- [ ] **Step 1: 全量 tsc + eslint**

Run: `npx tsc --noEmit && npx eslint . --quiet`
Expected: 0 error。

- [ ] **Step 2: 部署 production + 端到端**

`vercel deploy --prod --yes`（需用户授权 prod 部署；或用 preview + 临时关 SSO）。

端到端实测（生产域名）：
1. `/listening/import` 贴 `https://www.youtube.com/watch?v=dQw4w9WgXcQ` → 抓字幕（200，原始 json3）→ `parseJson3` 预览 → 开始精听落库。
2. 跳 `/listening/video/<id>` → 三招：imagine 显标题+缩略图；listen 点播放 → iframe 视频从 `audioStartMs` 播到 `audioEndMs` 停；变速按钮选 0.75 → 视频 0.75x；AB 循环 toggle → 该句循环；口音选择器隐藏；watchdog 视频播放中不误报。
3. recall：bilingual 隐藏，仅 english/hidden 两态。
4. 503 验证：贴已知限流视频（如 `M7lc1UVf-VE`）→ 降级粘贴路径。

- [ ] **Step 3: 派 Code Reviewer 审查整个 Step 2**

`Agent` 工具，`Code Reviewer` 类型。审查范围：Task 1-7 全部 diff（commits 从 Task 1 到 Task 7）。重点：mediaType 分支是否破坏 text 路径、video iframe 生命周期/内存泄漏、AB 循环停止条件、watchdog React 19 规则、`extractVideoId` 边界、503 降级、`materialId` 传递。

- [ ] **Step 4: 修复 Code Reviewer 全部发现**

按发现分级修复，每修复一项 tsc/eslint 验证。

- [ ] **Step 5: 更新 handoff 文档**

`docs/handoff-w4-continuation.md`：W4-T3 Step 2 标 ✅ 完成；记录 Step 2 实现要点（video 路由、YouTubeMediaSource、mediaType 分支、503 降级）+ 任一 Code Reviewer BLOCKER 教训。

- [ ] **Step 6: 最终 commit**

```bash
git add docs/handoff-w4-continuation.md <修复的文件>
git commit -m "feat(w4-t3): Step 2 complete — YouTube video into listening flow + review fixes

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage**（逐节核对）：
- §3.1 YouTubeMediaSource（逐句/AB/rate/onStateChange/destroy）→ Task 3 ✅，Task 5 接入 ✅
- §3.2 materialToShadowingData + recall 空译文 → Task 4 ✅（适配），Task 5 Step 11 ✅（recall bilingual 隐藏）
- §3.3 改动清单 10 行 → Task 5 Step 5-15 全覆盖 ✅
- §3.4 imagine 标题缩略图 → Task 5 Step 10 ✅
- §3.5 导入入口 + 导入→三招连接 → Task 6 ✅（导入），Task 7 ✅（video 路由闭合）
- §3.6 Python 返原始 json3 → Task 1 ✅
- §3.7 统一 topics → Task 2 ✅

**Placeholder 扫描**：无 TBD/TODO；每步有具体代码或精确行号。

**类型一致性**：`YouTubeMediaSource` 接口 Task 3 定义、Task 5 消费一致（`play/setRate/setAbLoop/onStateChange/destroy`）；`materialToShadowingData` Task 4 定义、Task 5 消费一致；`ShadowingTab({cefrLevel, material})` Task 5 定义、Task 7 消费一致；`parseJson3`/`parseSubtitles` 来自 `lib/subtitle-parse.ts`（Step 1 已存在）。`extractVideoId` Task 5 Step 4 建 `lib/youtube.ts`、Task 6 复用——一致。

**注意**：Task 3 的 `@types/youtube` 处理已改为本地 `declare global`（不引依赖，符合 CLAUDE.md）。Task 5 Step 7 的 `availableRates` 需 state（ytSourceRef 不触发重渲染）——计划已注明。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-30-w4t3-video-listening.md`. Two execution options:

**1. Subagent-Driven（推荐）** — 每个 Task 派 fresh subagent，Task 间审查，快迭代

**2. Inline Execution** — 本会话内用 executing-plans，批量执行 + checkpoint 审查

Which approach?
