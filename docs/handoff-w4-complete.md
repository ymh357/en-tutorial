# Handoff — W4 全部完成(W4-T3 收尾 + W4-T2 音频 + WordCard 接线),已 push;+ 独立整体终审一轮

> 给新 session 的交接文档。本会话(2026-07-30~31)完成 W4-T3 浏览器实测/deferred/review、W4-T2 音频原版素材全链路、WordCard 接线 W4 成果(TTS 发音 + listening 挖词原声)。**先读本文件 + `docs/handoff-w4-continuation.md`(W0–W4-T1 细节)+ `docs/handoff-w4-audio-final.md`(W4-T2/T3 收尾过程)再动手。**

## 一句话状态

方法论四招前三招已落地,W4 原版素材三路(text/video/audio)全完成并 prod 验证,WordCard/SRS 已消费 W4 成果(单词 TTS 发音 + listening 挖词 → SRS 听原句原声)。**C 阶段后又跑了一轮跨 A+B+C 独立整体终审(opus),发现 2 Critical + 4 Important + 5 Minor + 2 spec question,全部根因修复,scoped 复审(sonnet)确认 10/10 RESOLVED、零回归。** origin/main = 61fff3e(handoff)已 push;终审修复两 commit(31d257f、017dfd5)**本地未 push**(待授权)。剩余仅 W4 之外的遗留(cron 成本/getReusableTask 接入/ruff 等)+ 人耳听感最终确认。

## 独立整体终审一轮(本会话末尾,goal 的"整体完整 独立 reviewer review")

派 opus Code Reviewer 审 A+B+C 全范围(`0aeaeab^..19e8e12`,16 文件 diff)。架构事实全确认干净:MediaSource 契约对称、YouTube DOM 所有权隔离、onReady/onError immediate-fire、subtitle-parse endMs trim、autoplay 黄金规则(无 await-then-play / AB 不二次 play / useAudioClipPlayback 同步)、CardSource exhaustiveness、watchdog stageRef 门控、player 生命周期无泄漏、upload 同源校验、text 路径零改动、无遗留 debug log。

发现的真缺陷(已全修,scoped 复审 RESOLVED):
- **C1**:`handleSaveCard` 把划选原文直接当 `lemma` 写 → 破坏全 app `isWordKnown`/去重不变量(lemma 列契约是 lemmatized 基形,`getCardByLemma` 是精确索引等值查询)。修:`await ensureLemmatizer()` → `lemmatize(front)` → 用 lemma 去重+写入。
- **C2**:多词选区(三击选整句)被当 vocabulary 卡存入 lemma 索引。修:`handleSentenceMouseUp` 剥首尾标点 + `^[A-Za-z][A-Za-z'-]*$` 单词校验,非单词不挂存卡入口。
- **I1**:`justSavedCard` 的 setTimeout 未捕获 → tab 切换后 setState 泄漏。修:`savedTimerRef` + unmount 清 + `mountedRef` 门控。
- **I3**:`finished` 只置 true 不重置,"Try Another" 在末句把学习者困在 imagine 阶段。修:`ExerciseCompletionActions` 加 `!finished` 门控。
- **I4**:player effect 依赖 material 但 finished/index/abLoop 不随重置(latent,路由 remount 下不触发)。修:render-time ref-guard 重置(React 19 "render 中调 prop 变化调整 state" 模式,**非** effect 主体——effect 主体同步 setState 被 React 19 禁)。
- **I2(browse)**:空 back 回退 `sourceSentence` 只加在 `srs/page.tsx`,browse 渲染空 + 搜不到。修:browse 渲染与搜索都加 `card.back || card.sourceSentence || ""`。
- **S2**:upload-auth 白名单硬编码单生产域 + localhost:3000 → preview deploy 全 403。修:`isAllowedOrigin` 用 URL 解析,接受 localhost:3000-3009 + `^en-tutorial(-[^.]+)?\.vercel\.app$`(生产 + preview);恶意 lookalike / opaque "null" / 缺 Origin 均 403。
- **M1**:use-audio-clip 死 `if(started)` guard 移除 + 加 `endMs>startMs` sanity(TTS fallback)。
- **M2**:audio-source `pendingPlay.endMs` 死字段移除(flush 只用 startMs)。
- **M3**:`getRate()` 零调用方,从契约 + 两实现一并移除。

