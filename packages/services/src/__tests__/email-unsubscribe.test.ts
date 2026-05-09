import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildUnsubscribeUrl,
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
} from '../email/unsubscribe-token'

describe('unsubscribe-token', () => {
  describe('generateUnsubscribeToken', () => {
    it('creates token in format leadId.signature', () => {
      const token = generateUnsubscribeToken('lead-123')
      expect(token).toContain('lead-123.')
      const parts = token.split('.')
      expect(parts).toHaveLength(2)
      expect(parts[0]).toBe('lead-123')
      expect(parts[1]).toHaveLength(16) // 16-char hex signature
    })

    it('produces deterministic tokens for the same leadId', () => {
      const t1 = generateUnsubscribeToken('lead-abc')
      const t2 = generateUnsubscribeToken('lead-abc')
      expect(t1).toBe(t2)
    })

    it('produces different tokens for different leadIds', () => {
      const t1 = generateUnsubscribeToken('lead-111')
      const t2 = generateUnsubscribeToken('lead-222')
      expect(t1).not.toBe(t2)
    })
  })

  describe('verifyUnsubscribeToken', () => {
    it('returns leadId for valid token', () => {
      const token = generateUnsubscribeToken('lead-xyz')
      const result = verifyUnsubscribeToken(token)
      expect(result).toBe('lead-xyz')
    })

    it('returns null for tampered signature', () => {
      const token = generateUnsubscribeToken('lead-xyz')
      const tampered = `${token.slice(0, -1)}X`
      expect(verifyUnsubscribeToken(tampered)).toBeNull()
    })

    it('returns null for missing signature', () => {
      expect(verifyUnsubscribeToken('lead-xyz')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(verifyUnsubscribeToken('')).toBeNull()
    })

    it('returns null for garbage input', () => {
      expect(verifyUnsubscribeToken('not.a.valid.token')).toBeNull()
    })
  })

  describe('buildUnsubscribeUrl', () => {
    it('constructs URL with token', () => {
      const url = buildUnsubscribeUrl('lead-456')
      expect(url).toContain('/api/unsubscribe?token=lead-456.')
    })

    it('uses NEXT_PUBLIC_APP_URL when set', () => {
      const original = process.env.NEXT_PUBLIC_APP_URL
      process.env.NEXT_PUBLIC_APP_URL = 'https://test.example.com'
      const url = buildUnsubscribeUrl('lead-789')
      expect(url).toMatch(/^https:\/\/test\.example\.com\/api\/unsubscribe/)
      process.env.NEXT_PUBLIC_APP_URL = original
    })

    it('falls back to phynd.app', () => {
      const original = process.env.NEXT_PUBLIC_APP_URL
      delete process.env.NEXT_PUBLIC_APP_URL
      const url = buildUnsubscribeUrl('lead-000')
      expect(url).toMatch(/^https:\/\/crm\.madfam\.io\/api\/unsubscribe/)
      process.env.NEXT_PUBLIC_APP_URL = original
    })
  })
})
