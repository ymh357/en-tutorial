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
  width?: string | number;
  height?: string | number;
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
  // YT.Player accepts either an element or its id as the first argument.
  new (element: HTMLElement | string, options: YTPlayerOptions): YTPlayer;
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
  // React-owned wrapper element. The player mounts INSIDE it as a non-React
  // child: we create a fresh <div> and let YT.Player replace that div with its
  // iframe. Because React never owns the mount div (it is created and appended
  // imperatively here, not declared in JSX), React's reconciliation cannot
  // collide with YT's DOM takeover — the wrapper's stage-driven className stays
  // on the React-owned element and is never smeared onto the iframe.
  host: HTMLElement;
}

export interface YouTubeMediaSource {
  /** Seek to startMs and play; auto-pause at endMs (or loop if abLoop). */
  play(startMs: number, endMs: number): void;
  pause(): void;
  seekTo(ms: number): void;
  /** Clamp to nearest available rate; returns actual applied rate, or null if
   * the player isn't ready yet (caller should keep the user's selection). */
  setRate(rate: number): number | null;
  getRate(): number;
  getAvailableRates(): number[];
  /** Toggle AB-loop replay of the current sentence range. */
  setAbLoop(on: boolean): void;
  /** Subscribe to play/pause/ended state changes (for watchdog). */
  onStateChange(cb: (state: "playing" | "paused" | "ended") => void): () => void;
  /** Fire once when the player is ready — the earliest point
   * getAvailableRates() reflects the actual video. */
  onReady(cb: () => void): () => void;
  /** Pause video, clear interval, destroy iframe, remove mount node. */
  destroy(): void;
}

export const createYouTubePlayer = (
  opts: YouTubePlayerOpts
): YouTubeMediaSource => {
  const { host, videoId } = opts;
  let player: YTPlayer | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let abLoop = false;
  let currentStartMs = 0;
  let currentEndMs = 0;
  // play() calls issued before the async player is ready are queued here and
  // flushed from onReady — otherwise the most common call pattern (play()
  // immediately after construction) would be silently dropped.
  let pendingPlay: { startMs: number; endMs: number } | null = null;
  const stateCbs = new Set<(s: "playing" | "paused" | "ended") => void>();
  const onReadyCbs = new Set<() => void>();
  // -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued.
  // Buffering/unstarted/cued are transient, non-user-initiated states that
  // are neither "playing" nor a real "paused" — surfacing them as "paused"
  // would make a watchdog mistake a network stall for a user pause, so we
  // return null for those and skip notifying subscribers entirely.
  const mapState = (data: number): "playing" | "paused" | "ended" | null =>
    data === 1 ? "playing" : data === 0 ? "ended" : data === 2 ? "paused" : null;

  // The mount <div> is created imperatively and handed to YT.Player, which
  // REPLACES it with an <iframe>. Retain a ref so destroy() can clean up the
  // iframe (via player.destroy) and any leftover mount node if YT itself fails
  // to remove it.
  let mountNode: HTMLDivElement | null = null;

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

  // Shared logic for both the public play() and the flushed pendingPlay —
  // requires `player` to be non-null (caller must check).
  const playInternal = (startMs: number, endMs: number): void => {
    currentStartMs = startMs;
    currentEndMs = endMs;
    player?.seekTo?.(startMs / 1000, true);
    player?.playVideo?.();
    startPoll();
  };

  // Player is constructed async after the API loads. Calls before ready are
  // queued by YT.Player itself; we guard play/seek with a ready check.
  // `destroyed` guards against the React StrictMode double-invoke case: if
  // destroy() runs before this .then() resolves (mount→unmount within the
  // API-load window), we must not construct a player nobody will ever clean
  // up — and we must not append a mount node to a host whose effect already
  // cleaned up.
  let destroyed = false;
  void loadIframeApi().then(() => {
    if (!window.YT || destroyed) return;
    const mount = document.createElement("div");
    host.appendChild(mount);
    mountNode = mount;
    player = new window.YT.Player(mount, {
      videoId,
      width: "100%",
      height: "100%",
      events: {
        onStateChange: (e) => {
          const mapped = mapState(e.data);
          if (mapped === null) return;
          stateCbs.forEach((cb) => cb(mapped));
        },
        onReady: () => {
          // Fire readiness subscribers BEFORE flushing pendingPlay so callers
          // (shadowing-tab) can capture availableRates / sync the rate at the
          // earliest moment the video reflects them — onStateChange can lag or
          // (auto-play blocked / unavailable video) never arrive.
          onReadyCbs.forEach((cb) => cb());
          if (pendingPlay) {
            const { startMs, endMs } = pendingPlay;
            pendingPlay = null;
            playInternal(startMs, endMs);
          }
        },
      },
    });
  });

  return {
    play(startMs, endMs) {
      if (!player) {
        // Not ready yet — replace any earlier pending request (reentrancy:
        // a newer play() call supersedes a stale one that hasn't fired) and
        // clear any stale poll from a previous play() that did run.
        pendingPlay = { startMs, endMs };
        clearPoll();
        return;
      }
      pendingPlay = null;
      playInternal(startMs, endMs);
    },
    pause() {
      // Drop any queued play() that hasn't been flushed by onReady yet —
      // otherwise the player becoming ready later would auto-play, silently
      // overriding this pause() call.
      pendingPlay = null;
      player?.pauseVideo?.();
      clearPoll();
    },
    seekTo(ms) {
      player?.seekTo?.(ms / 1000, true);
    },
    setRate(rate) {
      if (!player) return null;
      const avail = player.getAvailablePlaybackRates?.() ?? [0.5, 1, 1.5, 2];
      const clamped = [...avail].sort(
        (a, b) => Math.abs(a - rate) - Math.abs(b - rate)
      )[0];
      player.setPlaybackRate?.(clamped);
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
    onReady(cb) {
      onReadyCbs.add(cb);
      return () => onReadyCbs.delete(cb);
    },
    destroy() {
      destroyed = true;
      pendingPlay = null;
      clearPoll();
      stateCbs.clear();
      onReadyCbs.clear();
      player?.destroy?.();
      player = null;
      // player.destroy() removes the iframe it created, but if construction
      // hadn't finished (or YT left the mount div behind), drop it manually.
      mountNode?.remove();
      mountNode = null;
    },
  };
};
