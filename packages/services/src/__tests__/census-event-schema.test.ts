import { describe, expect, it } from 'vitest'
import {
  type CensusEnvelope,
  parseCensusEnvelope,
  parseCensusOptOut,
  parseCensusPickHandoff,
} from '../census/census-event-schema'

// Synthetic values only: no real organization, list or channel.
const EVENT_ID = '7d0b1c9e-3f4a-4b5c-8d6e-0f1a2b3c4d5e'
const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'

function pickPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    org_id: 'org_test_agency',
    list_id: 'list_test_1',
    list_name: 'Lista de prueba',
    platform: 'youtube',
    external_id: CHANNEL_ID,
    channel_url: `https://www.youtube.com/channel/${CHANNEL_ID}`,
    stage: 'shortlisted',
    handed_off_by: 'user_test_1',
    note: 'Texto de la agencia',
    occurred_at: '2026-11-24T18:00:00Z',
    event_id: EVENT_ID,
    ...overrides,
  }
}

function fields(map: Record<string, string>): string[] {
  return Object.entries(map).flat()
}

function envelopeFields(
  payload: unknown,
  overrides: Record<string, string> = {},
  eventType = 'census.pick.handed_off',
): string[] {
  return fields({
    event_type: eventType,
    source: 'creator-census',
    correlation_id: EVENT_ID,
    event_id: EVENT_ID,
    schema_version: '1',
    timestamp: '2026-11-24T18:00:01Z',
    payload: JSON.stringify(payload),
    ...overrides,
  })
}

function envelope(payload: Record<string, unknown>): CensusEnvelope {
  const parsed = parseCensusEnvelope('1-0', envelopeFields(payload))
  if (!parsed.ok) throw new Error(parsed.reason)
  return parsed.value
}

describe('parseCensusEnvelope', () => {
  it('reads a registered envelope', () => {
    const parsed = parseCensusEnvelope('5-0', envelopeFields(pickPayload()))
    expect(parsed).toMatchObject({
      ok: true,
      value: { streamId: '5-0', eventType: 'census.pick.handed_off', eventId: EVENT_ID },
    })
  })

  it.each([
    ['a missing event type', { event_type: '' }],
    ['another source', { source: 'someone-else' }],
    ['an unknown schema version', { schema_version: '2' }],
    ['an event id that is not a UUID', { event_id: 'not-a-uuid' }],
    ['a payload that is not JSON', { payload: '{nope' }],
    ['a payload that is not an object', { payload: '[1,2]' }],
  ])('refuses %s', (_label, overrides) => {
    expect(parseCensusEnvelope('1-0', envelopeFields(pickPayload(), overrides)).ok).toBe(false)
  })
})

