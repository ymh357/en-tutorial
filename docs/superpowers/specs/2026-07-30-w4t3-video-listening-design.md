# W4-T3 Step 2 设计：YouTube 视频原版素材接入 listening 三招

> 状态：设计稿，待用户复审 → 转 writing-plans。
> 前置：Step 0（Python yt-dlp function）+ Step 1（`lib/subtitle-parse.ts`）已完成并过 Code Reviewer（commits `d559a5a`、`0bcc54e`）。本 spec 只覆盖 Step 2（前端 + 三招流程接 video 声音源）。

## 1. 目标与范围

让用户贴一个 YouTube URL → 抓字幕 → 落 `Material(mediaType:"video")` → 在 listening 三招流程（imagine/listen/recall）里**用 YouTube 视频原声**逐句精听：逐句跳转、变速、当前句高亮、AB 循环。

**Step 2 scope（用户已定"全流程接 go"）**：
1. 造项目第一个媒体播放器 `YouTubeMediaSource`（仅 YouTube；TTS 不包装，按 mediaType 分支）。
2. 改 `shadowing-tab` 三招流程接 video 声音源（逐句 seek/到句暂停/变速/AB/watchdog 适配）。
3. YouTube 导入入口（URL 主导，503 触发手动粘贴字幕降级）。
4. Material 落库 + `mediaType:"video"` 消费分流。
5. imagine 阶段用视频标题+缩略图（不调 LLM）。
6. Python function 改返原始 json3（统一解析路径，`parseJson3` 不再死代码）。

**明确不做**（用户已定）：
- 不做主题策展推荐清单（用户贴 URL，不做推荐）。
- 不做 `interests → YouTube 主题`映射层（interests 在本阶段不消费）。
- 不调 LLM 补 imageryHint/translation。

## 2. 已确认的产品决策

| 决策点 | 选定 | 理由 |
|---|---|---|
| scope | 全流程接 go（含改三招） | 一次到位拿到"视频能逐句精听"完整价值 |
| 素材来源 | 用户贴 URL，不做推荐 | 最简、与 reader URL 导入一致、零映射层维护 |
| 字幕契约 | Python 返原始 json3 | YouTube/srt/vtt 走同一 `parseJson3` 路径，单一过滤逻辑来源 |
| imagine 缺口 | 标题+缩略图，不调 LLM | 零成本零延迟，符合"先想画面再看" |
| 粘贴字幕 | URL 主导；仅 503 触发粘贴降级 | 不增入口复杂度，保留对单视频的救场 |

## 3. 架构

### 3.1 YouTube 媒体播放器

`components/listening/media-source.ts`（新）——**Step 2 仅 YouTube 用，TTS 不强行包装**（避免为未做的 W4-T2 预造抽象）。shadowing-tab 内按 `mediaType` 分支：text 走原 `speak`（零改动），video 走 `YouTubeMediaSource`。W4-T2 音频来时再决定是否抽共同接口。

**逐句模型（与 TTS 语义一致，非连续播放）**：listen 阶段 `play(startMs,endMs)` 只播当前句、到 endMs 自停、用户手动 next（三招每句一轮，句间有 imagine/recall）。当前句高亮 = `index`（数组下标，always），**不由时间驱动**。故接口无 `onTimeUpdate` 高亮用途——`play` 内部轮询 `getCurrentTime` 仅用于 endMs 暂停判定（不外抛）。

```ts
export interface YouTubeMediaSource {
  play(startMs: number, endMs: number): void;  // seek+play，内部轮询到 endMs pauseVideo
  pause(): void;
  seekTo(ms: number): void;
  setRate(rate: number): void;                    // 先 getAvailablePlaybackRates() 取合法档，最近邻规整
  getRate(): number;                               // 返回实际生效档（供 UI 显示）
  getAvailableRates(): number[];                   // 供 UI 禁用不合法档
  onStateChange(cb: (state: "playing"|"paused"|"ended") => void): () => void;  // watchdog/stage 同步
  destroy(): void;                                 // stopVideo + 清内部轮询
}
```

