import {
  type PaymentEvidence,
  type PaymentEvidenceSource,
  type PaymentMethod,
  engagementEvents,
  engagements,
  orders,
  paymentEvidence,
  quotes,
} from '@phynd/db/schema'
import { and, desc, eq, isNull, ne } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { NotFoundError, ValidationError } from '../errors'
import { actorIdOf, requireCrmUserId } from '../identity/actor'
import { findAccountViolations } from './account-guard'
export { canViewEvidence, type EvidenceViewer } from './access'
import { isEvidenceKeyFor } from './evidence-file'
import {
  type Reconciliation,
  formatMxMoney,
  fromCents,
  orderPaymentStatus,
  reconcile,
  toCents,
} from './reconciliation'

export interface PaymentEvidenceInput {
  quoteId?: string | null
  orderId?: string | null
  contactId?: string | null
  method: PaymentMethod
  bankName?: string | null
  operationType?: string | null
  folio?: string | null
  trackingKey?: string | null
  paidAt: Date
  amount: string
  currency?: string
  reference?: string | null
  originAccountLast4?: string | null
  destinationAccountLast4?: string | null
  beneficiaryName?: string | null
  notes?: string | null
  source?: PaymentEvidenceSource
  extractionConfidence?: number | null
  evidenceStorageKey?: string | null
  evidenceMime?: string | null
  evidenceSha256?: string | null
  clientVisible?: boolean
  externalKey?: string | null
}

export type PaymentEvidencePatch = Partial<PaymentEvidenceInput>

/** What the client portal shows: no folio, tracking key, notes, or account beyond last 4. */
export interface ClientPaymentEvidence {
  id: string
  paidAt: Date
  amount: string
  currency: string
  method: PaymentMethod
  status: 'recorded' | 'verified'
  originAccountLast4: string | null
  evidenceMime: string | null
  hasEvidence: boolean
}

const METHOD_TEXT: Record<PaymentMethod, string> = {
  spei_transfer: 'transferencia SPEI',
  card: 'tarjeta',
  cash: 'efectivo',
  other: 'otro medio',
}

/** Client-safe fixed copy (register-neutral; no account digits, folio or names). */
export function paymentReceivedMessage(
  e: Pick<PaymentEvidence, 'amount' | 'currency' | 'method' | 'paidAt'>,
) {
  const money = formatMxMoney(toCents(e.amount) ?? 0, e.currency)
  const date = new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'long',
    timeZone: 'America/Mexico_City',
  }).format(e.paidAt)
  return `Recibimos un pago de ${money} ${e.currency} por ${METHOD_TEXT[e.method] ?? METHOD_TEXT.other} el ${date}.`
}

type Tx = Parameters<Parameters<ServiceContext['db']['transaction']>[0]>[0]

export class PaymentEvidenceService {
  constructor(private readonly ctx: ServiceContext) {}

  async list(engagementId: string): Promise<PaymentEvidence[]> {
    return this.ctx.db
      .select()
      .from(paymentEvidence)
      .where(eq(paymentEvidence.engagementId, engagementId))
      .orderBy(desc(paymentEvidence.paidAt))
  }

  async getById(id: string): Promise<PaymentEvidence> {
    const [row] = await this.ctx.db
      .select()
      .from(paymentEvidence)
      .where(eq(paymentEvidence.id, id))
      .limit(1)
    if (!row) throw new NotFoundError('Payment evidence', id)
    return row
  }

