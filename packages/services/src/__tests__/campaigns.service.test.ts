import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as authGate from '../campaigns/campaign-authorization-gate'
import { CampaignAuthorizationService } from '../campaigns/campaign-authorization.service'
import * as sendGate from '../campaigns/campaign-send-gate'
import { CampaignsService } from '../campaigns/campaigns.service'
import { NotFoundError, ValidationError } from '../errors'
import { type MockDatabase, createTestContext, makeCampaign } from './helpers'

/** The `authorized` ledger row the send-gate spy hands back in happy paths. */
function makeAuthorizationRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'auth-001',
    campaignId: 'camp-tulana',
    status: 'authorized',
    payloadHash: 'a'.repeat(64),
    snapshot: {},
    requestedBy: 'test-user',
    decidedBy: 'owner@madfam.io',
    decidedVia: 'web',
    decisionNote: null,
    decidedAt: new Date('2026-01-15T10:00:00Z'),
    createdAt: new Date('2026-01-15T09:00:00Z'),
    updatedAt: new Date('2026-01-15T10:00:00Z'),
    ...overrides,
  } as Awaited<ReturnType<typeof authGate.assertCampaignSendAuthorized>>
}

vi.mock('../campaigns/campaign-buyer-signal.service', () => ({
  CampaignBuyerSignalService: vi.fn().mockImplementation(() => ({
    record: vi.fn().mockResolvedValue({ id: 'signal-001', deduplicated: false }),
  })),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  asc: vi.fn((col: unknown) => ({ _tag: 'asc', col })),
  desc: vi.fn((col: unknown) => ({ _tag: 'desc', col })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  gt: vi.fn((col: unknown, val: unknown) => ({ _tag: 'gt', col, val })),
  inArray: vi.fn((col: unknown, vals: unknown) => ({ _tag: 'inArray', col, vals })),
  isNotNull: vi.fn((col: unknown) => ({ _tag: 'isNotNull', col })),
  isNull: vi.fn((col: unknown) => ({ _tag: 'isNull', col })),
  sql: vi.fn((...args: unknown[]) => ({ _tag: 'sql', args })),
}))

// EmailService is exercised in the eligible send path; spy on its send so we
// can assert dispatch without hitting Resend. Returns a provider id like a
// real send would.
const emailSendSpy = vi.fn().mockResolvedValue({ id: 'resend-msg-001' })
vi.mock('../email/email.service', () => ({
  EmailService: vi.fn().mockImplementation(() => ({ send: emailSendSpy })),
  resolveSenderIdentity: vi.fn(() => 'MADFAM <noreply@madfam.io>'),
}))

vi.mock('@phynd/db/schema', () => ({
  campaigns: {
    id: 'campaigns.id',
    status: 'campaigns.status',
  },
  contacts: { id: 'contacts.id', email: 'contacts.email', deletedAt: 'contacts.deleted_at' },
  leads: { id: 'leads.id', contactId: 'leads.contact_id', deletedAt: 'leads.deleted_at' },
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

describe('CampaignsService', () => {
  let service: CampaignsService
  let mockDb: MockDatabase

  beforeEach(() => {
    const ctx = createTestContext()
    mockDb = ctx.mockDb
    service = new CampaignsService(ctx)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // list()
  // -------------------------------------------------------------------------
  describe('list()', () => {
    it('returns paginated campaigns', async () => {
      mockDb._qb._result = [makeCampaign()]
      const result = await service.list()
      expect(result.items).toHaveLength(1)
      expect(result.hasMore).toBe(false)
      expect(result.nextCursor).toBeNull()
    })

    it('detects hasMore when rows exceed limit', async () => {
      const items = [
        makeCampaign({ id: 'c1' }),
        makeCampaign({ id: 'c2' }),
        makeCampaign({ id: 'c3' }),
      ]
      mockDb._qb._result = items
      const result = await service.list({ limit: 2 })
      expect(result.items).toHaveLength(2)
      expect(result.hasMore).toBe(true)
    })

    it('returns empty when no campaigns', async () => {
      mockDb._qb._result = []
      const result = await service.list()
      expect(result.items).toHaveLength(0)
      expect(result.hasMore).toBe(false)
    })

    it('applies cursor for pagination', async () => {
      mockDb._qb._result = [makeCampaign({ id: 'c5' })]
      const result = await service.list({ cursor: 'c4', limit: 10 })
      expect(result.items).toHaveLength(1)
      expect(mockDb._qb.where).toHaveBeenCalled()
    })

    it('applies Tulana list filters', async () => {
      mockDb._qb._result = [makeCampaign({ skuKey: 'avala__issuer', status: 'needs_review' })]
      const result = await service.list(undefined, {
        status: 'needs_review',
        tulanaOnly: true,
        gaReadiness: 'near_ready',
      })
      expect(result.items).toHaveLength(1)
      expect(mockDb._qb.where).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // getById()
  // -------------------------------------------------------------------------
  describe('getById()', () => {
    it('returns a campaign when found', async () => {
      const campaign = makeCampaign()
      mockDb._qb._result = [campaign]
      const result = await service.getById('campaign-001')
      expect(result).toEqual(campaign)
    })

    it('returns null when not found', async () => {
      mockDb._qb._result = []
      const result = await service.getById('nonexistent')
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // getByUtmCampaign()
  // -------------------------------------------------------------------------
  describe('getByUtmCampaign()', () => {
    it('returns a campaign when one matches the utm_campaign', async () => {
      const campaign = makeCampaign({ utmCampaign: 'spring-2026' })
      mockDb._qb._result = [campaign]
      const result = await service.getByUtmCampaign('spring-2026')
      expect(result).toEqual(campaign)
    })

    it('returns null for empty utm_campaign without hitting the DB', async () => {
      const result = await service.getByUtmCampaign('')
      expect(result).toBeNull()
      expect(mockDb.select).not.toHaveBeenCalled()
    })

    it('returns null when no campaign matches', async () => {
      mockDb._qb._result = []
      const result = await service.getByUtmCampaign('nonexistent-campaign')
      expect(result).toBeNull()
    })

    it('returns the earliest match when multiple campaigns share the slug', async () => {
      // Service applies orderBy + limit(1) so the helper just yields the
      // first item. Verifying the correct LIMIT behavior here.
      const earliest = makeCampaign({ id: 'campaign-old', utmCampaign: 'evergreen' })
      mockDb._qb._result = [earliest]
      const result = await service.getByUtmCampaign('evergreen')
      expect(result?.id).toBe('campaign-old')
    })
  })

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------
  describe('create()', () => {
    it('creates a campaign', async () => {
      const newCampaign = makeCampaign({ id: 'campaign-new' })
      mockDb._qb._result = [newCampaign]
      const result = await service.create({ name: 'New Campaign' })
      expect(result).toEqual(newCampaign)
      expect(mockDb.insert).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // update()
  // -------------------------------------------------------------------------
  describe('update()', () => {
    it('updates a campaign', async () => {
      const updated = makeCampaign({ status: 'paused' })
      mockDb._qb._result = [updated]
      const result = await service.update('campaign-001', { status: 'paused' })
      expect(result).toEqual(updated)
      expect(mockDb.update).toHaveBeenCalled()
    })

    it('returns null when updating nonexistent campaign', async () => {
      mockDb._qb._result = []
      const result = await service.update('nonexistent', { status: 'paused' })
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // delete()
  // -------------------------------------------------------------------------
  describe('delete()', () => {
    it('deletes a campaign', async () => {
      mockDb._qb._result = [makeCampaign()]
      const result = await service.delete('campaign-001')
      expect(result).toBeDefined()
      expect(mockDb.delete).toHaveBeenCalled()
    })

    it('returns null when deleting nonexistent campaign', async () => {
      mockDb._qb._result = []
      const result = await service.delete('nonexistent')
      expect(result).toBeNull()
    })
  })

  describe('listDraftVariants()', () => {
    it('returns persisted draft variants for a campaign', async () => {
      const campaign = makeCampaign({ id: 'campaign-tulana', skuKey: 'avala__issuer' })
      const variants = [
        {
          id: 'variant-row-1',
          campaignId: 'campaign-tulana',
          variantId: 'v-1',
          format: 'structured',
          claimKeysUsed: ['issuer_verified_badges'],
        },
      ]
      vi.spyOn(service, 'getById').mockResolvedValue(
        campaign as Awaited<ReturnType<typeof service.getById>>,
      )
      mockDb._qb._result = variants

      const result = await service.listDraftVariants('campaign-tulana')
      expect(result).toEqual(variants)
    })

    it('throws NotFoundError for an unknown campaign', async () => {
      vi.spyOn(service, 'getById').mockResolvedValue(null)
      await expect(service.listDraftVariants('missing')).rejects.toThrow('Campaign')
    })
  })

  describe('reviewTulanaImport()', () => {
    it('approves a ready Tulana import', async () => {
      const pending = makeCampaign({
        id: 'campaign-tulana',
        skuKey: 'avala__issuer',
        gaReadiness: 'ready',
        status: 'needs_review',
      })
      const approved = { ...pending, status: 'approved' }
      mockDb._qb._result = [pending]
      vi.spyOn(service, 'update').mockResolvedValue(approved)
      // Staff approval also queues the owner-authorization request.
      const requestSpy = vi
        .spyOn(CampaignAuthorizationService.prototype, 'request')
        .mockResolvedValue(makeAuthorizationRecord({ status: 'pending' }))

      const result = await service.reviewTulanaImport('campaign-tulana', 'approved')
      expect(result?.status).toBe('approved')
      expect(service.update).toHaveBeenCalledWith('campaign-tulana', { status: 'approved' })
      expect(requestSpy).toHaveBeenCalledWith('campaign-tulana', 'test-user')
    })

    it('still approves when the authorization request has nothing reviewable', async () => {
      const pending = makeCampaign({
        id: 'campaign-tulana',
        skuKey: 'avala__issuer',
        gaReadiness: 'ready',
        status: 'needs_review',
      })
      const approved = { ...pending, status: 'approved' }
      mockDb._qb._result = [pending]
      vi.spyOn(service, 'update').mockResolvedValue(approved)
      // No draft variants → request() refuses; approval itself must survive
      // (the send path stays blocked until a request exists and is authorized).
      vi.spyOn(CampaignAuthorizationService.prototype, 'request').mockRejectedValue(
        new ValidationError('Campaign has no draft variants'),
      )

      const result = await service.reviewTulanaImport('campaign-tulana', 'approved')
      expect(result?.status).toBe('approved')
    })

    it('rejects a Tulana import without GA guard', async () => {
      const pending = makeCampaign({
        id: 'campaign-tulana',
        skuKey: 'avala__issuer',
        gaReadiness: 'not_ready',
        status: 'needs_review',
      })
      const rejected = { ...pending, status: 'rejected' }
      mockDb._qb._result = [pending]
      vi.spyOn(service, 'update').mockResolvedValue(rejected)

      const result = await service.reviewTulanaImport('campaign-tulana', 'rejected')
      expect(result?.status).toBe('rejected')
      expect(service.update).toHaveBeenCalledWith('campaign-tulana', { status: 'rejected' })
    })

    it('blocks approval when ga_readiness is not_ready', async () => {
      mockDb._qb._result = [
        makeCampaign({
          id: 'campaign-tulana',
          skuKey: 'avala__issuer',
          gaReadiness: 'not_ready',
          status: 'needs_review',
        }),
      ]

      await expect(
        service.reviewTulanaImport('campaign-tulana', 'approved'),
      ).rejects.toBeInstanceOf(ValidationError)
    })

    it('throws when campaign is not a Tulana import', async () => {
      mockDb._qb._result = [makeCampaign({ skuKey: null })]

      await expect(service.reviewTulanaImport('campaign-001', 'approved')).rejects.toBeInstanceOf(
        ValidationError,
      )
    })

    it('throws when campaign is missing', async () => {
      mockDb._qb._result = []

      await expect(service.reviewTulanaImport('missing', 'approved')).rejects.toBeInstanceOf(
        NotFoundError,
      )
    })
  })

  describe('attemptTulanaSend()', () => {
    // The two fail-closed tests run FIRST: they exercise the REAL
    // authorization gate, before any test installs a spy on it (spy
    // implementations persist across clearAllMocks).
    it('blocks the send outright when no owner authorization exists (fail closed)', async () => {
      const campaign = makeCampaign({
        id: 'camp-tulana',
        skuKey: 'avala__issuer',
        status: 'approved',
        tulanaMetadata: { drafts: [{ channel: 'email' }] },
      })

      // No authorized row in the ledger — the mock db returns [] for the
      // gate's select. The real gate must throw before any consent
      // evaluation or email dispatch happens.
      mockDb._qb._result = []
      vi.spyOn(service, 'getById').mockResolvedValue(
        campaign as Awaited<ReturnType<typeof service.getById>>,
      )
      const eligibilitySpy = vi.spyOn(sendGate, 'checkCampaignSendEligibility')

      await expect(service.attemptTulanaSend('camp-tulana', 'contact-001')).rejects.toThrow(
        /no owner authorization/i,
      )
      expect(eligibilitySpy).not.toHaveBeenCalled()
      expect(emailSendSpy).not.toHaveBeenCalled()
      eligibilitySpy.mockRestore()
    })

    it('blocks the send when campaign content drifted after authorization (hash mismatch)', async () => {
      const campaign = makeCampaign({
        id: 'camp-tulana',
        skuKey: 'avala__issuer',
        status: 'approved',
        tulanaMetadata: { drafts: [{ channel: 'email' }] },
      })

      // An authorized row exists, but its payloadHash was computed over
      // different content than the campaign currently carries.
      mockDb._qb._result = [makeAuthorizationRecord({ payloadHash: 'f'.repeat(64) })]
      vi.spyOn(service, 'getById').mockResolvedValue(
        campaign as Awaited<ReturnType<typeof service.getById>>,
      )

      await expect(service.attemptTulanaSend('camp-tulana', 'contact-001')).rejects.toThrow(
        /changed after it was authorized/i,
      )
      expect(emailSendSpy).not.toHaveBeenCalled()
    })

    it('suppresses send when consent checks fail', async () => {
      const campaign = makeCampaign({
        id: 'camp-tulana',
        skuKey: 'avala__issuer',
        status: 'approved',
        tulanaMetadata: { drafts: [{ channel: 'email' }] },
      })

      mockDb._qb._result = [campaign]
      vi.spyOn(authGate, 'assertCampaignSendAuthorized').mockResolvedValue(
        makeAuthorizationRecord(),
      )
      vi.spyOn(sendGate, 'checkCampaignSendEligibility').mockResolvedValue({
        eligible: false,
        reasons: ['marketing_consent_missing'],
        channel: 'email',
      })
      vi.spyOn(service, 'update').mockResolvedValue({ ...campaign, status: 'suppressed' })

      const result = await service.attemptTulanaSend('camp-tulana', 'contact-001')
      expect(result.outcome).toBe('suppressed')
      expect(result.reasons).toContain('marketing_consent_missing')
    })

    it('sends the draft variant and marks campaign sent when eligibility passes', async () => {
      const campaign = makeCampaign({
        id: 'camp-tulana',
        skuKey: 'avala__issuer',
        status: 'approved',
        tulanaMetadata: { audience: 'credential issuers', drafts: [{ channel: 'email' }] },
      })

      // The mock db resolves every query to the same _result; give it a row
      // that satisfies the campaign, contact, draft-variant and lead reads the
      // send path performs (email + body + id fields on one object).
      mockDb._qb._result = [
        {
          ...campaign,
          email: 'lead@example.com',
          body: 'Governed campaign body grounded in campaign-safe claims.',
          subject: 'A subject from the Selva variant',
          preheader: 'Preview text',
          cta: 'See how it works',
          variantId: 'var-abc',
        },
      ]
      vi.spyOn(authGate, 'assertCampaignSendAuthorized').mockResolvedValue(
        makeAuthorizationRecord(),
      )
      vi.spyOn(sendGate, 'checkCampaignSendEligibility').mockResolvedValue({
        eligible: true,
        reasons: [],
        channel: 'email',
      })
      vi.spyOn(service, 'update').mockResolvedValue({ ...campaign, status: 'sent' })

      const result = await service.attemptTulanaSend('camp-tulana', 'contact-001')
      expect(result.outcome).toBe('sent')

      // The break this fix closes: an eligible send now actually dispatches the
      // approved copy, tagged for open/click attribution.
      expect(emailSendSpy).toHaveBeenCalledTimes(1)
      const sendArg = emailSendSpy.mock.calls.at(0)?.at(0)
      expect(sendArg.to).toBe('lead@example.com')
      expect(sendArg.subject).toBe('A subject from the Selva variant')
      expect(sendArg.html).toContain('Governed campaign body')
      expect(sendArg.tags).toEqual(
        expect.arrayContaining([
          { name: 'campaign_id', value: 'camp-tulana' },
          { name: 'contact_id', value: 'contact-001' },
          { name: 'sku_key', value: 'avala__issuer' },
        ]),
      )
      expect(result.providerMessageId).toBe('resend-msg-001')
    })

    it('does not send when the contact is suppressed', async () => {
      const campaign = makeCampaign({
        id: 'camp-tulana',
        skuKey: 'avala__issuer',
        status: 'approved',
        tulanaMetadata: { drafts: [{ channel: 'email' }] },
      })

      mockDb._qb._result = [campaign]
      vi.spyOn(authGate, 'assertCampaignSendAuthorized').mockResolvedValue(
        makeAuthorizationRecord(),
      )
      vi.spyOn(sendGate, 'checkCampaignSendEligibility').mockResolvedValue({
        eligible: false,
        reasons: ['suppressed'],
        channel: 'email',
      })
      vi.spyOn(service, 'update').mockResolvedValue({ ...campaign, status: 'suppressed' })

      const result = await service.attemptTulanaSend('camp-tulana', 'contact-001')
      expect(result.outcome).toBe('suppressed')
      // Gate honored: a suppressed contact is never emailed.
      expect(emailSendSpy).not.toHaveBeenCalled()
    })
  })
})
