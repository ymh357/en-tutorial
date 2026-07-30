# Handoff — 直接听懂方法论落地（W0–W4-T1 完成，W4-T2/T3 待续）

> 给新 session 的交接文档。本会话完成了 W0–W3 全部 + W4-T1，每阶段都经 Code Reviewer 审查并修复全部发现。**先读本文件 + `docs/superpowers/plans/2026-07-30-direct-listening-methodology.md` 再动手。**

## 一句话状态

方法论四招中前三招已落地（练习三步、水平精细度、遗忘交替重复），原版素材数据层已铺好（W4-T1）；**剩余 W4-T2（音频）和 W4-T3（YouTube）未做**。新 session 从 W4-T2 开始。

## 项目约束（必读）

- `AGENTS.md`：Next.js 16 有破坏性改动，写码前读 `node_modules/next/dist/docs/` 相关篇。
- 纯客户端 Dexie（IndexedDB），无服务端 DB，单例 profile `id:"singleton"`。
- 每阶段（phase）做完走 Code Reviewer 审查（`Agent` 工具，`Code Reviewer` 类型），修复全部发现再下一阶段。
- tsc `npx tsc --noEmit` + eslint `npx eslint . --quiet` 必须 0 error 才能 commit。
- commit 末尾 `Co-Authored-By: Claude <noreply@anthropic.com>`，直接在 main 提交（已授权）。
- Git：所有写操作（commit 等）需用户确认——但本项目用户已持续授权 commit 到 main、不 push。

## 已完成提交序列（main，从旧到新）

```
165d5ed W0   foundation for direct-listening methodology (types + Dexie v8 + Material)
3dbc22b W1-T1 extract ShadowingTab + shared helpers
0b3a5c6 W1-T2 shadowing schema to object shape (blocker B)
516c582 W1-T3 3-step stage machine (imagine → listen → recall)
b9d1359 W1-T4 subtitle three-state gating
4e05c46 W1-T5 client-side variable speed (playbackRate)
aefd8f0 W1-T6 persist listening blind spots + comprehension signal
b13f76c W1-T7 progressive phrase chunking
6fccf61 W1-T8 focus/attention watchdog
d659648 W1-T9 accent selection
dacb80d W1   review fixes (race, methodology, integration, 13 项)
f408361 W2-T1 persist locatedLevel + confidence
df43ac5 W2-T2 derive step granularity from assessed level
96e5d01 W2-T3 consume step granularity (level-driven fineness)
8ada45e W2-T4 bind cards to real source sentence
19fdc87 W2-T5 WordCard shows real source sentence
13bc789 W2   review fixes (schema sync, dead data, lazy-init, asymmetry, 10 项)
04d7930 W3-T1 fluency/mastery track split for SRS priority
e9b0b0d W3-T2 alternating-repetition (getReusableTask)
8b5fb3f W3-T3 cron CEFR band + client level-scoping (blocker A)
0986987 W3-T4 layer copy by fluency/mastery track + fix stale lines
a5a4d7d W3   review fixes (track switch, TZ, prompt single-source, ids, copy, 10 项)
00a3ded W4-T1a onboarding interest selection + Material helpers
f7a229f W4-T1b URL import registers authentic Material
```

## 三轮 phase 审查的 BLOCKER 教训（务必吸取）

1. **W1 审查**：chunkSentence fetch 无 token 守卫，慢请求的结果会串到下一句（显示错句子）。修复：`chunkTokenRef` + reset 处 bump。**教训：任何异步 fetch 结果要落到 state，必须有 token/AbortController 防串句。**
2. **W2 审查**：改 LLM 返回形状时，conversationReviewSchema 漏加 `sourceSentence` 字段。zod v4 `toJSONSchema()` 默认 `additionalProperties:false`，LLM 被禁止返回该字段 → 对话路径"真实语境"功能 100% 静默失效。**亲自 `node` 验证过 zod 行为。教训：改 AI 返回形状要同步四处——zod schema + TS type + prompt 文案 + 消费方运行时守卫。** part2 schema 还犯了 `required` vs 类型 `optional` 不一致（单字段缺失引爆整次 review）。
3. **W3 审查**：mastery 轨道在 `study-engine` 有分支但全仓库无写入入口（文档欺诈/死代码）→ Settings 加了 Learning Track 选择器。cron/services 用 UTC `toISOString` 与客户端本地日期错位（影响中国用户 streak/stats）→ 统一用 `lib/date.ts` 的 `today()` + `.env.local` `TZ=Asia/Shanghai`。

**后续每次 phase 完成沿用：派 Code Reviewer → 修复全部 → 再下一阶段。**

## 现有架构关键事实（新 session 需知道）

