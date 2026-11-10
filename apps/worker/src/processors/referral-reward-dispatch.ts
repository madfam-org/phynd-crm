/**
 * BullMQ processor: referral-reward-dispatch
 *
 * Posts a `referral.converted` event to Dhanam `POST /v1/referral/reward` so
 * Dhanam applies the referrer's and the referred user's rewards.
 *
 * Signing: HMAC-SHA256 hex of the exact body bytes sent, in
 * `X-PhyndCRM-Signature: sha256=<hex>` (Dhanam accepts bare hex or the prefix).
 * The key is DHANAM_REFERRAL_WEBHOOK_SECRET: the referral edge's own key,
 * which Dhanam (the verifier) owns at Vault secret/dhanam/referral
 * `referral_webhook_secret`. It is NOT DHANAM_WEBHOOK_SECRET, which verifies
 * Dhanam's inbound billing relay to PhyndCRM: a different edge.
 *
 * Failure is never silent. A reward that cannot be sent fails the job, so it
 * stays in the queue's failed set (the dead-letter, kept by
 * REFERRAL_REWARD_DISPATCH_JOB_OPTIONS) and can be replayed:
 *   - key or URL missing, or Dhanam refuses the request (4xx other than
 *     408/429): UnrecoverableError, failed at once, no retries, error log;
 *   - Dhanam 5xx, 408, 429, timeout or network error: plain Error, retried
 *     with backoff.
 * Dhanam deduplicates a conversion by referral code and referrer, so a retry
 * or a replay never pays twice.
 */

import { createHmac } from 'node:crypto'
import { createLogger } from '@phynd/logging'
import { type Job, UnrecoverableError } from 'bullmq'

const logger = createLogger('worker:referral-reward-dispatch')

/** The referral edge's own signing key (verifier-owned by Dhanam). */
export const REFERRAL_SIGNING_SECRET_ENV = 'DHANAM_REFERRAL_WEBHOOK_SECRET'
export const DHANAM_API_URL_ENV = 'DHANAM_API_URL'
export const REFERRAL_SIGNATURE_HEADER = 'X-PhyndCRM-Signature'
export const REFERRAL_REWARD_PATH = '/v1/referral/reward'

/** Log event names: alert on these. */
export const UNCONFIGURED_EVENT = 'referral_reward_dispatch_unconfigured'
export const REFUSED_EVENT = 'referral_reward_dispatch_refused'
export const RETRYABLE_EVENT = 'referral_reward_dispatch_retryable_failure'

const REQUEST_TIMEOUT_MS = 15_000

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

/** `sha256=<hex>` HMAC-SHA256 of the raw body. */
export function signReferralRewardBody(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

/** Statuses a retry can fix; every other 4xx is permanent. */
function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429
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

  const dhanamApiUrl = process.env[DHANAM_API_URL_ENV]
  const signingSecret = process.env[REFERRAL_SIGNING_SECRET_ENV]
  const missing = [
    ...(dhanamApiUrl ? [] : [DHANAM_API_URL_ENV]),
    ...(signingSecret ? [] : [REFERRAL_SIGNING_SECRET_ENV]),
  ]
  if (!dhanamApiUrl || !signingSecret) {
    // Env is read at pod start, so a retry cannot fix this: fail now and keep
    // the job in the failed set for a replay once the key is wired.
    logger.error(
      { event: UNCONFIGURED_EVENT, jobId: job.id, referralId, referralCode, missing },
      `Referral reward NOT sent: ${missing.join(', ')} not configured`,
    )
    throw new UnrecoverableError(
      `Referral reward dispatch not configured: missing ${missing.join(', ')}`,
    )
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

  const url = `${dhanamApiUrl.replace(/\/+$/, '')}${REFERRAL_REWARD_PATH}`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [REFERRAL_SIGNATURE_HEADER]: signReferralRewardBody(payload, signingSecret),
      },
      body: payload,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(
      {
        event: RETRYABLE_EVENT,
        jobId: job.id,
        referralId,
        attempt: job.attemptsMade + 1,
        err: message,
      },
      'Dhanam reward dispatch request failed; will retry',
    )
    throw new Error(`Dhanam reward dispatch request failed: ${message}`)
  }

  if (!response.ok) {
    const text = await response.text().catch(() => 'Unable to read response body')
    const status = response.status

    if (isRetryableStatus(status)) {
      logger.error(
        {
          event: RETRYABLE_EVENT,
          jobId: job.id,
          referralId,
          status,
          attempt: job.attemptsMade + 1,
          body: text,
        },
        'Dhanam reward dispatch failed; will retry',
      )
      throw new Error(`Dhanam reward dispatch failed with status ${status}`)
    }

    const reason =
      status === 401 || status === 403
        ? `Dhanam refused the referral signature (${status}): ${REFERRAL_SIGNING_SECRET_ENV} does not match Dhanam's referral key`
        : `Dhanam rejected the referral reward (${status})`
    logger.error(
      { event: REFUSED_EVENT, jobId: job.id, referralId, referralCode, status, body: text },
      `Referral reward NOT applied: ${reason}`,
    )
    throw new UnrecoverableError(reason)
  }

  logger.info(
    { jobId: job.id, referralId, referralCode, status: response.status },
    'Referral reward dispatch sent successfully',
  )
}
