// ScoreCard — 学习反馈评分卡：大分数徽章 + 标题/副标题 + 可选 delta，body 为四维度细进度条网格。

import * as React from "react"

import { cn } from "@/lib/utils"

type ScoreDimension = {
  label: string
  score: number
  max: number
  /** "accent" marks a dimension that still needs improvement (amber bar). */
  tone?: "primary" | "accent"
}

type ScoreCardProps = React.ComponentProps<"div"> & {
  /** Headline score, e.g. 7 (band) or 82 (0-100). */
  overallScore: number | string
  /** Small caps label under the score, e.g. "BAND". */
  overallLabel?: string
  title: string
  subtitle?: string
  /** Optional trend pill, e.g. "+0.5 vs last". */
  delta?: string
  dimensions: ScoreDimension[]
}

function ScoreCard({
  className,
  overallScore,
  overallLabel = "BAND",
  title,
  subtitle,
  delta,
  dimensions,
  ...props
}: ScoreCardProps) {
  return (
    <div
      data-slot="score-card"
      className={cn(
        "overflow-hidden rounded-[18px] bg-card text-card-foreground shadow-md ring-1 ring-foreground/10",
        className
      )}
      {...props}
    >
      <div
        data-slot="score-card-header"
        className="flex items-start justify-between gap-4 px-6 py-5 [background:linear-gradient(135deg,color-mix(in_oklab,var(--primary)_12%,var(--card)),var(--card))]"
      >
        <div className="flex items-center gap-4">
          <div className="flex size-16 shrink-0 flex-col items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <span className="font-heading text-[26px] leading-none font-bold">
              {overallScore}
            </span>
            {overallLabel ? (
              <span className="mt-0.5 text-[9px] font-semibold tracking-wide uppercase opacity-85">
                {overallLabel}
              </span>
            ) : null}
          </div>
          <div className="flex flex-col gap-0.5">
            <h3 className="font-heading text-[19px] leading-tight font-bold">
              {title}
            </h3>
            {subtitle ? (
              <p className="text-[13px] text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
        </div>
        {delta ? (
          <span className="shrink-0 rounded-4xl px-2.5 py-1 text-[11.5px] font-bold text-success [background:color-mix(in_oklab,var(--success)_16%,transparent)]">
            {delta}
          </span>
        ) : null}
      </div>

      <div
        data-slot="score-card-body"
        className="grid grid-cols-2 gap-5 px-6 py-5 sm:grid-cols-4"
      >
        {dimensions.map((dim) => {
          const pct = dim.max > 0 ? Math.min(100, (dim.score / dim.max) * 100) : 0
          const accent = dim.tone === "accent"
          return (
            <div key={dim.label} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12.5px] font-semibold">{dim.label}</span>
                <span className="text-[12.5px] text-muted-foreground">
                  {dim.score}
                </span>
              </div>
              <div className="h-[7px] w-full overflow-hidden rounded-4xl bg-muted">
                <div
                  className={cn(
                    "h-full rounded-4xl",
                    accent ? "bg-accent" : "bg-primary"
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export { ScoreCard }
export type { ScoreCardProps, ScoreDimension }
