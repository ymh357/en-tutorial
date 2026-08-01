// components/listening/audio-source.ts
// HTMLAudioElement wrapper for the listening three-stage flow. Same per-
// sentence contract as YouTubeMediaSource (play/pause/seek/setRate/AB-loop/
// onStateChange/onReady) so shadowing-tab can treat video and audio through
// one MediaSource ref. Used by W4-T2 (authentic audio materials uploaded via
// @vercel/blob). The <audio> element is detached (sound only — no video frame
// to render), which is fine because the three-stage flow drives playback from
// sentence indices, not from an on-screen player.

import type { MediaSource } from "@/components/listening/media-source";

export interface AudioPlayerOpts {
  /** Public URL of the audio file (e.g. a @vercel/blob upload URL). */
  src: string;
}

const STANDARD_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

export const createAudioPlayer = (opts: AudioPlayerOpts): MediaSource => {
  const audio = new Audio();
  audio.src = opts.src;

  // Load metadata so seeking to a startMs is possible before play.
  audio.load();

  const stateCbs = new Set<(s: "playing" | "paused" | "ended") => void>();
  const onReadyCbs = new Set<() => void>();
  const onErrorCbs = new Set<(message: string) => void>();
  let rafId: number | null = null;
  let abLoop = false;
  let currentStartMs = 0;
  let currentEndMs = 0;
  let pendingPlay: { startMs: number } | null = null;
  let ready = false;
  let failed = false;
  let destroyed = false;

  const mapAudioEvent = (
    type: string
  ): "playing" | "paused" | "ended" | null =>
    type === "play" ? "playing" : type === "pause" ? "paused" : type === "ended" ? "ended" : null;

  audio.addEventListener("loadedmetadata", () => {
    if (ready || destroyed) return;
    ready = true;
    onReadyCbs.forEach((cb) => cb());
    // If play() was already called in the user's gesture (before metadata was
    // ready), playback has started but currentTime couldn't be set to startMs
    // yet — seek now to the sentence start so the clip plays from the right
    // point. (playInternal deferred the seek with `if (ready)`.)
    if (pendingPlay && !destroyed) {
      const { startMs } = pendingPlay;
      pendingPlay = null;
      audio.currentTime = startMs / 1000;
    }
  });
  // Audio is a detached <audio> (sound only — no visible error frame like
  // YouTube's iframe), so a load failure (blob URL dead/token removed/file
  // corrupt/CORS) would otherwise leave ready=false forever: onReady never
  // fires, pendingPlay queues endlessly, the play button does nothing and
  // listensCount still increments — a silent dead end. Surface it via onError
  // so the caller can setError (review [重要]).
  audio.addEventListener("error", () => {
    if (destroyed) return;
    failed = true;
    pendingPlay = null;
    clearPoll();
    const err = audio.error;
    const msg =
      err?.code === 4
        ? "音频加载失败（URL 失效或网络错误）"
        : err?.code === 3
          ? "音频解码失败（文件可能损坏）"
          : "音频加载失败";
    onErrorCbs.forEach((cb) => cb(msg));
  });
  audio.addEventListener("play", () => {
    const s = mapAudioEvent("play");
    if (s) stateCbs.forEach((cb) => cb(s));
  });
  audio.addEventListener("pause", () => {
    const s = mapAudioEvent("pause");
    if (s) stateCbs.forEach((cb) => cb(s));
  });
  audio.addEventListener("ended", () => {
    const s = mapAudioEvent("ended");
    if (s) stateCbs.forEach((cb) => cb(s));
    clearPoll();
  });

  const clearPoll = (): void => {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };
  const startPoll = (): void => {
    clearPoll();
    // requestAnimationFrame (~16ms) vs setInterval(100ms): HTML5 audio
    // currentTime is continuously readable, so frame-level polling pauses
    // within ~16ms of currentEndMs (vs 0-100ms) — short next-sentence words
    // no longer get dragged in at clip end.
    const tick = (): void => {
      const ms = audio.currentTime * 1000;
      if (ms >= currentEndMs) {
        if (abLoop) {
          // Seek back to the sentence start WITHOUT pausing — the element is
          // already in the playing state, so it keeps playing from startMs with
          // no second play() call. Calling play() here would run outside any
          // user gesture (rAF callback) and be rejected by the autoplay
          // policy, breaking the loop.
          audio.currentTime = currentStartMs / 1000;
          rafId = requestAnimationFrame(tick);
        } else {
          audio.pause();
          clearPoll();
          return;
        }
      } else {
        rafId = requestAnimationFrame(tick);
      }
    };
    rafId = requestAnimationFrame(tick);
  };

  // Requires metadata ready (currentTime is settable only once duration is known).
  const playInternal = (startMs: number, endMs: number): void => {
    currentStartMs = startMs;
    currentEndMs = endMs;
    if (ready) audio.currentTime = startMs / 1000;
    // autoplay policy: play() must run in the user-gesture call stack when
    // possible. The pendingPlay flush from loadedmetadata is NOT a gesture, so
    // browsers reject it — therefore play() always kicks off play() here in the
    // caller's gesture, and if metadata isn't ready yet the loadedmetadata
    // handler re-seeks to startMs. Log rejections for diagnosis.
    void audio.play().catch((e) => {
      console.warn("audio play() rejected (autoplay policy?)", e);
    });
    startPoll();
  };

  return {
    play(startMs, endMs) {
      // If the media failed to load, don't queue/play and don't let the caller
      // count a listen (C2-class: a guarded action that fails silently while
      // side effects accumulate). The error is already surfaced via onError.
      if (failed) return;
      // Always attempt playback in the caller's (user-gesture) call stack —
      // HTMLAudioElement.play() can start before loadedmetadata, and the
      // autoplay policy only allows it within a gesture. The earlier design
      // queued pendingPlay and flushed from the loadedmetadata callback (not a
      // gesture), so the browser rejected play() and the learner heard nothing
      // (A1 audio test: 8s watchdog nudge fired because playback never started).
      // If metadata isn't ready, the loadedmetadata handler re-seeks to startMs.
      // Only startMs is needed for the deferred seek; endMs is applied
      // synchronously by playInternal (currentEndMs) at call time.
      pendingPlay = ready ? null : { startMs };
      playInternal(startMs, endMs);
    },
    pause() {
      pendingPlay = null;
      audio.pause();
      clearPoll();
    },
    seekTo(ms) {
      if (ready) audio.currentTime = ms / 1000;
    },
    setRate(rate) {
      // HTMLAudioElement supports arbitrary 0.5-2x; clamp to the standard grid
      // so the rate buttons and getAvailableRates stay consistent.
      const clamped = [...STANDARD_RATES].sort(
        (a, b) => Math.abs(a - rate) - Math.abs(b - rate)
      )[0];
      audio.playbackRate = clamped;
      return clamped;
    },
    getAvailableRates() {
      return [...STANDARD_RATES];
    },
    setAbLoop(on) {
      abLoop = on;
    },
    onStateChange(cb) {
      stateCbs.add(cb);
      return () => stateCbs.delete(cb);
    },
    onReady(cb) {
      onReadyCbs.add(cb);
      // If metadata already loaded (e.g. cached), fire immediately.
      if (ready) cb();
      return () => onReadyCbs.delete(cb);
    },
    onError(cb) {
      onErrorCbs.add(cb);
      // If the error already fired before subscription, surface it now.
      if (failed) cb("音频加载失败");
      return () => onErrorCbs.delete(cb);
    },
    destroy() {
      destroyed = true;
      pendingPlay = null;
      clearPoll();
      stateCbs.clear();
      onReadyCbs.clear();
      onErrorCbs.clear();
      audio.pause();
      audio.src = "";
      audio.removeAttribute("src");
      // Explicitly abort any in-flight media fetch — setting src="" alone
      // doesn't fully release the network connection on every browser until
      // load() is called (review [次要]).
      audio.load();
    },
  };
};
