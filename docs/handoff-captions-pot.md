# Handoff — YouTube 字幕抓取被 POT 阻断;多平台 import 重构待启

> 给新 session 的交接文档。本会话(2026-07-31)从 W4 真机测试报的 503 切入,系统诊断了 YouTube 字幕抓取的死结,落地了即时善后,并明确了下一步方向。**先读本文件再动手。** 配合读 `docs/handoff-w4-complete.md`(W4 整体 + W4-外遗留)。

## 一句话状态

W4 video URL 路径在 prod **功能性不可用**:YouTube 对 `timedtext` 端点强制 **POT(Proof-of-Origin Token)** 反爬,serverless 抓字幕被死结卡住。cookies 过了 bot 检查(已落地)但解不了 POT;yt-dlp 与纯 HTTP 都被挡。已做即时善后(503 文案准确化、build 修复、cookies 机制留作未来 POT 解后的即通基建)。**下一步:找一个无 POT 死结、可 serverless 直接抓字幕的平台(如 B站)作 YouTube 替代,重做 import 后端**——目标不是支持所有平台,而是**有一个平台能满足"粘 URL → 自动抓字幕 → 开练"即可**。

## 你(用户)的关键意图(新 session 必读)

- **素材来源**:主要 YouTube URL,也可以其他(如 B站)。
- **工作流期望**:粘 URL → 自动抓字幕开练。**不想手动准备文件**。
- **下一步范围(明确)**:**不是"支持所有平台"**。是**"有一个平台能满足自动抓字幕要求即可"**——YouTube 被 POT 死结,就找一个没这死结的平台替代,不必死磕 YouTube,也不必做多平台全集。
- 候选:**B站**(独立字幕 API,无 POT/无 bot 那套,serverless 友好度高)。其余平台按需。

## POT 死结的系统诊断(systematic-debugging 走完 Phase 1→4.5)

5 条路径全证伪,Vercel serverless 抓 YouTube 字幕在 POT 层死:
| 路径 | 结果 | blocker |
|---|---|---|
| 无 cookies + yt-dlp | "Sign in to confirm you're not a bot" | bot 检查 |
| cookies + yt-dlp(已加 cookiefile) | "Requested format is not available / No video formats found" | POT(yt-dlp 解 player 被 POT 守门) |
| cookies + 纯 HTTP timedtext(watch HTML 的 baseUrl) | 200 空 body | POT(timedtext 端点强制) |
| cookies + Innertube `/youtubei/v1/player` WEB | `playabilityStatus=UNPLAYABLE` | POT |
| Innertube ANDROID client(无 cookies) | 400 `FAILED_PRECONDITION` | 老移动绕路已死 |

**根因**:YouTube 2024 年中起对 `timedtext`/player 强制 POT。静态 watch-HTML 里的 caption `baseUrl` 故意不带 `pot`,真实播放器 JS 运行时才算 POT 拼上 URL。纯 HTTP 取 baseUrl 直打永远 200 空。cookies 只解 bot 不解 POT。

**W4-T3 当初(2026-07-30)能跑**是 POT 强制前的窗口;现在窗口关了。非代码 bug,外部反爬升级。

**POT 唯一解法(已证不可在 Vercel serverless 内做)**:`bgutil-ytdlp-pot-provider` 需持久 headless Chromium 跑 YouTube 混淆 JS 算 token,Vercel serverless 跑不了(冷启 Chromium 数秒、超 1GB 内存、超时、无持久浏览器)。需外挂持久 host(Docker/VPS)。用户当前资源是一台 macOS 笔记本(非常驻、v6 非固定、无 Docker/Chromium),不适合做持久 POT provider。故不死磕 YouTube,转向"换一个无 POT 死结的平台"。

## 本会话已落地(commits, 已 push, origin/main = ed4e74a)

