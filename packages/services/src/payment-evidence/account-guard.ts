/**
 * Account-number guard for payment evidence.
 *
 * A payment record may carry the LAST FOUR digits of an account, never more.
 * Free-text fields (concepto/reference, notes, beneficiary, bank, operation
 * type) refuse any run of ten or more digits, optionally separated by single
 * spaces or hyphens: that covers bank accounts (10-11 digits), CLABE (18) and
 * card numbers (15-16). Identifier fields (folio, clave de rastreo) legitimately
 * hold long digit runs, so they refuse only a value that IS a CLABE (valid
 * check digit) or a card number (valid Luhn).
 *
 * The database repeats the free-text rule as a CHECK (migration 0017); keep the
 * two in step. scripts/import-engagements.mjs carries a copy of this logic.
 */

/** Ten or more digits, single spaces/hyphens allowed between them. */
const LONG_DIGIT_RUN = /\d(?:[ -]?\d){9,}/g

export const FREE_TEXT_FIELDS = [
  'reference',
  'notes',
  'beneficiaryName',
  'bankName',
  'operationType',
] as const
export const IDENTIFIER_FIELDS = ['folio', 'trackingKey'] as const

export function isLast4(value: string | null | undefined): boolean {
  return value === null || value === undefined || /^\d{4}$/.test(value)
}

export function hasLongDigitRun(text: string | null | undefined): boolean {
  if (!text) return false
  LONG_DIGIT_RUN.lastIndex = 0
  return LONG_DIGIT_RUN.test(text)
}

/** Replaces every long digit run with •NNNN (its last four digits). */
export function maskLongDigitRuns(text: string): string {
  return text.replace(LONG_DIGIT_RUN, (run) => `•${run.replace(/\D/g, '').slice(-4)}`)
}

export function isLuhnValid(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return digits.length > 0 && sum % 10 === 0
}

/** CLABE: 18 digits; the last is a weighted (3,7,1) mod-10 check digit. */
export function isClabe(digits: string): boolean {
  if (!/^\d{18}$/.test(digits)) return false
  const weights = [3, 7, 1]
  let sum = 0
  for (let i = 0; i < 17; i++) sum += (Number(digits[i]) * (weights[i % 3] ?? 1)) % 10
  return (10 - (sum % 10)) % 10 === Number(digits[17])
}

export function looksLikeCardOrClabe(value: string | null | undefined): boolean {
  if (!value) return false
  const digits = value.replace(/[ -]/g, '')
  if (!/^\d+$/.test(digits)) return false
  if (digits.length === 18) return isClabe(digits)
  if (digits.length >= 13 && digits.length <= 19) return isLuhnValid(digits)
  return false
}

export interface AccountGuardViolation {
  field: string
  reason: 'full_account_number' | 'last4_format'
}

/**
 * Every violation in a payment-evidence record (camelCase fields). An empty
 * list means the record holds no account digits beyond last four.
 */
export function findAccountViolations(record: Record<string, unknown>): AccountGuardViolation[] {
  const violations: AccountGuardViolation[] = []
  for (const field of ['originAccountLast4', 'destinationAccountLast4']) {
    const value = record[field]
    if (value !== undefined && value !== null && !(typeof value === 'string' && isLast4(value))) {
      violations.push({ field, reason: 'last4_format' })
    }
  }
  for (const field of FREE_TEXT_FIELDS) {
    const value = record[field]
    if (typeof value === 'string' && hasLongDigitRun(value)) {
      violations.push({ field, reason: 'full_account_number' })
    }
  }
  for (const field of IDENTIFIER_FIELDS) {
    const value = record[field]
    if (typeof value === 'string' && looksLikeCardOrClabe(value)) {
      violations.push({ field, reason: 'full_account_number' })
    }
  }
  return violations
}
