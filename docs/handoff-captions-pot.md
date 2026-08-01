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

---

## 更新(2026-07-31):B站自动抓取已落地 — "一个平台满足即可"达成

采证通过 + 设计 + SDD 8 任务全部完成并逐任务评审 + broad review 通过。YouTube 被 POT 死结,**B站作为"能满足自动抓字幕"的那个平台已落地**。spec: `docs/superpowers/specs/2026-07-31-bilibili-import-design.md`,plan: `docs/superpowers/plans/2026-07-31-bilibili-import.md`,ledger: `.superpowers/sdd/2026-07-31-bilibili-import/progress.md`。

### 采证结论(实测,非假设)
从 Vercel datacenter IP(iad1)实测 B站链路:**免 wbi 签名、免 cookie** 全通——`view`(取 cid)、`player/wbi/v2`(字幕列表)、`playurl?fnval=1&qn=16`(单段 mp4 直链)全 `code:0`,stream HEAD 200 带或不带 Referer。与 YouTube POT(需 Chromium 运行时,serverless 不可做)形成根本对比。`lib/bilibili.ts` 的 wbi 签名是 `-352` 风控时的**回退路径**(纯 MD5,serverless 可做),非默认;`BILI_SESSDATA` cookie 作未来 datacenter 风控升级时的备用(用户提供过 cookies,暂未设 env,因当前不需要)。

### 已交付(8 任务,commits f4e1399..f9829c5)
- `lib/bilibili-client.ts`(extractBvid,client-safe)+ `lib/bilibili.ts`(server: wbi sign/resolveCid/pickEnglishSubtitle/fetchSubtitleJson)
- `app/api/bilibili/captions/route.ts`(字幕:无签名→-352 wbi 重试→选英文字幕→parseBilibili;503→粘贴兜底/404)
- `app/api/bilibili/media/route.ts`(流:playurl fnval=1 qn=16→单段 mp4,优先 backup_url;200 {url,cid}/503)
- `parseBilibili` in `lib/subtitle-parse.ts`(from/to 秒→ms,content→text)
- `createVideoPlayer` in `components/listening/media-source.ts`(HTMLVideoElement MediaSource,镜像 createAudioPlayer + onExpired 过期重解析一次)
- `shadowing-tab.tsx` 视频分支平台感知(YT 同步 / B站异步 resolve+createVideoPlayer,wireSource 共享回调,React 19 strict-effect-safe `cancelled` 守卫)
- `import/page.tsx` B站 URL 分发(extractBvid→captions;b23.tv 客户端重定向解析;503→粘贴兜底)
- broad review 修: B站 `<video>` CSS sizing(host div `[&>video]` 选择器,此前只有 `[&>iframe]`);删临时 probe route。

### 必须真机实测才能 ship(6 项,broad reviewer 列出 — code 路径已审,网络/边缘未实测)
1. **真实英文字幕 B站视频走全路径**:T1 probe 用的视频无字幕,`pickEnglishSubtitle`→`fetchSubtitleJson`→`parseBilibili`→渲染 从未在真实字幕 JSON 上跑过。需用户给一个已知有英文字幕的 bvid 验证。
2. **b23.tv 短链在真实浏览器重定向**:客户端 `fetch(url,{redirect:"follow"})` 受 CORS 影响,未实测;失败则优雅降级到"无法识别该链接"。
3. **wbi 签名重试在真实 -352 下**:所有 probe 命中无签名路径,`fetchMixinKey`/`wbiSign`/重试 零真实网络验证。需从不同网络/IP 触发 -352 验证。
4. **onExpired 中途过期重解析**:签名 mp4 URL 真实过期时 `video` error → onExpired → 续播,未实测。
5. **持续生产负载下 IP 风控**:T1 probe 单 bvid/单区域(iad1)/单时刻,非永久保证。量上来可能 -352/HTML 拦截页(当前优雅降级为通用错误+无粘贴兜底)。
6. **视频 CSS sizing 修复在浏览器视觉确认**:listen 态及其他 stage/breakpoint,确认无 YouTube iframe 回归。

### Parked(非阻塞,broad-reviewer call,镜像 YouTube 既有模式)
- 503 双因(无英文字幕 / 空解析)共用一条硬编码文案,空解析被误报。一行可修(读 `d.error`)。
- captions/media 两条路由无 try/catch(上游返 HTML/网络错时裸 500),客户端 `res.json().catch` 优雅降级。