  async create(engagementId: string, input: PaymentEvidenceInput): Promise<PaymentEvidence> {
    // Validate before any database read: a refused record never reaches the db.
    const values = normalizeInput(input)
    validateRecord(values)
    const engagement = await this.requireEngagement(engagementId)
    await this.requireLinks(engagement, values.quoteId ?? null, values.orderId ?? null)
    return this.ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(paymentEvidence)
        .values({
          ...toColumns(values),
          method: input.method,
          paidAt: input.paidAt,
          amount: values.amount ?? input.amount,
          engagementId,
          contactId: values.contactId ?? engagement.contactId,
          status: 'recorded',
          createdBy: actorIdOf(this.ctx.auth),
        })
        .returning()
      if (!row) throw new ValidationError('Failed to record payment evidence')
      await this.event(tx, row, 'system:payment_recorded', 'internal', 'Pago registrado')
      return row
    })
  }

  /** Corrections are allowed while the evidence is only recorded. */
  async update(id: string, patch: PaymentEvidencePatch): Promise<PaymentEvidence> {
    const existing = await this.getById(id)
    if (existing.status !== 'recorded') {
      throw new ValidationError('Only recorded (not yet verified or voided) payments can be edited')
    }
    const values = normalizeInput({ ...toInput(existing), ...patch })
    validateRecord(values)
    const engagement = await this.requireEngagement(existing.engagementId)
    await this.requireLinks(engagement, values.quoteId ?? null, values.orderId ?? null)
    const contactId = values.contactId
    const [row] = await this.ctx.db
      .update(paymentEvidence)
      .set({ ...toColumns(values), ...(contactId ? { contactId } : {}), updatedAt: new Date() })
      .where(and(eq(paymentEvidence.id, id), eq(paymentEvidence.status, 'recorded')))
      .returning()
    if (!row) throw new ValidationError('The payment changed while it was being edited')
    return row
  }

  /**
   * recorded -> verified. Adds the amount to the linked order's paid_amount
   * (same currency only), recomputes its payment_status, and tells the client
   * (event system:payment_received, client-visible when the evidence is).
   */
  async verify(id: string) {
    const verifierId = requireCrmUserId(this.ctx.auth)
    return this.ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .update(paymentEvidence)
        .set({
          status: 'verified',
          verifiedByUserId: verifierId,
          verifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(paymentEvidence.id, id), eq(paymentEvidence.status, 'recorded')))
        .returning()
      if (!row) throw new ValidationError('Only a recorded payment can be verified')
      const order = row.orderId ? await applyToOrder(tx, row, +1) : null
      await this.event(
        tx,
        row,
        'system:payment_received',
        row.clientVisible ? 'client' : 'internal',
        paymentReceivedMessage(row),
      )
      return { evidence: row, order }
    })
  }

  /** recorded|verified -> voided. Never deleted; a verified amount is taken back off the order. */
  async void(id: string, reason: string) {
    const voiderId = requireCrmUserId(this.ctx.auth)
    if (!reason.trim()) throw new ValidationError('A reason is required to void a payment')
    validateRecord({ notes: reason })
    return this.ctx.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(paymentEvidence)
        .where(eq(paymentEvidence.id, id))
        .for('update')
      if (!before) throw new NotFoundError('Payment evidence', id)
      if (before.status === 'voided') throw new ValidationError('The payment is already voided')
      const [row] = await tx
        .update(paymentEvidence)
        .set({
          status: 'voided',
          voidedByUserId: voiderId,
          voidedAt: new Date(),
          voidReason: reason.trim(),
          updatedAt: new Date(),
        })
        .where(and(eq(paymentEvidence.id, id), ne(paymentEvidence.status, 'voided')))
        .returning()
      if (!row) throw new ValidationError('The payment changed while it was being voided')
      const order =
        before.status === 'verified' && row.orderId ? await applyToOrder(tx, row, -1) : null
      // The client no longer sees "payment received" for a voided payment.
      await tx
        .update(engagementEvents)
        .set({ visibility: 'internal' })
        .where(
          and(
            eq(engagementEvents.engagementId, row.engagementId),
            eq(engagementEvents.dedupKey, dedupKey('system:payment_received', row.id)),
          ),
        )
      await this.event(tx, row, 'system:payment_voided', 'internal', 'Pago anulado')
      return { evidence: row, order }
    })
  }

  /** Due versus received for the evidence's order (else quote). */
  async reconciliationFor(
    id: string,
  ): Promise<Reconciliation & { target: 'order' | 'quote' | null }> {
    const e = await this.getById(id)
    if (e.orderId) {
      const [order] = await this.ctx.db
        .select()
        .from(orders)
        .where(eq(orders.id, e.orderId))
        .limit(1)
      const payments = await this.ctx.db
        .select({
          amount: paymentEvidence.amount,
          currency: paymentEvidence.currency,
          status: paymentEvidence.status,
        })
        .from(paymentEvidence)
        .where(eq(paymentEvidence.orderId, e.orderId))
      return {
        target: 'order',
        ...reconcile({
          due: order?.totalAmount ?? null,
          dueCurrency: order?.currency ?? e.currency,
          payments,
        }),
      }
    }
    if (e.quoteId) {
      const [quote] = await this.ctx.db
        .select()
        .from(quotes)
        .where(eq(quotes.id, e.quoteId))
        .limit(1)
      const payments = await this.ctx.db
        .select({
          amount: paymentEvidence.amount,
          currency: paymentEvidence.currency,
          status: paymentEvidence.status,
        })
        .from(paymentEvidence)
        .where(eq(paymentEvidence.quoteId, e.quoteId))
      return {
        target: 'quote',
        ...reconcile({
          due: quote?.totalAmount ?? null,
          dueCurrency: quote?.currency ?? e.currency,
          payments,
        }),
      }
    }
    return { target: null, ...reconcile({ due: null, dueCurrency: e.currency, payments: [e] }) }
  }

  /** The portal's payments: client-visible and not voided; never folio, notes or full accounts. */
  async listForClient(engagementId: string): Promise<ClientPaymentEvidence[]> {
    const rows = await this.ctx.db
      .select({
        id: paymentEvidence.id,
        paidAt: paymentEvidence.paidAt,
        amount: paymentEvidence.amount,
        currency: paymentEvidence.currency,
        method: paymentEvidence.method,
        status: paymentEvidence.status,
        originAccountLast4: paymentEvidence.originAccountLast4,
        evidenceMime: paymentEvidence.evidenceMime,
        evidenceStorageKey: paymentEvidence.evidenceStorageKey,
      })
      .from(paymentEvidence)
      .where(
        and(
          eq(paymentEvidence.engagementId, engagementId),
          eq(paymentEvidence.clientVisible, true),
          ne(paymentEvidence.status, 'voided'),
        ),
      )
      .orderBy(desc(paymentEvidence.paidAt))
    return rows.map(({ evidenceStorageKey, status, ...r }) => ({
      ...r,
      status: status === 'verified' ? 'verified' : 'recorded',
      hasEvidence: Boolean(evidenceStorageKey),
    }))
  }

  private async event(
    db: Tx,
    row: PaymentEvidence,
    eventType: string,
    visibility: 'client' | 'internal',
    message: string,
  ) {
    const key = dedupKey(eventType, row.id)
    const [existing] = await db
      .select({ id: engagementEvents.id })
      .from(engagementEvents)
      .where(
        and(
          eq(engagementEvents.engagementId, row.engagementId),
          eq(engagementEvents.dedupKey, key),
        ),
      )
      .limit(1)
    if (existing) return
    await db.insert(engagementEvents).values({
      engagementId: row.engagementId,
      source: 'system',
      eventType,
      status: eventType === 'system:payment_received' ? 'milestone' : 'completed',
      message,
      visibility,
      dedupKey: key,
      metadata: {
        payment_evidence_id: row.id,
        amount: row.amount,
        currency: row.currency,
        method: row.method,
        actor: actorIdOf(this.ctx.auth),
      },
    })
  }

  private async requireEngagement(engagementId: string) {
    const [row] = await this.ctx.db
      .select({
        id: engagements.id,
        contactId: engagements.contactId,
        opportunityId: engagements.opportunityId,
      })
      .from(engagements)
      .where(and(eq(engagements.id, engagementId), isNull(engagements.deletedAt)))
      .limit(1)
    if (!row) throw new NotFoundError('Engagement', engagementId)
    return row
  }

  /** A linked quote/order must belong to the engagement's opportunity or contact. */
  private async requireLinks(
    engagement: { contactId: string; opportunityId: string | null },
    quoteId: string | null,
    orderId: string | null,
  ) {
    const belongs = (r: { opportunityId: string | null; contactId: string | null }) =>
      (engagement.opportunityId !== null && r.opportunityId === engagement.opportunityId) ||
      r.contactId === engagement.contactId
    if (quoteId) {
      const [q] = await this.ctx.db
        .select({ opportunityId: quotes.opportunityId, contactId: quotes.contactId })
        .from(quotes)
        .where(and(eq(quotes.id, quoteId), isNull(quotes.deletedAt)))
        .limit(1)
      if (!q || !belongs(q))
        throw new ValidationError('The quote does not belong to this engagement')
    }
    if (orderId) {
      const [o] = await this.ctx.db
        .select({
          opportunityId: orders.opportunityId,
          contactId: orders.contactId,
          quoteId: orders.quoteId,
        })
        .from(orders)
        .where(and(eq(orders.id, orderId), isNull(orders.deletedAt)))
        .limit(1)
      if (!o || !belongs(o))
        throw new ValidationError('The order does not belong to this engagement')
      if (quoteId && o.quoteId && o.quoteId !== quoteId) {
        throw new ValidationError('The order belongs to a different quote')
      }
    }
  }
}

