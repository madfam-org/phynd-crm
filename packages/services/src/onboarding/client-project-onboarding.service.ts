import {
  contacts,
  conversions,
  engagementArtifacts,
  engagementEvents,
  engagements,
  opportunities,
  orders,
  quotes,
} from '@phyne/db/schema'
import type { ServiceContext } from '../context'
import { ConflictError } from '../errors'

type OnboardingTx = Parameters<Parameters<ServiceContext['db']['transaction']>[0]>[0]

export type ClientProjectKind = 'digital' | 'physical' | 'phygital'

export type ClientProjectDeliveryTrack =
  | 'digital_experience'
  | 'digital_twin'
  | 'fabrication'
  | 'fulfillment'
  | 'kiosk'

export interface ClientProjectOnboardingInput {
  client: {
    name: string
    email?: string
    phone?: string
    company?: string
    externalJanuaId?: string
  }
  project: {
    name: string
    description?: string
    kind: ClientProjectKind
    deliveryTracks?: ClientProjectDeliveryTrack[]
  }
  commercial: {
    pipelineId: string
    stageId: string
    amount?: string
    currency?: string
    expectedCloseDate?: Date
    quoteNumber?: string
    quoteStatus?: 'draft' | 'sent'
    quoteValidUntil?: Date
    createProductionOrder?: boolean
    orderNumber?: string
    orderStatus?: 'pending' | 'confirmed' | 'in_production'
    estimatedCompletion?: Date
  }
  intakeSource?: 'api' | 'crm' | 'selva_office'
  ownerId?: string
}

export interface ClientProjectOnboardingResult {
  contact: typeof contacts.$inferSelect
  opportunity: typeof opportunities.$inferSelect
  engagement: typeof engagements.$inferSelect
  quote: typeof quotes.$inferSelect
  order: typeof orders.$inferSelect | null
}

export class ClientProjectOnboardingService {
  constructor(private readonly ctx: ServiceContext) {}

  async create(input: ClientProjectOnboardingInput): Promise<ClientProjectOnboardingResult> {
    const prepared = prepareInput(input, this.ctx.auth.userId)

    return this.ctx.db.transaction(async (tx) => {
      const contact = await createContact(tx, input, prepared.ownerId)
      const opportunity = await createOpportunity(tx, input, prepared, contact.id)
      await recordIntakeConversion(tx, input, prepared, contact.id, opportunity.id)

      const engagement = await createEngagement(
        tx,
        input,
        prepared.ownerId,
        contact.id,
        opportunity.id,
      )
      const quote = await createQuote(tx, input, prepared, contact.id, opportunity.id)
      await addQuoteArtifact(tx, engagement.id, quote)

      const order = prepared.createProductionOrder
        ? await createProductionOrder(
            tx,
            input,
            prepared,
            contact.id,
            opportunity.id,
            quote.id,
            engagement.id,
          )
        : null
      await recordIntakeEvent(
        tx,
        input,
        contact.id,
        opportunity.id,
        engagement.id,
        quote.id,
        order?.id ?? null,
      )

      return { contact, opportunity, engagement, quote, order }
    })
  }
}

interface PreparedOnboardingInput {
  amount?: string
  createProductionOrder: boolean
  currency: string
  orderNumber: string
  ownerId?: string
  quoteNumber: string
}

function prepareInput(input: ClientProjectOnboardingInput, fallbackOwnerId?: string) {
  return {
    ownerId: input.ownerId ?? fallbackOwnerId ?? undefined,
    currency: normalizeCurrency(input.commercial.currency),
    amount: input.commercial.amount,
    quoteNumber:
      input.commercial.quoteNumber ?? buildDocumentNumber('Q', input.project.name, new Date()),
    createProductionOrder: input.commercial.createProductionOrder ?? false,
    orderNumber:
      input.commercial.orderNumber ?? buildDocumentNumber('ORD', input.project.name, new Date()),
  } satisfies PreparedOnboardingInput
}

async function createContact(
  tx: OnboardingTx,
  input: ClientProjectOnboardingInput,
  ownerId: string | undefined,
) {
  const [contact] = await tx
    .insert(contacts)
    .values({
      name: input.client.name,
      email: input.client.email,
      phone: input.client.phone,
      company: input.client.company,
      externalJanuaId: input.client.externalJanuaId,
      ownerId,
    })
    .returning()
  if (!contact) throw new ConflictError('Failed to create onboarding contact')
  return contact
}

async function createOpportunity(
  tx: OnboardingTx,
  input: ClientProjectOnboardingInput,
  prepared: PreparedOnboardingInput,
  contactId: string,
) {
  const [opportunity] = await tx
    .insert(opportunities)
    .values({
      name: input.project.name,
      contactId,
      pipelineId: input.commercial.pipelineId,
      stageId: input.commercial.stageId,
      value: prepared.amount,
      probability: input.project.kind === 'physical' ? 50 : 60,
      expectedCloseDate: input.commercial.expectedCloseDate,
      ownerId: prepared.ownerId,
    })
    .returning()
  if (!opportunity) throw new ConflictError('Failed to create onboarding opportunity')
  return opportunity
}