### 听力三步法（W1，方法论核心）
`components/listening/shadowing-tab.tsx`：
- `Stage = imagine | listen | recall`，与 `RecStatus`（设备态）正交。
- imagine：展示 topic/context/imageryHint，**不露英文**；listen：播放（变速 0.5–2x、口音、切短语）；recall：字幕三态（hidden/english/bilingual）+ 录音复述 + 主观理解自评。
- `granularity`（fine/medium/coarse）由 cefrLevel 派生：fine 默认 0.75x + 强制 imagine；coarse 可"直接听"跳过引导。
- 专注看门狗：listen/recall 20s 无交互弹 nudge（`markActive` 接到所有交互按钮）。React 19 严格规则：effect 体只写 ref+启 timer，setState 仅在 interval 回调条件触发。
- `playbackRate` = `userRateOverride ?? defaultRate`（defaultRate 派生自 granularity，运行时 cefrLevel 变化不失同步）。
- `shared.tsx` 导出 `callReview`/`saveListeningExercise`(带 extra: stage/missedWords/subjectiveComprehension/listensCount/focusResets/materialId)/`ExerciseCompletionActions`/`Mode`。

### SRS 双轨（W3）
`lib/study-engine.ts`：`srsFirst = profile.primaryTrack === "mastery"`。mastery：SRS priority 100 永不裁剪；fluency（默认）：priority 50.5、可裁剪、与听力/阅读平等轮换。`primaryTrack` 在 Settings 可切（写 `db.learningProfile`）。SRS 算法/`nextReview` 索引/`/srs` 页**完全保留不动**。

### 语料交替重复池（W3）
`lib/task-pool.ts`：
- `completeTask(id, seenIn?)`：置 `completed:true` + `exposureCount++` + `lastSeenAt` + `lastSeenIn`。
- `getReusableTask(type, minIntervalMs=6h)`：pool 无新任务时，重激活 exposureCount 最低、距 lastSeenAt>6h 的已完成任务（`completed:false`）。返回对象 lastSeenAt 是旧值（消费方需 completeTask 刷新）。
- **当前仅 shadowing 接入 getReusableTask**；其余 8 个 pool 消费方（dictation/comprehension/prediction/reader/translate/writing）仍 miss→实时生成，W4 接入。
- cron 多水平：`app/api/cron/generate-tasks/route.ts` 用 `CRON_LEVELS=[A2,B1,B2]` × 9 类型 = 27 次/天，BATCH=4 并发，id 确定性 `${type}-${level}-${today}`。prompt 从 `lib/task-pool-generate.ts` 的 `buildPrompt` import（单一来源，删了 cron 的重复 `buildCronPrompt`）。
- 客户端 `app/page.tsx pullOrGenerate`：按 `profile.studyLevel` 从 server 27 条里每类型取最近水平的 1 条。

### Material 实体（W0 类型 + W4-T1 操作）
`lib/types.ts`：
```
Material { id, topic, mediaType:"text"|"audio"|"video", sourceKind:"authentic"|"generated",
  sourceUrl?, title, content, sentences?: MaterialSentence[], difficulty?, vocabCoverage?,
  exposureCount, lastSeenAt?, createdAt }
MaterialSentence { text, translation?, imageryHint?, audioStartMs?, audioEndMs? }
```
Dexie v8 `materials` 表索引 `"id, topic, mediaType, createdAt"`。`dbHelpers`：`saveMaterial`/`getMaterials(topic?)`/`bumpMaterialExposure(id)`。
W4-T1b：reader ImportUrlTab 加 Topic 选择，URL 抓取的真实文章同步入 Material（authentic/text/topic）。

### 评估回流（W2）
`AssessmentResult` 持久化 `locatedLevel/atCeiling/atFloor/lowConfidence`（结果页展示定位级别）。`study-engine` 的 `stepGranularity` 已在 W2 审查时删除（无消费者——listening 自派生），但 `granularityForLevel` 仍 export 供 listening 用。

### 单词真实语境（W2）
`Card.sourceSentence`（真实原句，与 `example` 分离）。conversation/ielts 的 prompt + schema（都 `sourceSentence: z.string().optional()`）+ 类型（optional）。`context = sourceSentence || example`。reader 卡也补了 `sourceSentence`。WordCard 渲染"真实语境"行（与 example 相同时去重）。

### TTS（W1）
`lib/tts.ts`：`speak(text, rate?, playbackRate?, voice?)`。`playBlob` 用 `audio.playbackRate`（0.5–2x 客户端调速）。**blob 缓存**：`ttsBlobCache` Map keyed `${text}|${voice}|${rate}`（命中不重新请求）。`app/api/tts/route.ts` 接受 `voice`（默认 en-US-AriaNeural），`Cache-Control: no-store`（POST body 随 voice 变，URL 缓存会串口音）。

