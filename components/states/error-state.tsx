// Error state: stays calm and offers a retry path (§4).
"use client"

import * as React from "react"
import { AlertCircle } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface ErrorStateProps extends React.ComponentProps<"div"> {
  title: string
  description: string
  onRetry?: () => void
}

function ErrorState({
  title,
  description,
  onRetry,
  className,
  ...props
}: ErrorStateProps) {
  return (
    <div
      data-slot="error-state"
      className={cn(
        "flex flex-col items-center gap-4 rounded-2xl bg-card p-7 text-center text-card-foreground shadow-xs ring-1 ring-foreground/10",
        className
      )}
      {...props}
    >
      <div className="flex size-[52px] items-center justify-center rounded-xl text-destructive [background:color-mix(in_oklab,var(--destructive)_12%,transparent)] [&_svg]:size-6">
        <AlertCircle />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-[14.5px] font-bold">{title}</p>
        <p className="text-[13px] text-muted-foreground">{description}</p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
          Retry
        </Button>
      ) : null}
    </div>
  )
}

export { ErrorState }
export type { ErrorStateProps }
