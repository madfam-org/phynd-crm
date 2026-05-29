import { campaigns, contacts, leads } from '@phynd/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { NotFoundError } from '../errors'

export type CampaignSendEligibility = {
  eligible: boolean
  reasons: string[]
  channel: string
}

type TulanaDraft = { channel?: string }

function resolveOutreachChannel(campaign: {
  channel: string
  tulanaMetadata: Record<string, unknown> | null
}): string {
  const metadata = campaign.tulanaMetadata ?? {}
  const drafts = (metadata.drafts as TulanaDraft[] | undefined) ?? []
  return drafts[0]?.channel ?? campaign.channel
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
): CampaignSendEligibility {
  const reasons: string[] = []

  if (contact.deletedAt) {
    reasons.push('contact_deleted')
  }
  if (!contact.marketingConsent) {
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
  return evaluateContactEligibility(contact, leadRows, channel)
}
