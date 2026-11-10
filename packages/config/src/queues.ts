/**
 * Queue names and job options shared by the producer (web) and the consumer
 * (worker). A job's options come from the `queue.add` call that created it,
 * NOT from the consumer's Queue instance, so both sides import them from here.
 */

export const REFERRAL_REWARD_DISPATCH_QUEUE = 'referral-reward-dispatch'

/**
 * Referral rewards carry money owed to a referrer. A transient failure
 * (Dhanam 5xx, 429, timeout) is retried with backoff (30 s, 60 s, 120 s,
 * 240 s); a permanent one (missing key or URL, signature refused) fails the
 * job at once without consuming retries.
 *
 * Failed jobs are KEPT (`removeOnFail: false`): the failed set is the
 * dead-letter. An operator replays them once the cause is fixed, and Dhanam
 * deduplicates a conversion by referral code and referrer, so a replay never
 * pays twice. Volume is a handful of conversions, so the set stays small.
 */
export const REFERRAL_REWARD_DISPATCH_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: false,
} as const
