// components/listening/media-source.ts
// YouTube IFrame Player API wrapper for the listening three-stage flow.
// Per-sentence model (matches TTS semantics): play(startMs,endMs) plays one
// sentence and auto-pauses at endMs (or loops when abLoop is on). The current
// sentence highlight is driven by the caller's sentence index, NOT by time.

// Minimal local YT types — @types/youtube is intentionally not installed
// (no new dependencies). Only the members this file actually calls are typed.
interface YTOnStateChangeEvent {
  data: number;
}

interface YTPlayerEvents {
  onReady?: () => void;
  onStateChange?: (event: YTOnStateChangeEvent) => void;
}

interface YTPlayerOptions {
  videoId: string;
  events?: YTPlayerEvents;
}

interface YTPlayer {
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  getCurrentTime(): number;
  getPlaybackRate(): number;
  setPlaybackRate(rate: number): void;
  getAvailablePlaybackRates(): number[];
  destroy(): void;
}

interface YTPlayerCtor {
  new (containerId: string, options: YTPlayerOptions): YTPlayer;
}

interface YTNamespace {
  Player: YTPlayerCtor;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;

const loadIframeApi = (): Promise<void> => {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<void>((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return apiPromise;
};

export interface YouTubePlayerOpts {
  videoId: string;
  containerId: string; // iframe 挂载的 div id
}

export interface YouTubeMediaSource {
  /** Seek to startMs and play; auto-pause at endMs (or loop if abLoop). */
  play(startMs: number, endMs: number): void;
  pause(): void;
  seekTo(ms: number): void;
  /** Clamp to nearest available rate; returns actual applied rate. */
  setRate(rate: number): number;
  getRate(): number;
  getAvailableRates(): number[];
  /** Toggle AB-loop replay of the current sentence range. */
  setAbLoop(on: boolean): void;
  /** Subscribe to play/pause/ended state changes (for watchdog). */
  onStateChange(cb: (state: "playing" | "paused" | "ended") => void): () => void;
  /** Pause video, clear interval, destroy iframe. */
  destroy(): void;
}

export const createYouTubePlayer = (
  opts: YouTubePlayerOpts
): YouTubeMediaSource => {
  let player: YTPlayer | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let abLoop = false;
  let currentStartMs = 0;
  let currentEndMs = 0;
  const stateCbs = new Set<(s: "playing" | "paused" | "ended") => void>();
  const mapState = (data: number): "playing" | "paused" | "ended" =>
    data === 1 ? "playing" : data === 0 ? "ended" : "paused";

  // Player is constructed async after the API loads. Calls before ready are
  // queued by YT.Player itself; we guard play/seek with a ready check.
  void loadIframeApi().then(() => {
    if (!window.YT) return;
    player = new window.YT.Player(opts.containerId, {
      videoId: opts.videoId,
      events: {
        onStateChange: (e) => {
          stateCbs.forEach((cb) => cb(mapState(e.data)));
        },
        onReady: () => {
          // nothing — rate queried on demand
        },
      },
    });
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
      if (!player) return;
      const ms = (player.getCurrentTime?.() ?? 0) * 1000;
      if (ms >= currentEndMs) {
        if (abLoop) {
          player.seekTo?.(currentStartMs / 1000, true);
        } else {
          player.pauseVideo?.();
          clearPoll();
        }
      }
    }, 100);
  };

  return {
    play(startMs, endMs) {
      currentStartMs = startMs;
      currentEndMs = endMs;
      player?.seekTo?.(startMs / 1000, true);
      player?.playVideo?.();
      startPoll();
    },
    pause() {
      player?.pauseVideo?.();
      clearPoll();
    },
    seekTo(ms) {
      player?.seekTo?.(ms / 1000, true);
    },
    setRate(rate) {
      const avail = player?.getAvailablePlaybackRates?.() ?? [0.5, 1, 1.5, 2];
      const clamped = [...avail].sort(
        (a, b) => Math.abs(a - rate) - Math.abs(b - rate)
      )[0];
      player?.setPlaybackRate?.(clamped);
      return clamped;
    },
    getRate() {
      return player?.getPlaybackRate?.() ?? 1;
    },
    getAvailableRates() {
      return player?.getAvailablePlaybackRates?.() ?? [0.5, 1, 1.5, 2];
    },
    setAbLoop(on) {
      abLoop = on;
    },
    onStateChange(cb) {
      stateCbs.add(cb);
      return () => stateCbs.delete(cb);
    },
    destroy() {
      clearPoll();
      stateCbs.clear();
      player?.destroy?.();
      player = null;
    },
  };
};
