import { resolveRedisUrl } from '@phynd/config/connections'
import { createLogger } from '@phynd/logging'
import { type ReferralRewardDispatch, ReferralService, type ServiceContext } from '@phynd/services'
import { Queue } from 'bullmq'

// The one path that queues a referral's reward (`referral-reward-dispatch`,
// whose worker sends `referral.converted` to Dhanam). Both ways a referral
// converts call it: `/api/referrals/convert` and the Dhanam webhook's inline
// conversion of a paid event carrying a referral code. Exactly once per
// referral: `ReferralService.claimRewardDispatch` is an atomic conditional
// UPDATE, so only one caller ever gets the payload; the BullMQ job id is the
// referral id as a second guard. A failed enqueue gives the claim back, so a
// retry (of the convert call, or a redelivery of the Dhanam event) queues it.

const logger = createLogger('web:referrals:reward-dispatch')

export const REFERRAL_REWARD_QUEUE = 'referral-reward-dispatch'

/** `queued`: this call queued it; `already_queued`: an earlier call did (or it is not converted); `failed`: not queued, claim given back. */
export type RewardDispatchOutcome = 'queued' | 'already_queued' | 'failed'

export type EnqueueRewardDispatch = (job: ReferralRewardDispatch) => Promise<void>

function redisConnection() {
  const url = new URL(resolveRedisUrl())
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    password: url.password || undefined,
  }
}

/** BullMQ job id: one job per referral, ever. No `:` (BullMQ reserves it). */
export function rewardDispatchJobId(referralId: string): string {
  return `referral-reward-${referralId}`
}

export const enqueueRewardDispatch: EnqueueRewardDispatch = async (job) => {
  const queue = new Queue(REFERRAL_REWARD_QUEUE, { connection: redisConnection() })
  try {
    await queue.add('dispatch', job, { jobId: rewardDispatchJobId(job.referralId) })
  } finally {
    await queue.close()
  }
}

/**
 * Queues the reward for a converted referral unless it already is. Never
 * throws: a failure is logged with the referral id and reported as `failed`.
 */
export async function queueReferralRewardDispatch(
  ctx: ServiceContext,
  referralId: string,
  enqueue: EnqueueRewardDispatch = enqueueRewardDispatch,
): Promise<RewardDispatchOutcome> {
  const service = new ReferralService(ctx)
  let job: ReferralRewardDispatch | null
  try {
    job = await service.claimRewardDispatch(referralId)
  } catch (error) {
    logger.error({ err: error, referralId }, 'referral reward dispatch not claimed')
    return 'failed'
  }
  if (!job) return 'already_queued'

  try {
    await enqueue(job)
    logger.info({ referralId }, 'referral reward dispatch queued')
    return 'queued'
  } catch (error) {
    logger.error({ err: error, referralId }, 'referral reward dispatch not queued; claim released')
    try {
      await service.releaseRewardDispatch(referralId)
    } catch (releaseError) {
      // The claim stays: no retry can queue it. Loud, so an operator can.
      logger.error(
        { err: releaseError, referralId },
        'referral reward claim NOT released: reward will not be retried automatically',
      )
    }
    return 'failed'
  }
}
