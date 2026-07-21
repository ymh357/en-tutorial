// Empty state: invites action with icon, copy and optional action slot (§4).
import * as React from "react"
import { BookOpen } from "lucide-react"

import { cn } from "@/lib/utils"

interface EmptyStateProps extends React.ComponentProps<"div"> {
  icon?: React.ReactNode
  title: string
  description: string
  action?: React.ReactNode
}

function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center gap-4 rounded-2xl bg-card p-7 text-center text-card-foreground shadow-xs ring-1 ring-foreground/10",
        className
      )}
      {...props}
    >
      <div className="flex size-[52px] items-center justify-center rounded-xl bg-secondary text-muted-foreground [&_svg]:size-6">
        {icon ?? <BookOpen />}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-[14.5px] font-bold">{title}</p>
        <p className="text-[13px] text-muted-foreground">{description}</p>
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}

export { EmptyState }
export type { EmptyStateProps }