留(复审认可,非缺陷):**M4** audio stall 事件非对称(runtime-only,无法静态定论);**M5** WordCard `materialId`/`sentenceIndex` 当前无消费方传值,但 prefetch effect 在 materialId 缺省时早返回 null(干净 no-op),spec 前瞻设计两处复用,保留。**spec question S1**:media 模式 bilingual 不可达(material-adapter 硬编码 translation:""),挖词门禁 `!=="hidden"` 等价正确,仅 spec 措辞 "english/bilingual" 与现实不符——未来若 adapter 填翻译需复核。**spec question I2(a)**:listening 挖词卡 `back` 留空(spec 故意 no-LLM),SRS "show answer" 回退显 sourceSentence(语境句非释义)——是 spec 取舍,若想要真正释义需接字典/LLM,属未来增强。

复审 commits:`31d257f`(Phase1: C1/C2/I1/I3/I4)、`017dfd5`(Phase2: I2-browse/S2/M1/M2/M3)。tsc + eslint 全量 0 error。

## 项目约束(必读,沿袭 handoff-w4-continuation)

- `AGENTS.md`:Next.js 16 有破坏性改动,写码前读 `node_modules/next/dist/docs/` 相关篇。
- 纯客户端 Dexie(IndexedDB),无服务端 DB,单例 profile `id:"singleton"`。
- 每阶段派 Code Reviewer(`Agent` 工具)审查 → 修复全部 → 下一阶段。
- tsc `npx tsc --noEmit` + eslint `npx eslint . --quiet` 必须 0 error 才能 commit。
- commit 末尾 `Co-Authored-By: Claude <noreply@anthropic.com>`,直接在 main 提交(已授权)。push 需用户授权。
- Code comments in English only。不写测试(CLAUDE.md)。
- prod 部署用 `vercel --prod --yes`(本地直部,非 git push 触发)。

## 本会话产出(commits, 已全部 push,从旧到新)

### A 阶段 — W4-T3(video)收尾
```
0aeaeab  A2  P0 video 不可见 + deferred ①②③④⑦(P0:YT.Player 替换 React 节点 → host 所有权隔离)
4f6d914  A2  watchdog 连续播放误报(playing 期间周期 markActive)
07120b2  A3  review 修复:stage-gated watchdog / listen→recall pause / onReady rate / setRate null
```
### B 阶段 — W4-T2(audio)
```
61aedf4  B   W4-T2 音频:audio-source + upload-auth(@vercel/blob)+ import mode 切换 + 共用 MaterialListeningClient + shadowing-tab isMedia 泛化
19ec6ac  B   review 修复:同源校验 / 错误分类 / accept 一致 / switchMode 清 url / audio destroy load()
d5a05ed  终审修复:onError 契约对称 / onReady immediate-fire 一致 / upload 加固 / accept m4a / handler 合并
f19a44a  audio autoplay 修复:play() 在用户手势内(非 loadedmetadata 回调 flush)
45f4e54  audio AB-loop 修复:seek 不二次 play()(poll 回调非手势被 autoplay 拒)
0bd07e2  真机诊断根因:subtitle-parse endMs trim(srt/vtt 全丢 audioEndMs → 句尾停/AB/watchdog 全错)
```
### C 阶段 — WordCard 接线 W4 成果
```
17d40a2 docs(spec)  WordCard 接线设计
558839c docs(spec)  review 修订(BLOCKER autoplay + sourceId + sourceLabels + hidden + text 路径)
0f19119 docs(plan)  实现计划(6 任务 SDD)
d8cc7c6  Task1  Card.sentenceIndex + CardSource "listening" + sourceLabels 两处
6841aa1  Task2  useAudioClipPlayback hook(autoplay-safe)
4bfdfd4  Task2 fix  play() 同步化(DB 读移出 hook,消费方预取)
bdb7b2a  Task3  WordCard T1 发音 + T2b 听原句 + 删 audioSrc
000f315  Task4  listening recall 划选挖词存卡(无 LLM,sourceId=material.id)
6c39a53  Task5  SRS 听原句按钮 + 空 back 回退 sourceSentence
19e8e12  final fix  mining lemma 去重 + clip ended-listener(防"播放中…"卡死)
```
### D 阶段 — 独立整体终审一轮 + 根因修复(本地未 push)
```
31d257f  D1  C1 lemma 归一化 / C2 单词校验 / I1 timer 卸载安全 / I3 finished 门控 / I4 material 换重置(render-time)
017dfd5  D2  I2 browse 空 back 一致 / S2 origin 白名单覆盖 preview / M1 死 guard+endMs sanity / M2 死 endMs / M3 删 getRate
```


## 关键架构事实(本会话新增,新 session 需知道)

