'use client'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { CheckCircle2, Clock, Lock } from 'lucide-react'
import { isMaskedValue, leadChannel } from '../channel'
import { COPY, LEAD_STATUS_LABEL } from '../copy'
import { type SlaKind, slaState } from '../sla'

// Small, shared pieces of the lead queue and the lead page: the tier mark with
// its score parts, the deadline clock, the channel, the owner avatar, masked
// text and the status label. Colours come from the DESIGN.md tokens.

const TIER_CLASS: Record<string, string> = {
  A: 'bg-tier-a-soft text-tier-a-ink',
  B: 'bg-tier-b-soft text-tier-b-ink',
  C: 'bg-tier-c-soft text-tier-c-ink',
}

export function TierMark({
  tier,
  score,
  breakdown,
  size = 'sm',
}: {
  tier: string | null
  score: number | null
  breakdown: { rule: string; points: number }[]
  size?: 'sm' | 'lg'
}) {
  const label = tier ? `${tier} · ${score ?? 0}` : '—'
  const mark = (
    <span
      className={cn(
        'inline-flex items-center rounded-[4px] font-semibold tabular-nums',
        size === 'lg' ? 'px-2.5 py-1 text-sm' : 'px-1.5 py-0.5 text-xs',
        tier ? TIER_CLASS[tier] : 'text-meta',
      )}
    >
      {label}
    </span>
  )
  if (!tier) return mark
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            aria-label={`${COPY.tier} ${tier}, ${COPY.score.toLowerCase()} ${score ?? 0}. ${COPY.scoreParts}`}
          >
            {mark}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-xs">
          <ScoreParts breakdown={breakdown} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function ScoreParts({ breakdown }: { breakdown: { rule: string; points: number }[] }) {
  if (breakdown.length === 0) return <p className="text-xs">{COPY.noScore}</p>
  return (
    <div className="space-y-1 text-xs">
      <p className="font-semibold">{COPY.scoreParts}</p>
      <ul className="space-y-0.5">
        {breakdown.map((part) => (
          <li key={part.rule} className="flex justify-between gap-4">
            <span>{part.rule}</span>
            <span className="tabular-nums">
              {part.points > 0 ? '+' : ''}
              {part.points}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const SLA_CLASS: Record<SlaKind, string> = {
  overdue: 'bg-danger-soft text-danger-ink',
  due_soon: 'bg-warning-soft text-warning-ink',
  on_track: 'bg-muted text-meta',
  done: 'bg-brand-soft text-brand-ink',
  none: 'text-meta',
}

/** The signature deadline clock: counts down to, or up from, the first-contact deadline. */
export function DeadlineClock({
  task,
  now,
}: {
  task: { dueAt: Date | string | null; status: string } | null
  now?: Date
}) {
  const state = slaState(task, now)
  if (state.kind === 'none') {
    return (
      <span className="text-meta" title={state.description} suppressHydrationWarning>
        {state.label}
      </span>
    )
  }
  const Icon = state.kind === 'done' ? CheckCircle2 : Clock
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
        SLA_CLASS[state.kind],
      )}
      title={state.description}
      suppressHydrationWarning
    >
      <Icon aria-hidden className="h-3.5 w-3.5" />
      <span suppressHydrationWarning>{state.label}</span>
      <span className="sr-only" suppressHydrationWarning>
        . {state.description}
      </span>
    </span>
  )
}

export function ChannelLabel({ source }: { source: string | null }) {
  const channel = leadChannel(source)
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-sm">{channel.label}</span>
      {channel.detail && <span className="truncate text-xs text-meta">{channel.detail}</span>}
    </span>
  )
}

/** A value that may come back masked; masked reads as deliberately withheld. */
export function MaskedText({ value, className }: { value: string | null; className?: string }) {
  if (!value) return null
  if (!isMaskedValue(value)) return <span className={className}>{value}</span>
  return (
    <span
      className={cn('inline-flex items-center gap-1 italic text-meta', className)}
      title={COPY.maskedHint}
    >
      <Lock aria-hidden className="h-3 w-3" />
      {COPY.masked}
    </span>
  )
}

function initials(name: string): string {
  const parts = name
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
  return (
    (
      (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')
    ).toUpperCase() || '?'
  )
}

export function OwnerAvatar({
  owner,
  showName = false,
}: {
  owner: { name: string | null; email: string } | null
  showName?: boolean
}) {
  if (!owner) {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-meta">
        <span
          aria-hidden
          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-border text-[10px]"
        >
          ?
        </span>
        {showName && COPY.unassigned}
      </span>
    )
  }
  const label = owner.name ?? owner.email
  return (
    <span className="inline-flex min-w-0 items-center gap-2 text-sm">
      <span
        aria-hidden
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[10px] font-semibold text-brand-ink"
      >
        {initials(label)}
      </span>
      {showName ? (
        <span className="truncate">{label}</span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </span>
  )
}

export function StatusLabel({ status }: { status: string }) {
  return <span className="text-sm">{LEAD_STATUS_LABEL[status] ?? status}</span>
}

export function WaitlistNote({ intent }: { intent: string | null | undefined }) {
  if (intent !== 'waitlist') return null
  return (
    <span className="text-xs text-meta" title={COPY.waitlistHint}>
      {COPY.waitlist}
    </span>
  )
}
