/**
 * A contact's payment health: a value DERIVED on read from what the CRM
 * already stores (the contact's lifecycle stage and the billing conversions
 * the Dhanam webhook records), never stored. No scoring, no usage signals.
 *
 *   former_customer                          → cancelled
 *   latest payment outcome is a failure      → payment_failed
 *   customer (latest outcome paid, or none)  → ok
 *   lead with no failed payment              → null (no payment relationship)
 */
import { conversions } from '@phynd/db/schema'
import type { ContactLifecycleStage } from '@phynd/db/schema'
import { and, desc, inArray } from 'drizzle-orm'
import type { ServiceContext } from '../context'

export const CUSTOMER_HEALTHS = ['ok', 'payment_failed', 'cancelled'] as const
export type CustomerHealth = (typeof CUSTOMER_HEALTHS)[number]

/**
 * `conversions.type` of a successful Dhanam payment, as the Dhanam webhook
 * writes it (`mapEventTypeToConversionType` in
 * `apps/web/src/app/api/webhooks/dhanam/route.ts`; its tests pin the match).
 */
export const PAID_PAYMENT_CONVERSION_TYPES = [
  'dhanam_checkout_completed',
  'dhanam_subscription_created',
  'dhanam_payment_succeeded',
] as const

/**
 * `conversions.type` of a failed Dhanam payment. `payment_intent.payment_failed`
 * would map to a type longer than the column (30 characters) and is therefore
 * never stored under its own type.
 */
export const FAILED_PAYMENT_CONVERSION_TYPES = [
  'dhanam_invoice_payment_failed',
  'dhanam_payment_failed',
] as const

const PAID_TYPES: ReadonlySet<string> = new Set(PAID_PAYMENT_CONVERSION_TYPES)
const FAILED_TYPES: ReadonlySet<string> = new Set(FAILED_PAYMENT_CONVERSION_TYPES)
const OUTCOME_TYPES = [...PAID_PAYMENT_CONVERSION_TYPES, ...FAILED_PAYMENT_CONVERSION_TYPES]

/** The latest payment outcome a contact's conversions show. */
export type PaymentOutcome = 'paid' | 'failed'

export function deriveCustomerHealth(
  stage: ContactLifecycleStage | string | null | undefined,
  latestOutcome: PaymentOutcome | null,
): CustomerHealth | null {
  if (stage === 'former_customer') return 'cancelled'
  if (latestOutcome === 'failed') return 'payment_failed'
  if (stage === 'customer') return 'ok'
  return null
}

/**
 * The latest payment outcome per contact, from the billing conversions
 * recorded for them (one query for the whole page).
 */
export async function latestPaymentOutcomes(
  ctx: ServiceContext,
  contactIds: readonly string[],
): Promise<Map<string, PaymentOutcome>> {
  const outcomes = new Map<string, PaymentOutcome>()
  if (contactIds.length === 0) return outcomes
  const rows = await ctx.db
    .select({
      contactId: conversions.contactId,
      type: conversions.type,
      createdAt: conversions.createdAt,
    })
    .from(conversions)
    .where(
      and(
        inArray(conversions.contactId, [...contactIds]),
        inArray(conversions.type, OUTCOME_TYPES),
      ),
    )
    .orderBy(desc(conversions.createdAt), desc(conversions.id))
  for (const row of rows) {
    if (!row.contactId || outcomes.has(row.contactId)) continue
    if (PAID_TYPES.has(row.type)) outcomes.set(row.contactId, 'paid')
    else if (FAILED_TYPES.has(row.type)) outcomes.set(row.contactId, 'failed')
  }
  return outcomes
}

/** Each contact with its derived `health`. */
export async function withCustomerHealth<
  T extends { id: string; lifecycleStage: ContactLifecycleStage | string },
>(ctx: ServiceContext, rows: readonly T[]): Promise<Array<T & { health: CustomerHealth | null }>> {
  const outcomes = await latestPaymentOutcomes(
    ctx,
    rows.map((row) => row.id),
  )
  return rows.map((row) => ({
    ...row,
    health: deriveCustomerHealth(row.lifecycleStage, outcomes.get(row.id) ?? null),
  }))
}
