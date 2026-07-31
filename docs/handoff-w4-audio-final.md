# Handoff — W4-T3 收尾(A)+ W4-T2(B)完成,W4 整体终审通过

> 给新 session 的交接文档。本会话(2026-07-30~31)完成 W4-T3 浏览器实测+deferred 修复+review(A 阶段)、W4-T2 音频原版素材全链路实现+review(B 阶段)、W4 整体独立终审+修复。**先读本文件 + `docs/handoff-w4-continuation.md` 再动手。**

## 一句话状态

W4 全完成。W4-T3(video)A1 浏览器实测发现 P0+watchdog 误报,A2/A3 修复+review。W4-T2(audio)实现+review。W4 整体终审无 BLOCKER,全部发现根本性修复。`BLOB_READ_WRITE_TOKEN` 已配(vercel blob store `en-tutorial-audio`),audio 上传链路 prod 实测通。**真机诊断发现并修复 srt/vtt 解析丢 audioEndMs 的根因 BUG**(影响所有 srt/vtt 素材),audio 逐句 seek/AB/句尾停/watchdog 全验通。**未 push**(48 commits 在 main 本地,origin/main 仍停 fefb75e)。

## 本会话产出(commits, main, 从旧到新,未 push)

```
0aeaeab  A2  P0(video 不可见)+ deferred ①②③④⑦
4f6d914  A2  watchdog 连续播放误报(playing 期间周期 markActive)
07120b2  A3  review 修复:stage-gated watchdog / listen→recall pause / onReady rate
61aedf4  B   W4-T2 音频:audio-source + upload-auth + import mode 切换 + 共用 client + shadowing-tab isMedia 泛化
19ec6ac  B   review 修复:同源校验 / 错误分类 / accept 一致 / switchMode 清 url / audio destroy load()
d5a05ed  终审修复:onError 契约对称 / onReady immediate-fire 一致 / upload 加固 / accept m4a / handler 合并
f19a44a  audio autoplay 修复:play() 在用户手势内启动(非 loadedmetadata 回调 flush)
45f4e54  audio AB-loop 修复:seek 不二次 play()(poll 回调非手势被 autoplay 拒)
0bd07e2  真机诊断根因修复:subtitle-parse endMs trim(srt/vtt 丢 audioEndMs → 句尾停/AB/watchdog 全错)
```

## A 阶段:W4-T3 收尾

### A1 浏览器实测发现(生产域名 en-tutorial.vercel.app,先走 onboarding 建 B1 profile)

- ✅ onboarding→import→字幕抓取(22KB json3)→saveMaterial→video 路由,全链路通。
- ❌ **P0 BUG(新发现,非 deferred)**:listen 阶段视频**不可见**。iframe `className="hidden"`、`getBoundingClientRect` 0×0、宽高 640×360 默认(非 100%)。根因:`YT.Player(containerId)` **替换** React 拥有的 `<div id="yt-player"/>`,C1 的 wrapper+inner 双层**未真正隔离 DOM 所有权**——React 重渲染把 className 错涂到被替换的 iframe。
- ❌ **watchdog 误报(新发现)**:连续播放中弹"走神了"nudge。根因:`onStateChange "playing"` 只在状态变化瞬间 markActive 一次,播放持续期间(无 state 事件)不再喂 watchdog,20s 后误判 idle。
- ✅ 确认 deferred ①②④⑦存在;503 降级 UI 工作;recall 三态正确。

### A2/A3 修复

- **P0 根本性修**:`createYouTubePlayer` 不再 `containerId` 查 React 节点,改接收 `host: HTMLElement`,内部 `document.createElement("div")`+`host.appendChild(mount)` 交给 YT.Player 替换。React 永不拥有 mount/iframe → reconciliation 无法涂 className。JSX 用 `ref={playerHostRef}` div,无 JSX children。`[&>iframe]:h-full w-full` 保证尺寸。**prod 验证:iframe visible 412×232, className="", 100%**。
- **watchdog**:`activeInterval` 在 playing 状态每 5s `markActive`,paused/ended 清。**A3 review 发现跨 stage 副作用**:用 `stageRef` 门控 `markActiveIfListening`(仅 `stage==="listen"` 喂 watchdog),recall 阶段不再被残留播放抑制 nudge。
- **listen→recall pause**(review [重要]):"揭示原文并跟读"现 `sourceRef.current?.pause()`——原仅 setStage,YT 音频在 display:none host 下继续播(AB-loop 无限循环),泄漏进 recall。
- **onReady rate 同步**(review [次要]):rate 捕获从首次 onStateChange 挪到 `onReady`(media-source 新增 onReady 回调)——onStateChange 对不可用/autoplay-blocked 视频永不触发,致 availableRates 永 null。
- **setRate null**:player 未就绪返 null,调用方保留用户原选(不再 fallback clamp 0.75→0.5)。
- **deferred ①**:末句"完成练习"→ finished 卡片(原静默无完成信号)。
- **deferred ②**:video defaultRate=1(原 0.75 显示 1x 实播)。
- **deferred ③**:Python `en-orig` 空 events fallback 到 `en`。
- **deferred ④**:video-client loading 空 fragment→spinner(后 video-client 被 MaterialListeningClient 替代,spinner 带过去)。
- **deferred ⑦**:handleParsePaste 成功后 `setPasting(false)`;handleStart 加 catch+console.error。
- 顺手:YTPlayerCtor 类型 `string|HTMLElement`、mountNode.remove()、no-unused-expressions warning。

