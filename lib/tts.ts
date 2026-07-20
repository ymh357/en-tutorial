// Client-side TTS helper. Uses the Edge TTS neural voice API (/api/tts),
// falling back to browser speechSynthesis if the request fails.

let currentAudio: HTMLAudioElement | null = null;
// Resolver for the in-flight primary-audio playback promise below. pause()
// fires neither onended nor onerror, so stopSpeaking() calls this directly
// to settle any speak() call currently awaiting playback -- otherwise the
// awaiter (and its caller's mic-resume logic) would hang forever.
let resolveCurrent: (() => void) | null = null;
// Monotonic token identifying the most recent playback request (single speak()
// OR a whole speakStream() run). stopSpeaking() bumps it; any streaming loop
// checks it after every await and bails the moment it no longer owns playback,
// so a stop() (or a newer speak call) can't leave an orphaned queue playing.
let playbackToken = 0;

// Fetches one chunk's audio from /api/tts. Returns null on any non-OK
// response so the caller can decide whether to fall back (single speak) or
// skip the chunk (streaming, where one bad sentence shouldn't abort the rest).
const fetchTtsBlob = async (text: string, rate?: string): Promise<Blob | null> => {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, rate }),
  });
  if (!res.ok) return null;
  return res.blob();
};

// Plays one already-fetched audio blob to completion. Shared by speak() and
// speakStream() so both settle identically on end / error / stopSpeaking().
// Rejects only on genuine playback failure; a stopSpeaking()-triggered settle
// resolves (the caller treats an interrupted chunk as "done, move on / stop").
const playBlob = (blob: Blob): Promise<void> => {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  currentAudio = audio;
  return new Promise<void>((resolve, reject) => {
    resolveCurrent = () => {
      URL.revokeObjectURL(url);
      currentAudio = null;
      resolveCurrent = null;
      resolve();
    };
    audio.onended = () => resolveCurrent?.();
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      currentAudio = null;
      resolveCurrent = null;
      reject(new Error("Audio playback failed"));
    };
    audio.play().catch(reject);
  });
};

export const speak = async (text: string, rate?: string): Promise<void> => {
  // A fresh speak() interrupts any prior one; reuse stopSpeaking() (rather
  // than duplicating the pause + resolveCurrent settle logic here) so the
  // interrupted call settles exactly the same way an explicit stop would.
  stopSpeaking();

  try {
    const blob = await fetchTtsBlob(text, rate);
    if (!blob) {
      await fallbackSpeak(text, rate);
      return;
    }
    await playBlob(blob);
  } catch {
    await fallbackSpeak(text, rate);
  }
};

// Splits assistant text into speakable chunks on sentence boundaries. Keeps
// the terminating punctuation, collapses whitespace, and never splits inside
// common abbreviations that would otherwise fragment mid-sentence (e.g.
// "Mr. Lee", "e.g. this"). A chunk that still exceeds the API's practical
// length is fine -- the server accepts up to MAX_TEXT_LENGTH; the goal here is
// low first-audio latency, not hard length capping.
const ABBREVIATIONS = /\b(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e)$/i;

export const splitIntoSentences = (text: string): string[] => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  let start = 0;
  // Walk sentence-ending punctuation followed by whitespace; only cut when
  // the token before the punctuation isn't a known abbreviation.
  const boundary = /([.!?])\s+/g;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(normalized)) !== null) {
    const candidate = normalized.slice(start, match.index + 1);
    if (ABBREVIATIONS.test(candidate.slice(0, -1).trimEnd())) continue;
    chunks.push(candidate.trim());
    start = boundary.lastIndex;
  }
  const tail = normalized.slice(start).trim();
  if (tail) chunks.push(tail);
  return chunks;
};