const dedupKey = (eventType: string, id: string) => `${eventType}:${id}`

/** Adds (+1) or removes (−1) a verified amount on its order. */
async function applyToOrder(tx: Tx, e: PaymentEvidence, sign: 1 | -1) {
  if (!e.orderId) return null
  const [order] = await tx.select().from(orders).where(eq(orders.id, e.orderId)).for('update')
  if (!order) return null
  if (order.currency.toUpperCase() !== e.currency.toUpperCase()) {
    return { orderId: order.id, applied: false as const, reason: 'currency_mismatch' as const }
  }
  const paidCents = Math.max(0, (toCents(order.paidAmount) ?? 0) + sign * (toCents(e.amount) ?? 0))
  const paymentStatus = orderPaymentStatus(paidCents, toCents(order.totalAmount))
  await tx
    .update(orders)
    .set({
      paidAmount: fromCents(paidCents),
      paymentStatus,
      paidAt: paymentStatus === 'paid' ? (order.paidAt ?? e.paidAt) : order.paidAt,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, order.id))
  return {
    orderId: order.id,
    applied: true as const,
    paidAmount: fromCents(paidCents),
    paymentStatus,
  }
}

function trimOrNull(v: string | null | undefined) {
  if (v === undefined) return undefined
  const t = v?.trim()
  return t ? t : null
}

