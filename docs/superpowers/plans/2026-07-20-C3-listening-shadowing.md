# 子项目 C / C3 · listening shadowing 切 whisper + 诚实内容准确度反馈 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把 listening 页 shadowing（跟读）的语音输入从一次性浏览器 `SpeechRecognition`（自动纠语法/纠词 → 让"跟读准确度"虚高、失真）切到 C1 的 `lib/speech.ts`（MediaRecorder 录音 → `/api/stt` whisper 忠实转写 → 回退），并把已有的 `diffWords(目标, 转写)` 对比**诚实命名为"内容/词匹配准确度"**（不宣称测发音——whisper 无 word-level confidence，见 C1 smoke-test），对 whisper 失败回退（`approximate`）显式标注可靠性下降。

**Architecture:** shadowing 的 `record()` 从"一次性识别自动停"改为"录音 → Stop → Transcribing… → 忠实转写 → diffWords 反馈"，用 `recStatus: "idle" | "recording" | "transcribing"` 状态机（对齐 C2 conversation 的 micStatus 模式）+ `sessionRef`。删除 listening 页顶部只服务 shadowing 的 `SpeechRecognition*` 类型 / `getSpeechRecognitionConstructor` / `startListening`。`diffWords` 内容对比与 `saveListeningExercise` 记账保持不变。dictation/comprehension/prediction（打字）不涉及。

**Tech Stack:** Next.js 16、React 19、TS strict、Web APIs（MediaRecorder/getUserMedia）、`lib/speech.ts`、`lib/tts.ts`。

## Global Constraints

