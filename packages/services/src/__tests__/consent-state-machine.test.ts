import { describe, expect, it } from 'vitest'
import {
  isConsentAction,
  isConsentChannel,
  nextConsentStatus,
  normalizeConsentIdentifier,
} from '../consent/consent-state-machine'

describe('nextConsentStatus', () => {
  describe('from no record (none)', () => {
    it('grant → granted', () => {
      expect(nextConsentStatus(null, 'grant')).toBe('granted')
    })
    it('request_double_opt_in → pending_double_opt_in', () => {
      expect(nextConsentStatus(null, 'request_double_opt_in')).toBe('pending_double_opt_in')
    })
    it('revoke → revoked (durable opt-out tombstone)', () => {
      expect(nextConsentStatus(null, 'revoke')).toBe('revoked')
    })
    it('confirm_double_opt_in is invalid without a pending record', () => {
      expect(nextConsentStatus(null, 'confirm_double_opt_in')).toBeNull()
    })
  })

  describe('from pending_double_opt_in', () => {
    it('confirm_double_opt_in → granted', () => {
      expect(nextConsentStatus('pending_double_opt_in', 'confirm_double_opt_in')).toBe('granted')
    })
    it('revoke → revoked', () => {
      expect(nextConsentStatus('pending_double_opt_in', 'revoke')).toBe('revoked')
    })
    it('request_double_opt_in re-issues (stays pending)', () => {
      expect(nextConsentStatus('pending_double_opt_in', 'request_double_opt_in')).toBe(
        'pending_double_opt_in',
      )
    })
    it('explicit grant with evidence → granted', () => {
      expect(nextConsentStatus('pending_double_opt_in', 'grant')).toBe('granted')
    })
  })

  describe('from granted', () => {
    it('revoke → revoked', () => {
      expect(nextConsentStatus('granted', 'revoke')).toBe('revoked')
    })
    it('grant refreshes evidence (stays granted)', () => {
      expect(nextConsentStatus('granted', 'grant')).toBe('granted')
    })
    it('never downgrades to pending via request_double_opt_in', () => {
      expect(nextConsentStatus('granted', 'request_double_opt_in')).toBeNull()
    })
  })

  describe('from revoked', () => {
    it('confirm_double_opt_in is invalid — revocation kills outstanding tokens', () => {
      expect(nextConsentStatus('revoked', 'confirm_double_opt_in')).toBeNull()
    })
    it('re-grant with fresh evidence → granted', () => {
      expect(nextConsentStatus('revoked', 'grant')).toBe('granted')
    })
    it('fresh double-opt-in cycle → pending_double_opt_in', () => {
      expect(nextConsentStatus('revoked', 'request_double_opt_in')).toBe('pending_double_opt_in')
    })
    it('repeat revoke is idempotent', () => {
      expect(nextConsentStatus('revoked', 'revoke')).toBe('revoked')
    })
  })
})

describe('guards and normalization', () => {
  it('isConsentChannel accepts email/sms/whatsapp only', () => {
    expect(isConsentChannel('email')).toBe(true)
    expect(isConsentChannel('sms')).toBe(true)
    expect(isConsentChannel('whatsapp')).toBe(true)
    expect(isConsentChannel('fax')).toBe(false)
    expect(isConsentChannel('all')).toBe(false)
  })

  it('isConsentAction rejects unknown actions', () => {
    expect(isConsentAction('grant')).toBe(true)
    expect(isConsentAction('destroy')).toBe(false)
  })

  it('normalizeConsentIdentifier trims and lowercases', () => {
    expect(normalizeConsentIdentifier('  Persona@Example.MX ')).toBe('persona@example.mx')
  })
})
