// lib/use-audio-clip.ts
// Plays a single audio-Material sentence clip for WordCard / SRS review.
// Lightweight vs createAudioPlayer (no per-sentence/AB/onStateChange contract):
// just seek+play one bounded clip. Mirrors audio-source.ts's autoplay fix —
// play() is fired in the user-gesture call stack (the button onClick → hook
// play), and loadedmetadata only re-seeks; calling play() from loadedmetadata
// would be rejected by the autoplay policy (silent).

"use client";

import { useEffect, useRef, useState } from "react";
import { db } from "@/lib/db";
import { speak } from "@/lib/tts";
import type { Material } from "@/lib/types";

export function useAudioClipPlayback(): {
  play: (
    materialId: string,
    sentenceIndex: number,
    fallbackText: string
  ) => Promise<void>;
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
      a.src = "";
      a.removeAttribute("src");
      a.load();
      audioRef.current = null;
    }
  };

  useEffect(() => cleanup, []);

  const play = async (
    materialId: string,
    sentenceIndex: number,
    fallbackText: string
  ): Promise<void> => {
    // Tear down any prior playback before starting a new one.
    cleanup();

    let material: Material | undefined;
    try {
      material = await db.materials.get(materialId);
    } catch {
      void speak(fallbackText);
      return;
    }

    const sentence = material?.sentences?.[sentenceIndex];
    const startMs = sentence?.audioStartMs;
    const endMs = sentence?.audioEndMs;
    // Only audio materials with a bounded clip (both start+end) can play a
    // real clip; anything else (video, missing bounds, no material) falls
    // back to TTS so the learner still hears the sentence.
    if (
      !material ||
      material.mediaType !== "audio" ||
      !material.sourceUrl ||
      startMs == null ||
      endMs == null
    ) {
      void speak(fallbackText);
      return;
    }

    const audio = new Audio(material.sourceUrl);
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

    try {
      started = true;
      setPlaying(true);
      await audio.play();
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
    } catch {
      cleanup();
      setPlaying(false);
      void speak(fallbackText);
    }
  };

  return { play, playing };
}
