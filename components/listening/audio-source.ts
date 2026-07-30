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
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let abLoop = false;
  let currentStartMs = 0;
  let currentEndMs = 0;
  let pendingPlay: { startMs: number; endMs: number } | null = null;
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
    if (pendingPlay && !destroyed) {
      const { startMs, endMs } = pendingPlay;
      pendingPlay = null;
      playInternal(startMs, endMs);
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
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  };
  const startPoll = (): void => {
    clearPoll();
    pollInterval = setInterval(() => {
      const ms = audio.currentTime * 1000;
      if (ms >= currentEndMs) {
        if (abLoop) {
          audio.currentTime = currentStartMs / 1000;
          void audio.play().catch(() => {});
        } else {
          audio.pause();
          clearPoll();
        }
      }
    }, 100);
  };

  // Requires metadata ready (currentTime is settable only once duration is known).
  const playInternal = (startMs: number, endMs: number): void => {
    currentStartMs = startMs;
    currentEndMs = endMs;
    audio.currentTime = startMs / 1000;
    // Autoplay policy can reject play() when called outside a user gesture
    // (e.g. the pendingPlay flush from loadedmetadata, which isn't a gesture).
    // Log the rejection so it's diagnosable — don't surface as a hard error
    // since the user's own click-path goes through a gesture and works.
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
      if (!ready) {
        pendingPlay = { startMs, endMs };
        clearPoll();
        return;
      }
      pendingPlay = null;
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
    getRate() {
      return audio.playbackRate || 1;
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