- TS strict；纯本地；注释英文。
- 无测试框架：`tsc --noEmit` + `eslint`（分支现 0 error，保持）+ 推理核对 + 代码走查。不起 dev server、不实操麦克风。
- Git：每 task 提交；用户已授权所有 git 操作。commit 末尾附：
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SDA8JvMdjpqLaxXC7gLC9M
  ```

## 位置 & 依赖

子项目 C 的第三个（末个）plan。C1 已提供 `lib/speech.ts`；C2 已把 conversation 页切到 whisper（同款 recStatus/session 模式可参照 `app/conversation/[id]/page.tsx` 的 startMicSession/stopAndSend）。spec: `docs/superpowers/specs/2026-07-20-voice-whisper-design.md`（§3 listening shadowing 切 recordAndTranscribe；§5 发音/内容反馈——**不支持 word confidence → 内容准确度 + 诚实命名**）。C3 只改 `app/listening/page.tsx` 一个文件。

**C1 契约（消费，勿改 lib/speech.ts）：** `startRecording(): Promise<RecordingSession>`（getUserMedia+MediaRecorder；权限拒绝/不支持 throw，不重试）；`RecordingSession{ stop(): Promise<TranscribeResult>, cancel(): void }`；`TranscribeResult{ text: string, approximate: boolean }`（`approximate:true` = whisper 失败、走了 SpeechRecognition 近似回退，转写已被浏览器纠正、对跟读准确度不可靠）；`isRecordingSupported(): boolean`。

**现状事实（listening 页）：**
- `startListening()`（约 88-102 行）：一次性 SpeechRecognition → `Promise<string>`，唯一消费者是 `ShadowingTab.record`。
- `getSpeechRecognitionConstructor()`（约 80-86 行）+ 其上 `SpeechRecognition*` 类型（约 62-78 行）：仅被 `startListening` 与 `ShadowingTab` 的 `speechSupported` 检测使用。
- `stripFences`（约 104 行起）：被 dictation/shadowing 生成复用 —— **保留**。
- `ShadowingTab`（约 769-995 行）：`generateSentences` 出 5 句；`record()`（约 818-843 行）`await startListening()` → `diffWords(currentSentence, text)` → `DiffResult{accuracy, original:[{word,correct,heardAs}]}` → 存 `saveListeningExercise("shadowing", …)`。UI：Record 按钮（`isRecording`）+ 结果卡（"{accuracy}% accuracy" + 词级红绿 + "You said: …"）。`diffWords`/`DiffResult`/`saveListeningExercise`/`callReview` 不改。

## File Structure

- `app/listening/page.tsx`（改，唯一文件）：删顶部 SR 类型/`getSpeechRecognitionConstructor`/`startListening`；import `lib/speech`；`ShadowingTab` 状态机 + record 流程 + UI 诚实命名 + approximate 提示。

---

## Phase 1 — shadowing whisper cutover + 诚实反馈（1 文件，1 task）

### Task 1: shadowing 切 recordAndTranscribe + 内容准确度诚实命名

**Files:** Modify `app/listening/page.tsx`

**Interfaces:**
- Consumes: `lib/speech.ts` 的 `startRecording`/`isRecordingSupported`/`RecordingSession`/`TranscribeResult`；现有 `speak`（`@/lib/tts`，已 import）、`diffWords`/`DiffResult`、`saveListeningExercise`、`dbHelpers`、`callReview`、`stripFences`、`parseShadowingSentences`（均现有，保留）。

- [ ] **Step 1: 删顶部一次性识别设施。** 删除约 62-102 行的 `SpeechRecognitionResultLike`/`SpeechRecognitionErrorLike`/`SpeechRecognitionLike` 接口、`SpeechRecognitionConstructor` type、`getSpeechRecognitionConstructor()`、`startListening()`。**保留** `stripFences`（约 104 行起）及其后所有内容。
- [ ] **Step 2: import。** 顶部增补 `import { startRecording, isRecordingSupported, type RecordingSession } from "@/lib/speech";`（`speak` 已从 `@/lib/tts` import，确认在）。
- [ ] **Step 3: `ShadowingTab` state 收敛。** 在组件内：
  - **删除**：`const [isRecording, setIsRecording] = useState(false);`。
  - **新增**：
    ```ts
    type RecStatus = "idle" | "recording" | "transcribing";
    const [recStatus, setRecStatus] = useState<RecStatus>("idle");
    const sessionRef = useRef<RecordingSession | null>(null);
    const [approximate, setApproximate] = useState(false); // last attempt used the SpeechRecognition fallback (auto-corrected → unreliable for a repeat check)
    ```
  - `speechSupported` 检测（约 783 行 `setSpeechSupported(Boolean(getSpeechRecognitionConstructor()))`）→ `setSpeechSupported(isRecordingSupported());`
  - `generateSentences` 的重置块（约 791-792 行 `setTranscript(null); setResult(null);`）后补 `setApproximate(false);`。
- [ ] **Step 3b: 卸载清理（防 mic 泄漏）。** `ShadowingTab` 渲染在 Base UI `Tabs.Panel` 内（`components/ui/tabs.tsx`，隐藏面板默认卸载）——录音中切走 tab 或离页会卸载组件，若不 cancel 会话则 `getUserMedia` 流 + MediaRecorder 常亮无法停止。加卸载清理（对齐 `app/conversation/[id]/page.tsx` 的卸载 effect）：
    ```ts
    useEffect(() => {
      return () => {
        sessionRef.current?.cancel();
        sessionRef.current = null;
      };
    }, []);
    ```
- [ ] **Step 4: 用 start/stop 取代一次性 `record()`（约 818-843 行整体替换）。**
    ```ts
    const startAttempt = async (): Promise<void> => {
      setError(null);
      setTranscript(null);
      setResult(null);
      setApproximate(false);
      try {
        const session = await startRecording();
        sessionRef.current = session;
        setRecStatus("recording");
      } catch {
        sessionRef.current = null;
        setRecStatus("idle");
        setError("Microphone unavailable (permission denied or unsupported).");
      }
    };

    // Stop recording → faithful whisper transcript → word-match feedback.
    const stopAttempt = async (): Promise<void> => {
      const session = sessionRef.current;
      if (!session || recStatus !== "recording") return;
      sessionRef.current = null;
      setRecStatus("transcribing");
      try {
        const { text, approximate: approx } = await session.stop();
        const said = text.trim();
        if (!said) {
          setError("Didn't catch that — try recording again.");
          return;
        }
        setTranscript(said);
        setApproximate(approx);
        const shadowResult = diffWords(currentSentence, said);
        setResult(shadowResult);
        await dbHelpers.updateStreak();
        await dbHelpers.incrementTodayStat("listeningCount");
        await saveListeningExercise(
          "shadowing",
          currentSentence,
          said,
          shadowResult.accuracy
        );
      } catch {
        setError("Couldn't reach transcription — please try again.");
      } finally {
        setRecStatus((s) => (s === "transcribing" ? "idle" : s));
      }
    };
    ```
- [ ] **Step 5: `nextSentence`（约 845-853 行）重置补 `setApproximate(false);`**（与 `setTranscript(null); setResult(null);` 并列）。
- [ ] **Step 6: 录音按钮（约 918-936 行）改为 recStatus 三态。**
    ```tsx
    <Button
      size="lg"
      variant={recStatus === "recording" ? "destructive" : "default"}
      className="w-full min-h-[44px]"
      onClick={() =>
        recStatus === "recording" ? void stopAttempt() : void startAttempt()
      }
      disabled={!speechSupported || recStatus === "transcribing"}
    >
      {recStatus === "recording" ? (
        <>
          <Square className="h-4 w-4" />
          Stop &amp; Check
        </>
      ) : recStatus === "transcribing" ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Transcribing...
        </>
      ) : (
        <>
          <Mic className="h-4 w-4" />
          Record My Attempt
        </>
      )}
    </Button>
    ```
    **`Square` 当前未在 lucide-react import 中（现有为 Ear/Headphones/Loader2/Mic/Play/RotateCcw/Sparkles/Turtle）——必须把 `Square` 加进该 import 列表。** `Mic`/`Loader2` 已在用。
- [ ] **Step 6b: 门控 "Next Sentence"（约 986-994 行）防录音中前进泄漏 mic。** 底部 Next Sentence 按钮当前 `disabled={isLoading}` —— 录音/转写中前进会切句、留下未取消的活录音且与展示句失步。改为 `disabled={isLoading || recStatus !== "idle"}`（录音/转写中禁用；`ExerciseCompletionActions` 的 Try Another 仅在有 result 即 idle 时出现，无需改）。
- [ ] **Step 7: 结果卡诚实命名 + approximate 提示（约 942-978 行）。**
  - Badge 文案 `{result.accuracy}% accuracy` → `{result.accuracy}% word match`（诚实：measures 词匹配而非发音）。
  - 在 "You said: …"（约 973-975 行）下方补一行诚实说明：
    ```tsx
    <p className="text-xs text-muted-foreground">
      Word match against the target — not a pronunciation score.
    </p>
    ```
  - approximate 提示：在结果卡内（或紧邻）当 `approximate` 为真时显示：
    ```tsx
    {approximate && (
      <p className="text-xs text-muted-foreground">
        Approximate transcription (service unavailable) — this used an
        auto-corrected fallback, so the word match may read higher than reality.
      </p>
    )}
    ```
- [ ] **Step 8: not-supported 提示文案（约 863-870 行）。** 现文案专指 SpeechRecognition；改为覆盖录音整体。**该文案是 `<AlertDescription>` 内的 JSX 文本节点，仓库启用 `react/no-unescaped-entities`（见全库 `&apos;` 用法）—— 不要用裸 `'`。** 用不含撇号的措辞：`Recording is not supported in this browser. Try a recent Chrome, Safari, or Firefox.`（`speechSupported` 现由 `isRecordingSupported()` 驱动 —— 只有 MediaRecorder 与 SpeechRecognition 都不可用才为假）。
- [ ] **Step 9:** `tsc --noEmit` + `eslint app/listening/page.tsx` 清（保持 0 error；pre-existing 无关告警如实记）。**推理核对（写进 report）**：
  - cutover：无 `startListening`/`getSpeechRecognitionConstructor`/SR 类型残留引用（grep 确认）；`record` 旧函数已被 start/stop 取代且无悬空调用。
  - STT 忠实：whisper 成功 = 忠实转写（`approximate:false`）；失败 = SpeechRecognition 近似回退（`approximate:true`）显式标注可靠性下降，不静默。
  - 状态机：startAttempt 权限拒绝 catch → error + idle，**无重试循环**；stopAttempt 三出口（空转写 / 成功 / 抛错）下 `recStatus` 经守卫式 `finally` 收敛（空转写与抛错回 idle，成功也回 idle）；`sessionRef` 复用前置 null，无双会话；一次录音一次转写。
  - 诚实命名：Badge "word match" + 说明行 + approximate 提示落实 spec §5"不宣称测发音"。
  - diffWords/saveListeningExercise 记账未变（module "shadowing"，accuracy 仍存）。
