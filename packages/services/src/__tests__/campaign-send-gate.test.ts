import { describe, expect, it } from 'vitest'
import { evaluateContactEligibility } from '../campaigns/campaign-send-gate'

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
})
