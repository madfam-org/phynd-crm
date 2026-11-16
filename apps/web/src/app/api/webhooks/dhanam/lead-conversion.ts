import type { getDb } from '@phynd/db'
import { conversions } from '@phynd/db/schema'
import { and, eq } from 'drizzle-orm'
import { STRIPE_PAID_EVENT_TYPES } from './payment-lifecycle'

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]

export interface ContactLead {
  leadId: string
  /** `leads.status` of the contact's newest live lead. */
  status: string
}

/**
 * The lead a conversion row is attributed to: only the event that converts
 * that lead, i.e. a paid event while the lead is not converted yet. Every other
 * event of the contact (renewals, failures, refunds, later subscriptions)
 * stores no lead id. `conversions` keeps one row per (type, lead), so the check
 * for an existing row of this type keeps a lead converted by hand and then
 * reopened from colliding with its first conversion.
 */
export async function conversionLeadId(
  tx: Tx,
  eventType: string,
  conversionType: string,
  lead: ContactLead | null,
): Promise<string | null> {
  if (!lead || lead.status === 'converted') return null
  if (!STRIPE_PAID_EVENT_TYPES.has(eventType)) return null
  const [existing] = await tx
    .select({ id: conversions.id })
    .from(conversions)
    .where(and(eq(conversions.type, conversionType), eq(conversions.leadId, lead.leadId)))
    .limit(1)
  return existing ? null : lead.leadId
}
