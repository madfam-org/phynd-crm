import type { ClientEngagementItem } from '@phynd/services'
import { type PortalCopy, formatPortalDate } from './copy'

export interface PortalItemGroups {
  /** Milestones and deliverables, in staff order. */
  progress: ClientEngagementItem[]
  /** Actionables split by whose move it is. */
  actionables: { madfam: ClientEngagementItem[]; client: ClientEngagementItem[] }
  /** Open decisions waiting on the client, open decisions on MADFAM's side, decided ones. */
  clientDecisions: ClientEngagementItem[]
  madfamDecisions: ClientEngagementItem[]
  decidedDecisions: ClientEngagementItem[]
}

/** Groups client-visible items for the portal. Callers pass client-visible rows only. */
export function groupPortalItems(items: ClientEngagementItem[]): PortalItemGroups {
  const actionables = items.filter((i) => i.kind === 'actionable')
  const decisions = items.filter((i) => i.kind === 'decision')
  return {
    progress: items.filter((i) => i.kind === 'milestone' || i.kind === 'deliverable'),
    actionables: {
      madfam: actionables.filter((i) => i.side === 'madfam'),
      client: actionables.filter((i) => i.side === 'client'),
    },
    clientDecisions: decisions.filter((i) => i.status !== 'done' && i.side === 'client'),
    madfamDecisions: decisions.filter((i) => i.status !== 'done' && i.side === 'madfam'),
    decidedDecisions: decisions.filter((i) => i.status === 'done'),
  }
}

/**
 * The date line under an item. The portal never labels anything as overdue or
 * late: done items show when they were done, decisions show a suggested date
 * (a decision waiting on the client is never "overdue"), everything else shows
 * its target date.
 */
export function itemDateLine(item: ClientEngagementItem, copy: PortalCopy): string | null {
  if (item.status === 'done' && item.completedAt) {
    return `${copy.completedOn} ${formatPortalDate(item.completedAt)}`
  }
  if (!item.dueAt) return null
  const label = item.kind === 'decision' ? copy.suggestedDate : copy.targetDate
  return `${label} ${formatPortalDate(item.dueAt)}`
}

export type ItemTone = 'done' | 'active' | 'neutral'

/** Visual tone of an item's status pill. There is no warning or overdue tone. */
export function itemTone(item: ClientEngagementItem): ItemTone {
  if (item.status === 'done') return 'done'
  if (item.status === 'in_progress') return 'active'
  return 'neutral'
}
