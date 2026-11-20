import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockClaim = vi.fn()
const mockRelease = vi.fn()
vi.mock('@phynd/services', () => ({
  ReferralService: vi.fn().mockImplementation(() => ({
    claimRewardDispatch: mockClaim,
    releaseRewardDispatch: mockRelease,
  })),
}))

const mockLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('@phynd/logging', () => ({ createLogger: () => mockLogger }))

vi.mock('@phynd/config/connections', () => ({
  resolveRedisUrl: () => 'redis://:secret@redis.local:6390',
}))

const mockQueueAdd = vi.fn()
const mockQueueClose = vi.fn()
const queueArgs: unknown[][] = []
vi.mock('bullmq', () => ({
  Queue: class {
    constructor(...args: unknown[]) {
      queueArgs.push(args)
    }
    add = (...args: unknown[]) => mockQueueAdd(...args)
    close = () => mockQueueClose()
  },
}))

import {
  enqueueRewardDispatch,
  queueReferralRewardDispatch,
  rewardDispatchJobId,
} from '../reward-dispatch'

const job = {
  referralId: 'ref-1',
  referralCode: 'KRF-0000',
  referrerUserId: 'janua-referrer',
  referredUserId: '',
  referredEmail: 'referida@empresa-ficticia.mx',
  sourceProduct: 'karafiel',
  targetProduct: 'dhanam',
  planId: 'pro',
  revenueCents: 19900,
}

const ctx = {} as never

beforeEach(() => {
  mockClaim.mockReset()
  mockRelease.mockReset().mockResolvedValue(undefined)
  mockQueueAdd.mockReset().mockResolvedValue({ id: 'job' })
  mockQueueClose.mockReset().mockResolvedValue(undefined)
  mockLogger.error.mockReset()
  queueArgs.length = 0
})

describe('queueReferralRewardDispatch', () => {
  it('queues the job when this call claims it', async () => {
    mockClaim.mockResolvedValueOnce(job)
    const enqueue = vi.fn().mockResolvedValue(undefined)
    expect(await queueReferralRewardDispatch(ctx, 'ref-1', enqueue)).toBe('queued')
    expect(enqueue).toHaveBeenCalledWith(job)
    expect(mockRelease).not.toHaveBeenCalled()
  })

  it('queues nothing when an earlier call already claimed it (no double reward)', async () => {
    mockClaim.mockResolvedValueOnce(null)
    const enqueue = vi.fn()
    expect(await queueReferralRewardDispatch(ctx, 'ref-1', enqueue)).toBe('already_queued')
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('both conversion paths together queue exactly one job', async () => {
    // The claim is an atomic conditional update: the first caller wins.
    let claimed = false
    mockClaim.mockImplementation(async () => {
      if (claimed) return null
      claimed = true
      return job
    })
    const enqueue = vi.fn().mockResolvedValue(undefined)
    const outcomes = await Promise.all([
      queueReferralRewardDispatch(ctx, 'ref-1', enqueue), // Dhanam webhook
      queueReferralRewardDispatch(ctx, 'ref-1', enqueue), // /api/referrals/convert
    ])
    expect(outcomes.sort()).toEqual(['already_queued', 'queued'])
    expect(enqueue).toHaveBeenCalledTimes(1)
  })

  it('gives the claim back when the enqueue fails, so a retry can queue it', async () => {
    mockClaim.mockResolvedValueOnce(job)
    const enqueue = vi.fn().mockRejectedValue(new Error('redis down'))
    expect(await queueReferralRewardDispatch(ctx, 'ref-1', enqueue)).toBe('failed')
    expect(mockRelease).toHaveBeenCalledWith('ref-1')
    expect(mockLogger.error).toHaveBeenCalled()
  })

  it('never throws, also when the claim itself fails', async () => {
    mockClaim.mockRejectedValueOnce(new Error('db down'))
    expect(await queueReferralRewardDispatch(ctx, 'ref-1', vi.fn())).toBe('failed')
  })
})

describe('enqueueRewardDispatch', () => {
  it('adds one job per referral to the worker queue, with the referral as job id', async () => {
    await enqueueRewardDispatch(job)
    expect(queueArgs[0]?.[0]).toBe('referral-reward-dispatch')
    expect(queueArgs[0]?.[1]).toEqual({
      connection: { host: 'redis.local', port: 6390, password: 'secret' },
    })
    expect(mockQueueAdd).toHaveBeenCalledWith('dispatch', job, { jobId: 'referral-reward-ref-1' })
    expect(mockQueueClose).toHaveBeenCalledTimes(1)
    expect(rewardDispatchJobId('ref-1')).not.toContain(':')
  })

  it('closes the queue when the add fails', async () => {
    mockQueueAdd.mockRejectedValueOnce(new Error('redis down'))
    await expect(enqueueRewardDispatch(job)).rejects.toThrow('redis down')
    expect(mockQueueClose).toHaveBeenCalledTimes(1)
  })
})