```
5fc9484 fix(services): restore Vercel Services Python build (pyproject [project] table)
245934a fix(captions): pass YouTube cookies to yt-dlp to pass the datacenter bot check
ed4e74a fix(listening): accurate 503 copy — YouTube anti-bot blocks auto-captions
```
- **build 修复**:先前 ruff commit 的 `pyproject.toml` 缺 `[project]` table,Vercel Services Python runtime 的 `uv lock` 失败、captions service build 挂、prod 停在旧部署。修:runtime deps(yt-dlp/certifi)从 `requirements.txt` 迁入 `[project.dependencies]`、删 requirements.txt、uv 成单一源。部署成功。
- **cookies 机制**:`api/youtube_captions.py` 读 `YTC_COOKIES`(Netscape cookies.txt,加密 Vercel env,不进 git)→ 写 /tmp → yt-dlp `cookiefile`。过了 bot 这环(错误从 "Sign in bot" 变 format/POT)。**留作未来 POT 解后的即通基建**——若 POT provider 装好,cookies+POT 组合即通,无需再改这部分。
- **503 文案**:import 页 503 fallback 文案从"视频可能被限流"改为准确"YouTube 当前限制字幕自动抓取（反爬）。请手动粘贴 srt/vtt/json3 字幕，或改用音频上传"。降级机制本就存在(粘贴框),仅文案校准。

## 关键运维状态(新 session 需知道)

- **Vercel env(production)**:
  - `YTC_COOKIES`:用户 YouTube 登录态 cookies(Netscape 格式,加密)。⚠️ 等同 Google 账号登录态,任何能读该 env 的访问者可代表用户登录 YouTube。cookies 会过期/被 YouTube 轮换,需定期重导。serverless 高频抓取可能触发 YouTube 账号风控。**建议用小号**。
  - `YTC_DEBUG`:已移除(临时诊断用,会泄漏 yt-dlp 内部错误到 response,production 不该开)。
  - `CRON_SECRET`、`BLOB_READ_WRITE_TOKEN`:既有,未动。
- **Vercel 项目**:team `team_t2yNIQz3XM6T5XrwFHwAWcYY` / project `en-tutorial` / prj `prj_tXgWiPez6t2aeMXUnO4Ew2Gxf1vW`。git-connected(push 自动部署),也可 `vercel --prod --yes` 本地直部(用户授权过)。
- **captions service**:`api/youtube_captions.py`(Python ASGI,Vercel Services `services.captions`,entrypoint `youtube_captions:app`)。当前 prod 部署 = ed4e74a(build 修 + cookies + stable yt-dlp `>=2026.7.4`)。`pyproject.toml` `[project.dependencies]` 含 `yt-dlp>=2026.7.4`、`certifi`。ruff 配置 `[tool.ruff]`(dev-only,`npm run lint:py`)。

## 下一步:多平台 import 重构(新主线,需 brainstorm → spec → plan)

**目标**:有一个平台能满足"粘 URL → 自动抓字幕 → 精听三招"即可,不依赖被 POT 死结的 YouTube yt-dlp 路径。不必支持所有平台。

**候选:B站**。B站有独立字幕 API(无 POT/无 bot 那套),serverless 友好度高。需先采证:
- B站字幕 API 形态(`api.bilibili.com/x/player/wbi/v2?aid=...` 或 `?bvid=...` 取 `subtitle.subtitles[]`,每项 `subtitle_url` 取 json)— 是否需登录/cookies、是否限流、字幕格式(通常是 JSON-line,需归一到现有 `MaterialSentence {text, audioStartMs, audioEndMs}`)。
- B站视频的"音频"怎么进 W4 精听流:W4 用 video iframe(YT)或 audio blob(URL);B站视频可否嵌 iframe(`//player.bilibili.com/player?bvid=`)或取音频流?**这是关键设计点**——W4 的 MediaSource 契约(YouTubeMediaSource / createAudioPlayer)能否复用于 B站 iframe 或需新 adapter。
- 时戳:B站字幕是否给 start/duration(归一 audioStartMs/audioEndMs)。
- 通用粘贴 srt/vtt/json3 兜底(import 页已有)继续作"任何平台都能用"的 lower bound。

