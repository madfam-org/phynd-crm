import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CENSUS_CONSUMER_GROUP,
  CENSUS_DLQ_KEY,
  CensusEventConsumer,
  type CensusEventHandlers,
  type CensusStreamClient,
} from '../census/census-event-consumer'
import { CENSUS_STREAM_KEY } from '../census/census-event-schema'

// ---------------------------------------------------------------------------
// A stream with one consumer group, enough of Redis Streams for the consumer:
// XREADGROUP '>' delivers new entries and makes them pending; XACK clears
// them; XAUTOCLAIM hands back pending entries idle long enough and counts a
// delivery; XPENDING reports the delivery count; XADD appends (DLQ).
// ---------------------------------------------------------------------------

class FakeStreams implements CensusStreamClient {
  entries: { id: string; fields: string[] }[] = []
  private nextIndex = 0
  pending = new Map<string, { deliveries: number; since: number }>()
  acked: string[] = []
  dlq: Record<string, string>[] = []
  groups: string[][] = []
  failDlqWrites = false
  clock = 0
  private seq = 0

  add(fields: string[]): string {
    this.seq += 1
    const id = `${this.seq}-0`
    this.entries.push({ id, fields })
    return id
  }

  async connect() {}
  async quit() {}

  async xgroup(...args: (string | number)[]) {
    this.groups.push(args.map(String))
    return 'OK'
  }

  async xreadgroup(...args: (string | number)[]) {
    expect(args.slice(0, 2)).toEqual(['GROUP', CENSUS_CONSUMER_GROUP])
    const batch = this.entries.slice(this.nextIndex)
    this.nextIndex = this.entries.length
    if (batch.length === 0) return null
    for (const entry of batch) this.pending.set(entry.id, { deliveries: 1, since: this.clock })
    return [[CENSUS_STREAM_KEY, batch.map((e) => [e.id, e.fields])]]
  }

  async xautoclaim(...args: (string | number)[]) {
    const minIdle = Number(args[3])
    const claimed: [string, string[]][] = []
    for (const [id, state] of this.pending) {
      if (this.clock - state.since < minIdle) continue
      state.deliveries += 1
      state.since = this.clock
      const entry = this.entries.find((e) => e.id === id)
      claimed.push([id, entry?.fields ?? []])
    }
    return ['0-0', claimed, []]
  }

  async xpending(...args: (string | number)[]) {
    const state = this.pending.get(String(args[2]))
    return state ? [[String(args[2]), 'me', 0, state.deliveries]] : []
  }

  async xack(...args: (string | number)[]) {
    const id = String(args[2])
    this.pending.delete(id)
    this.acked.push(id)
    return 1
  }

  async xadd(...args: (string | number)[]) {
    if (this.failDlqWrites) throw new Error('bus unavailable')
    expect(args[0]).toBe(CENSUS_DLQ_KEY)
    const record: Record<string, string> = {}
    for (let i = 2; i + 1 < args.length; i += 2) record[String(args[i])] = String(args[i + 1])
    this.dlq.push(record)
    return `${this.dlq.length}-0`
  }
}

// Synthetic values only.
const CHANNEL = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const ORG = 'org_test_mapped'
let eventSeq = 0

function eventId(): string {
  eventSeq += 1
  return `00000000-0000-4000-8000-${String(eventSeq).padStart(12, '0')}`
}

function envelope(eventType: string, payload: unknown, id = eventId()): string[] {
  return [
    'event_type',
    eventType,
    'source',
    'creator-census',
    'correlation_id',
    id,
    'event_id',
    id,
    'schema_version',
    '1',
    'timestamp',
    '2026-11-24T18:00:01Z',
    'payload',
    JSON.stringify(payload),
  ]
}

function pickEntry(overrides: Record<string, unknown> = {}): string[] {
  const id = eventId()
  return envelope(
    'census.pick.handed_off',
    {
      org_id: ORG,
      list_id: 'list_test_1',
      list_name: 'Lista de prueba',
      platform: 'youtube',
      external_id: CHANNEL,
      channel_url: `https://www.youtube.com/channel/${CHANNEL}`,
      stage: 'shortlisted',
      handed_off_by: 'user_test_1',
      occurred_at: '2026-11-24T18:00:00Z',
      event_id: id,
      ...overrides,
    },
    id,
  )
}

function optOutEntry(): string[] {
  return envelope('census.optout.completed', {
    platform: 'youtube',
    external_id: CHANNEL,
    observed_at: '2026-11-26T09:00:00Z',
  })
}

let streams: FakeStreams
let handlers: { pickHandedOff: ReturnType<typeof vi.fn>; optOutCompleted: ReturnType<typeof vi.fn> }
let logger: {
  info: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
}
let consumer: CensusEventConsumer

function makeConsumer(orgTenants = new Map([[ORG, 'agency_a']])) {
  return new CensusEventConsumer({
    client: streams,
    handlers: handlers as unknown as CensusEventHandlers,
    orgTenants,
    logger,
    consumerName: 'phynd-crm-test',
    now: () => streams.clock,
  })
}

beforeEach(async () => {
  streams = new FakeStreams()
  handlers = {
    pickHandedOff: vi.fn().mockResolvedValue('created'),
    optOutCompleted: vi.fn().mockResolvedValue(1),
  }
  logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  consumer = makeConsumer()
  await consumer.init()
})