### 通用 MediaSource 契约(video/audio 共享)
`components/listening/media-source.ts` export `type MediaSource = YouTubeMediaSource`。`audio-source.ts` 的 `createAudioPlayer` 实现同一契约(HTMLAudioElement,detached)。`shadowing-tab` 一个 player-construction effect 分支覆盖 video/audio,text 路径零改动(`isVideo`/`isAudio`/`isMedia` 三态;所有行为门禁用 `isMedia`,presentation-only 用 `isVideo`)。
- **YouTubeMediaSource**:player 挂到 React **不拥有**的 mount div(`createYouTubePlayer({host})` 内部 `createElement+appendChild`,YT.Player 替换它)。React 只拥有 wrapper(`playerHostRef`)。P0 教训:勿让 YT.Player 替换 React 节点。
- **onError 契约对称**:两者都暴露 `onError(cb)`(audio 监听 `<audio>` error 事件;video 监听 YT onError)。shadowing-tab 订阅 → `setError`。audio `play()` 在 `failed` 时早返回(防 listensCount 自增重蹈 C2)。
- **onReady**:两者都 immediate-fire(订阅时若已 ready 立即调 cb),消除订阅竞态。
- **autoplay 黄金规则**:`play()` 必须在用户手势调用栈内。audio-source 的 `playInternal` 在手势内 `audio.play()`,loadedmetadata 只 re-seek(不 play)。AB 循环到 endMs seek 回 startMs **不二次 play**(poll 回调非手势会被拒)。`useAudioClipPlayback` hook 同理:消费方渲染期预取 AudioClip,onClick 同步 `play(clip, fallback)`(hook 内无 await 在 play 前)。

### WordCard 接线(C 阶段)
- **T1**:`WordCard` 组件有 Volume2 TTS 发音按钮(`speak(word)`)。SRS 页另有自己的 `speak(front)`(不自改)。
- **T2a**:listening recall(english/bilingual 模式,media only)划选 → `db.cards.add`(front=选词,sourceSentence=整句,materialId/sourceId=material.id,sentenceIndex=index,source="listening",back 空)。带 `getCardByLemma` 去重 + `incrementTodayStat("wordsLearned")` + catch `setError`。text 路径不开挖词(无稳定 sourceId)。
- **T2b**:`lib/use-audio-clip.ts` `useAudioClipPlayback()` → `{play(clip: AudioClip|null, fallbackText)=>void, playing}`。AudioClip=`{sourceUrl,startMs,endMs}`。WordCard + SRS 各自 `useEffect` 预取 AudioClip(db.materials.get → audio 且 startMs+endMs 齐全才建 clip,否则 null),onClick 同步 play。null/失败/error/ended → `speak(fallbackText)`。`audio.onended` 清 poll + setPlaying(false)(防卡死)。空 back 卡 SRS 回退显 sourceSentence。
- `Card.sentenceIndex?: number`、`CardSource` 含 `"listening"`(两处 `sourceLabels` 已补 `精听`)。`audioSrc` 槽位已删(被 materialId+sentenceIndex 取代)。

### 字幕解析 BUG 修复(影响所有 srt/vtt)
`lib/subtitle-parse.ts` parseCueBlocks:`endStr` 必须先 `.trim()` 再 `.split(/\s/)[0]`(原未 trim → leading 空格 → endMs=0 → audioEndMs 全丢)。json3 不受影响(用 dDurationMs)。

### blob 配置
`BLOB_READ_WRITE_TOKEN` 已配(blob store `en-tutorial-audio` / `store_ok8s6hg4NfpSe5xQ`,link 到项目 Production+Preview,通过 vercel API `POST /v1/storage/stores/{id}/connections`)。audio 上传走 `@vercel/blob/client` 的 `upload(pathname,file,{handleUploadUrl:"/api/upload-auth",multipart:true,access:"public"})`,不经 function body(绕 4.5MB)。`/api/upload-auth` 同源校验 + audio content-type 白名单 + 100MB cap。

## 教训(本会话新增,务必吸取)

1. **第三方"接管 DOM"库的 React 所有权隔离要彻底**:库挂载到 React **不拥有**的节点(命令式 createElement+appendChild),React 只拥有外层 wrapper。wrapper+inner 双层不够(inner 仍 React 节点)。
2. **持续播放的 watchdog 要周期 markActive**(不只状态变化瞬间),且用 stageRef 门控(避免 recall 被残留播放抑制)。
3. **onStateChange 不可靠**(不可用/autoplay-blocked 媒体不发)——ready 类初始化挂 onReady。
4. **handoff 的"应已配"要实测**(BLOB token 声称已配实未配)。
5. **autoplay:`play()` 必须在手势栈,loadedmetadata/对象 cache 回调都不算**。await DB 后 play 必被拒——DB 读移到手势前(渲染期预取)。
6. **字幕时间戳解析:split 后的片段要 trim**(leading 空格 → 空串 → 0 → 守卫失败 → 字段丢失,静默)。
7. **review 找到的 autoplay BLOCKER 要传给后续 task**:Task 2 改了 hook 接口,Task 3/5 的 brief 旧接口代码会重引人 BUG——dispatch 时必带纠正。
8. **新存卡路径要对齐既有约定**:getCardByLemma 去重 + incrementTodayStat(failure reviewer 跨 task 看出全局一致)。