### 运维状态(沿袭 + 新增)
- `YTC_COOKIES`:仍设(YouTube 路径,已死但保留作 POT 解后即通基建)。
- `BILI_SESSDATA`:**未设**(当前 datacenter 免 cookie 可通)。若未来 -352 风控触发,设此 env(用户提供过 B站小号 cookies,同 `YTC_COOKIES` 风险性质——等同 B站登录态,建议小号)。
- 新 route 已随 push 自动部署(git-connected)。push 后 prod 即有 `/api/bilibili/captions` + `/api/bilibili/media`。
- prod origin/main 待 push(本会话 commits 全 local)。push 需用户授权。

### 自证轮(2026-07-31,用户指令:不要依赖实测 代码自证)

user 要求"代码做到能自证",不靠真机实测。自证轮 3 任务完成 + broad re-review 通过(commits 4574884 / 1aacd27 / 515e250):

- **T9 b23 服务端化**:`resolveBvid`(server,lib/bilibili.ts)+ `isBilibiliLink`(pure client)+ 两路由 `?url=` + import 页删客户端 b23 fetch + shadowing-tab 用 `isBilibiliLink`/`?url=`。消除客户端 CORS 黑盒(服务端 fetch 无 CORS)+ 修掉 sourceUrl=b23→extractBvid null→静默无视频 隐患。
- **T10 onExpired reducer**:抽纯 `nextRetryState(state,event,hasCallback)` reducer,createVideoPlayer 委派。T5 行为不变(一次重试/retrying 守卫/ready 重置/surface)。fix C1:`ready=retryState.ready` 收进 try 分支(surface 路径不再覆盖 live ready,seekTo/onReady T5 parity)。
- **T11+T12 测试基建 + 矩阵**:node:test + tsx devDep(首个测试),33/33 通过。6 文件:parseBilibili、wbiSign(独立 re-derive md5,非 golden)/getMixinKey/pickEnglishSubtitle/resolveBvid、isBilibiliLink/extractBvid、两路由控制流(含 **T4 C1 回归守卫**:解析 -352 重试 URL query string 断言每键一次)、nextRetryState 6 转移。

**6 项"实测"自证映射(broad re-review 判诚实)**:
| 项 | 判定 |
|---|---|
| 字幕管线 | parseBilibili test 自证解析;真实字幕 JSON 载荷形态 = external(代码不可控) |
| b23 CORS | **结构性消除**(服务端化,客户端无 CORS 机制可失败) |
| wbi -352 重试 | **自证**(C1 guard 解析 query 串计数 + wbiSign 独立 re-derive) |
| onExpired 过期 | reducer **自证**;DOM 壳 T5-reviewed 未变(诚实边界) |
| prod IP 风控 | external(需真流量,代码降级 503→粘贴 已验) |
| CSS sizing | 已 T8 修(diff 证据) |

仍 external 的(真实字幕 JSON 载荷、prod 负载 IP 风控)是代码不可控的外部属性,非自证失败。**自证目标达成**:代码可控的纯函数/状态机/控制流全部由可重复测试 pinned,不依赖真机。

**运维新增**:`tsx` devDep(test 运行);`npm test` 跑 `**/*.test.ts`。无新 env。push 后 prod 自动部署。

---

## 突破(2026-08-01):YouTube POT 死结解开 — MacBook tunnel + bgutil fallback

之前判"POT 死结 serverless 不可解"是基于"边 @ Vercel serverless + 无常驻 host"。本节用 **cloudflared 出站隧道 + MacBook bgutil POT provider** 解开,prod 已验通(视频 `446E-r0rXHI`:Vercel→隧道→MacBook→真实 json3 142 句,HTTP 200)。Plan: `~/.claude-personal/plans/encapsulated-meandering-flame.md`(self-proving round plan 同文件被覆盖为此 plan)。

### 关键技术修正(推翻本文件早期论断)
1. **bgutil-ytdlp-pot-provider 不需 Chromium/Docker/Playwright**。`server/package.json` 纯 Node(`bgutils-js`+`jsdom`+`canvas`+`youtubei.js`+`express`),Node>=20,LuanRT BgUtils 已演进为纯 JS 经 jsdom 算 POT。早期 handoff/writeup "需持久 headless Chromium" 过时。
2. **cloudflared 出站隧道绕开 v6 入站被挡**:之前判"MacBook v6 入站被家宽防火墙/CGNAT 挡,Vercel 调不到"——对。但 cloudflared 让 MacBook **主动出站**连 Cloudflare,Cloudflare 给 `*.trycloudflare.com` 公网域名反代回 MacBook 4417,无任何公网入站需求。实测外部 curl→HTTP 200。Netbird 不受影响(独立)。

