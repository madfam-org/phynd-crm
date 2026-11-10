import { createHmac } from 'node:crypto'
import { UnrecoverableError } from 'bullmq'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@phynd/logging', () => ({
  createLogger: vi.fn(() => mockLogger),
}))

import {
  REFUSED_EVENT,
  RETRYABLE_EVENT,
  UNCONFIGURED_EVENT,
  processReferralRewardDispatch,
  signReferralRewardBody,
} from '../processors/referral-reward-dispatch'

const REFERRAL_KEY = 'referral-edge-test-key'
const BILLING_RELAY_KEY = 'billing-relay-test-key'
const DHANAM_URL = 'https://dhanam.test'

const job = {
  id: 'job-1',
  attemptsMade: 0,
  data: {
    referralId: 'ref-1',
    referralCode: 'MADFAM-TEST1234',
    referrerUserId: 'referrer-sub',
    referredUserId: 'referred-sub',
    referredEmail: 'referred@example.com',
    sourceProduct: 'dhanam',
    targetProduct: 'karafiel',
    planId: 'pro',
    revenueCents: 49_900,
  },
} as never

const fetchMock = vi.fn()

function lastRequest(): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  return { url, init }
}

function hmacHex(body: string, key: string): string {
  return createHmac('sha256', key).update(body).digest('hex')
}

describe('processReferralRewardDispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    process.env.DHANAM_API_URL = DHANAM_URL
    process.env.DHANAM_REFERRAL_WEBHOOK_SECRET = REFERRAL_KEY
    // The billing relay key must never sign rewards: set it to prove it is ignored.
    process.env.DHANAM_WEBHOOK_SECRET = BILLING_RELAY_KEY
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.DHANAM_API_URL
    delete process.env.DHANAM_REFERRAL_WEBHOOK_SECRET
    delete process.env.DHANAM_WEBHOOK_SECRET
  })

  it('posts the conversion to Dhanam signed with the referral key over the raw body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"rewards_created":3}', { status: 200 }))

    await processReferralRewardDispatch(job)

    const { url, init } = lastRequest()
    expect(url).toBe(`${DHANAM_URL}/v1/referral/reward`)
    expect(init.method).toBe('POST')
    const body = init.body as string
    expect(JSON.parse(body)).toEqual({
      type: 'referral.converted',
      data: {
        referral_code: 'MADFAM-TEST1234',
        referrer_user_id: 'referrer-sub',
        referred_user_id: 'referred-sub',
        source_product: 'dhanam',
        target_product: 'karafiel',
        plan_id: 'pro',
        revenue_cents: 49_900,
      },
    })
    const headers = init.headers as Record<string, string>
    expect(headers['X-PhyndCRM-Signature']).toBe(`sha256=${hmacHex(body, REFERRAL_KEY)}`)
    expect(headers['X-PhyndCRM-Signature']).not.toContain(hmacHex(body, BILLING_RELAY_KEY))
    // The email stays in PhyndCRM: Dhanam does not need it.
    expect(body).not.toContain('referred@example.com')
  })

  it('keeps the sha256= prefix on a 64-hex digest', () => {
    const signature = signReferralRewardBody('{"a":1}', REFERRAL_KEY)
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/)
    expect(signature.slice('sha256='.length)).toBe(hmacHex('{"a":1}', REFERRAL_KEY))
  })

  it('does not double the slash when DHANAM_API_URL ends with one', async () => {
    process.env.DHANAM_API_URL = `${DHANAM_URL}/`
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }))

    await processReferralRewardDispatch(job)

    expect(lastRequest().url).toBe(`${DHANAM_URL}/v1/referral/reward`)
  })

  it('fails the job (no retry) and logs an error when the referral key is missing', async () => {
    delete process.env.DHANAM_REFERRAL_WEBHOOK_SECRET

    const run = processReferralRewardDispatch(job)

    await expect(run).rejects.toBeInstanceOf(UnrecoverableError)
    await expect(run).rejects.toThrow('missing DHANAM_REFERRAL_WEBHOOK_SECRET')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: UNCONFIGURED_EVENT,
        missing: ['DHANAM_REFERRAL_WEBHOOK_SECRET'],
        referralId: 'ref-1',
      }),
      expect.stringContaining('NOT sent'),
    )
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('treats an empty referral key as missing', async () => {
    process.env.DHANAM_REFERRAL_WEBHOOK_SECRET = ''

    await expect(processReferralRewardDispatch(job)).rejects.toBeInstanceOf(UnrecoverableError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails the job (no retry) and logs an error when DHANAM_API_URL is missing', async () => {
    delete process.env.DHANAM_API_URL

    const run = processReferralRewardDispatch(job)

    await expect(run).rejects.toBeInstanceOf(UnrecoverableError)
    await expect(run).rejects.toThrow('missing DHANAM_API_URL')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: UNCONFIGURED_EVENT, missing: ['DHANAM_API_URL'] }),
      expect.any(String),
    )
  })

  it('names both when the key and the URL are missing', async () => {
    delete process.env.DHANAM_API_URL
    delete process.env.DHANAM_REFERRAL_WEBHOOK_SECRET

    await expect(processReferralRewardDispatch(job)).rejects.toThrow(
      'missing DHANAM_API_URL, DHANAM_REFERRAL_WEBHOOK_SECRET',
    )
  })

  it('fails the job (no retry) when Dhanam refuses the signature with 401', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"message":"Invalid referral signature"}', { status: 401 }),
    )

    const run = processReferralRewardDispatch(job)

    await expect(run).rejects.toBeInstanceOf(UnrecoverableError)
    await expect(run).rejects.toThrow(/refused the referral signature \(401\)/)
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: REFUSED_EVENT, status: 401 }),
      expect.stringContaining('NOT applied'),
    )
  })

  it('fails the job (no retry) on a 400 payload rejection', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad', { status: 400 }))

    const run = processReferralRewardDispatch(job)

    await expect(run).rejects.toBeInstanceOf(UnrecoverableError)
    await expect(run).rejects.toThrow('Dhanam rejected the referral reward (400)')
  })

  it.each([500, 503, 429, 408])('retries on %i', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response('busy', { status }))

    const run = processReferralRewardDispatch(job)

    await expect(run).rejects.toThrow(`status ${status}`)
    await expect(run).rejects.not.toBeInstanceOf(UnrecoverableError)
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: RETRYABLE_EVENT, status }),
      expect.any(String),
    )
  })

  it('retries on a network error or timeout', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))

    const run = processReferralRewardDispatch(job)

    await expect(run).rejects.toThrow('request failed: fetch failed')
    await expect(run).rejects.not.toBeInstanceOf(UnrecoverableError)
  })
})
