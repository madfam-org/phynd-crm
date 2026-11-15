import { getDb } from '@phynd/db'
import { contacts } from '@phynd/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]

/** Who a billing event says the buyer is. Any combination may be present. */
export interface BuyerIdentity {
  /**
   * Lookup hint for `contacts.externalJanuaId`: a Janua subject when the
   * event names one, else the billing platform's own customer id.
   */
  januaUserId: string | null
  /**
   * A Janua subject the event names explicitly. Only this value is ever
   * written to a new contact; a billing customer id is not a Janua subject.
   */
  januaSubject: string | null
  customerEmail: string | null
  customerName: string | null
}

export interface BuyerContact {
  contactId: string
  created: boolean
}

// `contacts.name` / `contacts.email` are varchar(255).
const MAX_COLUMN_LENGTH = 255
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The address a contact can be created from, or null when there is none. */
export function usableEmail(value: string | null): string | null {
  const email = value?.trim().toLowerCase() ?? ''
  if (!email || email.length > MAX_COLUMN_LENGTH || !EMAIL_SHAPE.test(email)) return null
  return email
}

/** The buyer's name as the event gives it, else the email's local part. */
export function buyerContactName(customerName: string | null, email: string): string {
  const name = customerName?.trim() || email.slice(0, email.indexOf('@'))
  return name.slice(0, MAX_COLUMN_LENGTH)
}

/**
 * Find the contact a billing event belongs to.
 *
 * Strategy: janua_user_id (richer mapping) → email (fallback).
 * We deliberately skip `stripe_customer_id` matching — PhyndCRM doesn't
 * store Stripe customer IDs anywhere (the federation provider fetches
 * billing state on-demand from dhanam itself).
 */
export async function resolveContactId(identity: BuyerIdentity): Promise<string | null> {
  const db = getDb()
  if (identity.januaUserId) {
    const [row] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.externalJanuaId, identity.januaUserId), isNull(contacts.deletedAt)))
      .limit(1)
    if (row?.id) return row.id
  }
  if (identity.customerEmail) {
    const [row] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.email, identity.customerEmail), isNull(contacts.deletedAt)))
      .limit(1)
    if (row?.id) return row.id
  }
  return null
}

/**
 * Get the contact for a buyer the CRM has not matched yet, creating it from
 * the event's customer fields when there is none. Returns null when the event
 * carries no usable email: a contact is never created without one.
 *
 * Runs inside the event's transaction. Two events for the same new buyer can
 * arrive together, and `contacts.email` has no unique constraint, so the
 * look-up-then-insert is serialized per buyer with transaction-scoped advisory
 * locks (email first, then the Janua subject, always in that order). The
 * second event waits for the first to commit and then finds its contact.
 *
 * A new contact starts with `marketingConsent = false`: a purchase is not a
 * marketing opt-in. Consent is captured through the consent API only.
 */
export async function findOrCreateBuyerContact(
  tx: Tx,
  identity: BuyerIdentity,
): Promise<BuyerContact | null> {
  const email = usableEmail(identity.customerEmail)
  if (!email) return null

  await lockBuyerKey(tx, `email:${email}`)
  const subject = storableSubject(identity.januaSubject)
  let subjectIsFree = true
  if (subject) {
    await lockBuyerKey(tx, `janua:${subject}`)
    // `external_janua_id` is unique across live and deleted rows alike.
    const [holder] = await tx
      .select({ id: contacts.id, deletedAt: contacts.deletedAt })
      .from(contacts)
      .where(eq(contacts.externalJanuaId, subject))
      .limit(1)
    if (holder?.id && !holder.deletedAt) return { contactId: holder.id, created: false }
    subjectIsFree = !holder?.id
  }

  // Case-insensitive: a contact typed in by hand may carry capitals.
  const [existing] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(sql`lower(${contacts.email}) = ${email}`, isNull(contacts.deletedAt)))
    .limit(1)
  if (existing?.id) return { contactId: existing.id, created: false }

  const [created] = await tx
    .insert(contacts)
    .values({
      name: buyerContactName(identity.customerName, email),
      email,
      externalJanuaId: subject && subjectIsFree ? subject : null,
      status: 'active',
      marketingConsent: false,
    })
    .returning({ id: contacts.id })
  if (!created?.id) throw new Error('buyer contact insert returned no row')
  return { contactId: created.id, created: true }
}

/** `contacts.external_janua_id` is varchar(255); a longer value is not stored. */
function storableSubject(value: string | null): string | null {
  const subject = value?.trim() ?? ''
  return subject && subject.length <= MAX_COLUMN_LENGTH ? subject : null
}

interface OrphanLogger {
  warn(fields: Record<string, unknown>, message: string): void
  error(fields: Record<string, unknown>, message: string): void
}

interface OrphanEvent {
  eventId: string
  eventType: string
  januaUserId: string | null
  /** Only checked for presence; never logged. */
  customerEmail: string | null
  paymentId: string | null
  subscriptionId: string | null
}

/**
 * Log an event that ends without a contact. The line carries identifiers
 * only: never the buyer's email or name.
 *
 * - A product `subscription.*` envelope never carries an email (it names the
 *   organization and the billing customer id only), so an unknown buyer there
 *   is expected: warn, with its own stable marker.
 * - Any other paid event should have carried a usable email: error, with a
 *   stable marker, because a purchase now has no customer record.
 */
export function logOrphanEvent(logger: OrphanLogger, event: OrphanEvent, paid: boolean): void {
  const ids = {
    event_id: event.eventId,
    event_type: event.eventType,
    janua_user_id: event.januaUserId,
  }
  if (!paid) {
    logger.warn(ids, 'dhanam event received but no contact match — orphan logged')
    return
  }
  const paidIds = { ...ids, payment_id: event.paymentId, subscription_id: event.subscriptionId }
  if (event.eventType.startsWith('subscription.') && !event.customerEmail) {
    logger.warn(
      paidIds,
      'DHANAM_SUBSCRIPTION_EVENT_WITHOUT_CONTACT: subscription event carries no email and matches no contact — orphan logged',
    )
    return
  }
  logger.error(
    paidIds,
    'DHANAM_PAID_EVENT_WITHOUT_CONTACT: paid event has no usable email, so the purchase has no customer contact — orphan logged',
  )
}

async function lockBuyerKey(tx: Tx, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`phynd:buyer:${key}`}, 0))`)
}