### A3 prod 验证(部署后浏览器)

- ✅ video 可见(412×232,100%,className="")
- ✅ 播放:iframe 内显 YouTube 字幕"Du Kennst…"(seek 到句首+播放)
- ✅ 句尾停:states `[-1,3,-1,3,1,2]`(playing→pause at endMs)
- ✅ AB 循环:states `[3,1,3,1]`,26s 无 nudge(watchdog 修复确认)
- ✅ listen→recall pause:AB 循环中点揭示原文 → states `[3,1,3,1,3,1,2]`(playing 后 2)
- ✅ recall 三态:原文+空译文提示+纯英/隐藏(无双语)+自评+录音

## B 阶段:W4-T2 音频

### 设计:通用 MediaSource 契约

把 W4-T3 的 YouTube player 泛化为 `MediaSource` interface(`media-source.ts` export `type MediaSource = YouTubeMediaSource`),audio 用 `createAudioPlayer` 实现同一契约(HTMLAudioElement,detached 无 DOM 播放器)。`shadowing-tab` 一个 effect 分支覆盖两种媒体,text 路径零改动(`isMedia` 在 material undefined 时 false)。`ytSourceRef`→统一 `sourceRef`,`isVideo`→`isVideo/isAudio/isMedia` 三态。

### 实现

- `components/listening/audio-source.ts`(新):`createAudioPlayer({src})` → MediaSource。`loadedmetadata` onReady,play/pause/seek/AB/setRate(STANDARD_RATES 网格 clamp)/onStateChange/destroy(audio.load() 释放网络)。
- `app/api/upload-auth/route.ts`(新):`@vercel/blob/client` 的 `handleUpload`(client-token 流程)。同源校验(Origin allowlist)+ audio content-types 白名单 + 100MB cap + try/catch。
- `app/listening/import/page.tsx`:video/audio mode 切换。audio:file picker + 粘贴 srt → `upload(pathname,file,{handleUploadUrl,multipart,access:public})` → saveMaterial `mediaType:audio` `sourceUrl=blob.url` → `/listening/audio/[id]`。抽 PreviewCard。错误分类(BlobFileTooLarge/ContentTypeNotAllowed/Access)。
- `components/listening/material-listening-client.tsx`(新,替代 video-only VideoListeningClient):mediaType-agnostic,video+audio 路由共用,loading spinner。
- `app/listening/audio/[id]/page.tsx`(新)+ video page 改:Next 16 `await params`,都渲染 MaterialListeningClient。
- `shadowing-tab.tsx`:player effect 分支 video(YouTube host)/audio(AudioMediaSource from sourceUrl)。所有原 video-only 门禁改 `isMedia`(默认 rate、口音隐藏、recall 空译文、末句 finished、listen→recall pause、watchdog cadence、rate clamp)。imagine audio 显标题引导无缩略图。

### B prod 验证(token 已配,实测)

`BLOB_READ_WRITE_TOKEN` 已配(blob store `en-tutorial-audio` / `store_ok8s6hg4NfpSe5xQ`,iad1,link 到项目 Production+Preview)。

