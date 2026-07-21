// Success state: short confirmation with pop-in check and success framing (§4).
import * as React from "react"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

interface SuccessStateProps extends React.ComponentProps<"div"> {
  title: string
  description: string
  action?: React.ReactNode
}

function SuccessState({
  title,
  description,
  action,
  className,
  ...props
}: SuccessStateProps) {
  return (
    <div
      data-slot="success-state"
      className={cn(
        "flex flex-col items-center gap-4 rounded-2xl border p-7 text-center text-card-foreground shadow-xs [background:color-mix(in_oklab,var(--success)_8%,var(--card))] [border-color:color-mix(in_oklab,var(--success)_30%,transparent)]",
        className
      )}
      {...props}
    >
      <div className="flex size-[52px] items-center justify-center rounded-full bg-success text-success-foreground [animation:ds-pop_.5s_ease-out] [&_svg]:size-6">
        <Check />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-[14.5px] font-bold">{title}</p>
        <p className="text-[13px] text-muted-foreground">{description}</p>
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}

export { SuccessState }
export type { SuccessStateProps }
