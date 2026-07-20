import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertCampaignSendAuthorized } from '../campaigns/campaign-authorization-gate'
import {
  CampaignAuthorizationService,
  buildAuthorizationPayload,
  hashAuthorizationPayload,
  stableStringify,
} from '../campaigns/campaign-authorization.service'
import { ValidationError } from '../errors'
import { type MockDatabase, createTestContext, makeCampaign } from './helpers'

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  asc: vi.fn((col: unknown) => ({ _tag: 'asc', col })),
  desc: vi.fn((col: unknown) => ({ _tag: 'desc', col })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  inArray: vi.fn((col: unknown, vals: unknown) => ({ _tag: 'inArray', col, vals })),
  isNotNull: vi.fn((col: unknown) => ({ _tag: 'isNotNull', col })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
  sql: vi.fn((...args: unknown[]) => ({ _tag: 'sql', args })),
}))

vi.mock('@phynd/db/schema', () => ({
  campaigns: { id: 'campaigns.id', status: 'campaigns.status' },
  contacts: { id: 'contacts.id', email: 'contacts.email', deletedAt: 'contacts.deleted_at' },
  campaignDraftVariants: {
    id: 'campaign_draft_variants.id',
    campaignId: 'campaign_draft_variants.campaign_id',
    createdAt: 'campaign_draft_variants.created_at',
  },
  campaignAuthorizations: {
    id: 'campaign_authorizations.id',
    campaignId: 'campaign_authorizations.campaign_id',
    status: 'campaign_authorizations.status',
    payloadHash: 'campaign_authorizations.payload_hash',
    decidedAt: 'campaign_authorizations.decided_at',
    createdAt: 'campaign_authorizations.created_at',
  },
  consentRecords: {
    identifier: 'consent_records.identifier',
    channel: 'consent_records.channel',
    status: 'consent_records.status',
  },
  suppressionEntries: {
    identifier: 'suppression_entries.identifier',
    channel: 'suppression_entries.channel',
  },
}))

function makeVariantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'variant-row-1',
    campaignId: 'campaign-001',
    variantId: 'v1_beneficio',
    format: 'structured',
    language: 'es-MX',
    subject: 'Tu dinero, claro y en orden',
    preheader: 'Conecta tus cuentas en minutos',
    body: 'Cuerpo del correo con afirmaciones verificadas.',
    cta: 'Probar dhanam',
    ctaUrl: 'https://app.dhan.am/register',
    claimKeysUsed: ['belvo_integration'],
    createdAt: new Date('2026-01-10T00:00:00Z'),
    ...overrides,
  }
}

type CampaignRow = Parameters<typeof buildAuthorizationPayload>[0]
type VariantRow = Parameters<typeof buildAuthorizationPayload>[1][number]

const CAMPAIGN = makeCampaign({
  id: 'campaign-001',
  skuKey: 'dhanam__consumer',
  status: 'approved',
  startDate: new Date('2026-08-01T00:00:00Z'),
  endDate: new Date('2026-08-15T00:00:00Z'),
  tulanaMetadata: {
    audience: 'personas en MX con finanzas multi-cuenta',
    campaign_type: 'consumer_launch',
    guardrails: { do_not_claim: ['rendimientos garantizados'] },
  },
}) as unknown as CampaignRow

