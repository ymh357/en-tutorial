// Client-side recording + transcription helper. Records the microphone via
// MediaRecorder and uploads the result to /api/stt (0G whisper-large-v3) for
// a faithful, uncorrected transcript -- the whole point of the whisper
// cutover being to stop SpeechRecognition's silent grammar auto-correction
// from defeating the app's error-review teaching loop.
//
// Fallback strategy (documented in the Phase 1 report): if the whisper
// upload fails (network error, non-2xx, or "STT not configured"), this
// falls back to a single live SpeechRecognition capture and marks the
// result `approximate: true`, per the "Whisper-primary with
// SpeechRecognition-fallback" recommendation in c-consumers.md §F. A
// recorded Blob cannot be replayed into SpeechRecognition -- it only
// listens to a live microphone stream -- so this fallback necessarily
// requires the user to speak again; callers should surface that (e.g. "we
// couldn't reach the transcription service, please repeat that").
// Never silent: whisper success is faithful (approximate: false); whisper
// failure is an explicit, flagged degradation, or a thrown error if even
// the fallback has nothing to recognize.
//
// Contract: a resolved TranscribeResult always carries a non-empty, trimmed
// transcript. "Nothing was recognized" is signalled by a rejection, never by
// an empty string -- callers that auto-resume recording depend on this to
// distinguish a retryable outcome from a deterministic dead end.

export interface TranscribeResult {
  text: string;
  approximate: boolean;
}

export interface RecordingSession {
  stop(): Promise<TranscribeResult>;
  cancel(): void;
}

// --- Minimal SpeechRecognition typings for the fallback path. Duplicated
// (rather than imported) because the existing declarations in
// app/conversation/[id]/page.tsx and app/listening/page.tsx are local to
// those files and not exported. ---
interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionResult {
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent {
  error: string;
}
interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

const getSpeechRecognitionCtor = (): (new () => SpeechRecognitionInstance) | undefined => {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

const hasMediaRecorder = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.MediaRecorder !== "undefined" &&
  typeof navigator !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia);

export const isRecordingSupported = (): boolean =>
  hasMediaRecorder() || Boolean(getSpeechRecognitionCtor());

// Runs a single live SpeechRecognition capture and resolves with whatever it
// hears. This is NOT a replay of the audio already recorded by MediaRecorder
// -- browsers cannot feed a Blob into SpeechRecognition -- so it opens a
// fresh microphone listen and requires the user to speak again.
const recognizeOnce = (): Promise<string> => {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    return Promise.reject(
      new Error("Speech recognition fallback is not supported in this browser")
    );
  }
  return new Promise<string>((resolve, reject) => {
    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      // An empty/whitespace transcript is NOT a usable result: resolving it
      // would hand callers a "successful" empty string, which the voice-mode
      // caller treats as "didn't catch that" and retries forever with no
      // state changed between attempts. Leave the promise unsettled and let
      // the onend handler below reject it as the no-result case it is.
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) resolve(transcript);
    };
    recognition.onerror = (event) => {
      reject(new Error(`Speech recognition fallback failed: ${event.error}`));
    };
    recognition.onend = () => {
      // onend always fires, including right after a successful onresult.
      // Settling twice is a no-op, so this is harmless in that case; when
      // the session ended with no usable result it is the only thing that
      // settles the promise, rejecting instead of hanging.
      reject(new Error("Speech recognition fallback ended with no result"));
    };
    try {
      recognition.start();
    } catch (error) {
      reject(
        error instanceof Error ? error : new Error("Failed to start speech recognition fallback")
      );
    }
  });
};

// A stalled network request would otherwise wedge stop() (and the page's
// "transcribing" state) forever with no way to reach the fallback path below.
const STT_TIMEOUT_MS = 40000;