**设计核心问题**(brainstorm 要解):
1. **平台抽象**:`api/youtube_captions.py` 单平台→抽象成 captions adapter registry(`fetchCaptions(platform, id) → {sentences, mediaSource}`)?还是每平台独立 route(`api/bilibili_captions.py`)、import 页按 URL 域名分发?
2. **媒体源**:W4 现 MediaSource 契约(YT iframe / HTMLAudioElement)。B站若用 iframe,复用 YouTubeMediaSource 模式(第三方 DOM 接管 + host 所有权隔离);若取音频流直链,复用 createAudioPlayer。需确认 B站 iframe/音频链路的可用性 + 反爬。
3. **归一**:`lib/subtitle-parse.ts` 现有 parseJson3/parseSrt/parseVtt。B站字幕格式若为自有 JSON,加 `parseBilibili` 或转成 srt/vtt 走既有 parser。
4. **import 页**:`app/listening/import/page.tsx` 现按 video/audio mode 分支。多平台后,URL 输入需识别域名(YouTube/B站/...)→ 选 adapter;失败仍走粘贴兜底。

**不做**:
- 不死磕 YouTube POT(外挂持久 Chromium POT provider 在用户当前资源下脆弱,且 YouTube 持续猫鼠)。YouTube 路保留现状(cookies+yt-dlp,尽力而为 + 503 降级粘贴/audio 兜底),不投入复活。
- 不做"所有平台全集"。一个够用即可(候选 B站),其余靠 srt 粘贴兜底。

## 项目约束(沿袭 handoff-w4-complete)

- `AGENTS.md`:Next.js 16 破坏性改动,写码前读 `node_modules/next/dist/docs/`。
- 纯客户端 Dexie(IndexedDB),单例 profile `id:"singleton"`。
- tsc `npx tsc --noEmit` + eslint `npx eslint . --quiet` 0 error 才能 commit;Python `npm run lint:py`(ruff)。
- 每阶段 Code Reviewer 门控。commit 末尾 `Co-Authored-By: Claude <noreply@anthropic.com>`,直接 main(已授权)。push 需用户授权。
- Code comments English only。不写测试(CLAUDE.md)。prod 部署 `vercel --prod --yes`。

## 如何继续(新 session)

1. **先采证 B站字幕 API 可行性**(serverless 直抓、时戳齐全、无需 POT 级反爬)。这是整个新主线可行性的硬前提——若 B站也被同类反爬死结挡,需另选平台或回到 A(POT provider)。
2. 采证通过 → brainstorm 多平台 import 架构(平台抽象、媒体源复用、归一、import 页分发)→ spec → plan → SDD 实现。
3. 采证不通过 → 回到 A(外挂持久 POT provider,需用户提供常驻 host 非 Mac)或重新选平台。

## 教训(本会话新增)

1. **handoff 的"应已配/应能跑"要实测**:W4-T3 spike(2026-07-30)能跑是 POT 强制前的窗口,handoff-w4-audio-final 记"prod 全验通"在 YouTube 反爬升级后失效——外部反爬依赖的"已验"有时效。
2. **ruff/pyproject 改动要先验 Vercel Services build**:加 `[tool.ruff]` 不够,Vercel Python runtime 跑 `uv lock` 需 `[project]` table。dev 工具配置不能破坏 runtime build。
3. **serverless 抓 YouTube 字幕的本质脆弱**:bot(可 cookies 解)+ POT(需 Chromium,serverless 跑不了)+ 持续猫鼠。cookies 只解第一层。换平台比死磕 POT 更根本。
4. **用户资源约束决定架构**:Mac 笔记本做持久 POT provider 不实际(非常驻/v6 非固定)。"根本性修复"要考虑用户实际能维护什么,非理想环境。
5. **多平台 = 单平台反爬不致命**:把 import 抽象成多 adapter,任一平台挂不影响其他,比单平台单工具(yt-dlp 抓 YT)抗反爬。