describe('stableStringify / hashAuthorizationPayload', () => {
  it('is key-order independent', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 2 }, b: 1 }),
    )
  })

  it('drops undefined values but keeps nulls', () => {
    expect(stableStringify({ a: undefined, b: null })).toBe('{"b":null}')
  })

  it('produces identical hashes for identical payloads', () => {
    const payload = buildAuthorizationPayload(
      CAMPAIGN,
      [makeVariantRow() as unknown as VariantRow],
      'MADFAM <noreply@madfam.io>',
    )
    expect(hashAuthorizationPayload(payload)).toBe(hashAuthorizationPayload({ ...payload }))
    expect(hashAuthorizationPayload(payload)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes the hash when copy, schedule, or sender change', () => {
    const base = buildAuthorizationPayload(
      CAMPAIGN,
      [makeVariantRow() as unknown as VariantRow],
      'MADFAM <noreply@madfam.io>',
    )
    const editedCopy = buildAuthorizationPayload(
      CAMPAIGN,
      [makeVariantRow({ subject: 'Otro asunto' }) as unknown as VariantRow],
      'MADFAM <noreply@madfam.io>',
    )
    const editedSender = buildAuthorizationPayload(
      CAMPAIGN,
      [makeVariantRow() as unknown as VariantRow],
      'Otra Marca <hola@example.com>',
    )
    expect(hashAuthorizationPayload(editedCopy)).not.toBe(hashAuthorizationPayload(base))
    expect(hashAuthorizationPayload(editedSender)).not.toBe(hashAuthorizationPayload(base))
  })
})

describe('buildAuthorizationPayload', () => {
  it('freezes audience definition, guardrails, schedule, and every variant', () => {
    const payload = buildAuthorizationPayload(
      CAMPAIGN,
      [makeVariantRow() as unknown as VariantRow],
      'MADFAM <noreply@madfam.io>',
    )
    expect(payload.audienceDefinition).toBe('personas en MX con finanzas multi-cuenta')
    expect(payload.guardrailsDoNotClaim).toEqual(['rendimientos garantizados'])
    expect(payload.schedule.startDate).toBe('2026-08-01T00:00:00.000Z')
    expect(payload.privacyUrl).toBe('https://app.dhan.am/privacy')
    expect(payload.variants).toHaveLength(1)
    expect(payload.variants[0]?.claimKeysUsed).toEqual(['belvo_integration'])
  })
})

