// CorrectionEntry — 纠错条：类型头部（圆点 + 大写标签）+ 原文（删除线）→ 更正（加粗）+ 解释。

import * as React from "react"
import { ArrowRight } from "lucide-react"

import { cn } from "@/lib/utils"

type CorrectionKind = "correction" | "word-choice"

type CorrectionEntryProps = React.ComponentProps<"div"> & {
  kind?: CorrectionKind
  original: string
  corrected: string
  explanation: string
}

const kindConfig: Record<CorrectionKind, { label: string; dotClass: string }> = {
  correction: {
    label: "CORRECTION",
    // correction-original color for the type dot
    dotClass: "bg-correction-original",
  },
  "word-choice": {
    label: "WORD CHOICE",
    dotClass: "bg-warning",
  },
}

function CorrectionEntry({
  className,
  kind = "correction",
  original,
  corrected,
  explanation,
  ...props
}: CorrectionEntryProps) {
  const { label, dotClass } = kindConfig[kind]

  return (
    <div
      data-slot="correction-entry"
      className={cn(
        "overflow-hidden rounded-2xl bg-card text-card-foreground shadow-xs ring-1 ring-foreground/10",
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-2 border-b px-[18px] py-2.5">
        <span className={cn("size-2 shrink-0 rounded-full", dotClass)} />
        <span className="text-xs font-bold text-muted-foreground">{label}</span>
      </div>

      <div className="px-[18px] py-4">
        <p className="flex flex-wrap items-center gap-2 text-[15px] leading-relaxed">
          <span className="rounded-[5px] bg-correction-original-bg px-[5px] py-0.5 text-correction-original line-through decoration-2">
            {original}
          </span>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="rounded-[5px] bg-correction-corrected-bg px-[5px] py-0.5 font-bold text-correction-corrected">
            {corrected}
          </span>
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {explanation}
        </p>
      </div>
    </div>
  )
}

export { CorrectionEntry }
export type { CorrectionEntryProps, CorrectionKind }