describe('parseCensusPickHandoff', () => {
  it('accepts a complete pick', () => {
    const parsed = parseCensusPickHandoff(envelope(pickPayload()))
    expect(parsed).toEqual({
      ok: true,
      value: {
        eventId: EVENT_ID,
        orgId: 'org_test_agency',
        listId: 'list_test_1',
        listName: 'Lista de prueba',
        platform: 'youtube',
        externalId: CHANNEL_ID,
        channelUrl: `https://www.youtube.com/channel/${CHANNEL_ID}`,
        stage: 'shortlisted',
        handedOffBy: 'user_test_1',
        note: 'Texto de la agencia',
        occurredAt: '2026-11-24T18:00:00Z',
      },
    })
  })

  it('accepts a pick without a note, and treats null or blank as no note', () => {
    const { note: _note, ...withoutNote } = pickPayload()
    for (const payload of [withoutNote, pickPayload({ note: null }), pickPayload({ note: '  ' })]) {
      const parsed = parseCensusPickHandoff(envelope(payload))
      expect(parsed.ok && parsed.value.note).toBeNull()
    }
  })

  it('accepts youtube.com without www and a trailing slash', () => {
    const parsed = parseCensusPickHandoff(
      envelope(pickPayload({ channel_url: `https://youtube.com/channel/${CHANNEL_ID}/` })),
    )
    expect(parsed.ok).toBe(true)
  })

  it('accepts every stage', () => {
    for (const stage of ['shortlisted', 'approached', 'in_talks', 'allied', 'passed']) {
      expect(parseCensusPickHandoff(envelope(pickPayload({ stage }))).ok).toBe(true)
    }
  })

  it.each([
    ['an unknown payload key (platform data such as a title)', { title: 'Un canal' }],
    ['a missing org id', { org_id: undefined }],
    ['an org id with spaces', { org_id: 'org id' }],
    ['a missing list id', { list_id: undefined }],
    ['an empty list name', { list_name: '  ' }],
    ['a list name over 120 characters', { list_name: 'x'.repeat(121) }],
    ['a list name on two lines', { list_name: 'uno\ndos' }],
    ['another platform', { platform: 'twitch' }],
    ['a channel id that is not one', { external_id: 'UCshort' }],
    ['a handle instead of a channel id', { external_id: '@canal' }],
    ['a URL on another host', { channel_url: `https://evil.example/channel/${CHANNEL_ID}` }],
    ['a look-alike host', { channel_url: `https://www.youtube.com.example/channel/${CHANNEL_ID}` }],
    ['a plain-http URL', { channel_url: `http://www.youtube.com/channel/${CHANNEL_ID}` }],
    ['a handle URL', { channel_url: 'https://www.youtube.com/@canal' }],
    [
      'a URL for another channel',
      { channel_url: 'https://www.youtube.com/channel/UCbbbbbbbbbbbbbbbbbbbbbb' },
    ],
    ['a URL with a query', { channel_url: `https://www.youtube.com/channel/${CHANNEL_ID}?x=1` }],
    [
      'a URL with credentials',
      { channel_url: `https://u:p@www.youtube.com/channel/${CHANNEL_ID}` },
    ],
    ['an unknown stage', { stage: 'signed' }],
    ['a missing handed_off_by', { handed_off_by: undefined }],
    ['a note over 2000 characters', { note: 'x'.repeat(2001) }],
    ['a note that is not a string', { note: 42 }],
    ['an occurred_at that is not a date-time', { occurred_at: '2026-11-24' }],
    ['an occurred_at without a zone', { occurred_at: '2026-11-24T18:00:00' }],
    ['a payload event id that differs from the envelope', { event_id: crypto.randomUUID() }],
  ])('refuses %s', (_label, overrides) => {
    const payload = pickPayload(overrides)
    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined) delete payload[key]
    }
    expect(parseCensusPickHandoff(envelope(payload)).ok).toBe(false)
  })

  it('accepts a note of exactly 2000 characters and a list name of 120', () => {
    const parsed = parseCensusPickHandoff(
      envelope(pickPayload({ note: 'n'.repeat(2000), list_name: 'l'.repeat(120) })),
    )
    expect(parsed.ok).toBe(true)
  })
})

describe('parseCensusOptOut', () => {
  function optOutEnvelope(payload: Record<string, unknown>): CensusEnvelope {
    const parsed = parseCensusEnvelope(
      '2-0',
      envelopeFields(payload, {}, 'census.optout.completed'),
    )
    if (!parsed.ok) throw new Error(parsed.reason)
    return parsed.value
  }

  it('reads the registered payload, with the envelope event id', () => {
    expect(
      parseCensusOptOut(
        optOutEnvelope({
          platform: 'youtube',
          external_id: CHANNEL_ID,
          observed_at: '2026-11-25T10:00:00Z',
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        eventId: EVENT_ID,
        platform: 'youtube',
        externalId: CHANNEL_ID,
        observedAt: '2026-11-25T10:00:00Z',
      },
    })
  })

  it('accepts a Bluesky opt-out (it matches no pick)', () => {
    const parsed = parseCensusOptOut(
      optOutEnvelope({
        platform: 'bluesky',
        external_id: 'did:plc:testtesttest',
        observed_at: '2026-11-25T10:00:00Z',
      }),
    )
    expect(parsed.ok).toBe(true)
  })

  it.each([
    ['an unknown key', { extra: 1 }],
    ['another platform', { platform: 'twitch' }],
    ['a YouTube id that is not a channel id', { external_id: 'abc' }],
    ['a missing observed_at', { observed_at: undefined }],
  ])('refuses %s', (_label, overrides) => {
    const payload: Record<string, unknown> = {
      platform: 'youtube',
      external_id: CHANNEL_ID,
      observed_at: '2026-11-25T10:00:00Z',
      ...overrides,
    }
    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined) delete payload[key]
    }
    expect(parseCensusOptOut(optOutEnvelope(payload)).ok).toBe(false)
  })
})
