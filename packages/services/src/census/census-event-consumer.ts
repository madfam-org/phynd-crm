/**
 * Redis Streams consumer for `madfam:census-events` (creator census).
 *
 * Follows the ecosystem bus convention of `events/billing-event-consumer.ts`
 * and the census's consumer contract (creator-census docs/EVENTS.md):
 *   - consumer group `phynd-crm-consumers`, created from `0` with MKSTREAM;
 *   - `XREADGROUP` and `XACK` after processing;
 *   - stalled entries reclaimed with `XAUTOCLAIM`, at start and then
 *     periodically (an entry whose processing failed stays pending and comes
 *     back this way, so a transient failure is retried while running, not
 *     only after a restart);
 *   - after 3 deliveries that failed, the entry goes to
 *     `madfam:census-events-dlq` and is acknowledged;
 *   - an entry that is invalid (envelope or payload) is poison: it goes to the
 *     dead-letter stream at once, without retries, and nothing of it is
 *     written. The dead letter holds the stream id, event type, event id and
 *     the reason, never the payload, so no channel id outlives an opt-out
 *     there;
 *   - deduplication on `event_id` is the handlers' job (they record each
 *     applied event in the tenant's database).
 *
 * Routing: `census.pick.handed_off` goes to the tenant the allowlist maps the
 * event's organization to; an unmapped organization is acknowledged and
 * counted as skipped, and nothing is written anywhere. `census.optout.completed`
 * goes to every mapped tenant. Other census event types are acknowledged and
 * counted as ignored.
 *
 * One log line per entry with its outcome; logs carry event ids, stream ids
 * and tenant ids, never organization or channel ids.
 */

import { hostname } from 'node:os'
import {
  CENSUS_OPTOUT_COMPLETED,
  CENSUS_PICK_HANDED_OFF,
  CENSUS_STREAM_KEY,
  type CensusOptOut,
  type CensusPickHandoff,
  parseCensusEnvelope,
  parseCensusOptOut,
  parseCensusPickHandoff,
} from './census-event-schema'
import type { CensusPickOutcome } from './census-handoff'

export const CENSUS_CONSUMER_GROUP = 'phynd-crm-consumers'
export const CENSUS_DLQ_KEY = `${CENSUS_STREAM_KEY}-dlq`
export const CENSUS_MAX_DELIVERIES = 3

const BLOCK_MS = 5000
const READ_COUNT = 10
/** An entry pending longer than this is reclaimed (and so retried). */
const STALE_MS = 60_000
const RECLAIM_INTERVAL_MS = 30_000
const RECLAIM_COUNT = 50

/** The few stream commands the consumer uses; an ioredis client fits. */
export interface CensusStreamClient {
  connect(): Promise<unknown>
  quit(): Promise<unknown>
  xgroup(...args: (string | number)[]): Promise<unknown>
  xreadgroup(...args: (string | number)[]): Promise<unknown>
  xautoclaim(...args: (string | number)[]): Promise<unknown>
  xpending(...args: (string | number)[]): Promise<unknown>
  xack(...args: (string | number)[]): Promise<unknown>
  xadd(...args: (string | number)[]): Promise<unknown>
}

export interface CensusConsumerLogger {
  info(fields: Record<string, unknown>, message: string): void
  warn(fields: Record<string, unknown>, message: string): void
  error(fields: Record<string, unknown>, message: string): void
}

export interface CensusEventHandlers {
  pickHandedOff(tenantId: string, event: CensusPickHandoff): Promise<CensusPickOutcome>
  /** Purges the channel in one tenant; returns the number of picks purged there. */
  optOutCompleted(tenantId: string, event: CensusOptOut): Promise<number>
}

export type CensusEntryOutcome =
  | CensusPickOutcome
  | 'opted_out'
  | 'skipped_unmapped'
  | 'ignored'
  | 'rejected'
  | 'retry_pending'
  | 'dead_lettered'

export interface CensusEventConsumerOptions {
  client: CensusStreamClient
  handlers: CensusEventHandlers
  /** Janua organization id → CRM tenant id (the explicit allowlist). */
  orgTenants: ReadonlyMap<string, string>
  logger: CensusConsumerLogger
  consumerName?: string
  now?: () => number
}

type StreamEntry = [id: string, fields: string[] | null]

export class CensusEventConsumer {
  private readonly client: CensusStreamClient
  private readonly handlers: CensusEventHandlers
  private readonly orgTenants: ReadonlyMap<string, string>
  private readonly tenants: string[]
  private readonly logger: CensusConsumerLogger
  private readonly consumerName: string
  private readonly now: () => number
  private running = false
  private lastReclaimAt = Number.NEGATIVE_INFINITY
  private readonly counters: Record<CensusEntryOutcome, number> = {
    created: 0,
    updated: 0,
    duplicate: 0,
    opted_out: 0,
    skipped_unmapped: 0,
    ignored: 0,
    rejected: 0,
    retry_pending: 0,
    dead_lettered: 0,
  }

