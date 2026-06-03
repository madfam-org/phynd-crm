/**
 * Redis Streams consumer for Dhanam billing events.
 *
 * Reads from `madfam:billing-events` using a consumer group (`phynd-crm-consumers`).
 * Processes billing events to update contact/lead data in PhyndCRM.
 *
 * Features:
 * - Consumer group with auto-claim for stale messages on startup
 * - Graceful shutdown with message acknowledgment
 * - DLQ after 3 failed processing attempts
 * - Blocking reads with configurable timeout
 *
 * Reference: selva-office/packages/redis-pool/src/selva_redis_pool/task_stream.py
 */

import type { ServiceEventEnvelope } from '@phynd/types'
import Redis from 'ioredis'

const STREAM_KEY = 'madfam:billing-events'
const CONSUMER_GROUP = 'phynd-crm-consumers'
const CONSUMER_NAME = `phynd-crm-${process.pid}`
const DLQ_KEY = `${STREAM_KEY}-dlq`
const BLOCK_MS = 5000
const MAX_RETRIES = 3
const STALE_MS = 60_000 // auto-claim messages idle > 60s

type BillingEvent = ServiceEventEnvelope

type EventHandler = (event: BillingEvent) => Promise<void>
type RedisStreamBatch = Array<[stream: string, entries: Array<[id: string, fields: string[]]>]>

export class BillingEventConsumer {
  private redis: Redis
  private running = false
  private handlers = new Map<string, EventHandler>()

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null, // required for blocking reads
      lazyConnect: true,
    })
  }

  /**
   * Register a handler for a specific event type.
   */
  on(eventType: string, handler: EventHandler): this {
    this.handlers.set(eventType, handler)
    return this
  }

  /**
   * Start consuming events. Call this once on worker startup.
   */
  async start(): Promise<void> {
    await this.redis.connect()

    // Create consumer group (ignore if already exists)
    try {
      await this.redis.xgroup('CREATE', STREAM_KEY, CONSUMER_GROUP, '0', 'MKSTREAM')
    } catch (err: unknown) {
      if (!(err instanceof Error && err.message.includes('BUSYGROUP'))) {
        throw err
      }
      // Group already exists — fine
    }

    // Auto-claim stale messages from crashed consumers
    await this.reclaimStale()

    this.running = true
    console.log(
      `[BillingEventConsumer] Started (group=${CONSUMER_GROUP}, consumer=${CONSUMER_NAME})`,
    )

    // Process loop
    while (this.running) {
      try {
        await this.processNextBatch()
      } catch (err) {
        if (this.running) {
          console.error('[BillingEventConsumer] Read error:', err)
          await sleep(1000)
        }
      }
    }
  }

  /**
   * Graceful shutdown.
   */
  async stop(): Promise<void> {
    this.running = false
    await this.redis.disconnect()
    console.log('[BillingEventConsumer] Stopped')
  }

  private async processNextBatch(): Promise<void> {
    // XREADGROUP with blocking
    const results = (await this.redis.xreadgroup(
      'GROUP',
      CONSUMER_GROUP,
      CONSUMER_NAME,
      'COUNT',
      '10',
      'BLOCK',
      String(BLOCK_MS),
      'STREAMS',
      STREAM_KEY,
      '>',
    )) as RedisStreamBatch | null

    if (!results) return // timeout, no new messages

    for (const [, entries] of results) {
      for (const [id, fields] of entries) {
        const event = this.parseEntry(id, fields)
        if (!event) {
          await this.redis.xack(STREAM_KEY, CONSUMER_GROUP, id)
          continue
        }

        const handler = this.handlers.get(event.event_type)
        if (!handler) {
          // No handler registered — acknowledge and skip
          await this.redis.xack(STREAM_KEY, CONSUMER_GROUP, id)
          continue
        }

        try {
          await handler(event)
          await this.redis.xack(STREAM_KEY, CONSUMER_GROUP, id)
        } catch (err) {
          console.error(
            `[BillingEventConsumer] Failed to process ${event.event_type} (${id}):`,
            err,
          )
          // Check retry count via XPENDING or just let it be re-delivered
          // After MAX_RETRIES, move to DLQ
          await this.maybeMoveToDlq(id, event)
        }
      }
    }
  }

  private async reclaimStale(): Promise<void> {
    try {
      const result = await this.redis.xautoclaim(
        STREAM_KEY,
        CONSUMER_GROUP,
        CONSUMER_NAME,
        String(STALE_MS),
        '0-0',
        'COUNT',
        '50',
      )
      const claimed = (result as unknown[])?.[1] as string[][] | undefined
      if (claimed?.length) {
        console.log(`[BillingEventConsumer] Auto-claimed ${claimed.length} stale messages`)
      }
    } catch {
      // XAUTOCLAIM may fail if stream doesn't exist yet — that's fine
    }
  }

  private async maybeMoveToDlq(id: string, event: BillingEvent): Promise<void> {
    try {
      // Check how many times this message has been delivered
      const pending = (await this.redis.xpending(
        STREAM_KEY,
        CONSUMER_GROUP,
        id,
        id,
        '1',
      )) as unknown[][]

      const deliveryCount = pending?.[0]?.[3] ?? 0

      if (Number(deliveryCount) >= MAX_RETRIES) {
        // Move to DLQ
        await this.redis.xadd(
          DLQ_KEY,
          '*',
          'original_id',
          id,
          'event_type',
          event.event_type,
          'source',
          event.source,
          'payload',
          JSON.stringify(event.payload),
          'failed_at',
          new Date().toISOString(),
          'delivery_count',
          String(deliveryCount),
        )
        await this.redis.xack(STREAM_KEY, CONSUMER_GROUP, id)
        console.warn(`[BillingEventConsumer] Moved ${id} to DLQ after ${deliveryCount} attempts`)
      }
    } catch (err) {
      console.error('[BillingEventConsumer] DLQ move failed:', err)
    }
  }

  private parseEntry(id: string, fields: string[]): BillingEvent | null {
    try {
      const map: Record<string, string> = {}
      for (let i = 0; i < fields.length; i += 2) {
        const key = fields[i]
        if (!key) continue
        map[key] = fields[i + 1] ?? ''
      }

      return {
        id,
        event_type: map.event_type ?? '',
        source: map.source ?? '',
        correlation_id: map.correlation_id ?? '',
        timestamp: map.timestamp ?? '',
        payload: map.payload ? JSON.parse(map.payload) : {},
      }
    } catch {
      console.warn(`[BillingEventConsumer] Failed to parse entry ${id}`)
      return null
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