- **YouTubeMediaSource**（包 IFrame Player API）：`play(startMs,endMs)` = `seekTo(startMs/1000)` + `playVideo()` + 起 `setInterval`(100ms) 轮询 `getCurrentTime()*1000`，到 `endMs` 时 `pauseVideo()` + 清轮询。`setRate` 先 `getAvailablePlaybackRates()` 取合法档，最近邻规整（0.75 多数视频合法，不合法 round 到 0.5/1）。`onStateChange` 转 `onStateChange.data`（1 playing/2 paused/0 ended）。
- **AB 循环（新功能，video listen 阶段专用 toggle）**：listen 阶段一个"AB 循环"开关按钮（video 模式才显）。开 → `play` 到 endMs 不暂停而 `seekTo(startMs)` 重播该句，直到用户点 next/recall 或关 toggle。关 → 同默认（到 endMs 停）。停止条件明确：toggle off / nextSentence / 切 stage / destroy。

**注入点**：`ShadowingTab` 增加 `material?: Material` prop。有 `material` 且 `mediaType==="video"` → 内部构造 `YouTubeMediaSource(videoId)` + 用 `materialToShadowingData(material)` 喂数据、跳过 `generateSentences`；句时间戳直接读 `material.sentences[index].audioStartMs/audioEndMs`（`ShadowingSentence` 无该字段，时间走 material）。无 material → 原有 pool/LLM 路径 + TTS（零改动）。

### 3.2 数据适配层：Material → ShadowingData

`ShadowingSentence {text, translation, imageryHint}` 全必填（`shadowing-tab.tsx:73-99` 的 `isShadowingData` 守卫）。video 字幕只有 `text`。新增适配函数 `materialToShadowingData(material: Material): ShadowingData`（放 `components/listening/material-adapter.ts` 新）：
- `topic` = material.topic
- `context` = material.title（视频标题作 context）
- `sentences` = material.sentences.map(s => ({ text: s.text, translation: "", imageryHint: "" }))
- imagine 阶段对 `imageryHint===""` 改显视频标题+缩略图（见 3.4）

`materialToShadowingData` 只产 `ShadowingData`（text/translation/imageryHint）。句时间戳**不进适配层**——shadowing-tab 直接读 `material.sentences[index].audioStartMs/audioEndMs`（见 3.1 注入点）。

**recall 空译文处理（video 模式功能缺口）**：`translation=""` 时，recall 三态字幕的 `bilingual` 态会只露英文（与 `english` 态重复，三态退化两态）。video 模式下检测 `currentTranslation === ""` → 隐藏 bilingual 选项，recall 只提供 `hidden`/`english` 两态 + 文案"该视频素材无中文译文"。

### 3.3 shadowing-tab 三招接 video 声音源（改动清单）

| 位置 | 现状 | video 化改动 |
|---|---|---|
| L24 `import speak` | 硬耦 TTS | 保留；video 模式另 import `YouTubeMediaSource`。按 `material?.mediaType` 分支，TTS 路径零改动 |
| L547 `speak(currentSentence, undefined, playbackRate, voice)` | listen 播放 | video 模式：`ytSource.play(startMs, endMs)`；text 模式：原 `speak`（不变） |
| L754 `speak(..., undefined, voice)` | recall 再听 | video 模式：`ytSource.play(startMs, endMs)`；text 模式不变 |
| L558-571 变速按钮 `[0.5,0.75,1,1.25,1.5,2]` | `setUserRateOverride` | video 模式：`ytSource.setRate(r)` + 用 `getAvailableRates()` 禁用不合法档、显示实际生效档；text 模式不变（TTS 连续rate） |
| L577-594 口音选择器 `VOICE_OPTIONS` | Edge-TTS voice | video 模式隐藏（声音是视频原声，无 voice 概念——否则欺诈 UI） |
| （新）AB 循环 toggle | 无（现有无 AB） | video listen 阶段显"AB 循环"开关：开则该句到 endMs 重播 seekTo(startMs)，关/next/切 stage/destroy 停（见 3.1） |
| L304-306 currentSentence/Translation/ImageryHint | 从 `data.sentences[index]` | 不变；video 下 translation/imageryHint 为空，imagine 段改显标题/缩略图，recall 段隐藏 bilingual（见 3.2） |
| L420-436 `nextSentence` 数组换 index | index++ | video 模式：index++ + `ytSource.seekTo(sentences[index].audioStartMs)`（text 模式不变） |
| L151-157 watchdog | 20s 无点击弹 nudge | video 模式：`onStateChange` PLAYING 时周期 `markActive()`（视频播放中静止是正常专注，不误报） |
| L509-537 imagine | 显 topic/context/imageryHint | video 模式：imageryHint 空时显视频标题+缩略图 `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` |
| saveListeningExercise（L355-375 当前未传 materialId） | 无 materialId | 传 `materialId` + `bumpMaterialExposure(materialId)` |

