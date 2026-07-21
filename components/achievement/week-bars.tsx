// Weekly activity heat bars: 7 vertical bars by completion level (§3.3).
import * as React from "react"

import { cn } from "@/lib/utils"

type DayLevel = "full" | "partial" | "none"

const barByLevel: Record<DayLevel, string> = {
  full: "bg-primary",
  partial: "[background:color-mix(in_oklab,var(--primary)_40%,var(--muted))]",
  none: "bg-muted",
}

interface WeekBarsProps extends React.ComponentProps<"div"> {
  days: DayLevel[]
  caption?: string
}

function WeekBars({ days, caption, className, ...props }: WeekBarsProps) {
  return (
    <div
      data-slot="week-bars"
      className={cn(
        "flex flex-col gap-3 rounded-2xl bg-card p-5 text-card-foreground shadow-xs ring-1 ring-foreground/10",
        className
      )}
      {...props}
    >
      <p className="font-heading text-sm font-bold">This week</p>
      <div className="flex items-end gap-1.5">
        {days.map((level, index) => (
          <span
            key={index}
            className={cn("h-[30px] flex-1 rounded-md", barByLevel[level])}
          />
        ))}
      </div>
      {caption ? (
        <p className="text-[12.5px] text-muted-foreground">{caption}</p>
      ) : null}
    </div>
  )
}

export { WeekBars }
export type { WeekBarsProps, DayLevel }
