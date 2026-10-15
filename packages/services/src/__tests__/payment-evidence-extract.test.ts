import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  type PaymentEvidenceExtractor,
  extractPaymentEvidence,
  imageNoopExtractor,
  parseBbvaComprobante,
} from '../payment-evidence/extractors'
import { extractPdfText, parseCMap } from '../payment-evidence/pdf-text'
import {
  SYNTHETIC_RECEIPT,
  buildSyntheticReceiptPdf,
  syntheticClabe,
} from './fixtures/synthetic-receipt-pdf'

const EXPECTED = {
  method: 'spei_transfer',
  operationType: 'Transferencias SPEI',
  folio: '0012345678',
  trackingKey: 'MBAN01002610150012345678',
  amount: '11603.56',
  currency: 'MXN',
  reference: 'Pago anticipo proyecto ejemplo',
  originAccountLast4: '1234',
  beneficiaryName: 'ACME EJEMPLO SA DE CV',
  bankName: 'BANCO EJEMPLO',
}

describe('PDF text extraction', () => {
  it('reads a simple two-column receipt (WinAnsi, bullet included)', () => {
    const text = extractPdfText(buildSyntheticReceiptPdf('simple'))
    expect(text).toContain('Comprobante de la operación')
    expect(text).toContain('Cuenta de origen  •1234')
    expect(text).toContain('Importe transferido  $11,603.56')
  })

  it('reads a bank-style PDF: object stream, FlateDecode, Identity-H font with ToUnicode', () => {
    const text = extractPdfText(buildSyntheticReceiptPdf('bank'))
    expect(text.split('\n')).toEqual(
      expect.arrayContaining([
        'Tipo de operación',
        'Transferencias SPEI',
        'Nombre del beneficiario',
      ]),
    )
  })

  it('parses bfrange CMaps and returns empty text for non-PDF input', () => {
    const cmap = parseCMap(
      'begincodespacerange <00> <FF> endcodespacerange beginbfrange <41> <43> <0061> endbfrange',
    )
    expect(cmap.codeLength).toBe(1)
    expect([0x41, 0x42, 0x43].map((c) => cmap.map.get(c))).toEqual(['a', 'b', 'c'])
    expect(extractPdfText(Buffer.from('not a pdf'))).toBe('')
  })
})

describe('BBVA comprobante extractor', () => {
  it('extracts every field from the committed synthetic fixture', async () => {
    const pdf = readFileSync(new URL('./fixtures/bbva-comprobante-sintetico.pdf', import.meta.url))
    const result = await extractPaymentEvidence({ bytes: pdf, mime: 'application/pdf' })
    expect(result?.extractor).toBe('bbva-comprobante-pdf')
    expect(result?.confidence).toBe(1)
    expect(result?.fields).toMatchObject({ ...EXPECTED, destinationAccountLast4: '5678' })
    // 15/10/2026 10:30:15 in Mexico City (UTC-6).
    expect(result?.fields.paidAt?.toISOString()).toBe('2026-10-15T16:30:15.000Z')
  })

  it('handles the bank layout, skips the "importe con letra" decoy and keeps only last-4 of a full CLABE', async () => {
    const result = await extractPaymentEvidence({
      bytes: buildSyntheticReceiptPdf('bank'),
      mime: 'application/pdf',
    })
    const clabe = syntheticClabe()
    expect(result?.fields).toMatchObject({ ...EXPECTED, destinationAccountLast4: clabe.slice(-4) })
    expect(JSON.stringify(result)).not.toContain(clabe)
  })

  it('reads label and value from the same cell, other date formats and a.m./p.m.', () => {
    const text = [
      'Comprobante de la operación',
      'Tipo de operación: Transferencia a otros bancos',
      'Fecha: 3 de marzo de 2026',
      'Hora: 4:05 p. m.',
      'Importe transferido: 1,000.00 MXN',
      `Concepto: Pago a cuenta ${syntheticClabe()}`,
    ].join('\n')
    const result = parseBbvaComprobante(text)
    expect(result?.fields.method).toBe('spei_transfer')
    expect(result?.fields.amount).toBe('1000.00')
    expect(result?.fields.paidAt?.toISOString()).toBe('2026-03-03T22:05:00.000Z')
    // Free text never keeps a long digit run.
    expect(result?.fields.reference).toBe(`Pago a cuenta •${syntheticClabe().slice(-4)}`)
    // 5 of 10 fields: type, date, time, amount, concepto.
    expect(result?.confidence).toBeCloseTo(0.5)
  })

  it('ignores documents that are not a BBVA comprobante', () => {
    expect(parseBbvaComprobante('Factura electrónica\nTotal $100.00')).toBeNull()
  })

  it('leaves images to manual entry (no-op), and lets a vision extractor plug in first', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000', 'hex')
    expect(await imageNoopExtractor.extract({ bytes: png, mime: 'image/png' })).toBeNull()
    expect(await extractPaymentEvidence({ bytes: png, mime: 'image/png' })).toBeNull()
    const vision: PaymentEvidenceExtractor = {
      name: 'test-vision',
      supports: (mime) => mime.startsWith('image/'),
      extract: async () => ({
        extractor: 'test-vision',
        confidence: 0.5,
        fields: { amount: '1.00' },
      }),
    }
    const result = await extractPaymentEvidence({ bytes: png, mime: 'image/png' }, [
      vision,
      imageNoopExtractor,
    ])
    expect(result?.extractor).toBe('test-vision')
  })

  it('treats a throwing extractor as "no prefill"', async () => {
    const broken: PaymentEvidenceExtractor = {
      name: 'broken',
      supports: () => true,
      extract: async () => {
        throw new Error('boom')
      },
    }
    expect(
      await extractPaymentEvidence({ bytes: Buffer.from('%PDF-'), mime: 'application/pdf' }, [
        broken,
      ]),
    ).toBeNull()
  })

  it('uses only invented values in the fixture', () => {
    expect(SYNTHETIC_RECEIPT.beneficiary).toMatch(/EJEMPLO/)
    expect(SYNTHETIC_RECEIPT.bank).toMatch(/EJEMPLO/)
  })
})