describe('CampaignAuthorizationService', () => {
  let service: CampaignAuthorizationService
  let mockDb: MockDatabase

  beforeEach(() => {
    const ctx = createTestContext()
    mockDb = ctx.mockDb
    service = new CampaignAuthorizationService(ctx)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('request()', () => {
    it('refuses when the campaign has no reviewable variants', async () => {
      // First select resolves the campaign; variant select resolves [] — the
      // mock db returns the same result for every query, so return the
      // campaign row and then flip to empty for the variants read.
      const results: unknown[][] = [[CAMPAIGN], []]
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) =>
        Promise.resolve(results.shift() ?? []).then(resolve),
      )

      await expect(service.request('campaign-001', 'staff-user')).rejects.toBeInstanceOf(
        ValidationError,
      )
      expect(mockDb.insert).not.toHaveBeenCalled()
    })

    it('supersedes prior pending requests and inserts a frozen snapshot', async () => {
      mockDb._qb._result = [{ ...CAMPAIGN, ...makeVariantRow(), n: 0 }]

      const record = await service.request('campaign-001', 'staff-user')
      expect(mockDb.update).toHaveBeenCalledTimes(1)
      expect(mockDb.insert).toHaveBeenCalledTimes(1)
      const inserted = mockDb._qb.values.mock.calls.at(0)?.at(0) as Record<string, unknown>
      expect(inserted.status).toBe('pending')
      expect(inserted.requestedBy).toBe('staff-user')
      expect(inserted.payloadHash).toMatch(/^[0-9a-f]{64}$/)
      const snapshot = inserted.snapshot as { version: number; payload: { sender: string } }
      expect(snapshot.version).toBe(1)
      expect(snapshot.payload.sender).toContain('@')
      expect(record).toBeDefined()
    })
  })

  describe('decide()', () => {
    const pendingRecord = {
      id: 'auth-001',
      campaignId: 'campaign-001',
      status: 'pending',
      payloadHash: 'a'.repeat(64),
      snapshot: { version: 1 },
      requestedBy: 'staff-user',
      decidedBy: null,
      decidedVia: null,
      decisionNote: null,
      decidedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    it('requires a note on rejection', async () => {
      mockDb._qb._result = [pendingRecord]
      await expect(
        service.decide('auth-001', 'rejected', { decidedBy: 'owner', decidedVia: 'web' }),
      ).rejects.toThrow(/note/i)
    })

    it('rejects deciding a non-pending record', async () => {
      mockDb._qb._result = [{ ...pendingRecord, status: 'authorized' }]
      await expect(
        service.decide('auth-001', 'authorized', { decidedBy: 'owner', decidedVia: 'web' }),
      ).rejects.toThrow(/not pending/i)
    })

    it('refuses to authorize when the campaign drifted from the snapshot', async () => {
      // getById → pending record with a hash that cannot match live content.
      // (campaign + variant fields merged in for the follow-up reads; keep
      // the authorization's own id/status LAST so the merge doesn't clobber.)
      mockDb._qb._result = [
        { ...CAMPAIGN, ...makeVariantRow(), ...pendingRecord, status: 'pending' },
      ]
      await expect(
        service.decide('auth-001', 'authorized', { decidedBy: 'owner', decidedVia: 'web' }),
      ).rejects.toThrow(/changed after/i)
      expect(mockDb.update).not.toHaveBeenCalled()
    })

    it('records rejection with authorizer identity and parks the campaign', async () => {
      const decided = {
        ...pendingRecord,
        status: 'rejected',
        decidedBy: 'owner@madfam.io',
        decidedVia: 'selva',
        decisionNote: 'Cifras de audiencia no cuadran',
      }
      // Read 1: getById → the still-pending record. Read 2: the decision
      // update's .returning() → the decided row. Read 3: campaign parking.
      const results: unknown[][] = [[pendingRecord], [decided], []]
      mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) =>
        Promise.resolve(results.shift() ?? []).then(resolve),
      )

      const result = await service.decide('auth-001', 'rejected', {
        decidedBy: 'owner@madfam.io',
        decidedVia: 'selva',
        note: 'Cifras de audiencia no cuadran',
      })
      expect(result.status).toBe('rejected')
      // Two updates: the authorization row + parking the campaign as rejected.
      expect(mockDb.update).toHaveBeenCalledTimes(2)
      const decisionSet = mockDb._qb.set.mock.calls.at(0)?.at(0) as Record<string, unknown>
      expect(decisionSet.decidedBy).toBe('owner@madfam.io')
      expect(decisionSet.decidedVia).toBe('selva')
      expect(decisionSet.decisionNote).toBe('Cifras de audiencia no cuadran')
      expect(decisionSet.decidedAt).toBeInstanceOf(Date)
    })
  })
})

describe('assertCampaignSendAuthorized (hard gate)', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('throws when no authorized record exists (fail closed)', async () => {
    const ctx = createTestContext()
    ctx.mockDb._qb._result = []
    await expect(assertCampaignSendAuthorized(ctx, CAMPAIGN)).rejects.toThrow(
      /no owner authorization/i,
    )
  })

  it('throws when the authorized hash no longer matches current content', async () => {
    const ctx = createTestContext()
    ctx.mockDb._qb._result = [{ id: 'auth-001', status: 'authorized', payloadHash: 'b'.repeat(64) }]
    await expect(assertCampaignSendAuthorized(ctx, CAMPAIGN)).rejects.toThrow(
      /changed after it was authorized/i,
    )
  })

  it('returns the ledger row when the current payload hash matches', async () => {
    const ctx = createTestContext()
    const variant = makeVariantRow()
    const liveHash = hashAuthorizationPayload(
      buildAuthorizationPayload(
        CAMPAIGN,
        [variant as unknown as VariantRow],
        process.env.EMAIL_FROM ?? 'MADFAM <noreply@madfam.io>',
      ),
    )
    // Gate performs two reads: the authorization row, then the variants.
    const results: unknown[][] = [
      [{ id: 'auth-001', status: 'authorized', payloadHash: liveHash }],
      [variant],
    ]
    ctx.mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) =>
      Promise.resolve(results.shift() ?? []).then(resolve),
    )

    const record = await assertCampaignSendAuthorized(ctx, CAMPAIGN)
    expect(record.id).toBe('auth-001')
  })
})
