/**
 * Default due dates of a case, by type, in BUSINESS DAYS (Monday to Friday).
 * Used when a case is opened without a due date of its own.
 *
 * Only `data_rights` comes from a commitment the product publishes; the rest
 * are internal service targets the owner may change. Source of the published
 * terms: the Spanish legal texts of the billing product
 * (`dhanam/packages/shared/src/i18n/es/legal.ts`, privacy notice «Derechos
 * ARCO» and terms «Suscripciones y Facturación»).
 *
 * Public holidays are NOT skipped, so a computed date is never later than the
 * same count of «días hábiles» with holidays excluded: a deadline taken from
 * the terms is met early, never late.
 */
import type { CaseType } from '@phynd/db/schema'

export const CASE_DEFAULT_DUE_BUSINESS_DAYS: Readonly<Record<CaseType, number>> = {
  /** Internal target. The published terms set no response time for support. */
  support: 3,
  /**
   * Internal target. The terms set the CUSTOMER's window: a refund of the first
   * payment of a plan is requested «dentro de los 5 días hábiles siguientes al
   * primer pago»; they set no time for MADFAM to process a refund.
   */
  refund: 5,
  /**
   * Published: an ARCO request is answered «en un plazo máximo de 20 días
   * hábiles» (and, if it proceeds, carried out within the 15 business days
   * after that answer; each period may be extended once, with notice). The
   * case is due on the answer deadline.
   */
  data_rights: 20,
  /**
   * Internal target. The terms ask the customer to request a CFDI in their own
   * name «dentro del mismo mes calendario del pago»; they set no time for
   * issuing a correction.
   */
  invoice_correction: 5,
}

/**
 * Mexico City has kept UTC-6 all year since daylight saving time was abolished
 * there in 2022, so the offset is fixed.
 */
const MEXICO_CITY_UTC_OFFSET_HOURS = -6

/**
 * The end (23:59:59.999, Mexico City time) of the `businessDays`-th business
 * day after `from`'s calendar day in Mexico City. The opening day itself does
 * not count, as in «días hábiles siguientes».
 */
export function addBusinessDaysEndOfDay(from: Date, businessDays: number): Date {
  const local = new Date(from.getTime() + MEXICO_CITY_UTC_OFFSET_HOURS * 3_600_000)
  const cursor = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()),
  )
  let remaining = businessDays
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    const weekday = cursor.getUTCDay()
    if (weekday !== 0 && weekday !== 6) remaining -= 1
  }
  // 23:59:59.999 local is the next day's 05:59:59.999 UTC.
  return new Date(cursor.getTime() + 24 * 3_600_000 - 1 - MEXICO_CITY_UTC_OFFSET_HOURS * 3_600_000)
}

/** Due date of a case of `type` opened at `openedAt`, when none was given. */
export function defaultCaseDueAt(type: CaseType, openedAt: Date): Date {
  return addBusinessDaysEndOfDay(openedAt, CASE_DEFAULT_DUE_BUSINESS_DAYS[type])
}

/** A case is overdue while it is not resolved and its due date has passed. */
export function isCaseOverdue(
  row: { status: string; dueAt: Date | string },
  now: Date = new Date(),
): boolean {
  return row.status !== 'resolved' && new Date(row.dueAt).getTime() < now.getTime()
}