  constructor(options: CensusEventConsumerOptions) {
    this.client = options.client
    this.handlers = options.handlers
    this.orgTenants = options.orgTenants
    this.tenants = [...new Set(options.orgTenants.values())]
    this.logger = options.logger
    this.consumerName = options.consumerName ?? `phynd-crm-${hostname()}-${process.pid}`
    this.now = options.now ?? Date.now
  }

  /** Outcome counts since start. */
  getCounters(): Readonly<Record<CensusEntryOutcome, number>> {
    return { ...this.counters }
  }

  /** Connects and creates the group (an existing group is fine). */
  async init(): Promise<void> {
    await this.client.connect()
    try {
      await this.client.xgroup('CREATE', CENSUS_STREAM_KEY, CENSUS_CONSUMER_GROUP, '0', 'MKSTREAM')
    } catch (err: unknown) {
      if (!(err instanceof Error && err.message.includes('BUSYGROUP'))) throw err
    }
  }

  /** Runs until {@link stop}. */
  async start(): Promise<void> {
    await this.init()
    this.running = true
    this.logger.info(
      {
        group: CENSUS_CONSUMER_GROUP,
        consumer: this.consumerName,
        mappedOrganizations: this.orgTenants.size,
        tenants: this.tenants,
      },
      'census event consumer started',
    )
    if (this.orgTenants.size === 0) {
      this.logger.warn({}, 'census consumer has no mapped organization: every hand-off is skipped')
    }
    while (this.running) {
      try {
        await this.pollOnce()
      } catch (err) {
        if (!this.running) break
        this.logger.error({ err }, 'census event read failed')
        await sleep(1000)
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false
    await this.client.quit()
    this.logger.info({ counters: this.getCounters() }, 'census event consumer stopped')
  }

  /** One step: reclaim stalled entries when due, then read new ones. */
  async pollOnce(blockMs = BLOCK_MS): Promise<void> {
    if (this.now() - this.lastReclaimAt >= RECLAIM_INTERVAL_MS) {
      this.lastReclaimAt = this.now()
      await this.reclaimStale()
    }
    const results = (await this.client.xreadgroup(
      'GROUP',
      CENSUS_CONSUMER_GROUP,
      this.consumerName,
      'COUNT',
      String(READ_COUNT),
      'BLOCK',
      String(blockMs),
      'STREAMS',
      CENSUS_STREAM_KEY,
      '>',
    )) as Array<[string, StreamEntry[]]> | null
    if (!results) return
    for (const [, entries] of results) {
      for (const [id, fields] of entries) await this.handleEntry(id, fields ?? [])
    }
  }

  /** Claims entries idle longer than {@link STALE_MS} and processes them again. */
  async reclaimStale(): Promise<void> {
    let cursor = '0-0'
    for (let pass = 0; pass < 10; pass++) {
      const result = (await this.client.xautoclaim(
        CENSUS_STREAM_KEY,
        CENSUS_CONSUMER_GROUP,
        this.consumerName,
        String(STALE_MS),
        cursor,
        'COUNT',
        String(RECLAIM_COUNT),
      )) as [string, StreamEntry[], ...unknown[]] | null
      if (!result) return
      const [next, entries] = result
      for (const [id, fields] of entries ?? []) {
        // A claimed entry deleted from the stream (an opt-out XDELs earlier
        // events) has no fields: nothing to process, only to acknowledge.
        if (!fields) {
          await this.ack(id)
          continue
        }
        await this.handleEntry(id, fields)
      }
      if (!next || next === '0-0') return
      cursor = next
    }
  }

  /**
   * Processes one entry and records its outcome. Handler errors never escape;
   * it throws only when Redis itself fails (an XACK), and the entry then stays
   * pending and comes back, where its event id makes it a duplicate.
   */
  async handleEntry(streamId: string, fields: readonly string[]): Promise<CensusEntryOutcome> {
    const envelope = parseCensusEnvelope(streamId, fields)
    if (!envelope.ok) {
      return this.reject(streamId, undefined, undefined, envelope.reason)
    }
    const { eventType, eventId } = envelope.value

    if (eventType === CENSUS_PICK_HANDED_OFF) {
      const pick = parseCensusPickHandoff(envelope.value)
      if (!pick.ok) return this.reject(streamId, eventType, eventId, pick.reason)
      const tenantId = this.orgTenants.get(pick.value.orgId)
      if (!tenantId) {
        // The organization has no CRM workspace mapped: written nowhere.
        await this.ack(streamId)
        return this.record('skipped_unmapped', { streamId, eventType, eventId })
      }
      return this.process(streamId, eventType, eventId, tenantId, () =>
        this.handlers.pickHandedOff(tenantId, pick.value),
      )
    }

    if (eventType === CENSUS_OPTOUT_COMPLETED) {
      const optOut = parseCensusOptOut(envelope.value)
      if (!optOut.ok) return this.reject(streamId, eventType, eventId, optOut.reason)
      return this.process(streamId, eventType, eventId, undefined, async () => {
        let purged = 0
        for (const tenantId of this.tenants) {
          purged += await this.handlers.optOutCompleted(tenantId, optOut.value)
        }
        this.logger.info(
          { eventId, tenants: this.tenants.length, purged },
          'census opt-out applied',
        )
        return 'opted_out' as const
      })
    }

    await this.ack(streamId)
    return this.record('ignored', { streamId, eventType, eventId })
  }

  private async process(
    streamId: string,
    eventType: string,
    eventId: string,
    tenantId: string | undefined,
    work: () => Promise<CensusEntryOutcome>,
  ): Promise<CensusEntryOutcome> {
    let outcome: CensusEntryOutcome
    try {
      outcome = await work()
    } catch (err) {
      return this.failed(streamId, eventType, eventId, tenantId, err)
    }
    await this.ack(streamId)
    return this.record(outcome, { streamId, eventType, eventId, tenantId })
  }

  /** A processing failure: retried until the delivery count reaches the limit. */
  private async failed(
    streamId: string,
    eventType: string,
    eventId: string,
    tenantId: string | undefined,
    err: unknown,
  ): Promise<CensusEntryOutcome> {
    const deliveries = await this.deliveryCount(streamId)
    this.logger.error(
      { err, streamId, eventType, eventId, tenantId, deliveries },
      'census event processing failed',
    )
    if (deliveries >= CENSUS_MAX_DELIVERIES) {
      const moved = await this.deadLetter(streamId, eventType, eventId, 'processing_failed')
      if (moved) return this.record('dead_lettered', { streamId, eventType, eventId, tenantId })
    }
    // Left pending: the next reclaim pass delivers it again.
    return this.record('retry_pending', { streamId, eventType, eventId, tenantId })
  }

  private async reject(
    streamId: string,
    eventType: string | undefined,
    eventId: string | undefined,
    reason: string,
  ): Promise<CensusEntryOutcome> {
    this.logger.warn({ streamId, eventType, eventId, reason }, 'census event rejected')
    const moved = await this.deadLetter(streamId, eventType, eventId, reason)
    return this.record(moved ? 'rejected' : 'retry_pending', { streamId, eventType, eventId })
  }

  /** XADD to the dead-letter stream, then XACK. False when the XADD failed. */
  private async deadLetter(
    streamId: string,
    eventType: string | undefined,
    eventId: string | undefined,
    reason: string,
  ): Promise<boolean> {
    try {
      await this.client.xadd(
        CENSUS_DLQ_KEY,
        '*',
        'original_id',
        streamId,
        'event_type',
        eventType ?? '',
        'event_id',
        eventId ?? '',
        'error',
        reason,
        'failed_at',
        new Date(this.now()).toISOString(),
        'consumer_group',
        CENSUS_CONSUMER_GROUP,
      )
    } catch (err) {
      // Not acknowledged: it stays pending and is tried again.
      this.logger.error({ err, streamId, eventId }, 'census dead-letter write failed')
      return false
    }
    await this.ack(streamId)
    return true
  }

  private async deliveryCount(streamId: string): Promise<number> {
    try {
      const pending = (await this.client.xpending(
        CENSUS_STREAM_KEY,
        CENSUS_CONSUMER_GROUP,
        streamId,
        streamId,
        '1',
      )) as Array<[string, string, number, number]> | null
      return Number(pending?.[0]?.[3] ?? 0)
    } catch {
      return 0
    }
  }

  private async ack(streamId: string): Promise<void> {
    await this.client.xack(CENSUS_STREAM_KEY, CENSUS_CONSUMER_GROUP, streamId)
  }

  private record(
    outcome: CensusEntryOutcome,
    fields: { streamId: string; eventType?: string; eventId?: string; tenantId?: string },
  ): CensusEntryOutcome {
    this.counters[outcome] += 1
    this.logger.info({ ...fields, outcome, total: this.counters[outcome] }, 'census event')
    return outcome
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
