import { describe, expect, it } from 'vitest'
import {
  checkCampaignSendEligibility,
  consentChannelForOutreach,
  evaluateContactEligibility,
} from '../campaigns/campaign-send-gate'
import { type MockDatabase, createTestContext, makeCampaign, makeContact } from './helpers'

describe('evaluateContactEligibility', () => {
  const baseContact = {
    marketingConsent: true,
    email: 'pilot@staging.madfam.io',
    phone: null,
    deletedAt: null,
  }

  it('allows send when consent is present and leads are subscribed', () => {
    const result = evaluateContactEligibility(baseContact, [{ unsubscribed: false }], 'email')
    expect(result.eligible).toBe(true)
    expect(result.reasons).toHaveLength(0)
  })

  it('blocks when marketing consent is missing', () => {
    const result = evaluateContactEligibility(
      { ...baseContact, marketingConsent: false },
      [],
      'email',
    )
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('marketing_consent_missing')
  })

  it('blocks when any lead is unsubscribed', () => {
    const result = evaluateContactEligibility(baseContact, [{ unsubscribed: true }], 'email')
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('lead_unsubscribed')
  })

  it('blocks email channel when contact email is missing', () => {
    const result = evaluateContactEligibility({ ...baseContact, email: null }, [], 'email')
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('email_missing')
  })

  it('blocks sms channel when phone is missing', () => {
    const result = evaluateContactEligibility(baseContact, [], 'sms')
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('phone_missing')
  })

  describe('consent-model gating', () => {
    it('granted channel consent permits even when the legacy boolean is false', () => {
      const result = evaluateContactEligibility(
        { ...baseContact, marketingConsent: false },
        [],
        'email',
        { consentStatus: 'granted', suppressionReasons: [] },
      )
      expect(result.eligible).toBe(true)
      expect(result.reasons).toHaveLength(0)
    })

    it('revoked channel consent blocks even when the legacy boolean is true', () => {
      const result = evaluateContactEligibility(baseContact, [], 'email', {
        consentStatus: 'revoked',
        suppressionReasons: [],
      })
      expect(result.eligible).toBe(false)
      expect(result.reasons).toContain('channel_consent_revoked')
    })

    it('pending double opt-in blocks the send', () => {
      const result = evaluateContactEligibility(baseContact, [], 'email', {
        consentStatus: 'pending_double_opt_in',
        suppressionReasons: [],
      })
      expect(result.eligible).toBe(false)
      expect(result.reasons).toContain('channel_consent_pending_double_opt_in')
    })

    it('falls back to the legacy boolean when no consent record exists', () => {
      const withBoolean = evaluateContactEligibility(baseContact, [], 'email', {
        consentStatus: null,
        suppressionReasons: [],
      })
      expect(withBoolean.eligible).toBe(true)

      const withoutBoolean = evaluateContactEligibility(
        { ...baseContact, marketingConsent: false },
        [],
        'email',
        { consentStatus: null, suppressionReasons: [] },
      )
      expect(withoutBoolean.eligible).toBe(false)
      expect(withoutBoolean.reasons).toContain('marketing_consent_missing')
    })
  })

  describe('suppression precedence', () => {
    it('suppression wins over granted channel consent', () => {
      const result = evaluateContactEligibility(baseContact, [], 'email', {
        consentStatus: 'granted',
        suppressionReasons: ['complaint'],
      })
      expect(result.eligible).toBe(false)
      expect(result.reasons).toContain('suppressed')
    })

    it('suppression wins over the legacy consent boolean', () => {
      const result = evaluateContactEligibility(baseContact, [{ unsubscribed: false }], 'email', {
        consentStatus: null,
        suppressionReasons: ['hard_bounce'],
      })
      expect(result.eligible).toBe(false)
      expect(result.reasons).toContain('suppressed')
    })
  })
})

describe('consentChannelForOutreach', () => {
  it('maps outreach channels to consent channels', () => {
    expect(consentChannelForOutreach('email')).toBe('email')
    expect(consentChannelForOutreach('SMS')).toBe('sms')
    expect(consentChannelForOutreach('phone')).toBe('sms')
    expect(consentChannelForOutreach('whatsapp')).toBe('whatsapp')
    // Unknown channels fall back to email consent
    expect(consentChannelForOutreach('social')).toBe('email')
  })
})

describe('checkCampaignSendEligibility (integration with consent models)', () => {
  function sequenceResults(db: MockDatabase, results: unknown[]) {
    let call = 0
    db._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
      const result = call < results.length ? results[call] : []
      call += 1
      return Promise.resolve(result).then(resolve)
    })
  }

  const campaign = makeCampaign({ channel: 'email' })
  const contact = makeContact({
    email: 'pilot@staging.madfam.io',
    marketingConsent: true,
    consentedAt: null,
  })

  it('is eligible with granted consent and no suppression', async () => {
    const ctx = createTestContext()
    sequenceResults(ctx.mockDb, [
      [campaign], // campaign lookup
      [contact], // contact lookup
      [], // leads
      [{ status: 'granted' }], // consent record
      [], // suppression entries
    ])

    const result = await checkCampaignSendEligibility(ctx, {
      campaignId: 'campaign-001',
      contactId: 'contact-001',
    })
    expect(result.eligible).toBe(true)
    expect(result.channel).toBe('email')
  })

  it('blocks when the recipient is on the suppression list despite granted consent', async () => {
    const ctx = createTestContext()
    sequenceResults(ctx.mockDb, [
      [campaign],
      [contact],
      [],
      [{ status: 'granted' }],
      [{ id: 'sup-001', channel: 'all', reason: 'complaint' }],
    ])

    const result = await checkCampaignSendEligibility(ctx, {
      campaignId: 'campaign-001',
      contactId: 'contact-001',
    })
    expect(result.eligible).toBe(false)
    expect(result.reasons).toEqual(['suppressed'])
  })

  it('blocks when channel consent is revoked', async () => {
    const ctx = createTestContext()
    sequenceResults(ctx.mockDb, [[campaign], [contact], [], [{ status: 'revoked' }], []])

    const result = await checkCampaignSendEligibility(ctx, {
      campaignId: 'campaign-001',
      contactId: 'contact-001',
    })
    expect(result.eligible).toBe(false)
    expect(result.reasons).toEqual(['channel_consent_revoked'])
  })

  it('keeps legacy boolean behavior when no consent record exists', async () => {
    const ctx = createTestContext()
    sequenceResults(ctx.mockDb, [[campaign], [contact], [], [], []])

    const result = await checkCampaignSendEligibility(ctx, {
      campaignId: 'campaign-001',
      contactId: 'contact-001',
    })
    expect(result.eligible).toBe(true)
  })
})