## 剩余待办(W4 之外,非阻塞)

### 需人耳人眼最终确认(非代码)
1. audio/video 实际出声听感(DOM 层全验:play() resolved/blob 可播/AB 句尾停/watchdog 不误报)。
2. deferred ⑤ playSentence fallback 窗口(audioEndMs 缺时 nextStart/+15s/+5s)手感。

### W4 之外遗留(handoff-w4-continuation 记载)
3. **W3 审查 #6**:cron 产 27 条、客户端只用 9 条(level-scoping 丢 18 条成本)。中期改 `/api/tasks/today?level=studyLevel` 服务端过滤。
4. **getReusableTask 仅 shadowing 接入**:其余 8 个 pool 消费方(dictation/comprehension/prediction/reader/translate/writing)仍 miss→实时生成。
5. **fluency 模式 overdue 顺延**:`lib/task-pool.ts` 注释仍提 TASKS_PER_DAY=6/overdue,fluency 下不应 overdue 置顶但 getTodayTasks 仍按 assignedDate 顺延。
6. **W2 审查 N1**:WordCard 的 imageryHint 槽位(已保留未渲染,audio Material 的 imageryHint 当前空串)。待 imageryHint 有数据源再渲染。
7. **ruff Python lint**:`api/youtube_captions.py` 未引 ruff(dev-only),待确认。
8. **video 503 粘贴降级的旧 Material**:parseSrt endMs BUG 修复前创建的 video/audio Material 的 audioEndMs 仍丢失在 Dexie,重新导入才修。可加 migration 或提示重导。

## 关键文件(新 session 需知道)

- `components/listening/media-source.ts` — YouTubeMediaSource(host 所有权隔离 + onReady/onError 契约)+ `type MediaSource`。
- `components/listening/audio-source.ts` — createAudioPlayer(同契约,error 监听,autoplay-safe)。
- `lib/use-audio-clip.ts` — useAudioClipPlayback(WordCard/SRS 片段播放,同步 play + ended listener + TTS fallback)。
- `lib/subtitle-parse.ts` — parseJson3/parseSrt/parseVtt(endMs trim 已修)。
- `components/listening/shadowing-tab.tsx` — 三招主组件,isMedia 三态,recall 划选挖词。
- `components/feedback/word-card.tsx` — T1 发音 + T2b 听原句(预取 AudioClip),audioSrc 已删。
- `app/srs/page.tsx` + `app/srs/browse/page.tsx` — sourceLabels 含 listening;SRS 听原句按钮 + 空 back 回退。
- `app/listening/import/page.tsx` — video/audio mode 切换 + blob upload。
- `app/api/upload-auth/route.ts` — @vercel/blob handleUpload(同源校验)。
- `api/youtube_captions.py` — Python yt-dlp function。
- `lib/types.ts` — Card.sentenceIndex + CardSource "listening"。
- `docs/superpowers/specs/2026-07-31-wordcard-wiring-design.md` + `docs/superpowers/plans/2026-07-31-wordcard-wiring.md` — C 阶段 spec/plan。
- `docs/handoff-w4-continuation.md`(W0–W4-T1)+ `docs/handoff-w4-audio-final.md`(A/B 阶段过程)。

## 如何继续(新 session)

W4 已闭环 + 独立整体终审通过。继续点:
- **push D 阶段两 commit**(31d257f、017dfd5)— 需用户授权(本地 main 已超 origin/main 两个 commit)。push 后 origin/main = 017dfd5。
- **真机听感确认**(audio/video 出声)→ 若有问题定位到具体路径。
- **W3/W2 遗留**(上面 #3-#7)— 按价值排:`getReusableTask` 8 消费方接入(语料交替重复池真正生效,方法论核心)> cron 成本优化 > fluency overdue。
- **migration #8**(旧 Material audioEndMs 修复)——若 audio/video 素材已积累。
- **W4-外 新增候选**:listening 挖词卡接字典/LLM 填 `back` 释义(当前 spec 故意 empty,见 I2(a) spec question)。
