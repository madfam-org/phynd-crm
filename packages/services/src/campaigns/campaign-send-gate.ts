import { campaigns, contacts, leads } from '@phynd/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { ConsentChannel } from '../consent/consent-state-machine'
import { ConsentService } from '../consent/consent.service'
import { SuppressionService } from '../consent/suppression.service'
import type { ServiceContext } from '../context'
import { NotFoundError } from '../errors'

export type CampaignSendEligibility = {
  eligible: boolean
  reasons: string[]
  channel: string
}

/**
 * Consent-model inputs for the pure eligibility evaluation. When omitted the
 * gate falls back to the legacy `contacts.marketingConsent` boolean only.
 */
export type ConsentGateInput = {
  /** Current channel-scoped consent record status, or null when none exists. */
  consentStatus: 'granted' | 'revoked' | 'pending_double_opt_in' | null
  /** Matching suppression-list entries (channel or 'all'). */
  suppressionReasons: string[]
}

type TulanaDraft = { channel?: string }

export function resolveOutreachChannel(campaign: {
  channel: string
  tulanaMetadata: Record<string, unknown> | null
}): string {
  const metadata = campaign.tulanaMetadata ?? {}
  const drafts = (metadata.drafts as TulanaDraft[] | undefined) ?? []
  return drafts[0]?.channel ?? campaign.channel
}

/**
 * Maps an outreach channel to the consent channel it is gated on. Unknown
 * channels (social, other…) fall back to email consent since email is the
 * only direct-outreach medium they could carry.
 */
export function consentChannelForOutreach(channel: string): ConsentChannel {
  const normalized = channel.toLowerCase()
  if (normalized === 'sms' || normalized === 'phone') return 'sms'
  if (normalized === 'whatsapp') return 'whatsapp'
  return 'email'
}

export function evaluateContactEligibility(
  contact: {
    marketingConsent: boolean
    email: string | null
    phone: string | null
    deletedAt: Date | null
  },
  leadRows: { unsubscribed: boolean }[],
  channel: string,
  consentGate?: ConsentGateInput,
): CampaignSendEligibility {
  const reasons: string[] = []

  // Suppression list wins over ANY consent — checked first, never overridden.
  if (consentGate && consentGate.suppressionReasons.length > 0) {
    reasons.push('suppressed')
  }

  if (contact.deletedAt) {
    reasons.push('contact_deleted')
  }

  if (consentGate?.consentStatus) {
    // An explicit channel-scoped consent record overrides the legacy boolean
    // in both directions: granted permits, revoked/pending blocks.
    if (consentGate.consentStatus === 'revoked') {
      reasons.push('channel_consent_revoked')
    } else if (consentGate.consentStatus === 'pending_double_opt_in') {
      reasons.push('channel_consent_pending_double_opt_in')
    }
  } else if (!contact.marketingConsent) {
    // No consent record for the channel — legacy boolean is the fallback.
    reasons.push('marketing_consent_missing')
  }

  if (leadRows.some((lead) => lead.unsubscribed)) {
    reasons.push('lead_unsubscribed')
  }

  const normalizedChannel = channel.toLowerCase()
  if (normalizedChannel === 'email' && !contact.email) {
    reasons.push('email_missing')
  }
  if ((normalizedChannel === 'sms' || normalizedChannel === 'phone') && !contact.phone) {
    reasons.push('phone_missing')
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    channel: normalizedChannel,
  }
}

export async function checkCampaignSendEligibility(
  ctx: ServiceContext,
  input: { campaignId: string; contactId: string },
): Promise<CampaignSendEligibility> {
  const [campaign] = await ctx.db.select().from(campaigns).where(eq(campaigns.id, input.campaignId))

  if (!campaign) {
    throw new NotFoundError('Campaign', input.campaignId)
  }

  const [contact] = await ctx.db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, input.contactId), isNull(contacts.deletedAt)))

  if (!contact) {
    throw new NotFoundError('Contact', input.contactId)
  }

  const leadRows = await ctx.db
    .select({ unsubscribed: leads.unsubscribed })
    .from(leads)
    .where(and(eq(leads.contactId, input.contactId), isNull(leads.deletedAt)))

  const channel = resolveOutreachChannel(campaign)
  const consentChannel = consentChannelForOutreach(channel)
  const identifier = consentChannel === 'email' ? contact.email : contact.phone

  let consentGate: ConsentGateInput | undefined
  if (identifier) {
    const consentService = new ConsentService(ctx)
    const suppressionService = new SuppressionService(ctx)
    const record = await consentService.getConsent(identifier, consentChannel)
    const suppression = await suppressionService.check(identifier, consentChannel)
    consentGate = {
      consentStatus: (record?.status as ConsentGateInput['consentStatus']) ?? null,
      suppressionReasons: suppression.entries.map((entry) => entry.reason),
    }
  }

  return evaluateContactEligibility(contact, leadRows, channel, consentGate)
}
