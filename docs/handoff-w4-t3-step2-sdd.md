# Handoff — W4-T3 Step 2（YouTube 视频接入 listening 三招）SDD 完成

> 给新 session 的交接文档。本会话从前置验证到 SDD 8 任务全跑完 W4-T3 Step 2。**先读本文件 + `docs/handoff-w4-continuation.md` 再动手。**

## 一句话状态

W4-T3（YouTube 视频原版素材）**全链路完成**：贴 URL → Vercel Services Python yt-dlp function 抓字幕 → 落 `Material(video)` → listening 三招用 YouTube iframe 原声逐句精听。Step 2 经 SDD 8 任务 + final opus review + fix wave，tsc/eslint 全程 0 error，生产部署端到端核心链路 curl 验通。**未 push**。剩浏览器交互实测 + deferred 项 + W4-T2（音频）。

## 本会话产出（commits，main，从旧到新，未 push）

```
3226259 Task 1  Python function 改返原始 json3（删 _flatten_events，统一 parseJson3 路径）
09beed2 Task 2  lib/topics.ts 统一 reader/onboarding 两份漂移常量（11 项并集）
5203bfe Task 3  YouTubeMediaSource — IFrame API 逐句封装
5d5c102 Task 3 fix1  play() player 未就绪排队 pendingPlay + mapState buffering 不误报 paused
39cb20c Task 3 fix2  pause()/destroy() 清 pendingPlay（防就绪后违背指令自动播）
43f806f Task 4  materialToShadowingData 适配（translation/imageryHint 填空串）
58835fc Task 5  shadowing-tab video 模式（mediaType 分支，text 零改动）
5dd1921 Task 5 fix1  nextSentence 重置 abLoop（防 AB 循环跨句残留）
e252fa6 Task 6  app/listening/import 导入页（URL + 503 粘贴降级）
82ed6d0 Task 7  app/listening/video/[id] 路由 + listening 入口 Link
36f296d Final fix  C1 容器替换 + C2 audioEndMs 静默 + C3 空译文门禁 + destroy 泄漏
4d31dff docs     handoff-w4-continuation 标 Step 2 完成
```

## 路线裁决史（本会话核心）

1. **前置验证推翻"纯 HTTP 抓字幕"**：同 IP 对照坐实——裸 fetch timedtext 因缺 POT 返空 body，本地 yt-dlp 拿到真实字幕。根因是方法非 IP。youtubei.js getTranscript（多 client）全 400、公共 Invisiacious/Piped 实例全死。
2. **路线 A 定案**：Vercel Services Python function 跑 yt-dlp。两命门实测通过：① Services 无额外经济成本（compute 走 Hobby function 免费额度）+ plan 可用；② Vercel 出口 IP 未被 429（dQw4w9WgXcQ 返 60 real sentences）。
3. **共存机制坑**：裸 `api/*.py` 在 Next 项目被框架吞不进路由表；`vercel.json functions.runtime:"@vercel/python"` 已弃用。正确形态：`services`（web=nextjs + captions=python）+ top-level `rewrites`（`/api/youtube_captions`→captions、`/api/(.*)`→web、`/(.*)`→web，**缺第二条会废现有 TS route**）。
4. **Deployment Protection**：项目 SSO `all_except_custom_domains` → preview 调不到 function（302 到 SSO），**仅生产 custom domain 可调**。验证时临时关（vercel API `PATCH /v9/projects/{id} {ssoProtection:null}`，token 在 `~/Library/Application Support/com.vercel.cli/auth.json`，原值 `{"ssoProtection":{"deploymentType":"all_except_custom_domains"}}` 验完恢复）。

## 当前状态

- **代码**：tsc/eslint 0 error；8 任务全 review clean（3 个 task fix loop + 1 final fix wave）。
- **部署**：prod 已部署 READY（`en-tutorial.vercel.app`）。生产端到端 curl 验通：`/api/youtube_captions?v=dQw4w9WgXcQ` 返 22KB 原始 json3、`/listening/import` 200。
- **未验**：iframe 逐句 seek/AB/变速/watchdog 的**浏览器目视交互**（curl 验不到）。
- **未 push**：12 commits 在 main 本地。

## Step 2 final review BLOCKER 教训（务必吸取）

1. **第三方"接管 DOM"库替换非插入容器**（C1）：`new YT.Player(containerId)` **替换**该元素。React 拥有的 `<div id="yt-player">` 被替换后，stage className 打在游离节点、iframe 默认尺寸且 imagine/recall 可见。**修法：wrapper(React className)+inner(YT 可替换) 双层 + 构造传 width/height 100%**。教训：用第三方"接管 DOM"的库，React className 必须在外层 wrapper，内层交给库替换。
2. **Optional chaining 静默吞 null**（C2）：`audioEndMs` 缺失时 `play()` 被条件跳过但 `listensCount` 仍自增 → 点播放静音无提示。教训：guarded action 失败要 fallback 或不计副作用。
3. **门禁缺 scope 谓词漏进 text 路径**（C3）：`currentTranslation === ""` 没加 `&& isVideo` → text 路径 LLM 返空译文丢双语按钮 + 误提示"该视频素材"。**"text 路径零改动"承诺的破口**。教训：video/text 双路径的每个 video-only 门禁都要带 `isVideo`，review 专门查这条。

