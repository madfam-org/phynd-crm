import { beforeEach, describe, expect, it, vi } from 'vitest'
import { REWARD_DISPATCH_MARKER, ReferralService } from '../referrals/referrals.service'
import { type MockDatabase, createTestContext } from './helpers'

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  ne: vi.fn((col: unknown, val: unknown) => ({ _tag: 'ne', col, val })),
  gt: vi.fn(),
  lt: vi.fn(),
  isNull: vi.fn(),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    _tag: 'sql',
    text: strings.join('?'),
    values,
  })),
}))

vi.mock('@phynd/db/schema', () => ({
  campaigns: {},
  contacts: {},
  conversions: { id: 'conversions.id', metadata: 'conversions.metadata' },
  leads: {},
  pipelineStages: {},
  pipelines: {},
  referralCodes: { id: 'referral_codes.id', code: 'referral_codes.code' },
  referrals: {
    id: 'referrals.id',
    status: 'referrals.status',
    metadata: 'referrals.metadata',
    conversionId: 'referrals.conversion_id',
  },
}))

vi.mock('@phynd/logging', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

/** Each awaited query resolves to the next queued result. */
function queueResults(db: MockDatabase, results: unknown[]): void {
  db._qb.then.mockReset()
  db._qb.then.mockImplementation((resolve: (value: unknown) => void) =>
    Promise.resolve(results.shift() ?? []).then(resolve),
  )
}

const converted = {
  id: 'ref-1',
  referralCodeId: 'code-1',
  referrerJanuaId: 'janua-referrer',
  referredJanuaId: null,
  referredEmail: 'referida@empresa-ficticia.mx',
  sourceProduct: 'karafiel',
  targetProduct: 'dhanam',
  status: 'converted',
  planId: 'pro',
  revenueCents: 19900,
  metadata: null,
}

describe('ReferralService reward dispatch', () => {
  let service: ReferralService
  let db: MockDatabase

  beforeEach(() => {
    const ctx = createTestContext()
    db = ctx.mockDb
    service = new ReferralService(ctx)
  })

  describe('convertReferral', () => {
    it('converts an open referral', async () => {
      queueResults(db, [[converted], [{ id: 'code-1', code: 'KRF-0000' }]])
      const result = await service.convertReferral('ref-1', 'pro', 19900)
      expect(result.alreadyConverted).toBe(false)
      expect(result.code).toEqual({ id: 'code-1', code: 'KRF-0000' })
      // Only a referral that is not converted yet is updated.
      expect(db._qb.where).toHaveBeenCalledWith(
        expect.objectContaining({
          args: expect.arrayContaining([
            expect.objectContaining({ _tag: 'ne', col: 'referrals.status', val: 'converted' }),
          ]),
        }),
      )
    })

    it('returns an already converted referral as it is, without overwriting it', async () => {
      queueResults(db, [[], [{ ...converted, planId: 'basic' }], [{ id: 'code-1' }]])
      const result = await service.convertReferral('ref-1', 'pro', 19900)
      expect(result.alreadyConverted).toBe(true)
      expect(result.planId).toBe('basic')
    })

    it('throws for an unknown referral', async () => {
      queueResults(db, [[], []])
      await expect(service.convertReferral('nope', 'pro', 1)).rejects.toThrow('Referral not found')
    })
  })

  describe('claimRewardDispatch', () => {
    it('returns the worker payload when this call claims it', async () => {
      queueResults(db, [[converted], [{ code: 'KRF-0000' }]])
      expect(await service.claimRewardDispatch('ref-1')).toEqual({
        referralId: 'ref-1',
        referralCode: 'KRF-0000',
        referrerUserId: 'janua-referrer',
        referredUserId: '',
        referredEmail: 'referida@empresa-ficticia.mx',
        sourceProduct: 'karafiel',
        targetProduct: 'dhanam',
        planId: 'pro',
        revenueCents: 19900,
      })
    })

    it('claims with one conditional update: converted and not yet marked', async () => {
      queueResults(db, [[converted], [{ code: 'KRF-0000' }]])
      await service.claimRewardDispatch('ref-1')
      const where = db._qb.where.mock.calls[0]?.[0] as { args: Array<Record<string, unknown>> }
      expect(where.args).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ _tag: 'eq', col: 'referrals.id', val: 'ref-1' }),
          expect.objectContaining({ _tag: 'eq', col: 'referrals.status', val: 'converted' }),
          expect.objectContaining({
            _tag: 'sql',
            values: ['referrals.metadata', REWARD_DISPATCH_MARKER],
          }),
        ]),
      )
      const set = db._qb.set.mock.calls[0]?.[0] as { metadata: { values: unknown[] } }
      expect(set.metadata.values).toContain(REWARD_DISPATCH_MARKER)
    })

    it('returns null when it is already claimed (or not converted)', async () => {
      queueResults(db, [[]])
      expect(await service.claimRewardDispatch('ref-1')).toBeNull()
    })
  })

  it('releaseRewardDispatch removes the marker', async () => {
    queueResults(db, [[]])
    await service.releaseRewardDispatch('ref-1')
    const set = db._qb.set.mock.calls[0]?.[0] as { metadata: { text: string; values: unknown[] } }
    expect(set.metadata.text).toContain(' - ')
    expect(set.metadata.values).toEqual(['referrals.metadata', REWARD_DISPATCH_MARKER])
  })

  it('findReferralConvertedByDhanamEvent looks the referral up through its conversion', async () => {
    queueResults(db, [[{ id: 'ref-1' }]])
    expect(await service.findReferralConvertedByDhanamEvent('evt_1')).toBe('ref-1')
    expect(db._qb.innerJoin).toHaveBeenCalled()
    queueResults(db, [[]])
    expect(await service.findReferralConvertedByDhanamEvent('evt_2')).toBeNull()
  })
})