- [ ] **Step 10:** Commit `refactor(listening): shadowing → whisper record/transcribe + honest word-match feedback`.

---

## Self-Review（已执行）

- **覆盖**：spec §3（listening shadowing 唯一消费者 `startListening` → recordAndTranscribe；prediction/dictation/comprehension 打字不涉及）、§5（whisper 无 word confidence → 用忠实转写 vs 目标的内容/词匹配对比 + 诚实命名"word match，非发音"；approximate 回退显式标注）。
- **占位符**：state/helper/UI 均给精确代码与近似行号；无 TODO。
- **类型一致性**：`RecStatus` 枚举贯穿；`RecordingSession`/`TranscribeResult` 来自 C1；删除的 SR 类型/`getSpeechRecognitionConstructor`/`startListening`/`isRecording` 全部在本 task 内替换（Step 9 grep 兜底）。`diffWords`/`DiffResult`/`saveListeningExercise` 签名不变。
- **风险/取舍**：
  - UX 变化：录音从"一次性自动停"变为"Record → Stop & Check → Transcribing… → 反馈"，一次上传延迟；符合忠实度优先。
  - approximate（whisper 失败回退）转写已被浏览器纠正 → 词匹配虚高；已显式提示，不静默、不宣称准确。
  - whisper 对非词的规范化（C1 smoke-test：goed→go）意味着词匹配仍非完美发音信号——诚实命名"word match, not a pronunciation score"正是为此。
  - **有意识取舍**：`approximate`（回退）尝试仍会 `saveListeningExercise` 存 accuracy 且 DB 无 approximate 字段（History/stats 处看不到回退警示）。加字段需动 `lib/db`（超出 C3 单文件范围），且与 C2 先例一致（C2 也未在持久层标记 approximate）。in-session UI 已诚实提示，持久层不标记为本轮明确接受项，非静默遗漏。
  - 单文件单 task；改动集中在 `ShadowingTab` + 顶部删除。
- **验证**：`tsc` + `eslint` + 代码走查；不起 dev server、不实操麦克风。C3 完成后做 **C 整体 broad whole-branch review**（覆盖 C1+C2+C3，见 ledger 决策）。