async function recordIntakeConversion(
  tx: OnboardingTx,
  input: ClientProjectOnboardingInput,
  prepared: PreparedOnboardingInput,
  contactId: string,
  opportunityId: string,
) {
  await tx.insert(conversions).values({
    type: 'client_project_intake',
    contactId,
    opportunityId,
    value: prepared.amount,
    metadata: onboardingMetadata(input),
  })
}

async function createEngagement(
  tx: OnboardingTx,
  input: ClientProjectOnboardingInput,
  ownerId: string | undefined,
  contactId: string,
  opportunityId: string,
) {
  const [engagement] = await tx
    .insert(engagements)
    .values({
      contactId,
      opportunityId,
      projectName: input.project.name,
      description: input.project.description,
      status: 'active',
      ownerId,
    })
    .returning()
  if (!engagement) throw new ConflictError('Failed to create onboarding engagement')
  return engagement
}

async function createQuote(
  tx: OnboardingTx,
  input: ClientProjectOnboardingInput,
  prepared: PreparedOnboardingInput,
  contactId: string,
  opportunityId: string,
) {
  const [quote] = await tx
    .insert(quotes)
    .values({
      quoteNumber: prepared.quoteNumber,
      opportunityId,
      contactId,
      status: input.commercial.quoteStatus ?? 'draft',
      totalAmount: prepared.amount,
      currency: prepared.currency,
      validUntil: input.commercial.quoteValidUntil,
      ownerId: prepared.ownerId,
    })
    .returning()
  if (!quote) throw new ConflictError('Failed to create onboarding quote')
  return quote
}

async function addQuoteArtifact(
  tx: OnboardingTx,
  engagementId: string,
  quote: typeof quotes.$inferSelect,
) {
  await tx.insert(engagementArtifacts).values({
    engagementId,
    type: 'quote',
    entityType: 'quote',
    entityId: quote.id,
    title: `Quote ${quote.quoteNumber}`,
    metadata: {
      status: quote.status,
      currency: quote.currency,
      total_amount: quote.totalAmount,
    },
  })
}

async function createProductionOrder(
  tx: OnboardingTx,
  input: ClientProjectOnboardingInput,
  prepared: PreparedOnboardingInput,
  contactId: string,
  opportunityId: string,
  quoteId: string,
  engagementId: string,
) {
  const [order] = await tx
    .insert(orders)
    .values({
      orderNumber: prepared.orderNumber,
      opportunityId,
      quoteId,
      contactId,
      status: input.commercial.orderStatus ?? 'pending',
      totalAmount: prepared.amount,
      currency: prepared.currency,
      estimatedCompletion: input.commercial.estimatedCompletion,
      ownerId: prepared.ownerId,
    })
    .returning()
  if (!order) throw new ConflictError('Failed to create onboarding production order')

  await tx.insert(engagementEvents).values({
    engagementId,
    source: 'system',
    eventType: 'system:production_order_created',
    status: order.status === 'in_production' ? 'in_progress' : 'pending',
    message: `Production order ${order.orderNumber} created`,
    metadata: { order_id: order.id, quote_id: quoteId, opportunity_id: opportunityId },
    dedupKey: `system:${engagementId}:order:${order.id}`,
  })
  return order
}

async function recordIntakeEvent(
  tx: OnboardingTx,
  input: ClientProjectOnboardingInput,
  contactId: string,
  opportunityId: string,
  engagementId: string,
  quoteId: string,
  orderId: string | null,
) {
  await tx.insert(engagementEvents).values({
    engagementId,
    source: 'system',
    eventType: 'system:intake_created',
    status: 'pending',
    message: `${input.project.kind} project intake created`,
    metadata: {
      ...onboardingMetadata(input),
      contact_id: contactId,
      opportunity_id: opportunityId,
      quote_id: quoteId,
      order_id: orderId,
    },
    dedupKey: `system:${engagementId}:intake`,
  })
}

function normalizeCurrency(currency: string | undefined): string {
  return (currency?.trim() || 'USD').toUpperCase()
}

function onboardingMetadata(input: ClientProjectOnboardingInput): Record<string, unknown> {
  return {
    project_kind: input.project.kind,
    delivery_tracks: input.project.deliveryTracks ?? [],
    intake_source: input.intakeSource ?? 'crm',
  }
}

function buildDocumentNumber(prefix: string, projectName: string, now: Date): string {
  const date = now.toISOString().slice(0, 10).replaceAll('-', '')
  const slug = projectName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 18)
  return `${prefix}-${date}${slug ? `-${slug}` : ''}`
}
