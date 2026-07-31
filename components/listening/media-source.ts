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
  onError?: (event: { data: number }) => void;
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
  getAvailableRates(): number[];
  /** Toggle AB-loop replay of the current sentence range. */
  setAbLoop(on: boolean): void;
  /** Subscribe to play/pause/ended state changes (for watchdog). */
  onStateChange(cb: (state: "playing" | "paused" | "ended") => void): () => void;
  /** Fire once when the player is ready — the earliest point
   * getAvailableRates() reflects the actual video. If already ready when
   * subscribed, fires immediately (matches audio-source's loadedmetadata
   * contract — no subscription-order race). */
  onReady(cb: () => void): () => void;
  /** Subscribe to load failures (blob URL dead, file corrupt, CORS, video
   * unavailable). The caller surfaces these so playback doesn't fail silently
   * (audio is a detached <audio> with no visible error frame like YouTube's). */
  onError(cb: (message: string) => void): () => void;
  /** Pause video, clear interval, destroy iframe, remove mount node. */
  destroy(): void;
}

// Generic media-source contract. YouTubeMediaSource (iframe, above) is one
// implementation; the audio player (HTMLAudioElement, audio-source.ts) is
// another. shadowing-tab持有 a single MediaSource ref regardless of mediaType.
export type MediaSource = YouTubeMediaSource;

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
  const onErrorCbs = new Set<(message: string) => void>();
  // Mirrors audio-source: a subscription after onReady already fired should
  // still run the callback once (no subscription-order race).
  let playerReady = false;
  // YT onError event data codes: 2 invalid param, 5 HTML5 error, 100 not
  // found/private, 101/150 embedding disabled. All surface as a load failure.
  const YT_ERROR_MESSAGES: Record<number, string> = {
    2: "视频参数无效",
    5: "视频播放器错误",
    100: "视频不存在或私密",
    101: "该视频禁止嵌入播放",
    150: "该视频禁止嵌入播放",
  };
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
          playerReady = true;
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
        onError: (e: { data: number }) => {
          // Video unavailable / embedding disabled / player error — surface so
          // the caller can setError instead of leaving the learner with a blank
          // iframe and a play button that does nothing.
          const msg = YT_ERROR_MESSAGES[e.data] ?? "视频加载失败";
          onErrorCbs.forEach((cb) => cb(msg));
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
      // If onReady already fired before this subscription, run it now — matches
      // audio-source's contract and removes a subscription-order race.
      if (playerReady) cb();
      return () => onReadyCbs.delete(cb);
    },
    onError(cb) {
      onErrorCbs.add(cb);
      return () => onErrorCbs.delete(cb);
    },
    destroy() {
      destroyed = true;
      pendingPlay = null;
      clearPoll();
      stateCbs.clear();
      onReadyCbs.clear();
      onErrorCbs.clear();
      player?.destroy?.();
      player = null;
      // player.destroy() removes the iframe it created, but if construction
      // hadn't finished (or YT left the mount div behind), drop it manually.
      mountNode?.remove();
      mountNode = null;
    },
  };
};

// Standard playback-rate grid (matches audio-source.ts) — HTMLVideoElement
// supports arbitrary rates, but clamping to this grid keeps the rate buttons
// and getAvailableRates consistent across all MediaSource implementations.
const STANDARD_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

export interface VideoPlayerOpts {
  /** Direct media URL (e.g. a resolved Bilibili playurl mp4 stream). */
  src: string;
  // React-owned wrapper element. Unlike createYouTubePlayer (which mounts a
  // non-React <div> that YT.Player replaces with an iframe), the <video>
  // element itself is appended directly into host — no intermediary mount
  // node is needed since we own the element outright.
  host: HTMLElement;
  // Bilibili's resolved mp4 stream URL expires after a short TTL. If a
  // playback error occurs, onExpired re-resolves a fresh signed URL so the
  // learner doesn't hit a dead player on a stale link. One retry only — a
  // second error after retrying is a real failure (network/CORS/corrupt
  // file), not an expired URL.
  onExpired?: () => Promise<string>;
}