## 待办：W4-T2（音频原版素材）

**计划文件**：`docs/superpowers/plans/2026-07-30-direct-listening-methodology.md` 的 W4-T2 节。

**外部依赖确认（已完成，2026-07-30）**：`@vercel/blob@2` 客户端直传**可行**。官方原生支持：服务端 `handleUpload({onBeforeGenerateToken})` 生成 token + 客户端 `upload(pathname, file, {access:"public", handleUploadUrl, multipart:true})`。音频走 `multipart:true` 最高 5TB、绕过 Vercel 4.5MB body 限制（不走 function body）。需新增一个 `handleUpload` 路由 + Vercel 项目配 `BLOB_READ_WRITE_TOKEN`（cron `put` 已用，应已配；`.env.local` 无此键，本地不跑 blob）。未验证项：multipart 大文件生产连通性需部署后实测，风险低。**W4-T2 可按此路线实现。**

**实现要点**：
- 客户端直传音频到 blob，存 url 到 `Material.sourceUrl`，`mediaType:"audio"`。
- 字幕 srt/vtt 解析 + 与音频对齐校验（可复用 `lib/word-align.ts` 思路）。`Material.sentences` 带 `audioStartMs/audioEndMs`。
- listening 音频播放器组件（逐句跳转、变速复用 `lib/tts.ts` 的 playbackRate 逻辑、AB 循环）。**建议把这个播放器设计成统一媒体播放器，文本/音频/视频 Material 都复用**（W4-T1 的"可听"和 W4-T3 的视频都靠它）。
- `saveMaterial` 时标 `sourceKind:"authentic"`。

## 待办：W4-T3（YouTube 视频原版）

**计划文件**：W4-T3 节。

**外部依赖确认（已完成，2026-07-30，路线推翻重定）**：
- 旧假设"服务端纯 HTTP 抓字幕 / curl 本机能过"**已被实测推翻**。本会话写了最小 `app/api/youtube-captions/route.ts`（裸 fetch watch HTML → captionTracks baseUrl → timedtext json3）并坐实**走不通**：
  - **同进程同 IP 对照**：Route A（裸 fetch = serverless route 方法）timedtext 返回 `status:200, content-length:0` **空 body**；Route B（本地 yt-dlp 子进程）拿到 `dQw4w9WgXcQ` 真实非空字幕（104 events / 32 KiB）。**根因是 fetch 方法缺 POT (proof-of-origin token)，不是部署 IP**——换 IP/部署 Vercel 不会更好。
  - 其它自动路线逐条实测全死：youtubei player API（ANDROID）400；youtubei.js `getTranscript`（WEB/ANDROID/IOS/TV_EMBEDDED）全 400；公共 Invidious/Piped 实例 HTML 错误页/502。
  - **唯一拿到真实字幕的是本地 yt-dlp**（`--skip-download --sub-format json3`，<1s，不需 ffmpeg/impersonate）。
