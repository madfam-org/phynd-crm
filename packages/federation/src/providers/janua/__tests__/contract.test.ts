/**
 * Contract test for the JanuaProvider federation integration.
 *
 * Guards the JanuaRawProfile shape defined inline in providers/janua/
 * index.ts. If Janua's GET /api/v1/users/{sub} response adds, removes,
 * or renames a field, these tests go red BEFORE production breaks.
 *
 * Counterpart (future): janua/apps/api/tests/federation-contract.spec.ts
 * — Janua side asserts it emits the same shape.
 */
import { describe, expect, it } from 'vitest'

import {
  type JsonSchema,
  assertSchemaValid,
  validateAgainstSchema,
} from '../../../__tests__/contract-helpers'
import { JanuaProvider } from '../index'

const januaRawProfileSchema: JsonSchema = {
  $id: 'janua-raw-profile.schema.json',
  title: 'JanuaRawProfile',
  type: 'object',
  required: ['sub', 'email', 'name', 'roles', 'scopes', 'email_verified'],
  additionalProperties: false,
  properties: {
    sub: { type: 'string', minLength: 1, maxLength: 255 },
    email: { type: 'string', minLength: 3, format: 'email' },
    name: { type: 'string', maxLength: 500 },
    picture: { type: ['string', 'null'], format: 'uri' },
    roles: {
      type: 'array',
      maxItems: 100,
      items: { type: 'string', maxLength: 100 },
    },
    scopes: {
      type: 'array',
      maxItems: 200,
      items: { type: 'string', maxLength: 100 },
    },
    email_verified: { type: 'boolean' },
    last_login: { type: ['string', 'null'], format: 'date-time' },
  },
}

const fixtures = {
  typical: {
    sub: 'janua-user-001',
    email: 'alice@example.com',
    name: 'Alice Rivera',
    roles: ['admin', 'billing:read'],
    scopes: ['openid', 'profile', 'email'],
    email_verified: true,
    last_login: '2026-04-17T14:00:00.000Z',
  },
  newSignup: {
    sub: 'janua-user-002',
    email: 'pending@example.com',
    name: '',
    roles: [],
    scopes: ['openid'],
    email_verified: false,
  },
}

describe('JanuaRawProfile contract schema', () => {
  it.each(Object.entries(fixtures))('fixture "%s" conforms', (_, fixture) => {
    assertSchemaValid(fixture, januaRawProfileSchema, 'JanuaRawProfile')
  })

  it('rejects missing sub', () => {
    const { sub: _, ...invalid } = fixtures.typical
    const errors = validateAgainstSchema(invalid, januaRawProfileSchema)
    expect(errors.some((e) => e.path === '$.sub')).toBe(true)
  })

  it('rejects missing email_verified', () => {
    const { email_verified: _, ...invalid } = fixtures.typical
    const errors = validateAgainstSchema(invalid, januaRawProfileSchema)
    expect(errors.some((e) => e.path === '$.email_verified')).toBe(true)
  })

  it('rejects additional properties at root', () => {
    const invalid = { ...fixtures.typical, surprise: 'new field' }
    const errors = validateAgainstSchema(invalid, januaRawProfileSchema)
    expect(errors.some((e) => e.message.includes('additional property'))).toBe(true)
  })
})

describe('JanuaProvider.map() transformation', () => {
  const provider = new JanuaProvider('https://auth.madfam.io')

  it('maps a typical profile to JanuaIdentity', () => {
    const result = provider.map(fixtures.typical)
    expect(result.userId).toBe('janua-user-001')
    expect(result.email).toBe('alice@example.com')
    expect(result.displayName).toBe('Alice Rivera')
    expect(result.verified).toBe(true)
    expect(result.roles).toEqual(['admin', 'billing:read'])
    expect(result.lastLoginAt).toBeInstanceOf(Date)
  })

  it('renames sub -> userId', () => {
    const result = provider.map(fixtures.typical)
    expect(result).toHaveProperty('userId')
    expect(result).not.toHaveProperty('sub')
  })

  it('coerces absent picture / last_login to null', () => {
    const result = provider.map(fixtures.newSignup)
    expect(result.avatarUrl).toBeNull()
    expect(result.lastLoginAt).toBeNull()
  })
})
