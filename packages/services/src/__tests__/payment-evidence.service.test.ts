import { type PaymentEvidence, engagementEvents, orders, paymentEvidence } from '@phynd/db/schema'
import { describe, expect, it } from 'vitest'
import { defaultEventVisibility } from '../engagements/event-visibility'
import { ValidationError } from '../errors'
import {
  PaymentEvidenceService,
  canViewEvidence,
  paymentReceivedMessage,
} from '../payment-evidence/payment-evidence.service'
import { createTestContext } from './helpers'

function evidence(overrides: Partial<PaymentEvidence> = {}): PaymentEvidence {
  return {
    id: 'pe-1',
    engagementId: 'eng-1',
    quoteId: null,
    orderId: 'order-1',
    contactId: 'contact-1',
    method: 'spei_transfer',
    bankName: 'BANCO EJEMPLO',
    operationType: 'Transferencias SPEI',
    folio: '0012345678',
    trackingKey: null,
    paidAt: new Date('2026-10-15T16:30:15Z'),
    amount: '11603.56',
    currency: 'MXN',
    reference: 'Pago anticipo',
    originAccountLast4: '1234',
    destinationAccountLast4: '5678',
    beneficiaryName: 'ACME EJEMPLO SA DE CV',
    notes: null,
    status: 'recorded',
    verifiedByUserId: null,
    verifiedAt: null,
    voidedByUserId: null,
    voidedAt: null,
    voidReason: null,
    source: 'extracted',
    extractionConfidence: '1.000',
    evidenceStorageKey: `payment-evidence/${'a'.repeat(64)}.pdf`,
    evidenceMime: 'application/pdf',
    evidenceSha256: 'a'.repeat(64),
    clientVisible: true,
    externalKey: null,
    createdBy: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as PaymentEvidence
}

/**
 * A recording stand-in for the drizzle db: selects resolve from a queue;
 * update().returning() resolves from its own queue; every write is logged
 * with its table.
 */
function fakeDb(opts: { selects?: unknown[][]; updates?: unknown[][] } = {}) {
  const selects = [...(opts.selects ?? [])]
  const updates = [...(opts.updates ?? [])]
  const writes: Array<{ op: string; table: unknown; values: Record<string, unknown> }> = []
  const chain = (result: () => unknown) => {
    const qb: Record<string, unknown> = {}
    for (const m of ['from', 'where', 'limit', 'orderBy', 'for', 'innerJoin', 'leftJoin']) {
      qb[m] = () => qb
    }
    // biome-ignore lint/suspicious/noThenProperty: awaitable query-builder stub
    qb.then = (resolve: (v: unknown) => void) => Promise.resolve(result()).then(resolve)
    return qb
  }
  const db = {
    writes,
    select: () => chain(() => selects.shift() ?? []),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        writes.push({ op: 'insert', table, values })
        const result = [{ id: 'new-row', ...values }]
        return {
          returning: async () => result,
          // biome-ignore lint/suspicious/noThenProperty: awaitable stub
          then: (r: (v: unknown) => void) => r(undefined),
        }
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        writes.push({ op: 'update', table, values })
        const result = () => (table === paymentEvidence ? (updates.shift() ?? []) : [])
        return {
          where: () => ({
            returning: async () => result(),
            // biome-ignore lint/suspicious/noThenProperty: awaitable stub
            then: (r: (v: unknown) => void) => r(undefined),
          }),
        }
      },
    }),
    transaction: async (cb: (tx: unknown) => unknown) => cb(db),
  }
  return db
}

function service(db: ReturnType<typeof fakeDb>, crmUserId: string | undefined = 'user-1') {
  const ctx = createTestContext()
  ctx.auth.crmUserId = crmUserId
  ;(ctx as { db: unknown }).db = db
  return new PaymentEvidenceService(ctx)
}

describe('canViewEvidence (signed-URL authorization)', () => {
  const e = evidence()
  it('lets staff open any receipt that has a file', () => {
    expect(canViewEvidence({ kind: 'staff' }, e)).toBe(true)
    expect(
      canViewEvidence({ kind: 'staff' }, { ...e, clientVisible: false, status: 'voided' }),
    ).toBe(true)
    expect(canViewEvidence({ kind: 'staff' }, { ...e, evidenceStorageKey: null })).toBe(false)
  })

  it('lets a portal viewer open only client-visible, non-voided receipts of their engagement', () => {
    const viewer = { kind: 'portal' as const, engagementId: 'eng-1' }
    expect(canViewEvidence(viewer, e)).toBe(true)
    expect(canViewEvidence({ ...viewer, engagementId: 'eng-2' }, e)).toBe(false)
    expect(canViewEvidence(viewer, { ...e, clientVisible: false })).toBe(false)
    expect(canViewEvidence(viewer, { ...e, status: 'voided' })).toBe(false)
    expect(canViewEvidence(viewer, { ...e, evidenceStorageKey: null })).toBe(false)
  })
})

