import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/federation/clients', () => ({ getCacheManager: () => ({}) }))
vi.mock('@phynd/db', () => ({ getDb: () => ({}) }))
vi.mock('@phynd/config/constants', () => ({ DEFAULT_TENANT_ID: 'madfam' }))
vi.mock('@phynd/logging', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

const mockConvert = vi.fn()
vi.mock('@phynd/services', () => ({
  createServiceContext: () => ({ ctx: 'convert' }),
  ReferralService: vi.fn().mockImplementation(() => ({ convertReferral: mockConvert })),
}))

const mockQueueReward = vi.fn()
vi.mock('@/lib/referrals/reward-dispatch', () => ({
  queueReferralRewardDispatch: (...args: unknown[]) => mockQueueReward(...args),
}))

import { POST as postRoute } from '../route'

async function POST(req: Request): Promise<Response> {
  const res = await postRoute(req)
  if (!res) throw new Error('the route returned no response')
  return res
}

const TOKEN = 'DUMMY_FEDERATION_TOKEN_DO_NOT_USE'

function request(body: unknown): Request {
  return new Request('http://localhost/api/referrals/convert', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const body = { referral_id: 'ref-1', plan_id: 'pro', revenue_cents: 19900 }

beforeEach(() => {
  vi.stubEnv('FEDERATION_API_TOKEN', TOKEN)
  mockConvert.mockReset().mockResolvedValue({ id: 'ref-1', alreadyConverted: false })
  mockQueueReward.mockReset().mockResolvedValue('queued')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/referrals/convert', () => {
  it('converts and queues the reward once', async () => {
    const res = await POST(request(body))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      referral_id: 'ref-1',
      status: 'converted',
      reward_dispatch: 'queued',
    })
    expect(mockConvert).toHaveBeenCalledWith('ref-1', 'pro', 19900)
    expect(mockQueueReward).toHaveBeenCalledWith({ ctx: 'convert' }, 'ref-1')
  })

  it('does not reward twice a referral the Dhanam webhook already converted', async () => {
    mockConvert.mockResolvedValueOnce({ id: 'ref-1', alreadyConverted: true })
    mockQueueReward.mockResolvedValueOnce('already_queued')
    const res = await POST(request(body))
    expect(res.status).toBe(200)
    expect(((await res.json()) as { reward_dispatch: string }).reward_dispatch).toBe(
      'already_queued',
    )
  })

  it('answers 500 when the reward cannot be queued, so the caller retries', async () => {
    mockQueueReward.mockResolvedValueOnce('failed')
    const res = await POST(request(body))
    expect(res.status).toBe(500)
  })

  it('answers 404 for an unknown referral and queues nothing', async () => {
    mockConvert.mockRejectedValueOnce(new Error('Referral not found'))
    const res = await POST(request(body))
    expect(res.status).toBe(404)
    expect(mockQueueReward).not.toHaveBeenCalled()
  })

  it('refuses a request without the federation token', async () => {
    const res = await POST(
      new Request('http://localhost/api/referrals/convert', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    )
    expect(res.status).toBe(401)
    expect(mockConvert).not.toHaveBeenCalled()
  })
})