### 架构(prod 已通)
```
Vercel api/youtube_captions.py
  ├─ yt-dlp + YTC_COOKIES(本地,现有)→ 200 json3(未被 POT-flag 时)
  └─ 503/None → fallback: GET POT_PROVIDER_URL?v= (header X-Pot-Secret)
       → Cloudflare → cloudflared(MacBook 出站)→ yt-captions-wrapper(:4417)
            → shells yt-dlp(--extractor-args youtubepot-bgutilhttp:base_url=127.0.0.1:4416 + cookies.txt)
            → bgutil POT server(:4416, localhost only)算 token
            → 返 {videoId, languageCode, json3}
```
两个 MacBook 进程:bgutil(4416,POT)+ wrapper(4417,yt-dlp)。cloudflared 只隧道 4417;bgutil 仅 localhost。

### 代码改动(仅 1 文件,commit bb71853)
`api/youtube_captions.py`:`_pot_fallback(video_id)` 函数(stdlib urllib,无新依赖),在 503 分支 + result-None 分支调;`POT_PROVIDER_URL`/`POT_PROVIDER_SECRET` env 门控(都不设=完全旧行为)。30 行。两 env 都设才生效。pyproject/ruff 不动(Node/Python 依赖全在 MacBook,Vercel 侧零新依赖)。

### MacBook ops(不在 repo,~/yt-pot/)
- `~/yt-pot/install.sh`(幂等装机):pip yt-dlp+bgutil plugin、clone bgutil+npm ci+tsc、wrapper express、cloudflared 二进制、.env(POT_SECRET 随机)、空 cookies.txt 提示。
- `~/yt-pot/start.sh`:起 bgutil+wrapper+cloudflared quick tunnel,打印 trycloudflare URL + secret + Vercel env 设置提示。
- `~/yt-pot/stop.sh`:pkill 三进程。
- `~/yt-pot/wrapper/server.js`(94 行):express,GET ?v=,X-Pot-Secret 恒时比较(无/错→403),11-char 校验(→400),shell yt-dlp 配 bgutil base_url+cookies.txt+en/en-orig/json3+skip_download,产 json3,行为对齐 `api/youtube_captions.py`(empty-events guard),返 `{videoId,languageCode,json3}`,失败→503。
- `~/yt-pot/cookies.txt`:Netscape 格式(从用户浏览器导出转换),同 Vercel `YTC_COOKIES` 的 Google session。bgutil 解 POT + cookies 解 bot 检查,两者都需要。
- `~/yt-pot/.env`:`POT_SECRET=7532...`(也设于 Vercel `POT_PROVIDER_SECRET`)。

### Vercel env(production, Encrypted)
- `POT_PROVIDER_URL`=当前 trycloudflare URL(**每次 MacBook start.sh 重启会变,需更新此 env**)。
- `POT_PROVIDER_SECRET`=稳定 shared secret(同 MacBook .env 的 POT_SECRET)。

### 运维负担(用户须知)
1. **MacBook 需常开 + yt-pot 运行**(start.sh)。关机/停服务 → YouTube 自动抓取降级到 503→粘贴兜底(B站路径不受影响,独立代码)。
2. **quick tunnel URL 每次重启变** → 更新 Vercel `POT_PROVIDER_URL`。摩擦点;若烦可升级 named tunnel(需 Cloudflare 管理的域名,仍免费)。
3. **cookies 会过期/轮换**(YouTube 主动轮)→ MacBook cookies.txt + Vercel YTC_COOKIES 都要重导(同 session)。
4. bgutil "不保证绕过"(README CAUTION)——YouTube 再收紧则 fallback 也挂,落 503→粘贴。架构优雅降级。

### 验收(本节 prod 实测)
- MacBook curl tunnel+secret ?v=446E-r0rXHI → 200 真实 json3 142 events(首句"go a statically typed compiled...")。**自 POT 阻断以来首次成功自动抓 YouTube 字幕。**
- 无 secret 403、错 secret 403、坏 videoId 400(安全门)。
- Vercel prod `/api/youtube_captions?v=446E-r0rXHI` → 200(fallback 经隧道到 MacBook 成功)。
- import 页:粘该 URL → 抓字幕 → 预览句子(非 503)。用户可即刻验证。

### 未做/遗留
- named tunnel 固定域名(用户选 quick,接受重启换 URL 摩擦)。
- launchd 常驻(用户选手动 start/stop 脚本)。
- Phase D Python fallback 无单元测试(CLAUDE.md 默认不写测试;end-to-end prod 实测即验收)。
- b23/B站英文软字幕稀的根本问题未治(B站路径保持现状,英文素材转向 YouTube+POT-fallback)。

