import { campaignEmailEvents, campaigns, contacts } from '@phynd/db/schema'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { SuppressionService } from '../consent/suppression.service'
import type { ServiceContext } from '../context'
import {
  type BuyerSignalEventType,
  CampaignBuyerSignalService,
} from './campaign-buyer-signal.service'

export type EmailEventType =
  | 'sent'
  | 'delivered'
  | 'delivery_delayed'
  | 'opened'
  | 'clicked'
  | 'bounced'
  | 'complained'

export type RecordEmailEventInput = {
  eventType: EmailEventType
  recipient: string
  emailId?: string | null
  campaignId?: string | null
  contactId?: string | null
  leadId?: string | null
  url?: string | null
  dedupKey: string
  metadata?: Record<string, unknown>
  occurredAt?: Date
}

/** Resend webhook event shape (the fields we consume). */
export type ResendWebhookEvent = {
  type: string
  created_at?: string
  data: {
    email_id?: string
    to?: string | string[]
    subject?: string
    // Resend delivers tags as an object map in webhook payloads; the send
    // API accepts an array of { name, value }. Support both.
    tags?: Record<string, string> | { name: string; value: string }[]
    click?: { link?: string; timestamp?: string }
    bounce?: { type?: string; subType?: string; message?: string }
  }
}

export type IngestResult = {
  handled: boolean
  deduplicated: boolean
  eventType?: EmailEventType
  campaignId?: string | null
  contactId?: string | null
  suppressionAdded?: boolean
}

const RESEND_EVENT_MAP: Record<string, EmailEventType> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delivery_delayed',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
}

// Engagement events that become Tulana buyer signals when the email is tied
// to a SKU campaign. `delivered` is intentionally absent — attemptTulanaSend
// already records a `delivered` signal at dispatch time.
const BUYER_SIGNAL_STRENGTH: Partial<
  Record<Extract<EmailEventType, BuyerSignalEventType>, 'low' | 'medium' | 'high'>
> = {
  opened: 'low',
  clicked: 'medium',
  bounced: 'low',
  complained: 'low',
}

function normalizeTags(
  tags: ResendWebhookEvent['data']['tags'],
): Record<string, string | undefined> {
  if (!tags) return {}
  if (Array.isArray(tags)) {
    return Object.fromEntries(tags.map((tag) => [tag.name, tag.value]))
  }
  return tags
}

function resolveRecipient(event: ResendWebhookEvent): string | null {
  const toField = event.data.to
  const recipient = (Array.isArray(toField) ? toField[0] : toField)?.toLowerCase()
  return recipient ?? null
}

function resolveOccurredAt(event: ResendWebhookEvent): Date {
  const occurredAt = event.created_at ? new Date(event.created_at) : new Date()
  return Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt
}

function buildEventMetadata(
  event: ResendWebhookEvent,
  tags: Record<string, string | undefined>,
): Record<string, unknown> {
  return {
    resendType: event.type,
    subject: event.data.subject,
    ...(event.data.bounce ? { bounce: event.data.bounce } : {}),
    ...(tags.drip_step ? { dripStep: tags.drip_step } : {}),
  }
}

/**
 * Persists per-recipient email delivery/engagement events and fans them out:
 *   - `campaign_email_events` row (idempotent via dedupKey)
 *   - buyer signal for SKU campaigns (feeds the Tulana export)
 *   - suppression-list entry on bounce/complaint (suppression wins over
 *     consent, so a complained address can never be emailed again)
 */
export class CampaignEmailEventService {
  constructor(private readonly ctx: ServiceContext) {}

  async record(input: RecordEmailEventInput) {
    const [existing] = await this.ctx.db
      .select({ id: campaignEmailEvents.id })
      .from(campaignEmailEvents)
      .where(eq(campaignEmailEvents.dedupKey, input.dedupKey))
      .limit(1)

    if (existing) {
      return { id: existing.id, deduplicated: true }
    }

    const [row] = await this.ctx.db
      .insert(campaignEmailEvents)
      .values({
        eventType: input.eventType,
        recipient: input.recipient.toLowerCase(),
        emailId: input.emailId ?? null,
        campaignId: input.campaignId ?? null,
        contactId: input.contactId ?? null,
        leadId: input.leadId ?? null,
        url: input.url ?? null,
        dedupKey: input.dedupKey,
        metadata: input.metadata ?? {},
        occurredAt: input.occurredAt ?? new Date(),
      })
      .returning()

    return { id: row?.id ?? '', deduplicated: false }
  }

