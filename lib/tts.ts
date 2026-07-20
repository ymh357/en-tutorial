// Client-side TTS helper. Uses the Edge TTS neural voice API (/api/tts),
// falling back to browser speechSynthesis if the request fails.

let currentAudio: HTMLAudioElement | null = null;
// Resolver for the in-flight primary-audio playback promise below. pause()
// fires neither onended nor onerror, so stopSpeaking() calls this directly
// to settle any speak() call currently awaiting playback -- otherwise the
// awaiter (and its caller's mic-resume logic) would hang forever.
let resolveCurrent: (() => void) | null = null;

export const speak = async (text: string, rate?: string): Promise<void> => {
  // A fresh speak() interrupts any prior one; reuse stopSpeaking() (rather
  // than duplicating the pause + resolveCurrent settle logic here) so the
  // interrupted call settles exactly the same way an explicit stop would.
  stopSpeaking();

  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, rate }),
    });

    if (!res.ok) {
      await fallbackSpeak(text, rate);
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;

    await new Promise<void>((resolve, reject) => {
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
  } catch {
    await fallbackSpeak(text, rate);
  }
};

export const stopSpeaking = (): void => {
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