// HTMLVideoElement wrapper — same per-sentence MediaSource contract as
// createAudioPlayer (audio-source.ts), but mounted visibly in `host` (a
// picture to render, unlike audio's detached element) and with an
// onExpired retry path for signed URLs that expire. The 100ms startPoll
// reads video.currentTime for AB-loop endMs — always readable on a media
// element, which is why this direct-<video> path works where embedding
// Bilibili's native iframe would not expose playback position.
export const createVideoPlayer = (opts: VideoPlayerOpts): MediaSource => {
  const video = document.createElement("video");
  video.src = opts.src;
  video.controls = true;
  opts.host.appendChild(video);
  video.load();

  const stateCbs = new Set<(s: "playing" | "paused" | "ended") => void>();
  const onReadyCbs = new Set<() => void>();
  const onErrorCbs = new Set<(message: string) => void>();
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let abLoop = false;
  let currentStartMs = 0;
  let currentEndMs = 0;
  let pendingPlay: { startMs: number } | null = null;
  let ready = false;
  let failed = false;
  let destroyed = false;
  // Guards the onExpired retry: only one re-resolve attempt per player
  // instance, and re-entry-safe if a second error event fires while the
  // first re-resolve is still in flight (fire-and-await, not fire-and-block).
  let retried = false;
  let retrying = false;

  const mapVideoEvent = (
    type: string
  ): "playing" | "paused" | "ended" | null =>
    type === "play" ? "playing" : type === "pause" ? "paused" : type === "ended" ? "ended" : null;

  video.addEventListener("loadedmetadata", () => {
    if (ready || destroyed) return;
    ready = true;
    onReadyCbs.forEach((cb) => cb());
    // Mirrors audio-source: if play() ran before metadata was ready, seek to
    // the queued startMs now (playInternal deferred the seek with `if (ready)`).
    if (pendingPlay && !destroyed) {
      const { startMs } = pendingPlay;
      pendingPlay = null;
      video.currentTime = startMs / 1000;
    }
  });
  video.addEventListener("error", () => {
    if (destroyed || retrying) return;
    // First error, with a re-resolver available and not yet retried this
    // session: attempt one fresh-URL retry instead of surfacing failure.
    if (opts.onExpired && !retried) {
      retried = true;
      retrying = true;
      // Reset ready so onReady re-fires once the fresh src's metadata loads —
      // the old src's playback position is meaningless for the new stream.
      ready = false;
      void opts.onExpired()
        .then((fresh) => {
          if (destroyed) return;
          video.src = fresh;
          video.load();
        })
        .catch(() => {
          if (destroyed) return;
          failed = true;
          pendingPlay = null;
          clearPoll();
          onErrorCbs.forEach((cb) => cb("视频加载失败（链接已失效）"));
        })
        .finally(() => {
          retrying = false;
        });
      return;
    }
    // Second error (already retried) or no onExpired configured — surface it.
    failed = true;
    pendingPlay = null;
    clearPoll();
    const err = video.error;
    const msg =
      err?.code === 4
        ? "视频加载失败（URL 失效或网络错误）"
        : err?.code === 3
          ? "视频解码失败（文件可能损坏）"
          : "视频加载失败";
    onErrorCbs.forEach((cb) => cb(msg));
  });
  video.addEventListener("play", () => {
    const s = mapVideoEvent("play");
    if (s) stateCbs.forEach((cb) => cb(s));
  });
  video.addEventListener("pause", () => {
    const s = mapVideoEvent("pause");
    if (s) stateCbs.forEach((cb) => cb(s));
  });
  video.addEventListener("ended", () => {
    const s = mapVideoEvent("ended");
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
      const ms = video.currentTime * 1000;
      if (ms >= currentEndMs) {
        if (abLoop) {
          // Seek back without pausing — element is already playing, so it
          // keeps playing from startMs with no second play() call. Calling
          // play() here would run outside any user gesture (setInterval
          // callback) and be rejected by the autoplay policy.
          video.currentTime = currentStartMs / 1000;
        } else {
          video.pause();
          clearPoll();
        }
      }
    }, 100);
  };

  // Requires metadata ready (currentTime is settable only once duration is known).
  const playInternal = (startMs: number, endMs: number): void => {
    currentStartMs = startMs;
    currentEndMs = endMs;
    if (ready) video.currentTime = startMs / 1000;
    // autoplay policy: play() must run in the user-gesture call stack when
    // possible — always kick off play() here in the caller's gesture; if
    // metadata isn't ready yet the loadedmetadata handler re-seeks to startMs.
    void video.play().catch((e) => {
      console.warn("video play() rejected (autoplay policy?)", e);
    });
    startPoll();
  };

  return {
    play(startMs, endMs) {
      // If the media failed to load (and no further retry is possible),
      // don't queue/play and don't let the caller count a listen. The error
      // is already surfaced via onError.
      if (failed) return;
      pendingPlay = ready ? null : { startMs };
      playInternal(startMs, endMs);
    },
    pause() {
      pendingPlay = null;
      video.pause();
      clearPoll();
    },
    seekTo(ms) {
      if (ready) video.currentTime = ms / 1000;
    },
    setRate(rate) {
      const clamped = [...STANDARD_RATES].sort(
        (a, b) => Math.abs(a - rate) - Math.abs(b - rate)
      )[0];
      video.playbackRate = clamped;
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
      if (failed) cb("视频加载失败");
      return () => onErrorCbs.delete(cb);
    },
    destroy() {
      destroyed = true;
      pendingPlay = null;
      clearPoll();
      stateCbs.clear();
      onReadyCbs.clear();
      onErrorCbs.clear();
      video.pause();
      video.src = "";
      video.removeAttribute("src");
      video.load();
      if (video.parentNode === opts.host) opts.host.removeChild(video);
    },
  };
};
