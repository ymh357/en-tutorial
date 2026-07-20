# 子项目 C · 语音 / Whisper — 设计文档

> 状态：待审阅（用户已授权自主定稿，沿用 A/B 的"你审"模式）
> 日期：2026-07-20
> 分支：feat/data-correctness-foundation（A、B 已完成，C/D 在此叠加）
> 背景调研：`scratchpad/c-consumers.md`（语音状态机、listening 语音、tts、闲置 /api/stt、录音机制、架构权衡）

## 1. 目标

1. **STT 切换到 Whisper**：语音输入当前用浏览器 `SpeechRecognition`，它会自动纠正语法 → 架空"recast 隐式纠错 + 复盘显式纠错"的教学闭环。切到已建好但闲置的服务端 `/api/stt`（whisper-large-v3，忠实转写不纠错）。
2. **修复 TTS/录音互斥回路**：4 个具体 bug（回声回路、Read-aloud 绕过互斥、权限拒绝死循环、字幕覆盖）。
3. **发音/内容反馈**（探索性）：若 0g whisper 返回 confidence/segment 则做发音提示；否则用"转写 vs 目标文本"对比做内容准确度反馈。

## 2. 架构（决策：Whisper-primary + SpeechRecognition-fallback）

新增一个共享客户端录音模块 `lib/speech.ts`：`recordAndTranscribe()` —— 用 `MediaRecorder` 录音 → POST 到 `/api/stt` → 返回忠实转写；`/api/stt` 失败（网络/5xx/无 key）时回退浏览器 `SpeechRecognition` 并给"近似转写（可能已被纠正）"的可见提示。

- 依据（c-consumers.md F 节）：全替换风险高（硬依赖 0g router 可用性）；永久双模增加无谓设置面。Whisper-primary+fallback 兼顾忠实度与可用性。
- UX 变化（如实告知用户）：从"流式实时字幕"变为"录音 → Transcribing… → 忠实转写"，有一次上传延迟、无实时中间字幕。用一个明确的 "Transcribing…" 状态覆盖。
- `/api/stt` 已有 MIME→扩展名映射处理跨浏览器 MediaRecorder 输出（webm/ogg/wav/mp4…），是现成基础。

## 3. STT cutover 设计

- **`lib/speech.ts`（新）**：
  - `recordAndTranscribe(opts): { start(), stop(): Promise<{ text, approximate: boolean }> }` 或等价接口：`start()` 开 MediaRecorder；`stop()` 收集 blob → POST `/api/stt` → `{text, approximate:false}`；失败回退 SpeechRecognition → `{text, approximate:true}`。
  - 处理权限（getUserMedia 拒绝 → 明确错误，不死循环）、浏览器不支持（无 MediaRecorder 且无 SpeechRecognition → 明确提示）。
- **对话页**（`app/conversation/[id]/page.tsx`）：`startVoiceRecording` 改用 `recordAndTranscribe`；voice mode 流程变为 录音→Transcribing→拿忠实转写填入并发送。`[Start the conversation]` 隐藏触发词逻辑保留。
- **listening shadowing**（`app/listening/page.tsx`）：`startListening`（唯一消费者 ShadowingTab.record）改用同一 `recordAndTranscribe`。prediction/dictation/comprehension 是打字，不涉及。
- **`/api/stt` 加固**：显式 size guard；`OG_API_KEY` 缺失时返回明确 "STT not configured"（而非 "Bearer undefined" → 502）；language 保持但可参数化。

## 4. TTS/录音互斥修复（4 bugs，见 c-consumers.md A/C）

1. **回声回路（High）** `lib/tts.ts` `fallbackSpeak`：`window.speechSynthesis.speak()` fire-and-forget，`speak()` 在音频结束前 resolve → mic 在 AI 还在说时重开。修：`fallbackSpeak` 返回 awaitable Promise（`utterance.onend` resolve），`speak()` 等它。
2. **Read-aloud 绕过互斥（High）** 对话页 `handleSpeak`：不设 `isSpeakingRef` → 录音中点消息喇叭会把音频播进 live mic。修：Read-aloud 也走 `isSpeakingRef` 互斥（或语音模式下播放期间禁用/暂停 mic）。
3. **权限拒绝死循环（Medium）** `onerror` 不看 `event.error` → `not-allowed` 每秒 2 次无限重试。修：区分 `not-allowed`/`no-speech`，权限拒绝给提示并停止重试。（whisper 路径下 MediaRecorder 的 getUserMedia 拒绝同样明确处理。）
4. **字幕覆盖（Medium-high）** 识别重启时新 session 的 `accumulated` 是新局部变量，覆盖而非合并 `liveTranscript`。修：跨 session 基于 state 追加。（切 whisper 后实时字幕问题大部分消失，但 fallback 路径仍需正确。）
- barge-in（gap，非 bug）：本轮不做（严格非抢占互斥可接受）；可作为后续。

## 5. 发音 / 内容反馈（探索性，C 末或 defer）

- C1 smoke-test 时验证 0g `/audio/transcriptions` 是否支持 `response_format: "verbose_json"` 且返回 segment/word confidence。
- **支持** → shadowing 用 confidence 做发音提示（低置信词高亮）。
- **不支持** → 用"whisper 忠实转写 vs 目标文本"的对齐对比做**内容准确度**反馈（诚实命名，不宣称测发音），复用 D 的对齐判分（若 D 先做）或简单 diff。
- 若两者都不划算，本子项目 defer 发音反馈，只交付 STT cutover + mutex 修复（已是主要价值）。

## 6. 决策记录

- STT：Whisper-primary + SpeechRecognition-fallback（非全替换/非永久双模）。
- 录音：新增 `lib/speech.ts` 共享 MediaRecorder helper。
- 发音反馈：探索性，取决于 C1 的 0g verbose_json/confidence smoke-test；不支持则降级为内容准确度或 defer。
- UX：接受"录音→Transcribing→忠实转写"替代实时字幕（忠实度 > 实时性，符合纠错教学目标）。

## 7. 拆分为 plan

- **C1 · STT 基础设施**：`lib/speech.ts`（录音+transcribe+fallback）+ `lib/tts.ts`（fallbackSpeak awaitable）+ `app/api/stt/route.ts`（加固 + verbose_json smoke-test 结论）。含 0g whisper smoke-test（真实网络，确认忠实转写 + 是否返回 confidence）。
- **C2 · 对话页语音重构**：`app/conversation/[id]/page.tsx` —— startVoiceRecording 用 recordAndTranscribe、Transcribing/error 状态、4 个 mutex bug 修复。
- **C3 · listening shadowing + 发音/内容反馈**：`app/listening/page.tsx` shadowing 切 recordAndTranscribe；据 C1 smoke-test 结论做发音 confidence 或内容准确度反馈（或 defer）。

## 8. 验证策略

- 无测试框架：`tsc --noEmit` + `eslint`（分支现 0 error，保持）+ 推理核对。
- C1 的 0g whisper smoke-test 是唯一需真实网络的验证（确认忠实转写 + verbose_json/confidence 支持）；不可行则标注未验证 + 保留 fallback。
- 录音/转写/互斥的行为验证靠代码走查（不起 dev server、不实操麦克风）；明确每个 mutex bug 的修复点与预期。

## 9. 非目标

不做：判分对齐算法/测评心理测量/SRS 调度（子项目 D）；barge-in 打断；TTS 多音色/口音（可后续）；prompt 教学内容。C 只做"语音输入忠实化 + 播放/录音互斥可靠 +（可行则）发音反馈"。