// Uploads a recorded audio blob to /api/stt. Falls back to recognizeOnce()
// on any failure of the whisper path, including a client-side timeout.
const transcribe = async (blob: Blob): Promise<TranscribeResult> => {
  let whisperError: unknown;
  try {
    const formData = new FormData();
    formData.append("audio", blob, "recording");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STT_TIMEOUT_MS);
    try {
      const res = await fetch("/api/stt", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      const data = (await res.json()) as { text?: string; error?: string };

      if (!res.ok || data.error) {
        throw new Error(data.error ?? `STT request failed: ${res.status}`);
      }

      // A 2xx response carrying an empty transcript is a failure of the
      // whisper path, not a success with nothing in it -- returning "" here
      // would skip the fallback entirely and report approximate: false, so
      // the caller could not even tell the transcript was degraded. Throw so
      // the SpeechRecognition fallback below gets its turn.
      const whisperText = data.text?.trim();
      if (!whisperText) {
        throw new Error("STT returned an empty transcript");
      }

      return { text: whisperText, approximate: false };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    whisperError = error;
  }

  try {
    const text = await recognizeOnce();
    return { text, approximate: true };
  } catch (fallbackError) {
    // Both paths failed: don't let the fallback's error hide the whisper
    // upload's root cause (network error, non-2xx, misconfiguration).
    const whisperMessage =
      whisperError instanceof Error ? whisperError.message : String(whisperError);
    const fallbackMessage =
      fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
    throw new Error(
      `Transcription failed: ${fallbackMessage} (whisper upload also failed: ${whisperMessage})`,
      { cause: whisperError }
    );
  }
};

const PREFERRED_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

// Picks a broadly-compatible mimeType up front (Chrome/Firefox commonly
// support webm/opus, Safari mp4) so the recorded Blob's type is one the
// server's extension map (app/api/stt/route.ts) recognizes exactly.
const pickMimeType = (): string | undefined => {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined;
  }
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
};

// Mic constraints shared by recording and barge-in detection. echoCancellation
// is the load-bearing one for barge-in: with it on, Chrome's software AEC uses
// the default output device as its reference and cancels the TTS playback from
// the mic input, so the volume detector below reacts to the USER's voice, not
// the assistant's own audio leaking back in. noiseSuppression/autoGainControl
// further steady the signal. (Desktop Chrome; the app doesn't target mobile.)
const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

export const startRecording = async (): Promise<RecordingSession> => {
  if (!hasMediaRecorder()) {
    throw new Error("Recording is not supported in this browser");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
  } catch (error) {
    const name = error instanceof Error ? error.name : undefined;
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      throw new Error("microphone permission denied");
    }
    throw error instanceof Error ? error : new Error("Failed to access microphone");
  }

  const stopTracks = (): void => {
    stream.getTracks().forEach((track) => track.stop());
  };

  // Everything below acquires no new external resources, but MediaRecorder
  // construction/start() can still throw in some browsers (e.g. Safari's
  // audio-only MediaRecorder quirks pass the isTypeSupported check yet
  // reject on construction or start). If that happens after the mic stream
  // is already live, stop its tracks before rethrowing so the mic isn't
  // left on with no caller able to reach RecordingSession.cancel().
  try {
    const mimeType = pickMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    let settled = false;
    // Set only while a stop() promise is awaiting recorder.onstop, so
    // onerror can reject it directly instead of leaving it hanging.
    let pendingReject: ((reason: unknown) => void) | null = null;
    // Set once a device error fires, so any stop() call (in flight or
    // later) rejects with the real cause instead of the generic
    // "already stopped" message.
    let recordingError: Error | null = null;

    recorder.onerror = (event) => {
      const detail =
        event.error && typeof event.error.message === "string"
          ? event.error.message
          : "unknown recording error";
      const error = new Error(`Recording device error: ${detail}`);
      recordingError = error;
      if (pendingReject) {
        pendingReject(error);
        pendingReject = null;
      }
      if (!settled) {
        // onstop is not guaranteed to fire after an error in every browser,
        // so release the mic here rather than depending on it.
        settled = true;
        recorder.onstop = null;
        stopTracks();
      }
    };

    const stop = (): Promise<TranscribeResult> => {
      if (recordingError) {
        return Promise.reject(recordingError);
      }
      if (settled) {
        return Promise.reject(new Error("Recording session already stopped"));
      }
      settled = true;

      return new Promise<TranscribeResult>((resolve, reject) => {
        pendingReject = reject;
        recorder.onstop = () => {
          pendingReject = null;
          stopTracks();
          // Strip codec parameters (e.g. ";codecs=opus") so the assembled
          // Blob's type matches the server's extension map exactly rather
          // than falling through to its generic default.
          const bareMimeType = (recorder.mimeType || "audio/webm").split(";")[0];
          const blob = new Blob(chunks, { type: bareMimeType });
          transcribe(blob).then(resolve, reject);
        };
        recorder.stop();
      });
    };

    const cancel = (): void => {
      if (settled) return;
      settled = true;
      recorder.onstop = null;
      if (recorder.state !== "inactive") recorder.stop();
      stopTracks();
    };

    recorder.start();

    return { stop, cancel };
  } catch (error) {
    stopTracks();
    throw error;
  }
};

