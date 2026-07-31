// WordCard — 生词卡：单词 + 音标、词性/级别、释义、例句，及全宽 "Add to review" 按钮。

"use client"

import * as React from "react"
import { Headphones, Plus, Check, Volume2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { db } from "@/lib/db"
import type { Material } from "@/lib/types"
import { speak } from "@/lib/tts"
import { useAudioClipPlayback, type AudioClip } from "@/lib/use-audio-clip"

type WordCardProps = Omit<React.ComponentProps<"div">, "onClick"> & {
  word: string
  phonetic?: string
  partOfSpeech?: string
  level?: string
  definition: string
  example: string
  /** The real sentence where the word was encountered (methodology: lived
   *  context). Shown as "真实语境" above the fresh `example` when present. */
  sourceSentence?: string
  /** Cue to form the mental picture for abstract words (methodology). */
  imageryHint?: string
  /** Audio Material this card was mined from + the sentence index — enables
   *  "听原句原声" clip playback (T2b). Only present for listening-mined cards. */
  materialId?: string
  sentenceIndex?: number
  onAdd?: () => void
  added?: boolean
  /** Disables the Add button (e.g. while the add request is in flight) without
   *  removing it — keep onAdd stable and toggle this instead. */
  addDisabled?: boolean
}

function WordCard({
  className,
  word,
  phonetic,
  partOfSpeech,
  level,
  definition,
  example,
  sourceSentence,
  // imageryHint is a reserved slot (methodology: mental-picture cue); not
  // rendered yet — audio materials have empty imageryHint today.
  imageryHint,
  materialId,
  sentenceIndex,
  onAdd,
  added = false,
  addDisabled = false,
  ...props
}: WordCardProps) {
  const clip = useAudioClipPlayback()
  const [audioClip, setAudioClip] = React.useState<AudioClip | null>(null)

  // Prefetch the AudioClip bounds (Material lookup) on render so the click
  // handler can call clip.play() synchronously — any await inside the
  // click handler would push audio.play() out of the user-gesture call
  // stack and get it silently rejected by the browser's autoplay policy.
  React.useEffect(() => {
    let cancelled = false

    const resolve = async (): Promise<AudioClip | null> => {
      if (materialId == null || sentenceIndex == null) return null
      const material: Material | undefined = await db.materials.get(materialId)
      const sentence = material?.sentences?.[sentenceIndex]
      if (
        material?.mediaType === "audio" &&
        material.sourceUrl != null &&
        sentence?.audioStartMs != null &&
        sentence?.audioEndMs != null
      ) {
        return {
          sourceUrl: material.sourceUrl,
          startMs: sentence.audioStartMs,
          endMs: sentence.audioEndMs,
        }
      }
      return null
    }

    void resolve().then((next) => {
      if (!cancelled) setAudioClip(next)
    })

    return () => {
      cancelled = true
    }
  }, [materialId, sentenceIndex])

  // Join "ADJECTIVE · B2" only from the parts that exist.
  const meta = [partOfSpeech, level].filter(Boolean).join(" · ")

  return (
    <div
      data-slot="word-card"
      className={cn(
        "rounded-2xl bg-card p-[18px] text-card-foreground shadow-xs ring-1 ring-foreground/10",
        className
      )}
      {...props}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="font-heading text-[20px] leading-tight font-bold">
          {word}
        </h4>
        <div className="flex items-center gap-2">
          {phonetic ? (
            <span className="font-mono text-[12.5px] text-muted-foreground">
              {phonetic}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void speak(word)}
            aria-label={`Pronounce ${word}`}
            className="text-muted-foreground hover:text-primary transition-colors"
          >
            <Volume2 className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      {meta ? (
        <p className="mt-1.5 text-[11px] font-bold tracking-[0.03em] text-accent uppercase">
          {meta}
        </p>
      ) : null}

      <p className="mt-2 text-sm leading-relaxed">{definition}</p>

      {sourceSentence ? (
        <p className="mt-3 border-l-2 border-primary/40 pl-[11px] text-sm italic">
          <span className="not-italic text-[10px] uppercase tracking-wide text-primary/70 mr-1">真实语境</span>
          {sourceSentence}
        </p>
      ) : null}

      {materialId != null && sentenceIndex != null ? (
        <button
          type="button"
          onClick={() => clip.play(audioClip, sourceSentence ?? word)}
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-primary"
        >
          <Headphones className="size-3.5" aria-hidden />
          {clip.playing ? "播放中…" : "听原句原声"}
        </button>
      ) : null}

      {/* Hide the fresh-example line when it duplicates the source sentence. */}
      {sourceSentence !== example ? (
        <p className="mt-3 border-l-2 border-border pl-[11px] text-sm text-muted-foreground italic">
          <span className="not-italic text-[10px] uppercase tracking-wide text-muted-foreground/70 mr-1">例句</span>
          {example}
        </p>
      ) : null}

      {onAdd ? (
        <button
          type="button"
          onClick={onAdd}
          disabled={added || addDisabled}
          className={cn(
            "mt-4 flex w-full items-center justify-center gap-1.5 rounded-[9px] px-3 py-[9px] text-sm font-semibold text-primary transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-70",
            "[background:color-mix(in_oklab,var(--primary)_12%,transparent)]",
            !added &&
              "hover:[background:color-mix(in_oklab,var(--primary)_20%,transparent)]"
          )}
        >
          {added ? (
            <>
              <Check className="size-4" aria-hidden />
              Added to review
            </>
          ) : (
            <>
              <Plus className="size-4" aria-hidden />
              Add to review
            </>
          )}
        </button>
      ) : null}
    </div>
  )
}

export { WordCard }
export type { WordCardProps }
