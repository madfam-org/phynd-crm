import type { EngagementEventVisibility } from '@phynd/db/schema'

/**
 * Write-time visibility of engagement events (client portal privacy).
 *
 * The client portal (`/portal/[engagementId]`) shows ONLY engagement events
 * whose `visibility` is `'client'`. It never shows activities, notes, stage
 * transitions or `'internal'` events. Every new event is `'internal'` unless
 * its writer opts in, either explicitly or through this allowlist.
 *
 * An event type is on the allowlist only when PhyndCRM itself writes the row
 * with fixed, client-safe copy (the message never comes from a free-form
 * producer payload) and the client would expect to see it. Exact matches only:
 * no prefixes, no suffix matching, no canonical-name wildcards.
 *
 * Deliberately NOT on the list:
 *  - the `system:deliverable_accepted` alias (duplicate of the portal's own row);
 *  - `pravara:<status>` raw rows (the canonical alias below carries the same news);
 *  - `system:payment_reconciled` and the other reconciliation/dispatch/recovery
 *    rows (internal bookkeeping);
 *  - Selva/Karafiel milestones (message comes from the producer payload);
 *  - anything posted to `POST /api/v1/engagements/events` (producer-authored;
 *    that route always writes `'internal'`).
 *
 * Staff can still mark any single event client-visible from the engagement
 * timeline (`engagements.setEventVisibility`). Keep this list in sync with
 * docs/ENGAGEMENT_EVENT_TAXONOMY.md § Visibility.
 */
export const CLIENT_VISIBLE_EVENT_TYPES: ReadonlySet<string> = new Set([
  // The client's own action in the portal.
  'portal:deliverable_accepted',
  // The client's own payment, as reported by Dhanam ("Payment received").
  'dhanam:payment_succeeded',
  // A quote was published to the client's portal.
  'system:quote_sent',
  // A quote was accepted (from the CRM or from Cotiza's approval).
  'system:quote_approved',
  'cotiza:quote_approved',
  // Physical delivery milestones (canonical aliases, fixed copy).
  'pravara:prototype_shipped',
  'pravara:deliverable_received',
])

export const ENGAGEMENT_EVENT_VISIBILITY_VALUES: readonly EngagementEventVisibility[] = [
  'internal',
  'client',
]

/** Visibility a new event gets when its writer does not set one. */
export function defaultEventVisibility(eventType: string): EngagementEventVisibility {
  return CLIENT_VISIBLE_EVENT_TYPES.has(eventType) ? 'client' : 'internal'
}

export function isEngagementEventVisibility(value: unknown): value is EngagementEventVisibility {
  return value === 'internal' || value === 'client'
}