// Handle for an in-progress barge-in listen. cancel() tears down the mic
// stream + audio graph without firing the onset callback.
export interface SpeechOnsetListener {
  cancel: () => void;
}

const getAudioContextCtor = (): (new () => AudioContext) | undefined => {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext;
};

export const isSpeechOnsetSupported = (): boolean =>
  Boolean(getAudioContextCtor()) &&
  typeof navigator !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia);

// Barge-in detector. Opens its OWN short-lived AEC-enabled mic stream and
// watches input loudness; when the user speaks over the assistant, it fires
// onOnset ONCE and tears itself down. The caller then stops TTS and opens the
// real recording session.
//
// Why a separate stream rather than reading the recorder's: recording is off
// during playback by design, and this detector must live exactly for the
// playback window. It closes the instant it fires (or is cancelled), so the
// brief overlap with the subsequent startRecording() stream is bounded.
//
// Robustness choices:
// - RMS over the time-domain buffer, not a single sample, to gauge loudness.
// - Require ONSET_FRAMES consecutive above-threshold frames (~150ms) so a
//   click, a lip smack, or residual echo transient can't trigger a false
//   barge-in; sustained speech clears it easily.
// - echoCancellation removes most of the assistant's own playback from the
//   input, so the threshold reacts to the user, not the TTS.
const ONSET_RMS_THRESHOLD = 0.045; // empirical: speech clears it, AEC residual doesn't
const ONSET_FRAMES = 5; // consecutive above-threshold polls (~150ms at 30ms cadence)
const ONSET_POLL_MS = 30;

// Starts listening for the user speaking. Resolves to a listener handle once
// the mic is live (so the caller can cancel it), or null if barge-in is
// unsupported or the mic can't be opened (in which case playback just proceeds
// without barge-in rather than failing).
export const listenForSpeechOnset = async (
  onOnset: () => void
): Promise<SpeechOnsetListener | null> => {
  const Ctor = getAudioContextCtor();
  if (!Ctor || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return null;
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
  } catch {
    // Mic unavailable for detection: skip barge-in, don't break playback.
    return null;
  }

  let torn = false;
  let audioCtx: AudioContext | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const teardown = (): void => {
    if (torn) return;
    torn = true;
    if (timer !== null) clearInterval(timer);
    timer = null;
    stream.getTracks().forEach((t) => t.stop());
    // close() returns a promise; ignore it -- nothing awaits teardown.
    void audioCtx?.close();
    audioCtx = null;
  };

  try {
    audioCtx = new Ctor();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);

    let hot = 0;
    timer = setInterval(() => {
      if (torn || !audioCtx) return;
      analyser.getFloatTimeDomainData(buf);
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
      const rms = Math.sqrt(sumSq / buf.length);
      if (rms >= ONSET_RMS_THRESHOLD) {
        hot++;
        if (hot >= ONSET_FRAMES) {
          teardown();
          onOnset();
        }
      } else {
        hot = 0; // reset: onset must be SUSTAINED, not a single spike
      }
    }, ONSET_POLL_MS);
  } catch {
    // AudioContext graph failed to build: abandon barge-in cleanly.
    teardown();
    return null;
  }

  return { cancel: teardown };
};