// Speaks text sentence-by-sentence to minimize first-audio latency: the first
// sentence starts playing as soon as ITS audio arrives, while later sentences
// are prefetched during playback. Resolves only after the whole passage has
// played (or was stopped), preserving speak()'s "await until fully spoken"
// contract that callers rely on before resuming the mic.
//
// Interruption-safe: captures a playbackToken up front and re-checks it after
// every await, so a stopSpeaking() (or a newer speak/speakStream) makes this
// loop abandon its remaining queue instead of playing over the new audio.
export const speakStream = async (text: string, rate?: string): Promise<void> => {
  stopSpeaking();
  const token = playbackToken;

  const sentences = splitIntoSentences(text);
  if (sentences.length === 0) return;
  // Single sentence: no pipelining to gain -- defer to speak() so the fallback
  // path (browser speechSynthesis on API failure) still applies.
  if (sentences.length === 1) {
    // stopSpeaking() above already bumped the token; speak() bumps it again
    // via its own stopSpeaking(), which is harmless here (we don't loop).
    await speak(sentences[0], rate);
    return;
  }

  // Prefetch pipeline: request sentence N+1 while sentence N plays. Each slot
  // holds an in-flight (or resolved) blob promise. A rejected/empty fetch
  // becomes null and that sentence is simply skipped (no audio), rather than
  // aborting the whole passage.
  const fetches: Array<Promise<Blob | null>> = sentences.map((s) =>
    fetchTtsBlob(s, rate).catch(() => null)
  );

  for (let i = 0; i < sentences.length; i++) {
    const blob = await fetches[i];
    // Ownership check after the await: a stop or newer request happened.
    if (token !== playbackToken) return;
    if (!blob) continue; // this sentence failed to synthesize; skip it
    try {
      await playBlob(blob);
    } catch {
      // Playback failure on one sentence shouldn't kill the rest.
    }
    if (token !== playbackToken) return;
  }
};

export const stopSpeaking = (): void => {
  // Invalidate any in-flight speakStream loop: after its next await it will
  // see the token changed and abandon its remaining queue instead of playing
  // over whatever comes next.
  playbackToken++;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  resolveCurrent?.(); // settle any pending speak() so awaiters don't hang
  resolveCurrent = null;
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel(); // fallback path settles via utterance onend (C1)
  }
};

// Parse an Edge-TTS rate string ("-30%", "+0%") into a SpeechSynthesisUtterance
// rate (1 = normal speed). Defaults to 1 when absent or unparseable.
const parseUtteranceRate = (rate?: string): number => {
  if (!rate) return 1;
  const match = rate.match(/^([+-]?\d+(?:\.\d+)?)%$/);
  if (!match) return 1;
  return Math.min(10, Math.max(0.1, 1 + Number(match[1]) / 100));
};

// Resolves only when the fallback utterance finishes (or errors), so a caller
// awaiting speak() never resumes the mic while this audio is still playing.
// A timeout is a mandatory safety net: Chromium has documented bugs where
// speechSynthesis.cancel() or longer utterances fail to fire onend/onerror,
// which would otherwise leave this promise — and the caller's mic — hung
// forever. It must outlast genuine playback or it would fire mid-speech and
// reopen the mic (the echo loop this fix closes). Duration scales with both
// length AND rate: a slower rate lengthens playback proportionally (listening
// speaks a 100-150 word passage at -30%), so the estimate is divided by the
// applied rate; the 180s ceiling covers the longest fallback-spoken text at
// the slowest configured rate.
const fallbackSpeak = (text: string, rate?: string): Promise<void> => {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    return Promise.resolve();
  }
  window.speechSynthesis.cancel();
  const utteranceRate = parseUtteranceRate(rate);
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timeoutMs = Math.min(180000, (5000 + text.length * 120) / utteranceRate);
    const timer = setTimeout(finish, timeoutMs);
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.rate = utteranceRate;
      utterance.onend = finish;
      utterance.onerror = finish;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Synchronous throw (malformed utterance): settle rather than reject, so
      // the !res.ok call site does not fall through to speak()'s outer catch
      // and invoke fallbackSpeak a second time.
      finish();
    }
  });
};
