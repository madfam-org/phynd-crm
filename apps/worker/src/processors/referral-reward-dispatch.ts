/**
 * BullMQ processor: referral-reward-dispatch
 *
 * Sends an HMAC-signed webhook to Dhanam when a referral converts,
 * so that Dhanam can apply the appropriate reward to the referrer.
 */

import { createHmac } from 'node:crypto'
import { createLogger } from '@phyne/logging'
import type { Job } from 'bullmq'

const logger = createLogger('worker:referral-reward-dispatch')

export interface ReferralRewardDispatchData {
  referralId: string
  referralCode: string
  referrerUserId: string
  referredUserId: string
  referredEmail: string
  sourceProduct: string
  targetProduct: string
  planId: string
  revenueCents: number
}

export async function processReferralRewardDispatch(
  job: Job<ReferralRewardDispatchData>,
): Promise<void> {
  const {
    referralId,
    referralCode,
    referrerUserId,
    referredUserId,
    sourceProduct,
    targetProduct,
    planId,
    revenueCents,
  } = job.data

  logger.info({ jobId: job.id, referralId, referralCode }, 'Processing referral reward dispatch')

  const dhanamApiUrl = process.env.DHANAM_API_URL
  if (!dhanamApiUrl) {
    logger.warn('DHANAM_API_URL not configured — skipping reward dispatch')
    return
  }

  const webhookSecret = process.env.DHANAM_WEBHOOK_SECRET
  if (!webhookSecret) {
    logger.warn('DHANAM_WEBHOOK_SECRET not configured — skipping reward dispatch')
    return
  }

  const payload = JSON.stringify({
    type: 'referral.converted',
    data: {
      referral_code: referralCode,
      referrer_user_id: referrerUserId,
      referred_user_id: referredUserId,
      source_product: sourceProduct,
      target_product: targetProduct,
      plan_id: planId,
      revenue_cents: revenueCents,
    },
  })

  const signature = createHmac('sha256', webhookSecret).update(payload).digest('hex')

  const url = `${dhanamApiUrl}/v1/referral/reward`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PhyneCRM-Signature': `sha256=${signature}`,
    },
    body: payload,
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => 'Unable to read response body')
    logger.error(
      { referralId, status: response.status, body: text },
      'Dhanam reward dispatch failed',
    )
    throw new Error(`Dhanam reward dispatch failed with status ${response.status}`)
  }

  logger.info(
    { jobId: job.id, referralId, referralCode, status: response.status },
    'Referral reward dispatch sent successfully',
  )
}