describe('PaymentEvidenceService.create', () => {
  it('refuses a full account number before touching the database', async () => {
    const db = fakeDb()
    await expect(
      service(db).create('eng-1', {
        method: 'spei_transfer',
        paidAt: new Date(),
        amount: '100.00',
        reference: 'Pago a cuenta 0123456789',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      service(db).create('eng-1', {
        method: 'spei_transfer',
        paidAt: new Date(),
        amount: '100.00',
        originAccountLast4: '123456',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(db.writes).toEqual([])
  })

  it('records the payment with the actor and an internal audit event', async () => {
    const db = fakeDb({
      selects: [[{ id: 'eng-1', contactId: 'contact-1', opportunityId: null }], [], []],
    })
    await service(db).create('eng-1', {
      method: 'cash',
      paidAt: new Date('2026-10-15T18:00:00Z'),
      amount: '500',
      currency: 'mxn',
    })
    const [row, event] = db.writes
    expect(row?.table).toBe(paymentEvidence)
    expect(row?.values).toMatchObject({
      engagementId: 'eng-1',
      contactId: 'contact-1',
      status: 'recorded',
      currency: 'MXN',
      amount: '500',
      createdBy: 'user-1',
    })
    expect(event?.values).toMatchObject({
      eventType: 'system:payment_recorded',
      visibility: 'internal',
    })
  })
})

describe('PaymentEvidenceService.verify', () => {
  it('adds the amount to the order, recomputes its status and tells the client', async () => {
    const verified = evidence({ status: 'verified' })
    const db = fakeDb({
      updates: [[verified]],
      selects: [
        [
          {
            id: 'order-1',
            currency: 'MXN',
            paidAmount: '0.00',
            totalAmount: '11600.00',
            paidAt: null,
          },
        ],
        [],
      ],
    })
    const result = await service(db).verify('pe-1')

    expect(result.order).toMatchObject({
      applied: true,
      paidAmount: '11603.56',
      paymentStatus: 'paid',
    })
    const orderWrite = db.writes.find((w) => w.table === orders)
    expect(orderWrite?.values).toMatchObject({ paidAmount: '11603.56', paymentStatus: 'paid' })
    const event = db.writes.find((w) => w.table === engagementEvents)?.values
    expect(event).toMatchObject({ eventType: 'system:payment_received', visibility: 'client' })
    expect(String(event?.message)).toBe(
      'Recibimos un pago de $11,603.56 MXN por transferencia SPEI el 15 de octubre de 2026.',
    )
  })

  it('keeps the event internal for a receipt hidden from the client, and skips a currency mismatch', async () => {
    const verified = evidence({ status: 'verified', clientVisible: false, currency: 'USD' })
    const db = fakeDb({
      updates: [[verified]],
      selects: [[{ id: 'order-1', currency: 'MXN', paidAmount: null, totalAmount: '100.00' }], []],
    })
    const result = await service(db).verify('pe-1')
    expect(result.order).toMatchObject({ applied: false, reason: 'currency_mismatch' })
    expect(db.writes.some((w) => w.table === orders)).toBe(false)
    expect(db.writes.find((w) => w.table === engagementEvents)?.values.visibility).toBe('internal')
  })

  it('refuses anything that is not recorded, and needs a linked CRM user', async () => {
    await expect(service(fakeDb({ updates: [[]] })).verify('pe-1')).rejects.toBeInstanceOf(
      ValidationError,
    )
    await expect(service(fakeDb(), undefined).verify('pe-1')).rejects.toThrow()
  })
})

describe('PaymentEvidenceService.void', () => {
  it('takes a verified amount back off the order and hides the client event', async () => {
    const before = evidence({ status: 'verified' })
    const db = fakeDb({
      selects: [
        [before],
        [{ id: 'order-1', currency: 'MXN', paidAmount: '11603.56', totalAmount: '11600.00' }],
        [],
      ],
      updates: [[{ ...before, status: 'voided' }]],
    })
    const result = await service(db).void('pe-1', 'Pago duplicado')
    expect(result.order).toMatchObject({ paidAmount: '0.00', paymentStatus: 'unpaid' })
    const hidden = db.writes.find((w) => w.table === engagementEvents && w.op === 'update')
    expect(hidden?.values).toEqual({ visibility: 'internal' })
    expect(
      db.writes.find((w) => w.table === engagementEvents && w.op === 'insert')?.values,
    ).toMatchObject({
      eventType: 'system:payment_voided',
      visibility: 'internal',
    })
  })

  it('needs a reason, refuses account numbers in it, and never voids twice', async () => {
    await expect(service(fakeDb()).void('pe-1', '  ')).rejects.toBeInstanceOf(ValidationError)
    await expect(service(fakeDb()).void('pe-1', 'cuenta 0123456789')).rejects.toBeInstanceOf(
      ValidationError,
    )
    const db = fakeDb({ selects: [[evidence({ status: 'voided' })]] })
    await expect(service(db).void('pe-1', 'Error')).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('client-facing payment data', () => {
  it('is on the client-visible allowlist', () => {
    expect(defaultEventVisibility('system:payment_received')).toBe('client')
    expect(defaultEventVisibility('system:payment_recorded')).toBe('internal')
    expect(defaultEventVisibility('system:payment_voided')).toBe('internal')
  })

  it('the client message carries date, amount and method, never account digits or folio', () => {
    const message = paymentReceivedMessage(evidence())
    expect(message).toContain('$11,603.56 MXN')
    expect(message).toContain('transferencia SPEI')
    expect(message).toContain('15 de octubre de 2026')
    expect(message).not.toMatch(/1234|5678|0012345678/)
  })

  it('the portal list leaves out folio, notes, names and the storage key', async () => {
    const db = fakeDb({
      selects: [
        [
          {
            id: 'pe-1',
            paidAt: new Date(),
            amount: '10.00',
            currency: 'MXN',
            method: 'cash',
            status: 'verified',
            originAccountLast4: null,
            evidenceMime: 'image/png',
            evidenceStorageKey: 'payment-evidence/x.png',
          },
        ],
      ],
    })
    const [row] = await service(db).listForClient('eng-1')
    expect(Object.keys(row ?? {}).sort()).toEqual([
      'amount',
      'currency',
      'evidenceMime',
      'hasEvidence',
      'id',
      'method',
      'originAccountLast4',
      'paidAt',
      'status',
    ])
    expect(row?.hasEvidence).toBe(true)
  })
})