  async listForCampaign(campaignId: string, filters?: { eventType?: EmailEventType }) {
    const conditions = [eq(campaignEmailEvents.campaignId, campaignId)]
    if (filters?.eventType) {
      conditions.push(eq(campaignEmailEvents.eventType, filters.eventType))
    }
    return this.ctx.db
      .select()
      .from(campaignEmailEvents)
      .where(and(...conditions))
      .orderBy(desc(campaignEmailEvents.occurredAt))
  }

  /**
   * Ingests one verified Resend webhook event. `dedupKey` should be the svix
   * message id (unique per webhook message, stable across redeliveries).
   */
  async ingestResendEvent(event: ResendWebhookEvent, dedupKey: string): Promise<IngestResult> {
    const eventType = RESEND_EVENT_MAP[event.type]
    const recipient = resolveRecipient(event)
    if (!eventType || !recipient) {
      return { handled: false, deduplicated: false }
    }

    const tags = normalizeTags(event.data.tags)
    const emailId = event.data.email_id ?? null
    const occurredAt = resolveOccurredAt(event)

    const campaignId = tags.campaign_id ?? null
    const leadId = tags.lead_id ?? null
    const contactId = tags.contact_id ?? (await this.findContactIdByEmail(recipient))

    const recorded = await this.record({
      eventType,
      recipient,
      emailId,
      campaignId,
      contactId,
      leadId,
      url: eventType === 'clicked' ? (event.data.click?.link ?? null) : null,
      dedupKey,
      metadata: buildEventMetadata(event, tags),
      occurredAt,
    })

    if (recorded.deduplicated) {
      return { handled: true, deduplicated: true, eventType, campaignId, contactId }
    }

    const suppressionAdded = await this.maybeAddSuppression(eventType, recipient, emailId)
    await this.maybeRecordBuyerSignal({ eventType, campaignId, contactId, recipient, occurredAt })

    return {
      handled: true,
      deduplicated: false,
      eventType,
      campaignId,
      contactId,
      suppressionAdded,
    }
  }

  /** Bounces/complaints auto-suppress the address across all products. */
  private async maybeAddSuppression(
    eventType: EmailEventType,
    recipient: string,
    emailId: string | null,
  ): Promise<boolean> {
    if (eventType !== 'bounced' && eventType !== 'complained') {
      return false
    }
    const suppressionService = new SuppressionService(this.ctx)
    const { created } = await suppressionService.add({
      identifier: recipient,
      channel: 'email',
      reason: eventType === 'complained' ? 'complaint' : 'hard_bounce',
      source: 'resend_webhook',
      evidence: `Resend email.${eventType} for message ${emailId ?? 'unknown'}`,
      metadata: emailId ? { emailId } : {},
    })
    return created
  }

  private async maybeRecordBuyerSignal(input: {
    eventType: EmailEventType
    campaignId: string | null
    contactId: string | null
    recipient: string
    occurredAt: Date
  }): Promise<void> {
    const eventType = input.eventType as Extract<EmailEventType, BuyerSignalEventType>
    const strength = BUYER_SIGNAL_STRENGTH[eventType]
    if (!strength || !input.campaignId) {
      return
    }

    const [campaign] = await this.ctx.db
      .select({
        skuKey: campaigns.skuKey,
        orchestrator: campaigns.orchestrator,
        tulanaMetadata: campaigns.tulanaMetadata,
      })
      .from(campaigns)
      .where(eq(campaigns.id, input.campaignId))
      .limit(1)

    if (!campaign?.skuKey) {
      return
    }

    const signalService = new CampaignBuyerSignalService(this.ctx)
    await signalService.record({
      campaignId: input.campaignId,
      contactId: input.contactId ?? undefined,
      skuKey: campaign.skuKey,
      contactSegment:
        (campaign.tulanaMetadata?.audience as string | undefined) ?? campaign.orchestrator ?? null,
      eventType,
      signalStrength: strength,
      // One signal per event type per campaign+recipient — repeat opens do
      // not inflate the Tulana export.
      dedupKey: `${eventType}:${input.campaignId}:${input.contactId ?? input.recipient}`,
      metadata: { channel: 'email' },
      occurredAt: input.occurredAt,
    })
  }

  private async findContactIdByEmail(email: string): Promise<string | null> {
    const [contact] = await this.ctx.db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.email, email), isNull(contacts.deletedAt)))
      .limit(1)
    return contact?.id ?? null
  }
}
