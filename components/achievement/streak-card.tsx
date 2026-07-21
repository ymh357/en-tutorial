// Daily streak card: flame badge + large day count (§3.3).
import * as React from "react"
import { Flame } from "lucide-react"

import { cn } from "@/lib/utils"

interface StreakCardProps extends React.ComponentProps<"div"> {
  days: number
}

function StreakCard({ days, className, ...props }: StreakCardProps) {
  return (
    <div
      data-slot="streak-card"
      className={cn(
        "flex items-center gap-[15px] rounded-2xl bg-card p-5 text-card-foreground shadow-xs ring-1 ring-foreground/10",
        className
      )}
      {...props}
    >
      <div className="flex size-[52px] shrink-0 items-center justify-center rounded-xl [background:color-mix(in_oklab,var(--accent)_16%,transparent)]">
        <Flame className="size-6 fill-accent text-accent" />
      </div>
      <div className="flex flex-col">
        <span className="font-heading text-[26px] leading-none font-bold">{days}</span>
        <span className="mt-1 text-[12.5px] text-muted-foreground">day streak</span>
      </div>
    </div>
  )
}

export { StreakCard }
export type { StreakCardProps }
