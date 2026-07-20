# 子项目 C / C2 · 对话页语音重构 + 4 处互斥修复 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把对话页（`app/conversation/[id]/page.tsx`）的语音输入从"浏览器 SpeechRecognition 连续识别（会自动纠语法，架空纠错教学闭环）"切到 C1 建好的 `lib/speech.ts`（MediaRecorder 录音 → `/api/stt` whisper 忠实转写 → 失败回退），并修复 4 个 TTS/录音互斥缺陷。

**Architecture:** 语音模式流程从"连续识别 + 实时字幕 + 手动 Send"变为"录音 → Stop → Transcribing… → 忠实转写自动发送"。用单一 `micStatus: "idle" | "recording" | "transcribing"` 枚举取代散落的 `isRecording`/`liveTranscript` 布尔与实时 interim 预览（消除 boolean soup）。TTS 播放与麦克风严格互斥：`speak()`（C1 已修为 awaitable）结束后才重开麦克风；read-aloud 也走同一互斥。`[Start the conversation]` 隐藏开场触发保留。

**Tech Stack:** Next.js 16、React 19、TS strict、Web APIs（MediaRecorder/getUserMedia）、`lib/speech.ts`、`lib/tts.ts`。

## Global Constraints

- TS strict；纯本地；注释英文。
- 无测试框架：`tsc --noEmit` + `eslint`（分支现 0 error，保持）+ 推理核对 + 每个 mutex 修复点的代码走查。不起 dev server、不实操麦克风（录音/互斥逻辑靠代码走查 + 对 C1 `lib/speech.ts` 契约的推理）。
- Git：每 task 提交；用户已授权所有 git 操作。commit 末尾附：
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SDA8JvMdjpqLaxXC7gLC9M
  ```

## 位置 & 依赖

子项目 C 的第二个 plan（C1 已完成：`lib/speech.ts` 录音+转写+回退、`/api/stt` 加固、`lib/tts.ts` fallbackSpeak awaitable）。spec: `docs/superpowers/specs/2026-07-20-voice-whisper-design.md`（§3 STT cutover、§4 四个 mutex bug）。C2 只改对话页一个文件；listening shadowing 是 C3。

**C1 提供的契约（本 plan 消费，勿改 lib/speech.ts）：**
```ts
// lib/speech.ts
export interface TranscribeResult { text: string; approximate: boolean; } // approximate=true 表示 whisper 失败、走了 SpeechRecognition 近似回退
export interface RecordingSession {
  stop(): Promise<TranscribeResult>;  // 停止录音 → 上传 /api/stt 忠实转写 → 结果；whisper 失败则单次 SpeechRecognition 近似回退（approximate:true）；双失败 reject
  cancel(): void;                     // 丢弃本次录音、停 tracks
}
export const startRecording: () => Promise<RecordingSession>;  // getUserMedia + MediaRecorder；权限拒绝 throw 明确错误（不循环重试）；不支持 throw
export const isRecordingSupported: () => boolean;              // MediaRecorder/getUserMedia 或 SpeechRecognition 可用
```
关键语义（来自 C1 report / speech.ts 头注释）：`startRecording()` 在 `getUserMedia` 拒绝时**抛出明确错误且不自重试**（结构性消除"权限死循环"bug）；一次录音只转写一次（无连续重启，结构性消除"字幕覆盖"bug）；whisper 成功 = 忠实转写（`approximate:false`），失败 = 显式降级需用户重说（`approximate:true`）或抛错。

## File Structure

- `app/conversation/[id]/page.tsx`（改，唯一文件）：
  - 删除语音模式的连续 `SpeechRecognition`（`startVoiceRecording`、其 `onresult/onerror/onend` 连续重启逻辑、`recognitionRef`、`liveTranscript`、`isRecording`、以及文件顶部本地的 `SpeechRecognition*` 类型与 `getSpeechRecognition()` —— 全部由 `lib/speech.ts` 取代）。
  - 新增语音状态机 `micStatus` + `sessionRef` + `startMicSession/stopAndSend/cancelMic`。
  - 改 `speakAndResumeListening` 在播放后开录音会话；`handleSpeak` 走互斥；`handleToggleVoiceInput`（文本模式麦克风）也切到录音→转写→填入。
  - 改语音模式 UI（Recording/Transcribing/Stop&Send/Cancel；删实时 interim 预览）。

---

## Phase 1 — 对话页语音重构（1 文件，2 task）

> 两 task 同文件，必须顺序执行；Task 2 消费 Task 1 产出的 helper（下方"Produces"给出精确签名）。

### Task 1: 语音模式 STT cutover + 状态机 + mutex bug 1/3/4 + 语音 UI

**Files:** Modify `app/conversation/[id]/page.tsx`

**Interfaces:**
- Consumes: `lib/speech.ts` 的 `startRecording`/`isRecordingSupported`/`RecordingSession`/`TranscribeResult`（上方契约）；`lib/tts.ts` 的 `speak`/`stopSpeaking`（现有 import 保留）。
- Produces（Task 2 依赖）：
  ```ts
  type MicStatus = "idle" | "recording" | "transcribing";
  // state: const [micStatus, setMicStatus] = useState<MicStatus>("idle");
  // ref:   const sessionRef = useRef<RecordingSession | null>(null);
  // ref:   const voiceModeRef / isSpeakingRef（保留）
  const startMicSession: () => Promise<void>;             // startRecording → sessionRef/micStatus="recording"；权限/不支持 catch → setVoiceError + 关 voiceMode + micStatus="idle"
  const speakAndResumeListening: (text: string) => Promise<void>; // 互斥播放后（若 voiceMode）startMicSession
  const setVoiceError: (msg: string | null) => void;      // 错误提示 state setter
  ```

- [ ] **Step 1: import 与类型切换。**
  - 顶部 import 增补：`import { startRecording, isRecordingSupported, type RecordingSession } from "@/lib/speech";`（`speak`/`stopSpeaking` 已从 `@/lib/tts` import，保留）。
  - **删除**文件顶部本地的 `SpeechRecognitionAlternative`/`SpeechRecognitionResult`/`SpeechRecognitionResultList`/`SpeechRecognitionEvent`/`SpeechRecognitionInstance` 接口与 `getSpeechRecognition()` 函数（约 22-56 行）——语音全部经 `lib/speech.ts`，页面不再直接用 SpeechRecognition。（注意：`lib/speech.ts` 内部有自己的一份 SR 类型，互不影响。）
- [ ] **Step 2: state 收敛。** 在组件内：
  - **删除**：`const [isRecording, setIsRecording] = useState(false);`、`const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);`、`const [liveTranscript, setLiveTranscript] = useState("");`。
  - **新增**：
    ```ts
    type MicStatus = "idle" | "recording" | "transcribing";
    const [micStatus, setMicStatus] = useState<MicStatus>("idle");
    const sessionRef = useRef<RecordingSession | null>(null);
    const [voiceError, setVoiceError] = useState<string | null>(null);
    const [lastApproximate, setLastApproximate] = useState(false); // last transcript came from the SpeechRecognition fallback
    ```
  - `voiceSupported` 改为：`const voiceSupported = typeof window !== "undefined" && isRecordingSupported();`
  - 保留：`voiceMode`/`voiceModeRef`/`isSpeaking`/`isSpeakingRef`。
- [ ] **Step 3: 删除旧 `startVoiceRecording`（约 206-264 行），新增录音会话 helper。**
    ```ts
    // Starts a fresh MediaRecorder session (whisper-primary, per lib/speech.ts).
    // getUserMedia denial / unsupported throws a clear error and does NOT retry
    // (kills the old not-allowed retry loop); surface it and drop out of voice mode.
    const startMicSession = async (): Promise<void> => {
      // Never open the mic while TTS is still playing (echo-loop guard).
      if (isSpeakingRef.current) return;
      // Do NOT clear voiceError here: stopAndSend sets a "try again" / "please
      // repeat" prompt immediately before calling startMicSession, and both run
      // in the same render frame — clearing here would coalesce that message to
      // null (React batching) and it would never show. Errors are cleared only
      // at intentional fresh-start points (toggleVoiceMode ON, faithful send).
      try {
        const session = await startRecording();
        sessionRef.current = session;
        setMicStatus("recording");
      } catch {
        sessionRef.current = null;
        setMicStatus("idle");
        setVoiceError(
          "Microphone unavailable (permission denied or unsupported). Voice mode off."
        );
        voiceModeRef.current = false;
        setVoiceMode(false);
      }
    };
    ```
- [ ] **Step 4: `stopAndSend` / `cancelMic`（语音模式）。**
    ```ts
    // Stop recording → faithful transcript → auto-send. On transcribe failure,
    // surface a repeat prompt and return to idle (user can record again).
    const stopAndSend = async (): Promise<void> => {
      const session = sessionRef.current;
      if (!session || micStatus !== "recording" || isStreaming) return;
      sessionRef.current = null;
      setMicStatus("transcribing");
      try {
        const { text, approximate } = await session.stop();
        setLastApproximate(approximate);
        const trimmed = text.trim();
        if (trimmed) {
          setVoiceError(null); // genuine send clears any stale "try again" prompt
          sendMessage({ text: trimmed });
          // AI reply auto-plays via the voice-autoplay effect, which then
          // resumes recording through speakAndResumeListening → startMicSession.
        } else {
          setVoiceError("Didn't catch that — try again.");
          await startMicSession();
        }
      } catch {
        setVoiceError("Couldn't reach transcription — please repeat that.");
        await startMicSession();
      } finally {
        setMicStatus((s) => (s === "transcribing" ? "idle" : s));
      }
    };

    // Discard current recording and immediately start a fresh one (stay in voice mode).
    const cancelMic = (): void => {
      sessionRef.current?.cancel();
      sessionRef.current = null;
      setMicStatus("idle");
      void startMicSession();
    };
    ```
    注意：`finally` 里若已在 `startMicSession()` 成功把 `micStatus` 设为 `"recording"`，则 `s === "transcribing"` 为假、不覆盖（用函数式 setState 读最新值）；正常成功发送路径 `micStatus` 仍是 `"transcribing"` → 归 `"idle"`（随后 AI 回复 → autoplay → resume）。
- [ ] **Step 5: 改 `speakAndResumeListening`（约 287-296 行）。** 播放后开录音会话（而非旧 `startVoiceRecording`）：
    ```ts
    const speakAndResumeListening = async (text: string): Promise<void> => {
      isSpeakingRef.current = true;
      setIsSpeaking(true);
      await speak(text); // C1: resolves only after audio truly ends (awaitable fallback)
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      if (voiceModeRef.current) {
        await startMicSession();
      }
    };
    ```
- [ ] **Step 6: 改 `toggleVoiceMode`（约 298-320 行）。**
  - **打开分支**（`else` 里）：进入前先清掉任何遗留的文本模式录音会话并清 error（否则 text→voice 中途切换会覆盖 `sessionRef` 而不 cancel，泄漏 live mic —— I1）：在设置 `voiceModeRef.current = true; setVoiceMode(true);` 之后、`messages.length === 0` 判断之前插入 `sessionRef.current?.cancel(); sessionRef.current = null; setMicStatus("idle"); setVoiceError(null);`；随后 `messages.length === 0` → `sendMessage({ text: "[Start the conversation]" })`（不变），`else` → `void startMicSession();`（替换旧 `startVoiceRecording()`）。
  - **关闭分支**：把 `recognitionRef.current?.stop(); setIsRecording(false); setLiveTranscript("");` 换成 `sessionRef.current?.cancel(); sessionRef.current = null; setMicStatus("idle"); setVoiceError(null);`（其余 `stopSpeaking()`/`isSpeakingRef`/`voiceModeRef` 保留）。
- [ ] **Step 7: 改 `handleVoiceSend`/`handleVoiceClear`（约 266-281 行）。** 删除这两个基于 `liveTranscript` 的旧函数——它们的职责由 `stopAndSend`/`cancelMic` 取代。
- [ ] **Step 8: 卸载/结束清理。**
  - 卸载 effect（约 412-418 行）：`recognitionRef.current?.stop();` → `sessionRef.current?.cancel();`（`stopSpeaking()` 保留）。
  - `handleEndAndReview` 的语音 teardown（约 495-503 行）：`recognitionRef.current?.stop(); setIsRecording(false); setLiveTranscript("");` → `sessionRef.current?.cancel(); sessionRef.current = null; setMicStatus("idle");`（其余保留）。
  - voiceAutoPlay effect（约 382-399 行）：逻辑不变（仍在流结束后 `speakAndResumeListening(text)`）。
- [ ] **Step 9: 语音模式 UI（约 646-708 行 `voiceMode ? (...)` 分支）。** 用 `micStatus` 驱动：
  - 状态圆点/文案：`micStatus === "recording"` → 红色 pulse + "Listening… tap Stop when done"；`micStatus === "transcribing"` → "Transcribing…"（不可点）；`isStreaming` → "AI is thinking…"；`isSpeaking` → "AI is speaking…"；否则 "Ready"。（保留原配色语义：recording 红、speaking 绿。）
  - **删除**实时 interim 预览块（`{isRecording && (<div>…Live:…</div>)}`，含 `liveTranscript` 显示）。
  - 录音中显示两个按钮：`Stop & Send`（`onClick={() => void stopAndSend()}`，`disabled={micStatus !== "recording" || isStreaming}`）与 `Cancel`（`onClick={cancelMic}`，`disabled={micStatus !== "recording"}`）。
  - `micStatus === "transcribing"` 时显示禁用的 "Transcribing…" 提示（可复用一个 disabled 按钮或文案行）。
  - （`voiceError` / `lastApproximate` 的显示**不放在此语音块内** —— 见 Step 9b，移到 ternary 外，使权限拒绝/文本模式错误也能显示。）
- [ ] **Step 9b: 全局错误/近似提示（ternary 外，两模式共用；修 C1+M2）。** 在 Voice Mode 切换按钮块（约 634-644 行 `{voiceSupported && (<Button…Voice Mode…/>)}`）之后、`{voiceMode ? (...) : (...)}` ternary 之前，插入（输入区渲染即挂载，语音/文本/退出语音后都可见）：
    ```tsx
    {voiceError && <p className="text-xs text-red-500">{voiceError}</p>}
    {lastApproximate && (
      <p className="text-xs text-amber-600">
        Approximate transcription (couldn&apos;t reach the service).
      </p>
    )}
    ```
    为何在此：`startMicSession` catch 会关掉 voiceMode（回到文本分支），且文本模式 mic 的错误也在文本分支——放 ternary 外才都可见。忠实发送时 `stopAndSend` 已 `setVoiceError(null)` + `setLastApproximate(false)` 清除。
- [ ] **Step 10:** `tsc --noEmit` + `eslint app/conversation/[id]/page.tsx` 清（保持分支 0 error；若有 pre-existing 无关告警如实记录）。**推理核对（写进 report）**：
  - bug1 回声回路：`speakAndResumeListening` 在 `await speak()`（C1 awaitable）后才 `startMicSession`；`startMicSession` 首行 `if (isSpeakingRef.current) return` 双保险。
  - bug3 权限死循环：`startRecording()` 拒绝 → catch → 提示 + 关 voiceMode，**无 setTimeout 重试**。
  - bug4 字幕覆盖：无连续识别、无 `accumulated`/onend 重启；一次录音一次转写。
  - `[Start the conversation]`：`toggleVoiceMode` 打开且 `messages.length === 0` 分支不变（发送触发词，AI 开场 → autoplay → speakAndResumeListening → startMicSession）。
- [ ] **Step 11:** Commit `refactor(conversation): voice mode → whisper record/transcribe + mutex fixes (echo/perm/overwrite)`.

### Task 2: read-aloud 互斥（bug 2）+ 文本模式麦克风切 whisper

**Files:** Modify `app/conversation/[id]/page.tsx`

**Interfaces:**
- Consumes（Task 1 产出）：`micStatus`/`setMicStatus`、`sessionRef`、`startMicSession`、`speakAndResumeListening`、`voiceModeRef`、`setVoiceError`、`setLastApproximate`。

- [ ] **Step 1: read-aloud 互斥（bug 2）。** 现状 `handleSpeak`（约 434-436 行）`void speak(text)` 无互斥 —— 语音模式录音中点消息喇叭会把 TTS 播进 live mic。改：
    ```ts
    const handleSpeak = async (text: string): Promise<void> => {
      if (voiceModeRef.current) {
        // Ignore read-aloud taps while TTS is already playing or a transcript
        // is in flight: replaying would churn sessionRef and overlap speak()
        // (M1). The user can re-tap once we return to Recording/Ready.
        if (isSpeakingRef.current || micStatus === "transcribing") return;
        // Voice mode: stop any live recording first so TTS is not captured,
        // then play through the speaking mutex and resume recording after.
        sessionRef.current?.cancel();
        sessionRef.current = null;
        setMicStatus("idle");
        await speakAndResumeListening(text);
      } else {
        await speak(text);
      }
    };
    ```
    UI 调用点（约 607 行 `onClick={() => handleSpeak(text)}`）改为 `onClick={() => void handleSpeak(text)}`（返回 Promise，避免 no-misused-promises）。
- [ ] **Step 2: 文本模式麦克风切 whisper（`handleToggleVoiceInput`，约 440-481 行）。** 现状用连续 SpeechRecognition 填 `input`（同样会自动纠错，且是刚删掉的 `getSpeechRecognition`）。整体替换为录音→转写→填入（可编辑，不自动发送）：
    ```ts
    // Text-mode mic: record → whisper transcribe → append to the input box
    // (editable, not auto-sent). Same faithful-transcription path as voice mode.
    const handleToggleVoiceInput = async (): Promise<void> => {
      if (micStatus === "recording") {
        const session = sessionRef.current;
        sessionRef.current = null;
        setMicStatus("transcribing");
        try {
          const { text, approximate } = await (session
            ? session.stop()
            : Promise.resolve({ text: "", approximate: false }));
          setLastApproximate(approximate);
          const trimmed = text.trim();
          if (trimmed) setInput((prev) => (prev ? `${prev} ${trimmed}` : trimmed));
        } catch {
          setVoiceError("Couldn't reach transcription — please try again.");
        } finally {
          setMicStatus("idle");
        }
        return;
      }
      if (micStatus !== "idle") return;
      setVoiceError(null);
      try {
        const session = await startRecording();
        sessionRef.current = session;
        setMicStatus("recording");
      } catch {
        sessionRef.current = null;
        setMicStatus("idle");
        setVoiceError("Microphone unavailable (permission denied or unsupported).");
      }
    };
    ```
    需在顶部 import 补 `startRecording`（Task 1 已 import，确认在）。
- [ ] **Step 3: 文本模式 mic 按钮 UI（约 710-729 行）。** `variant`/pulse 由 `isRecording` → `micStatus === "recording"`；标签 "Recording..." → `micStatus === "transcribing" ? "Transcribing..." : "Recording..."`；`aria-label` 同理；`onClick={handleToggleVoiceInput}` → `onClick={() => void handleToggleVoiceInput()}`；录音/转写中禁用 Textarea 发送不受影响（保持 `disabled={isStreaming}`）。
- [ ] **Step 4:** `tsc --noEmit` + `eslint app/conversation/[id]/page.tsx` 清。**推理核对（写进 report）**：read-aloud 在 voiceMode 下先 cancel 录音再经互斥播放、播放后 resume；文本模式 mic 一次录音一次转写、权限拒绝不循环、填入可编辑不自动发送；无残留 `isRecording`/`liveTranscript`/`recognitionRef`/`getSpeechRecognition` 引用（grep 确认）。
- [ ] **Step 5:** Commit `refactor(conversation): read-aloud mutex + text-mode mic → whisper`.

---

## Self-Review（已执行）

- **覆盖**：spec §3（对话页 startVoiceRecording→录音/转写；record→Transcribing→忠实转写；[Start the conversation] 保留）、§4 全 4 bug（bug1 回声回路 = C1 根因 + 本页 await/`isSpeakingRef` 双保险；bug2 read-aloud 互斥 = Task 2 Step 1；bug3 权限死循环 = 改用 `startRecording` 抛错不重试，结构性消除；bug4 字幕覆盖 = 无连续重启，结构性消除）。listening shadowing 是 C3，不在此。
- **占位符**：所有 helper 与 UI 改动给出精确代码/精确删除目标与近似行号；无 TODO/占位。
- **类型一致性**：`micStatus` 枚举贯穿两 task；`RecordingSession`/`TranscribeResult` 来自 C1 `lib/speech.ts`；删除的 `isRecording`/`liveTranscript`/`recognitionRef`/本地 SR 类型/`getSpeechRecognition` 在两 task 内全部替换（Task 2 Step 4 grep 兜底）。
- **风险/取舍**：
  - UX 变化（如实告知用户）：语音模式从"实时字幕 + 手动 Send"变为"录音 → Stop → Transcribing… → 忠实转写自动发送"，有一次上传延迟、无实时中间字幕（忠实度 > 实时性，符合纠错教学目标，spec §2 已决策）。
  - `approximate`（whisper 失败回退）显式提示，不静默。
  - read-aloud 在录音中触发会丢弃当前录音（cancel 后播放再重录）——re-speak 是用户主动、且录音中回放旧消息属边缘交互，可接受；已注释说明。
  - 两 task 同文件顺序执行；Task 2 依赖 Task 1 的 helper（Produces 已列签名）。
- **验证**：`tsc --noEmit` + `eslint` + 逐 bug 代码走查；不起 dev server、不实操麦克风（录音/互斥靠对 C1 契约的推理核对）。C3 前不做 broad review（见 ledger：C 的 whole-branch review 延到 C3 后一次性覆盖 C1+C2+C3）。