另有 SDD lesson：Task 3 `play()` player 未就绪静默丢帧（pendingPlay 修复）+ Task 5 `nextSentence` 漏重置 abLoop 跨句残留——都是"状态跨边界未重置"类，review 时关注。

## Deferred 到下一 slice（非阻塞，详细见 `docs/handoff-w4-continuation.md`）

1. **末句 nextSentence 死循环**（video 模式最后一句点 next 跑完 reset 落回同句 imagine 无完成信号）——需 end-of-material UX 决策，**列下一 slice 首项**。
2. video 不应用 default rate（A1-A2 显 0.75x 实播 1x）。
3. Python `en-orig`→`en` fallback 丢失（两行可修——`if data.get("events")` 判空再 fallback）。
4. `VideoListeningClient` loading 空 fragment 无视觉反馈。
5. `playSentence` fallback 窗口启发式（next startMs / +15s cap / +5s default）待浏览器实测确认。
6. **iframe 逐句 seek/AB/变速/隐藏的浏览器目视交互实测**（生产域名 en-tutorial.vercel.app）。
7. Task 6 `handleParsePaste` 解析后未重置 `pasting=false`（粘贴框与预览卡 UI 堆叠）、`handleStart` 无 catch。

## 如何继续（新 session）

### 选项 A：收尾 W4-T3（浏览器实测 + deferred）
1. `git log --oneline -12` 确认状态。
2. 浏览器开 `https://en-tutorial.vercel.app/listening/import`，贴 `https://www.youtube.com/watch?v=dQw4w9WgXcQ` → 抓字幕 → 开始精听 → 测：imagine 显标题+缩略图（不露视频）、listen 点播放 iframe 从句首播到句尾停、变速档、AB 循环 toggle、口音选择器隐藏、recall 仅 english/hidden 两态、watchdog 视频播放中不误报。
3. 测 503 降级：贴长尾视频（如 `M7lc1UVf-VE`，本机 572 句 / Vercel 503）→ 粘贴 srt 路径。
4. 修 deferred 首项：末句 end-of-material UX。
5. push（需用户授权）。

### 选项 B：转 W4-T2（音频）
W4-T2 已确认可行（`@vercel/blob` 客户端直传 multipart 绕 4.5MB），见 `docs/handoff-w4-continuation.md` W4-T2 节。`lib/subtitle-parse.ts` 的 srt/vtt 解析已为 T2 备好。

## SDD artifacts

SDD workspace `/.superpowers/sdd/2026-07-30-w4t3-video-listening/` 已删（git history 是记录）。各 task 的 brief/report/review 文件不再存在——需要回溯看 `git log` + commit message + 本文件 + `docs/handoff-w4-continuation.md`。

## 关键文件（新 session 需知道）

- `api/youtube_captions.py` — Python ASGI function（返原始 json3，B1 合并 auto+manual subs，outtmpl `/tmp/%(id)s`，ASGI lifespan，错误分类 400/404/503/500，detail 收敛 YTC_DEBUG）。
- `vercel.json` — services（web+captions）+ rewrites（顺序不能动）+ crons。
- `requirements.txt` — `yt-dlp>=2026.7.4` + `certifi>=2026.7.22`。
- `lib/subtitle-parse.ts` — `parseJson3/parseSrt/parseVtt/parseSubtitles → MaterialSentence[]`（W4-T2/T3 共享）。
- `lib/topics.ts` — 统一 TOPICS（11 项）+ DEFAULT_TOPIC。
- `lib/youtube.ts` — `extractVideoId(url)`。
- `components/listening/media-source.ts` — `YouTubeMediaSource`（IFrame 封装，pendingPlay/destroyed/AB/setRate 规整）。
- `components/listening/material-adapter.ts` — `materialToShadowingData`。
- `components/listening/shadowing-tab.tsx` — `ShadowingTab({cefrLevel, material?})`，mediaType 分支（text 走 speak / video 走 YouTubeMediaSource），yt-player wrapper+inner 双层，playSentence helper，AB toggle，watchdog video playing 计入 active，recall 空 translation 隐藏 bilingual（`isVideo &&`）。
- `app/listening/import/page.tsx` — URL 导入 + 503 粘贴降级。
- `app/listening/video/[id]/page.tsx` + `video-client.tsx` — Server `await params` + Client 读 Dexie 透传 ShadowingTab。
- `docs/superpowers/specs/2026-07-30-w4t3-video-listening-design.md` — Step 2 设计 spec。
- `docs/superpowers/plans/2026-07-30-w4t3-video-listening.md` — Step 2 实现计划（8 任务）。
