// WordCard — 生词卡：单词 + 音标、词性/级别、释义、例句，及全宽 "Add to review" 按钮。

"use client"

import * as React from "react"
import { Check, Plus } from "lucide-react"

import { cn } from "@/lib/utils"

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
  /** Audio source URL for pronunciation playback (future: W4 audio materials). */
  audioSrc?: string
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
  imageryHint,
  audioSrc,
  onAdd,
  added = false,
  addDisabled = false,
  ...props
}: WordCardProps) {
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
        {phonetic ? (
          <span className="font-mono text-[12.5px] text-muted-foreground">
            {phonetic}
          </span>
        ) : null}
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

      <p className="mt-3 border-l-2 border-border pl-[11px] text-sm text-muted-foreground italic">
        <span className="not-italic text-[10px] uppercase tracking-wide text-muted-foreground/70 mr-1">例句</span>
        {example}
      </p>

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
