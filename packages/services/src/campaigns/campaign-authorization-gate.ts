import { campaignAuthorizations, type campaigns } from '@phynd/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import type { ServiceContext } from '../context'
import { resolveSenderIdentity } from '../email/email.service'
import { ValidationError } from '../errors'
import {
  buildAuthorizationPayload,
  hashAuthorizationPayload,
  loadCampaignVariants,
} from './campaign-authorization.service'

type CampaignRow = typeof campaigns.$inferSelect

/**
 * Hard human-authorization gate on the campaign send path (fail closed).
 *
 * `attemptTulanaSend` calls this after the GA/claims gate and before any
 * consent evaluation. It requires:
 *
 *   1. an `authorized` campaign_authorizations row for the campaign, and
 *   2. that row's payloadHash to match the campaign's CURRENT authorization
 *      payload (copy variants, schedule, sender, audience definition…).
 *
 * No record → blocked. Content drifted after authorization → blocked. There
 * is deliberately no env-var or role bypass: an unauthorized send must be
 * impossible through every dispatch surface (tRPC, webhook, worker).
 *
 * Returns the matching authorization row so callers can stamp its id into
 * the buyer-signal audit metadata.
 */
export async function assertCampaignSendAuthorized(
  ctx: ServiceContext,
  campaign: CampaignRow,
): Promise<typeof campaignAuthorizations.$inferSelect> {
  const [record] = await ctx.db
    .select()
    .from(campaignAuthorizations)
    .where(
      and(
        eq(campaignAuthorizations.campaignId, campaign.id),
        eq(campaignAuthorizations.status, 'authorized'),
      ),
    )
    .orderBy(desc(campaignAuthorizations.decidedAt))
    .limit(1)

  if (!record) {
    throw new ValidationError(
      'Campaign send blocked: no owner authorization on record. ' +
        'Request authorization and get an explicit approval before sending.',
    )
  }

  const variants = await loadCampaignVariants(ctx, campaign.id)
  const currentHash = hashAuthorizationPayload(
    buildAuthorizationPayload(campaign, variants, resolveSenderIdentity()),
  )
  if (currentHash !== record.payloadHash) {
    throw new ValidationError(
      'Campaign send blocked: campaign content changed after it was authorized. ' +
        'Request a fresh authorization for the current content.',
    )
  }

  return record
}
