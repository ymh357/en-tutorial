// Client-side TTS helper. Uses the Edge TTS neural voice API (/api/tts),
// falling back to browser speechSynthesis if the request fails.

let currentAudio: HTMLAudioElement | null = null;

export const speak = async (text: string, rate?: string): Promise<void> => {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }

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
      audio.onended = () => {
        URL.revokeObjectURL(url);
        currentAudio = null;
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        currentAudio = null;
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
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
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
// A length-scaled timeout is a mandatory safety net: Chromium has documented
// bugs where speechSynthesis.cancel() or longer utterances fail to fire
// onend/onerror, which would otherwise leave this promise — and the caller's
// mic — hung forever. The timeout is generous enough that genuine playback
// almost always ends (onend) first; it only fires when the browser goes silent.
const fallbackSpeak = (text: string, rate?: string): Promise<void> => {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    return Promise.resolve();
  }
  window.speechSynthesis.cancel();
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, Math.min(60000, 5000 + text.length * 120));
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.rate = parseUtteranceRate(rate);
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
