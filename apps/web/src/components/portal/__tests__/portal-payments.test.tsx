import { portalCopy } from '@/lib/portal/copy'
import type { ClientPaymentEvidence } from '@phynd/services'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PortalPayments } from '../portal-payments'

const payments: ClientPaymentEvidence[] = [
  {
    id: 'pe-1',
    paidAt: new Date('2026-10-15T16:30:15Z'),
    amount: '11603.56',
    currency: 'MXN',
    method: 'spei_transfer',
    status: 'verified',
    originAccountLast4: '1234',
    evidenceMime: 'image/png',
    hasEvidence: true,
  },
  {
    id: 'pe-2',
    paidAt: new Date('2026-10-20T18:00:00Z'),
    amount: '500.00',
    currency: 'MXN',
    method: 'cash',
    status: 'recorded',
    // Defence in depth: a malformed value never renders.
    originAccountLast4: '0123456789',
    evidenceMime: 'application/pdf',
    hasEvidence: true,
  },
]

const render = (register: 'tu' | 'usted', list = payments) =>
  renderToStaticMarkup(
    <PortalPayments copy={portalCopy(register)} engagementId="eng-1" payments={list} />,
  )

describe('portal «Pagos»', () => {
  it('shows date, amount, method and status in Spanish', () => {
    const html = render('usted')
    expect(html).toContain('Pagos')
    expect(html).toContain('$11,603.56')
    expect(html).toContain('Transferencia SPEI')
    expect(html).toContain('15 oct 2026')
    expect(html).toContain('Verificado')
    expect(html).toContain('Recibido')
    expect(html).toContain('Desde la cuenta •1234')
  })

  it('never shows more than the last four digits of an account', () => {
    const html = render('tu')
    expect(html).not.toContain('0123456789')
    expect(html).not.toMatch(/\d{5,}/)
  })

  it('serves the receipt through the authorizing route, never a storage URL', () => {
    const html = render('tu')
    expect(html).toContain('src="/portal/eng-1/payments/pe-1/file"')
    expect(html).toContain('href="/portal/eng-1/payments/pe-2/file"')
    expect(html).not.toMatch(/r2\.cloudflarestorage|X-Amz-/)
  })

  it('speaks in the reader register', () => {
    expect(render('tu')).toContain('Ver tu comprobante')
    expect(render('usted')).toContain('Ver su comprobante')
    expect(render('tu', [])).toContain('pagos tuyos')
    expect(render('usted', [])).toContain('pagos suyos')
  })
})
