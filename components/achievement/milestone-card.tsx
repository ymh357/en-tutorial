// Milestone unlock card: medal badge with pop entrance + accent gradient (§3.3).
import * as React from "react"
import { Award } from "lucide-react"

import { cn } from "@/lib/utils"

interface MilestoneCardProps extends React.ComponentProps<"div"> {
  title: string
  description: string
}

function MilestoneCard({
  title,
  description,
  className,
  ...props
}: MilestoneCardProps) {
  return (
    <div
      data-slot="milestone-card"
      className={cn(
        "flex items-center gap-[15px] rounded-2xl p-5 text-card-foreground ring-1 ring-foreground/10 [background:linear-gradient(135deg,color-mix(in_oklab,var(--accent)_14%,var(--card)),var(--card))]",
        className
      )}
      {...props}
    >
      <div className="flex size-[54px] shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-sm [animation:ds-pop_.5s_ease-out]">
        <Award className="size-7" />
      </div>
      <div className="flex flex-col gap-0.5">
        <p className="font-heading text-base font-bold">{title}</p>
        <p className="text-[13px] text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

export { MilestoneCard }
export type { MilestoneCardProps }