function normalizeInput(input: PaymentEvidencePatch): PaymentEvidencePatch {
  const out: PaymentEvidencePatch = { ...input }
  for (const k of [
    'bankName',
    'operationType',
    'folio',
    'trackingKey',
    'reference',
    'originAccountLast4',
    'destinationAccountLast4',
    'beneficiaryName',
    'notes',
  ] as const) {
    if (k in out) out[k] = trimOrNull(out[k])
  }
  if (out.currency) out.currency = out.currency.trim().toUpperCase()
  if (out.amount !== undefined) out.amount = String(out.amount).trim()
  if (out.extractionConfidence !== undefined && out.extractionConfidence !== null) {
    out.extractionConfidence = Number(out.extractionConfidence)
  }
  return out
}

/** Refuses full account numbers anywhere, bad amounts, and keys that do not match the file. */
export function validateRecord(values: PaymentEvidencePatch): void {
  const violations = findAccountViolations(values as Record<string, unknown>)
  if (violations.length > 0) {
    const fields = [...new Set(violations.map((v) => v.field))].join(', ')
    throw new ValidationError(
      `Remove account, CLABE or card numbers (keep at most the last 4 digits): ${fields}`,
    )
  }
  if (values.amount !== undefined) {
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(values.amount) || Number(values.amount) <= 0) {
      throw new ValidationError('Amount must be a positive number with at most 2 decimals')
    }
  }
  if (values.currency !== undefined && !/^[A-Z]{3}$/.test(values.currency)) {
    throw new ValidationError('Currency must be a 3-letter ISO code')
  }
  const c = values.extractionConfidence
  if (c !== undefined && c !== null && !(c >= 0 && c <= 1)) {
    throw new ValidationError('Extraction confidence must be between 0 and 1')
  }
  if (values.evidenceStorageKey) {
    if (
      !values.evidenceSha256 ||
      !values.evidenceMime ||
      !isEvidenceKeyFor(values.evidenceStorageKey, values.evidenceSha256, values.evidenceMime)
    ) {
      throw new ValidationError('The evidence file reference is inconsistent')
    }
  }
}

/** Patch -> column values (numeric confidence is stored as a string; contact handled apart). */
function toColumns(
  values: PaymentEvidencePatch,
): Omit<Partial<typeof paymentEvidence.$inferInsert>, 'contactId'> {
  const { extractionConfidence, contactId: _contactId, ...rest } = values
  return {
    ...rest,
    ...(extractionConfidence === undefined
      ? {}
      : {
          extractionConfidence:
            extractionConfidence === null ? null : Number(extractionConfidence).toFixed(3),
        }),
  }
}

function toInput(e: PaymentEvidence): PaymentEvidenceInput {
  return {
    quoteId: e.quoteId,
    orderId: e.orderId,
    contactId: e.contactId,
    method: e.method,
    bankName: e.bankName,
    operationType: e.operationType,
    folio: e.folio,
    trackingKey: e.trackingKey,
    paidAt: e.paidAt,
    amount: e.amount,
    currency: e.currency,
    reference: e.reference,
    originAccountLast4: e.originAccountLast4,
    destinationAccountLast4: e.destinationAccountLast4,
    beneficiaryName: e.beneficiaryName,
    notes: e.notes,
    source: e.source,
    extractionConfidence: e.extractionConfidence === null ? null : Number(e.extractionConfidence),
    evidenceStorageKey: e.evidenceStorageKey,
    evidenceMime: e.evidenceMime,
    evidenceSha256: e.evidenceSha256,
    clientVisible: e.clientVisible,
    externalKey: e.externalKey,
  }
}
