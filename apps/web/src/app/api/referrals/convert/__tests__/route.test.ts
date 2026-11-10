import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockQueueAdd, mockQueueClose, mockQueueCtor, mockConvert } = vi.hoisted(() => {
  const mockQueueAdd = vi.fn()
  const mockQueueClose = vi.fn()
  const mockQueueCtor = vi.fn(() => ({ add: mockQueueAdd, close: mockQueueClose }))
  const mockConvert = vi.fn()
  return { mockQueueAdd, mockQueueClose, mockQueueCtor, mockConvert }
})

vi.mock('bullmq', () => ({ Queue: mockQueueCtor }))
vi.mock('@/lib/federation/clients', () => ({ getCacheManager: vi.fn(() => ({})) }))
vi.mock('@phynd/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('@phynd/config/connections', () => ({
  resolveRedisUrl: vi.fn(() => 'redis://localhost:6379'),
}))
vi.mock('@phynd/services', () => ({
  createServiceContext: vi.fn(() => ({})),
  ReferralService: vi.fn(() => ({ convertReferral: mockConvert })),
}))
vi.mock('@phynd/logging', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}))

import {
  REFERRAL_REWARD_DISPATCH_JOB_OPTIONS,
  REFERRAL_REWARD_DISPATCH_QUEUE,
} from '@phynd/config/queues'
import { POST } from '../route'

const TOKEN = 'federation-test-token'

function request(body: unknown): Request {
  return new Request('http://localhost/api/referrals/convert', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/referrals/convert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.FEDERATION_API_TOKEN = TOKEN
    mockConvert.mockResolvedValue({
      id: 'ref-1',
      code: { code: 'MADFAM-TEST1234' },
      referrerJanuaId: 'referrer-sub',
      referredJanuaId: 'referred-sub',
      referredEmail: 'referred@example.com',
      sourceProduct: 'dhanam',
      targetProduct: 'karafiel',
    })
  })

  afterEach(() => {
    delete process.env.FEDERATION_API_TOKEN
  })

  it('enqueues the reward with retries and failed-job retention', async () => {
    const res = await POST(request({ referral_id: 'ref-1', plan_id: 'pro', revenue_cents: 49_900 }))

    expect(res?.status).toBe(200)
    expect(mockQueueCtor).toHaveBeenCalledWith(REFERRAL_REWARD_DISPATCH_QUEUE, expect.anything())
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'dispatch',
      expect.objectContaining({
        referralId: 'ref-1',
        referralCode: 'MADFAM-TEST1234',
        planId: 'pro',
        revenueCents: 49_900,
      }),
      REFERRAL_REWARD_DISPATCH_JOB_OPTIONS,
    )
    expect(mockQueueClose).toHaveBeenCalledOnce()
  })

  it('keeps failed reward jobs so they can be replayed', () => {
    expect(REFERRAL_REWARD_DISPATCH_QUEUE).toBe('referral-reward-dispatch')
    expect(REFERRAL_REWARD_DISPATCH_JOB_OPTIONS.removeOnFail).toBe(false)
    expect(REFERRAL_REWARD_DISPATCH_JOB_OPTIONS.attempts).toBeGreaterThan(1)
    expect(REFERRAL_REWARD_DISPATCH_JOB_OPTIONS.backoff.type).toBe('exponential')
  })

  it('does not enqueue when the conversion fails', async () => {
    mockConvert.mockRejectedValueOnce(new Error('Referral not found'))

    const res = await POST(request({ referral_id: 'nope', plan_id: 'pro', revenue_cents: 1 }))

    expect(res?.status).toBe(404)
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })
})
