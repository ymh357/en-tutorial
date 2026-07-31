// lib/use-audio-clip.ts
// Plays a single audio-Material sentence clip for WordCard / SRS review.
// Lightweight vs createAudioPlayer (no per-sentence/AB/onStateChange contract):
// just seek+play one bounded clip. Mirrors audio-source.ts's autoplay fix —
// play() is synchronous and fires audio.play() immediately in the caller's
// user-gesture call stack (e.g. a button onClick); loadedmetadata only
// re-seeks. The caller (WordCard/SRS) is responsible for prefetching the
// Material and resolving { sourceUrl, startMs, endMs } BEFORE the gesture,
// since any await before play() would push it past the gesture and get it
// silently rejected by the browser's autoplay policy.

"use client";

import { useEffect, useRef, useState } from "react";
import { speak } from "@/lib/tts";

export interface AudioClip {
  sourceUrl: string;
  startMs: number;
  endMs: number;
}

export function useAudioClipPlayback(): {
  play: (clip: AudioClip | null, fallbackText: string) => void;
  playing: boolean;
} {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [playing, setPlaying] = useState(false);

  const cleanup = (): void => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.onloadedmetadata = null;
      a.onerror = null;
      a.onended = null;
      a.src = "";
      a.removeAttribute("src");
      a.load();
      audioRef.current = null;
    }
  };

  useEffect(() => cleanup, []);

  const play = (clip: AudioClip | null, fallbackText: string): void => {
    // Tear down any prior playback before starting a new one.
    cleanup();

    // No clip (non-audio material, missing bounds, or prefetch failed) —
    // fall back to TTS so the learner still hears the sentence.
    if (!clip) {
      void speak(fallbackText);
      return;
    }

    const { sourceUrl, startMs, endMs } = clip;
    const audio = new Audio(sourceUrl);
    audioRef.current = audio;
    let started = false;

    // Fire play() in the user-gesture call stack (this hook's play is invoked
    // synchronously from a button onClick). loadedmetadata may not be ready
    // yet, but play() can start; the seek happens once metadata loads.
    audio.onloadedmetadata = () => {
      if (started) audio.currentTime = startMs / 1000;
    };
    audio.onerror = () => {
      cleanup();
      setPlaying(false);
      void speak(fallbackText);
    };
    // Natural end-of-file guard: if endMs is slightly past the actual audio
    // duration (rounding/truncated blob), the endMs poll never fires because
    // currentTime freezes below endMs once playback ends. Without this, the
    // poll spins forever and `playing` stays stuck true.
    audio.onended = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      setPlaying(false);
    };

    started = true;
    setPlaying(true);
    audio
      .play()
      .then(() => {
        // If metadata already loaded by now, seek immediately; otherwise the
        // onloadedmetadata handler will seek.
        if (audio.readyState >= 1) audio.currentTime = startMs / 1000;

        // Poll to pause at endMs (clip bound).
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(() => {
          if (audio.currentTime * 1000 >= endMs) {
            audio.pause();
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
            setPlaying(false);
          }
        }, 100);
      })
      .catch(() => {
        cleanup();
        setPlaying(false);
        void speak(fallbackText);
      });
  };

  return { play, playing };
}