- **新路线 A（已与用户确认）**：独立 **Vercel Python serverless function** 跑 yt-dlp 抓字幕。yt-dlp 最小 pip 安装仅 25MB（纯 Python，brotli/websockets/mutagen 非硬依赖、未装；import 不需），远低于 250MB；`--skip-download` 不需 ffmpeg、不下载视频，超时/体积/下载大小的担忧均不适用。
- **Vercel Python+Next 同项目**：经 [Services](https://vercel.com/docs/services) 机制共存。**裸 `api/*.py` 不生效**（被 Next 框架吞，不进路由表）；`vercel.json` 的 `functions.runtime:"@vercel/python"` 已弃用（报错）。正确形态：`vercel.json` 用 `services` key 声明 `web`(nextjs, root `.`)+`captions`(python, root `api/`, entrypoint `youtube_captions:app`)，配 top-level `rewrites` 把 `/api/youtube_captions` → captions service、`/(.*)` → web。Python service 须用 **ASGI app**（`async def app(scope,receive,send)`），非 `BaseHTTPRequestHandler`。
- **命门 ①（runtime/Services 可用性 + 经济成本）已验证通过**：Services 在当前 plan 可用（无 plan/permission 报错）；compute 按 Vercel Functions 标准计费（Hobby 免费额度：Active CPU 4h / mem 360GB-hr / invocation 1M 含，无 baseline/per-service 费）；service-to-service binding 才计 service request，本场景单 service 接公网不触发。Python 3.12 venv + yt-dlp(25MB)+certifi 构建成功，build cache 137MB < 250MB。
- **命门 ②（Vercel 出口 IP 429 死结）已验证通过**（2026-07-30 实部署实测）：preview 部署（iad1 华盛顿出口 IP）实调 `/api/youtube_captions?v=dQw4w9WgXcQ` 返回非空字幕——`languageCode:en, sentenceCount:60`，首句 `♪ We're no strangers to love ♪`@18640ms。**Vercel 共享 IP 未被 YouTube 429 拦截**。yt-dlp 内嵌 POT 处理是关键。
- **部署适配坑（已修）**：Vercel serverless cwd 只读，yt-dlp `outtmpl` 必须指向 `/tmp`（`/tmp/yt-caption-%(title)s.%(ext)s`），否则 `[Errno 30] Read-only file system`。
- **Deployment Protection 注意**：本项目开了 SSO Protection `all_except_custom_domains`，preview URL 需 SSO 登录才能访问 → 纯客户端前端在 preview 环境调不到 function（302 到 SSO）。**生产 custom domain 豁免**，故 W4-T3 字幕抓取仅在生产域名工作；preview 验证须临时关 protection（vercel API `PATCH /v9/projects/{id}` `{"ssoProtection":null}`，验完恢复）。原值已备份。
- 字幕 baseUrl 带 `expire`，但 yt-dlp 内嵌 POT 处理，**实时解析**即可，不缓存签名。

**实现要点**：
- 新建 **Python** function `api/youtube_captions.py`（ASGI app，非 TS route）：`?v=VIDEOID` → `yt_dlp.YoutubeDL` Python API（`--write-auto-subs --sub-langs en --skip-download --sub-format json3`，outtmpl `/tmp/...`）→ 解析 json3 → 返回 `{videoId, languageCode, sentences:[{text,startMs,endMs}]}`。配 `requirements.txt`（`yt-dlp`+`certifi`，后者 macOS python.org Python 缺 root cert 必需）。经 Vercel Services 机制与 Next 同项目部署。**Step 0 spike 已完成并验证通过（命门 ①② 均过）。**
- 统一字幕解析库 `lib/subtitle-parse.ts`：`parseJson3/parseSrt/parseVtt → MaterialSentence[]`。Python function 返原始 json3，TS 库归一化；**W4-T2 音频上传的 srt/vtt 也复用此库**（两任务共享）。
- 旧 `app/api/youtube-captions/route.ts`（TS 裸 fetch，已证死）→ **删除**，json3 解析逻辑迁入 `lib/subtitle-parse.ts`。
- 前端 YouTube iframe（`<iframe src="https://www.youtube.com/embed/VIDEOID">`）按主题（房车旅行/隐士生活等，方法论原话）。
- 字幕即 listening 素材：复用 W1 三招流程（imagine/listen/recall）。但 video Material 的"声音"来自 iframe 视频，非 Edge-TTS——`speak` 不适用，需视频播放控制。
- `mediaType:"video"`，`sourceUrl=watch URL`。
- **分阶段**：Step 0 spike（最小 Python function 部署验证命门）✅ 完成；Step 1（`lib/subtitle-parse.ts` + 删旧 route）✅ 完成；Step 2（前端 YouTube 导入 UI + iframe 播放，复用 W4-T2 媒体播放器）⏳ 待做。

## 其它遗留（非阻塞，可顺手）

- W3 审查 #6：cron 产 27 条、客户端只用 9 条（level-scoping 丢弃 18 条生成成本）。短期接受。中期改：`/api/tasks/today?level=studyLevel` 服务端过滤。
- W3 审查 #3：getReusableTask 仅 shadowing 接入。其余 8 个 pool 消费方 W4 接入（注释已标）。
- W2 审查 N1：WordCard 的 `imageryHint`/`audioSrc` 是 W4 槽位（标了 TODO(W4)），音频/画面数据源到位后接线。
- `lib/task-pool.ts` 注释里仍提 `TASKS_PER_DAY=6`/overdue 顺延——双轨后 fluency 模式不应 overdue 置顶，但 `getTodayTasks` 仍按 assignedDate 顺延。fluency 下行为轻度不符方法论（不追账），可后续修。

## 建议工作流（新 session）

1. 读本文件 + 计划文件。
2. `git log --oneline -30` 确认状态。
3. **W4-T2**：先验证 `@vercel/blob` 客户端直传可行性（查文档/写最小实测）→ 实现 → `tsc`+`eslint` → commit → 派 Code Reviewer 审查 → 修复全部。
4. **W4-T3**：路线已重定为 Python yt-dlp function（纯 HTTP 实测全死，见上）。**第一件事 spike**：写最小 `api/youtube_captions.py`+`requirements.txt`，`vercel` CLI preview 部署，实调 `?v=` 验证 Vercel IP 下非空（命门：429/runtime 权限）。非空→进 Step 1/2；被拦→回退取舍（粘贴/缩水），不沉没成本。
5. 全部完成后，可对 W4 整体跑一轮审查。
