/**
 * Contract test for JanuaTelemetryProvider.
 * Guards JanuaRawTelemetry shape from janua-telemetry/index.ts.
 */
import { describe, expect, it } from 'vitest'

import {
  type JsonSchema,
  assertSchemaValid,
  validateAgainstSchema,
} from '../../../__tests__/contract-helpers'
import { JanuaTelemetryProvider } from '../index'

const schema: JsonSchema = {
  type: 'object',
  required: ['sessions', 'total_sessions', 'unique_devices', 'top_sources'],
  additionalProperties: false,
  properties: {
    sessions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['session_id', 'fingerprint', 'identified', 'page_views', 'started_at'],
        additionalProperties: false,
        properties: {
          session_id: { type: 'string', minLength: 1 },
          fingerprint: { type: 'string' },
          contact_id: { type: ['string', 'null'] },
          identified: { type: 'boolean' },
          ip_city: { type: ['string', 'null'] },
          ip_country: { type: ['string', 'null'] },
          device_type: { type: ['string', 'null'] },
          browser: { type: ['string', 'null'] },
          os: { type: ['string', 'null'] },
          referrer: { type: ['string', 'null'] },
          utm_source: { type: ['string', 'null'] },
          utm_medium: { type: ['string', 'null'] },
          utm_campaign: { type: ['string', 'null'] },
          utm_term: { type: ['string', 'null'] },
          utm_content: { type: ['string', 'null'] },
          page_views: {
            type: 'array',
            items: {
              type: 'object',
              required: ['url', 'timestamp'],
              additionalProperties: false,
              properties: {
                url: { type: 'string' },
                title: { type: ['string', 'null'] },
                duration: { type: ['number', 'null'] },
                timestamp: { type: 'string' },
              },
            },
          },
          started_at: { type: 'string' },
          ended_at: { type: ['string', 'null'] },
          duration: { type: ['number', 'null'] },
        },
      },
    },
    total_sessions: { type: 'integer', minimum: 0 },
    unique_devices: { type: 'integer', minimum: 0 },
    top_sources: {
      type: 'array',
      items: {
        type: 'object',
        required: ['source', 'count'],
        additionalProperties: false,
        properties: {
          source: { type: 'string' },
          count: { type: 'integer', minimum: 0 },
        },
      },
    },
  },
}

const fixture = {
  sessions: [
    {
      session_id: 'sess-1',
      fingerprint: 'fp-abc',
      contact_id: 'c-1',
      identified: true,
      ip_city: 'Mexico City',
      ip_country: 'MX',
      device_type: 'mobile',
      browser: 'Chrome',
      os: 'iOS',
      referrer: 'google.com',
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'launch',
      utm_term: null,
      utm_content: null,
      page_views: [{ url: '/', title: 'Home', duration: 12, timestamp: '2026-04-17T10:00:00Z' }],
      started_at: '2026-04-17T10:00:00Z',
      ended_at: '2026-04-17T10:05:00Z',
      duration: 300,
    },
  ],
  total_sessions: 1,
  unique_devices: 1,
  top_sources: [{ source: 'google', count: 1 }],
}

const emptyFixture = {
  sessions: [],
  total_sessions: 0,
  unique_devices: 0,
  top_sources: [],
}

describe('JanuaRawTelemetry contract', () => {
  it('typical fixture conforms', () => {
    assertSchemaValid(fixture, schema)
  })

  it('empty fixture conforms', () => {
    assertSchemaValid(emptyFixture, schema)
  })

  it('rejects negative total_sessions', () => {
    const invalid = { ...fixture, total_sessions: -1 }
    const errors = validateAgainstSchema(invalid, schema)
    expect(errors.some((e) => e.path === '$.total_sessions')).toBe(true)
  })

  it('rejects additional top-level properties', () => {
    const invalid = { ...fixture, mystery: true }
    const errors = validateAgainstSchema(invalid, schema)
    expect(errors.some((e) => e.message.includes('additional'))).toBe(true)
  })
})

describe('JanuaTelemetryProvider.map()', () => {
  const provider = new JanuaTelemetryProvider('https://telemetry.madfam.io')

  it('renames snake_case top-level to camelCase', () => {
    const result = provider.map(fixture)
    expect(result).toHaveProperty('totalSessions', 1)
    expect(result).toHaveProperty('uniqueDevices', 1)
    expect(result).toHaveProperty('topSources')
    expect(result).not.toHaveProperty('total_sessions')
  })

  it('coerces null-or-missing session fields to null', () => {
    const minimal = {
      ...emptyFixture,
      sessions: [
        {
          session_id: 's2',
          fingerprint: 'fp2',
          identified: false,
          page_views: [],
          started_at: '2026-04-17T00:00:00Z',
        } as any,
      ],
      total_sessions: 1,
    }
    const result = provider.map(minimal)
    const session = result.sessions[0]
    expect(session.contactId).toBeNull()
    expect(session.ipCity).toBeNull()
  })
})