- ✅ import 页 video/audio 切换
- ✅ audio 文件选择 + 自动填标题 + 大小显示
- ✅ srt 字幕解析 → 预览
- ✅ **实际上传成功**:mp3 经 `@vercel/blob` multipart 直传 → blob url `...public.blob.vercel-storage.com/audio/test-audio-sJ...` → saveMaterial mediaType:audio → 跳 `/listening/audio/[id]`
- ✅ audio 路由三招 UI:imagine(标题+"先看标题想象这段音频")+ listen(播放/AB/6 变速/口音隐藏)+ recall
- ✅ blob url 可播性硬验:fetch 200 `audio/mpeg` 64KB + `new Audio(url)` loadedmetadata dur=3.93s
- ✅ play() 未被 autoplay 拒(HTMLAudioElement.prototype.play probe:calls=1 rejections=[])
- ✅ 无 error alert / 无 console warn(error 事件未触发=加载成功)
- ⚠️ ~~AB/连续播放 watchdog 16s nudge~~ **已修复(真机诊断)**:根因是 `lib/subtitle-parse.ts` parseCueBlocks 的 end 时间戳未 trim——`"start --> end"` split 后 endStr 带 leading 空格,`split(/\s/)[0]` 取到空串→endMs=0→audioEndMs undefined(每条 srt/vtt 句都丢 endMs!)。playSentence fallback 到 nextStart,poll 的句尾停/AB seek 都基于错误边界,音频跑到自然 end触发 pause+ended→activeInterval 被清→20s nudge。**影响所有 srt/vtt 素材**(audio 上传 + video 503 粘贴降级);json3 不受影响(用 dDurationMs)。
- ✅ **修复后 prod 重验(新 audio material)**:Dexie sentences `audioEndMs` 正确填(500→3500/4000→6500);AB 循环 28s 无 nudge;无 error。
- commit `0bd07e2`。真机诊断用了临时 console.log(已移除)。

## 待诊断:audio watchdog 16s nudge ← 已解决(见上)

~~audio 单句播放 play() 未被拒、blob url 可播……~~ 根因已定位并修复(subtitle-parse endMs trim),非 detached audio 事件时序问题。autoplay/AB 的两个修复(f19a44a/45f4e54)仍是正确改进,保留。

## 如何继续(新 session)

真机诊断已解决 audio watchdog 根因(subtitle-parse endMs trim,commit 0bd07e2),audio 链路 prod 全验通(上传/路由/三招/逐句 seek/AB 循环/句尾停/watchdog 不误报)。

### 剩余
1. **push**(需用户授权,48 commits 在 main 本地,origin/main 停 fefb75e)。
2. (可选)人耳确认 audio 出声(DOM 层已确认 play() resolved + blob 可播 + AB 循环逻辑工作,但"听感"需人耳)。
3. (可选)W1 遗留 W3 审查 #6(cron 27 条客户端只用 9 条)、getReusableTask 其余 8 消费方——非 W4 范畴。



## W4 整体终审

已派独立 Code Reviewer 审 W4 整体(T1+T2+T3 跨阶段一致性/架构/遗漏)。**结果待回**——回来后按 goal 根本性修复全部,再按需 push。

## 关键文件(新 session 需知道,在 handoff-w4-continuation 基础上新增/变更)

- `components/listening/media-source.ts` — YouTubeMediaSource(host 所有权隔离 P0 修复 + onReady 回调)+ `export type MediaSource`。
- `components/listening/audio-source.ts`(新)— createAudioPlayer,同一 MediaSource 契约。
- `components/listening/material-listening-client.tsx`(新)— video/audio 共用 client(替代 video-client)。
- `app/listening/audio/[id]/page.tsx`(新)— audio 路由。
- `app/api/upload-auth/route.ts`(新)— @vercel/blob handleUpload(同源校验)。
- `components/listening/shadowing-tab.tsx` — isMedia 三态泛化,stageRef/activeInterval/onReady/sourceRef。
- `app/listening/import/page.tsx` — video/audio mode 切换。
- 其余文件同 handoff-w4-continuation。

## 教训(本会话新增,务必吸取)

1. **第三方"接管 DOM"库的 React 所有权隔离要彻底**:C1 的 wrapper+inner 双层不够——inner 仍是 React 节点。正确:库挂载到 React **不拥有**的节点(命令式 createElement+appendChild),React 只拥有外层 wrapper。P0 就栽在这。
2. **持续播放的 watchdog 要周期 markActive,不只状态变化瞬间**:且用 stageRef 门控,避免 recall 被残留播放抑制。
3. **onStateChange 不可靠**:对不可用/autoplay-blocked 媒体永不触发。ready 类初始化(rates/rate 同步)应挂 onReady。
4. **handoff 的"应已配"要实测**:BLOB_READ_WRITE_TOKEN 声称已配实未配,cron put 一直静默失败。env 要 curl/`vercel env ls` 核实。
5. **video/audio 双路径泛化为统一契约**:MediaSource interface 让 text→video→audio 三路径一个 effect 分支,text 零改动。每个 media-only 门禁用 `isMedia` 谓词(C3 教训泛化)。
