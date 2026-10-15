import { describe, expect, it } from 'vitest'
import {
  EMPTY_PAYMENT_FORM,
  type UploadResult,
  fromMxLocal,
  prefillFromUpload,
  toCreateInput,
  toMxLocal,
} from '../payment-form'

const upload: UploadResult = {
  storageKey: `payment-evidence/${'a'.repeat(64)}.pdf`,
  sha256: 'a'.repeat(64),
  mime: 'application/pdf',
  size: 1932,
  extraction: {
    extractor: 'bbva-comprobante-pdf',
    confidence: 1,
    fields: {
      method: 'spei_transfer',
      amount: '11603.56',
      currency: 'MXN',
      paidAt: '2026-10-15T16:30:15.000Z',
      originAccountLast4: '1234',
      destinationAccountLast4: '012345',
      reference: 'Pago anticipo proyecto ejemplo',
    },
  },
}

describe('payment form helpers', () => {
  it('shows and reads dates in Mexico City time', () => {
    expect(toMxLocal('2026-10-15T16:30:15.000Z')).toBe('2026-10-15T10:30')
    expect(fromMxLocal('2026-10-15T10:30')?.toISOString()).toBe('2026-10-15T16:30:00.000Z')
    expect(fromMxLocal('')).toBeNull()
    expect(fromMxLocal('15/10/2026')).toBeNull()
  })

  it('prefills from the extractor and keeps only 4-digit account fields', () => {
    const form = prefillFromUpload(upload)
    expect(form).toMatchObject({
      amount: '11603.56',
      paidAtLocal: '2026-10-15T10:30',
      originAccountLast4: '1234',
      destinationAccountLast4: '',
      clientVisible: true,
    })
  })

  it('builds the create input with the file reference and the extraction source', () => {
    const input = toCreateInput({ ...prefillFromUpload(upload), amount: '11,603.56' }, upload)
    expect(input).toMatchObject({
      amount: '11603.56',
      source: 'extracted',
      extractionConfidence: 1,
      evidenceStorageKey: upload.storageKey,
      evidenceSha256: upload.sha256,
      evidenceMime: 'application/pdf',
      quoteId: null,
    })
    expect(
      toCreateInput({ ...EMPTY_PAYMENT_FORM, amount: '10', paidAtLocal: '2026-10-15T10:30' }, null),
    ).toMatchObject({
      source: 'manual',
      evidenceStorageKey: null,
    })
    expect(() => toCreateInput({ ...EMPTY_PAYMENT_FORM, amount: '10' }, null)).toThrow(/Fecha/)
  })
})
