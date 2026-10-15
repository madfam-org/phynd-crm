import { describe, expect, it } from 'vitest'
import { ValidationError } from '../errors'
import {
  findAccountViolations,
  hasLongDigitRun,
  isClabe,
  isLast4,
  isLuhnValid,
  looksLikeCardOrClabe,
  maskLongDigitRuns,
} from '../payment-evidence/account-guard'
import { validateRecord } from '../payment-evidence/payment-evidence.service'
import { syntheticClabe } from './fixtures/synthetic-receipt-pdf'

// Synthetic numbers only: a test card number (Luhn-valid 4111…) and a CLABE
// with a computed check digit; neither belongs to anyone.
const CARD = '4111 1111 1111 1111'
const CLABE = syntheticClabe()
const ACCOUNT = '0123456789'

describe('account guard', () => {
  it('accepts exactly four digits as last-4', () => {
    expect(isLast4('1234')).toBe(true)
    expect(isLast4(null)).toBe(true)
    for (const bad of ['123', '12345', '12a4', ' 1234', '•1234']) expect(isLast4(bad)).toBe(false)
  })

  it('finds 10+ digit runs, also with spaces or hyphens, but not amounts or dates', () => {
    for (const text of [
      ACCOUNT,
      CARD,
      CLABE,
      '0121-8000-1234-5678-90',
      'Pago CLABE 0121 8000 1234 5678 90',
    ]) {
      expect(hasLongDigitRun(text), text).toBe(true)
    }
    for (const text of [
      '$11,603.56',
      '15/10/2026 10:30:15',
      'Factura 123456789',
      'Folio 2026-10-15',
      '•1234',
    ]) {
      expect(hasLongDigitRun(text), text).toBe(false)
    }
  })

  it('masks long digit runs to their last four', () => {
    expect(maskLongDigitRuns(`Pago a CLABE ${CLABE} gracias`)).toBe(
      `Pago a CLABE •${CLABE.slice(-4)} gracias`,
    )
  })

  it('recognises CLABE and card numbers by their check digits', () => {
    expect(isClabe(CLABE)).toBe(true)
    expect(isClabe(`${CLABE.slice(0, 17)}${(Number(CLABE[17]) + 1) % 10}`)).toBe(false)
    expect(isLuhnValid(CARD.replace(/ /g, ''))).toBe(true)
    expect(looksLikeCardOrClabe(CARD)).toBe(true)
    expect(looksLikeCardOrClabe(CLABE)).toBe(true)
    expect(looksLikeCardOrClabe('MBAN01002610150012345678')).toBe(false)
    expect(looksLikeCardOrClabe('0012345678')).toBe(false)
  })

  it('refuses a full account number in every free-text field, including notes and reference', () => {
    for (const field of ['reference', 'notes', 'beneficiaryName', 'bankName', 'operationType']) {
      expect(findAccountViolations({ [field]: `texto ${ACCOUNT}` }), field).toEqual([
        { field, reason: 'full_account_number' },
      ])
    }
  })

  it('refuses a CLABE or card pasted as folio or clave de rastreo, keeps real identifiers', () => {
    expect(findAccountViolations({ folio: CLABE })).toEqual([
      { field: 'folio', reason: 'full_account_number' },
    ])
    expect(findAccountViolations({ trackingKey: CARD })).toEqual([
      { field: 'trackingKey', reason: 'full_account_number' },
    ])
    expect(
      findAccountViolations({ folio: '0012345678', trackingKey: 'MBAN01002610150012345678' }),
    ).toEqual([])
  })

  it('refuses more than four digits in the last-4 fields', () => {
    expect(
      findAccountViolations({ originAccountLast4: ACCOUNT, destinationAccountLast4: '56789' }),
    ).toEqual([
      { field: 'originAccountLast4', reason: 'last4_format' },
      { field: 'destinationAccountLast4', reason: 'last4_format' },
    ])
  })

  it('validateRecord turns violations into a ValidationError naming the fields', () => {
    expect(() => validateRecord({ reference: `CLABE ${CLABE}` })).toThrow(ValidationError)
    expect(() => validateRecord({ reference: `CLABE ${CLABE}` })).toThrow(/reference/)
    expect(() => validateRecord({ amount: '-5' })).toThrow(ValidationError)
    expect(() => validateRecord({ amount: '10.005' })).toThrow(ValidationError)
    expect(() =>
      validateRecord({
        evidenceStorageKey: `payment-evidence/${'a'.repeat(64)}.pdf`,
        evidenceSha256: 'b'.repeat(64),
        evidenceMime: 'application/pdf',
      }),
    ).toThrow(/inconsistent/)
    expect(() =>
      validateRecord({
        reference: 'Pago anticipo',
        amount: '11603.56',
        originAccountLast4: '1234',
      }),
    ).not.toThrow()
  })

  it('matches the database CHECK (same pattern, Postgres flavour)', () => {
    // payment_evidence_free_text_check uses '[0-9]([ -]?[0-9]){9,}'.
    const pg = /[0-9]([ -]?[0-9]){9,}/
    for (const text of [
      ACCOUNT,
      CARD,
      CLABE,
      'Factura 123456789',
      '$11,603.56',
      'a1-2-3-4-5-6-7-8-9-0',
    ]) {
      expect(pg.test(text), text).toBe(hasLongDigitRun(text))
    }
  })
})