### 3.4 imagine 阶段 video 模式

video 素材 `imageryHint=""`：imagine 段检测 `currentImageryHint === ""` → 改显：
- 视频标题（`data.context` = material.title，导入页填入）
- 缩略图 `<img src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}>`（静态 URL，零 API 调用）
- 文案："先看视频标题和封面，想象这个视频会讲什么，不要急着播放。"

### 3.5 YouTube 导入入口

参照 reader `ImportUrlTab`（`app/reader/page.tsx:397-560`）两段式：输入 URL → 抓字幕预览 → 确认落库。

**导入→三招连接（关键）**：导入页"开始精听"落库后，跳专用路由 `app/listening/video/[id]/page.tsx`（新，隔离、不扰 listening 页 pool-tab 逻辑）。该路由读 `db.materials.get(id)` → 透传给 `ShadowingTab({cefrLevel, material})`——ShadowingTab 有 material 且 `mediaType==="video"` 时构造 `YouTubeMediaSource(videoId)` + 用 `materialToShadowingData` 喂数据、跳过 `generateSentences`（见 3.1 注入点）。这是整个流程的闭合点，无它则导入完进不了三招。

形态：listening 页一个"导入 YouTube 视频"按钮 → 跳新路由 `app/listening/import/page.tsx`（新，与 reader 独立页一致、可独立验证、不挤 listening 页）。含：
1. URL 输入（`youtube.com/watch?v=` 或 `youtu.be/` 解析 videoId，复用 `VIDEO_ID_RE` 同款 11 字符校验）+ 标题输入框（可选，默认从 URL 推断或留空，落 material.title）
2. topic 选择（用统一 `lib/topics.ts`，见 3.7）
3. "抓字幕"按钮 → `GET /api/youtube_captions?v=ID`（生产域名）。**不调 oEmbed**（避免额外外部依赖/失败路径）；缩略图静态拼 `https://img.youtube.com/vi/${id}/hqdefault.jpg`，标题用步骤 1 的输入。
   - 200：`parseJson3(json3)` → 预览前几句 + 缩略图
   - 400：URL/ID 不合法提示
   - 404：视频不可用/无英文字幕提示
   - **503：自动引导手动粘贴字幕**（"自动抓取失败（视频可能被限流）。请手动粘贴 srt/vtt 字幕："→ textarea → `parseSubtitles` → 预览）
4. "开始精听" → `saveMaterial({ mediaType:"video", sourceKind:"authentic", sourceUrl: watch URL, title, content:"", sentences })` → 跳 video 三招路由（见上"导入→三招连接"）

### 3.6 Python function 改返原始 json3

`api/youtube_captions.py`：删 `_flatten_events`，成功响应返**原始 json3 对象**（`{events:[...]}`）。过滤逻辑统一由 `lib/subtitle-parse.ts` 的 `parseJson3` 处理——其 `isSpeech`（L60-64）过滤 `[`/`(` 前缀的非语音标注（`[Music]`/`[Applause]`），**保留 `♪` 包裹的实际歌词**（`♪ We're no strangers ♪` 是真实歌词，应留）。前端 `parseJson3(pythonJson3)` → `MaterialSentence[]`（含 audioStartMs/audioEndMs）。

