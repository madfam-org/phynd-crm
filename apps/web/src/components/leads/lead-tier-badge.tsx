import { Badge } from '@/components/ui/badge'

const TIER_VARIANT: Record<string, 'success' | 'warning' | 'secondary'> = {
  A: 'success',
  B: 'warning',
  C: 'secondary',
}

const TIER_HINT: Record<string, string> = {
  A: 'Tier A: call within 1 business day',
  B: 'Tier B',
  C: 'Tier C',
}

/** A | B | C badge from the lead's score; a dash until it is scored. */
export function LeadTierBadge({ tier }: { tier: string | null | undefined }) {
  if (!tier) return <span className="text-muted-foreground">—</span>
  return (
    <Badge
      variant={TIER_VARIANT[tier] ?? 'secondary'}
      title={TIER_HINT[tier]}
      className="font-mono"
    >
      {tier}
    </Badge>
  )
}

/** Shown on a waitlist lead: tell them when it is available; it is not a sale. */
export function WaitlistBadge({ intent }: { intent: string | null | undefined }) {
  if (intent !== 'waitlist') return null
  return (
    <Badge variant="outline" title="Waitlist: notify when available, never a sale">
      Notify when available
    </Badge>
  )
}
