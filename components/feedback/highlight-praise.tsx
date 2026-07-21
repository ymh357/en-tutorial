// HighlightPraise — 表扬块：success 色系边框/底色 + star 图标标题 + 正文（含 inline 高亮短语）。

import * as React from "react"
import { Star } from "lucide-react"

import { cn } from "@/lib/utils"

type HighlightPraiseProps = React.ComponentProps<"div"> & {
  title?: string
  children: React.ReactNode
}

function HighlightPraise({
  className,
  title = "Nicely done",
  children,
  ...props
}: HighlightPraiseProps) {
  return (
    <div
      data-slot="highlight-praise"
      className={cn(
        "rounded-2xl p-[18px] [background:color-mix(in_oklab,var(--success)_8%,var(--card))] [border:1px_solid_color-mix(in_oklab,var(--success)_30%,transparent)]",
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-2">
        <span className="flex size-[26px] shrink-0 items-center justify-center rounded-lg bg-success text-success-foreground">
          <Star className="size-4" aria-hidden />
        </span>
        <span className="text-[13.5px] font-bold text-success">{title}</span>
      </div>
      <p className="mt-2 text-[14.5px] leading-relaxed text-card-foreground">
        {children}
      </p>
    </div>
  )
}

/** Inline highlight for the praised phrase inside <HighlightPraise> body. */
function PraisePhrase({
  className,
  ...props
}: React.ComponentProps<"mark">) {
  return (
    <mark
      data-slot="praise-phrase"
      className={cn(
        "rounded-[5px] px-[5px] py-px font-semibold text-inherit [background:color-mix(in_oklab,var(--success)_20%,transparent)]",
        className
      )}
      {...props}
    />
  )
}

export { HighlightPraise, PraisePhrase }
export type { HighlightPraiseProps }