需重新部署验证（Python 改动）。契约：响应体 = YouTube 原始 json3 `{events:[...]}`；前端不再依赖 Python 的 `startMs/endMs` 字段。

### 3.7 统一 topics 单一来源

抽 `lib/topics.ts`（新）：export `TOPICS` 常量，合并 onboarding `INTEREST_TOPICS`(10) 与 reader `TOPICS`(8) 为一份。reader `app/reader/page.tsx:36-45` 与 onboarding `app/onboarding/page.tsx:59-70` 改 import。**Settings interests 编辑器不在本 scope**（文案欺诈现存，但修它属独立改动，记 handoff 待办）。

## 4. 错误处理

- URL 解析失败/非 YouTube：前端校验，不发请求。
- 503 自动抓失败 → 粘贴降级路径（3.5）。
- YouTube 适配器 API 加载失败/视频不可播放：listen 阶段显错 + 引导回导入。
- 变速档不支持：按钮禁用或显示最近邻生效档，不静默。
- watchdog：video playing 计入 active（3.3）。

## 5. 测试

- 手动为主（Python service 仅部署可跑、preview 受 SSO 挡）。
- 单测可做：`lib/subtitle-parse.ts`（已有，补 YouTube 原始 json3 用例）、`material-adapter.ts`（Material→ShadowingData 形状）、URL→videoId 解析。
- 端到端：生产域名贴 URL → 抓字幕 → 三招精听（部署后验）。
- dev 联调：粘贴 srt/vtt 路径在 `next dev` 下测播放器/三招（绕过 Python service）。

## 6. 风险

| 风险 | 缓解 |
|---|---|
| 改三招破坏现有文本/TTS 行为 | mediaType 分支：text 走原 `speak` 零改动；video 走 `YouTubeMediaSource` 独立分支，不交叠 |
| Python 改 json3 需重新部署验证 | 部署 preview 实调 dQw4w9WgXcQ 确认返原始 json3 |
| 变速 0.75 个别视频不支持 | 运行时读 `getAvailablePlaybackRates` 规整 + UI 禁用不合法档 |
| YouTube `seekTo` 关键帧粒度（~1-2s）致句首偏移 | 比 TTS 精确句边界差；可接受（精听目的非帧级），或 seekTo 前 200ms 提前补偿 |
| AB 循环 toggle 新增 UI/状态 | video listen 阶段专用开关，停止条件明确（toggle off/next/切 stage/destroy） |
| preview/next dev 无法端到端 | 粘贴字幕路径兜底 dev 联调；生产域名端到端 |
| 导入→三招断点 | ShadowingTab 加 `material` prop + video 路由透传（3.5 连接段） |
| recall 空译文三态退化 | video 模式隐藏 bilingual，仅 hidden/english 两态（3.2） |
| interests/Settings 文案欺诈仍在 | 本 scope 不修，记 handoff 待办（避免 scope 膨胀） |

## 7. 分阶段实现（writing-plans 细化）

1. Python 改 json3 + 重新部署验证。
2. `lib/topics.ts` 统一 + reader/onboarding 改 import（纯重构）。
3. `components/listening/media-source.ts`（仅 `YouTubeMediaSource`，含 IFrame API 加载/逐句 play/AB toggle）。
4. `components/listening/material-adapter.ts`（Material→ShadowingData）。
5. `shadowing-tab` 加 `material` prop + mediaType 分支（video: imagine 标题缩略图/watchdog playing 计入 active/口音隐藏/AB toggle/逐句 seek+到句停；text: 零改动）。
6. `app/listening/video/[id]/page.tsx` + `app/listening/import/page.tsx`（URL + 503 粘贴降级）+ listening 页入口按钮。
7. saveListeningExercise 传 materialId + bumpMaterialExposure。
8. tsc/eslint + 部署端到端验证 + Code Reviewer。

每阶段独立可提交、可审查。