describe('CensusEventConsumer', () => {
  it('creates the group on the census stream from the beginning', () => {
    expect(streams.groups).toEqual([
      ['CREATE', CENSUS_STREAM_KEY, CENSUS_CONSUMER_GROUP, '0', 'MKSTREAM'],
    ])
  })

  it('hands a mapped pick to its tenant and acknowledges it', async () => {
    const id = streams.add(pickEntry())
    await consumer.pollOnce(0)
    expect(handlers.pickHandedOff).toHaveBeenCalledTimes(1)
    expect(handlers.pickHandedOff).toHaveBeenCalledWith(
      'agency_a',
      expect.objectContaining({ orgId: ORG, externalId: CHANNEL, stage: 'shortlisted' }),
    )
    expect(streams.acked).toEqual([id])
    expect(consumer.getCounters().created).toBe(1)
  })

  it('acknowledges and skips a pick from an unmapped organization, writing nowhere', async () => {
    const id = streams.add(pickEntry({ org_id: 'org_test_unmapped' }))
    await consumer.pollOnce(0)
    expect(handlers.pickHandedOff).not.toHaveBeenCalled()
    expect(handlers.optOutCompleted).not.toHaveBeenCalled()
    expect(streams.acked).toEqual([id])
    expect(streams.dlq).toEqual([])
    expect(consumer.getCounters().skipped_unmapped).toBe(1)
  })

  it('dead-letters a malformed pick at once, without the payload, and writes nothing', async () => {
    const id = streams.add(pickEntry({ stage: 'signed' }))
    await consumer.pollOnce(0)
    expect(handlers.pickHandedOff).not.toHaveBeenCalled()
    expect(streams.acked).toEqual([id])
    expect(streams.dlq).toEqual([
      expect.objectContaining({
        original_id: id,
        event_type: 'census.pick.handed_off',
        error: 'pick: stage is not one of the known stages',
      }),
    ])
    expect(JSON.stringify(streams.dlq)).not.toContain(CHANNEL)
    expect(consumer.getCounters().rejected).toBe(1)
  })

  it('dead-letters an entry with a broken envelope', async () => {
    const id = streams.add(['event_type', 'census.pick.handed_off', 'payload', '{}'])
    await consumer.pollOnce(0)
    expect(streams.dlq).toEqual([expect.objectContaining({ original_id: id })])
    expect(streams.acked).toEqual([id])
  })

  it('leaves a rejected entry pending when the dead-letter write fails', async () => {
    streams.failDlqWrites = true
    const id = streams.add(pickEntry({ stage: 'signed' }))
    await consumer.pollOnce(0)
    expect(streams.acked).toEqual([])
    expect(streams.pending.has(id)).toBe(true)
  })

  it('retries a failed pick through reclaim and dead-letters it after 3 deliveries', async () => {
    handlers.pickHandedOff.mockRejectedValue(new Error('database unavailable'))
    const id = streams.add(pickEntry())

    await consumer.pollOnce(0) // delivery 1
    expect(streams.pending.get(id)?.deliveries).toBe(1)
    expect(streams.acked).toEqual([])

    streams.clock += 61_000
    await consumer.pollOnce(0) // reclaimed: delivery 2
    expect(streams.pending.get(id)?.deliveries).toBe(2)
    expect(streams.dlq).toEqual([])

    streams.clock += 61_000
    await consumer.pollOnce(0) // reclaimed: delivery 3 → dead letter
    expect(handlers.pickHandedOff).toHaveBeenCalledTimes(3)
    expect(streams.dlq).toEqual([
      expect.objectContaining({ original_id: id, error: 'processing_failed' }),
    ])
    expect(streams.acked).toEqual([id])
    expect(consumer.getCounters()).toMatchObject({ retry_pending: 2, dead_lettered: 1 })
  })

  it('succeeds on a retry after a transient failure', async () => {
    handlers.pickHandedOff.mockRejectedValueOnce(new Error('timeout'))
    const id = streams.add(pickEntry())
    await consumer.pollOnce(0)
    streams.clock += 61_000
    await consumer.pollOnce(0)
    expect(streams.acked).toEqual([id])
    expect(streams.dlq).toEqual([])
    expect(consumer.getCounters().created).toBe(1)
  })

  it('applies an opt-out to every mapped tenant once', async () => {
    consumer = makeConsumer(
      new Map([
        [ORG, 'agency_a'],
        ['org_test_second', 'agency_b'],
        ['org_test_third', 'agency_a'],
      ]),
    )
    await consumer.init()
    const id = streams.add(optOutEntry())
    await consumer.pollOnce(0)
    expect(handlers.optOutCompleted.mock.calls.map(([tenant]) => tenant)).toEqual([
      'agency_a',
      'agency_b',
    ])
    expect(handlers.optOutCompleted).toHaveBeenCalledWith(
      'agency_a',
      expect.objectContaining({ platform: 'youtube', externalId: CHANNEL }),
    )
    expect(streams.acked).toEqual([id])
    expect(consumer.getCounters().opted_out).toBe(1)
  })

  it('acknowledges other census events without handling them', async () => {
    const id = streams.add(
      envelope('census.channel.qualified', {
        platform: 'youtube',
        external_id: CHANNEL,
        threshold: 10000,
        band: '10k_100k',
        observed_at: '2026-11-24T18:00:00Z',
      }),
    )
    await consumer.pollOnce(0)
    expect(handlers.pickHandedOff).not.toHaveBeenCalled()
    expect(streams.acked).toEqual([id])
    expect(consumer.getCounters().ignored).toBe(1)
  })

  it('never logs organization or channel ids', async () => {
    streams.add(pickEntry())
    streams.add(pickEntry({ org_id: 'org_test_unmapped' }))
    streams.add(pickEntry({ stage: 'signed' }))
    streams.add(optOutEntry())
    await consumer.pollOnce(0)
    const logged = JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls])
    expect(logged).not.toContain(ORG)
    expect(logged).not.toContain('org_test_unmapped')
    expect(logged).not.toContain(CHANNEL)
  })
})
