// Voice interaction status card with four animated indicator states (§3.2).
import * as React from "react"
import { Mic } from "lucide-react"

import { cn } from "@/lib/utils"

type VoiceStateKind = "recording" | "transcribing" | "thinking" | "playing"

const defaultCopy: Record<VoiceStateKind, { title: string; subtitle: string }> = {
  recording: { title: "Listening…", subtitle: "Speak now, tap to stop" },
  transcribing: { title: "Transcribing…", subtitle: "Turning your speech into text" },
  thinking: { title: "Thinking…", subtitle: "Preparing your feedback" },
  playing: { title: "Playing…", subtitle: "Listen to the response" },
}

function RecordingIndicator() {
  return (
    <div className="relative flex size-[60px] items-center justify-center">
      <span
        aria-hidden
        className="absolute inset-0 rounded-full bg-destructive opacity-35 [animation:ds-pulse-ring_1.8s_ease-out_infinite]"
      />
      <div className="relative flex size-[60px] items-center justify-center rounded-full bg-destructive text-destructive-foreground">
        <Mic className="size-6" />
      </div>
    </div>
  )
}

function TranscribingIndicator() {
  return (
    <div className="flex size-[60px] items-center justify-center gap-1.5 rounded-full bg-secondary">
      {[0, 0.2, 0.4].map((delay) => (
        <span
          key={delay}
          className="size-[7px] rounded-full bg-info [animation:ds-dot_1.2s_infinite]"
          style={{ animationDelay: `${delay}s` }}
        />
      ))}
    </div>
  )
}

function ThinkingIndicator() {
  return (
    <div className="flex size-[60px] items-center justify-center rounded-full [background:color-mix(in_oklab,var(--primary)_14%,transparent)]">
      <span
        className="size-[34px] rounded-full border-[3px] [border-color:color-mix(in_oklab,var(--primary)_30%,transparent)] border-t-primary [animation:ds-spin_.8s_linear_infinite]"
      />
    </div>
  )
}

function PlayingIndicator() {
  const bars = [
    { height: "40%", delay: 0 },
    { height: "70%", delay: 0.15 },
    { height: "100%", delay: 0.3 },
    { height: "60%", delay: 0.45 },
  ]
  return (
    <div className="flex size-[60px] items-center justify-center gap-1 rounded-full bg-primary">
      {bars.map((bar) => (
        <span
          key={bar.delay}
          className="w-[3.5px] rounded-full bg-primary-foreground [animation:ds-eq_.9s_ease-in-out_infinite]"
          style={{ height: bar.height, animationDelay: `${bar.delay}s` }}
        />
      ))}
    </div>
  )
}

const indicators: Record<VoiceStateKind, React.FC> = {
  recording: RecordingIndicator,
  transcribing: TranscribingIndicator,
  thinking: ThinkingIndicator,
  playing: PlayingIndicator,
}

interface VoiceStateProps extends React.ComponentProps<"div"> {
  state: VoiceStateKind
  title?: string
  subtitle?: string
}

function VoiceState({
  state,
  title,
  subtitle,
  className,
  ...props
}: VoiceStateProps) {
  const Indicator = indicators[state]
  const copy = defaultCopy[state]

  return (
    <div
      data-slot="voice-state"
      className={cn(
        "flex flex-col items-center gap-3 rounded-2xl bg-card px-[18px] py-6 text-center text-card-foreground shadow-xs ring-1 ring-foreground/10",
        className
      )}
      {...props}
    >
      <Indicator />
      <div className="flex flex-col gap-1">
        <p className="font-heading text-sm font-bold">{title ?? copy.title}</p>
        <p className="text-xs text-muted-foreground">{subtitle ?? copy.subtitle}</p>
      </div>
    </div>
  )
}

export { VoiceState }
export type { VoiceStateProps, VoiceStateKind }
