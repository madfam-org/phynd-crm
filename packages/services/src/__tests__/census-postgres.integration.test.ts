/**
 * The creator-census consumer end to end against a real Postgres and Redis:
 * events are XADDed to `madfam:census-events`, the consumer reads them with
 * its real stream client, and the handlers write through the real services
 * into a SECOND database (the mapped tenant), never the default one.
 *
 * Runs only when PHYND_CENSUS_IT_DATABASE_URL (a Postgres URL whose user may
 * create databases; its database is the default tenant) and
 * PHYND_CENSUS_IT_REDIS_URL are set: the E2E workflow sets both against its
 * service containers. Without them the suite is skipped, so the unit job is
 * unaffected. Setup drops and re-creates the database `phynd_crm_census_it`
 * on that server and migrates it with scripts/db-migrate.mjs (the deploy
 * migrator).
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DEFAULT_TENANT_ID } from '@phynd/config/constants'
import { type Database, getDb } from '@phynd/db'
import { pipelineStages, pipelines, users } from '@phynd/db/schema'
import type { CacheManagerLike } from '@phynd/federation'
import { sql } from 'drizzle-orm'
import Redis from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readCensusConsumerSettings } from '../census/census-config'
import {
  CENSUS_CONSUMER_GROUP,
  CENSUS_DLQ_KEY,
  CensusEventConsumer,
  type CensusStreamClient,
} from '../census/census-event-consumer'
import { CENSUS_STREAM_KEY } from '../census/census-event-schema'
import { createCensusEventHandlers } from '../census/census-handlers'
import { CENSUS_REDACTED } from '../census/census-handoff'

const IT_DATABASE_URL = process.env.PHYND_CENSUS_IT_DATABASE_URL?.trim() ?? ''
const IT_REDIS_URL = process.env.PHYND_CENSUS_IT_REDIS_URL?.trim() ?? ''
const ENABLED = IT_DATABASE_URL !== '' && IT_REDIS_URL !== ''
// The CI step sets this, so it can never pass by skipping.
if (process.env.PHYND_CENSUS_IT_REQUIRED === 'true' && !ENABLED) {
  throw new Error('PHYND_CENSUS_IT_REQUIRED is set but the database or Redis URL is missing')
}

const TENANT = 'census_it'
const TENANT_DB_NAME = 'phynd_crm_census_it'
const MAPPED_ORG = 'org_it_mapped'
const UNMAPPED_ORG = 'org_it_unmapped'
const OWNER_ID = 'census-it-owner'
// Synthetic channel ids: valid in shape, belong to nobody.
const CHANNEL = 'UCcensusITchannel0000001'
const OTHER_CHANNEL = 'UCcensusITchannel0000002'
const channelUrl = (id: string) => `https://www.youtube.com/channel/${id}`

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

/** Every table the consumer can write, for the "nothing anywhere" checks. */
const TABLES = [
  'contacts',
  'leads',
  'notes',
  'activities',
  'external_references',
  'webhook_events',
  'conversions',
] as const

const noCache: CacheManagerLike = {
  get: async () => null,
  set: async () => undefined,
  invalidate: async () => undefined,
  invalidatePattern: async () => undefined,
  getStale: async () => null,
}

const silent = { info: () => {}, warn: () => {}, error: () => {} }

let defaultDb: Database
let tenantDb: Database
let redis: Redis
let consumer: CensusEventConsumer
let eventSeq = 0

function nextEventId(): string {
  eventSeq += 1
  return `11111111-2222-4333-8444-${String(eventSeq).padStart(12, '0')}`
}

async function rows<T = Record<string, unknown>>(db: Database, query: ReturnType<typeof sql>) {
  return (await db.execute(query)) as unknown as T[]
}

async function countAll(db: Database): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const table of TABLES) {
    const [row] = await rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from ${sql.identifier(table)}`,
    )
    counts[table] = row?.n ?? 0
  }
  return counts
}

/** Rows of every consumer table whose JSON form contains `needle`. */
async function rowsContaining(db: Database, needle: string): Promise<number> {
  let total = 0
  for (const table of TABLES) {
    const [row] = await rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from ${sql.identifier(table)} t where row_to_json(t)::text like ${`%${needle}%`}`,
    )
    total += row?.n ?? 0
  }
  return total
}

/** Everything the census could have left in the default database. */
async function censusRowsIn(db: Database): Promise<number> {
  const [row] = await rows<{ n: number }>(
    db,
    sql`select
      (select count(*) from leads where source = 'creator-census')
      + (select count(*) from webhook_events where provider = 'creator-census')
      + (select count(*) from external_references where provider = 'creator-census')
      + (select count(*) from notes where author_id = 'service:creator-census')
      + (select count(*) from contacts where name like 'YouTube · %')
      as n`,
  )
  return Number(row?.n ?? 0)
}

/** Drops the IT tenant database when it exists (no NOTICE when it does not). */
async function dropTenantDatabase(): Promise<void> {
  const existing = await rows(
    defaultDb,
    sql`select 1 from pg_database where datname = ${TENANT_DB_NAME}`,
  )
  if (existing.length > 0) {
    await defaultDb.execute(sql.raw(`drop database ${TENANT_DB_NAME} with (force)`))
  }
}

async function publish(eventType: string, payload: Record<string, unknown>, eventId: string) {
  await redis.xadd(
    CENSUS_STREAM_KEY,
    '*',
    'event_type',
    eventType,
    'source',
    'creator-census',
    'correlation_id',
    eventId,
    'event_id',
    eventId,
    'schema_version',
    '1',
    'timestamp',
    new Date().toISOString(),
    'payload',
    JSON.stringify(payload),
  )
  await consumer.pollOnce(200)
}

function pickPayload(eventId: string, overrides: Record<string, unknown> = {}) {
  return {
    org_id: MAPPED_ORG,
    list_id: 'list_it_1',
    list_name: 'Lista de integración',
    platform: 'youtube',
    external_id: CHANNEL,
    channel_url: channelUrl(CHANNEL),
    stage: 'shortlisted',
    handed_off_by: 'user_it_1',
    note: `Buen canal: ${channelUrl(CHANNEL)}`,
    occurred_at: '2026-11-24T17:00:00Z',
    event_id: eventId,
    ...overrides,
  }
}

async function censusLead() {
  const [lead] = await rows<{
    id: string
    contact_id: string
    source: string
    attribution: { census?: Record<string, string> } | null
    pipeline_id: string
    stage_id: string
  }>(
    tenantDb,
    sql`select * from leads where source = 'creator-census' and external_janua_id is null`,
  )
  return lead
}

describe.skipIf(!ENABLED)('census consumer on Postgres + Redis', () => {
  let firstEventId = ''
  let tenantCountsAfterCreate: Record<string, number> = {}

  beforeAll(async () => {
    const tenantUrl = new URL(IT_DATABASE_URL)
    tenantUrl.pathname = `/${TENANT_DB_NAME}`
    // The default tenant is the IT database itself; the mapped tenant is a
    // second database on the same server.
    process.env.DATABASE_URL = IT_DATABASE_URL
    process.env[`DATABASE_URL_${TENANT.toUpperCase()}`] = tenantUrl.toString()
    process.env.PHYND_CRM_CENSUS_CONSUMER_ENABLED = 'true'
    process.env.PHYND_CRM_CENSUS_ORG_TENANTS = `${MAPPED_ORG}=${TENANT}`
    process.env.PHYND_CRM_DEFAULT_TASK_OWNER_ID = OWNER_ID

    defaultDb = getDb(DEFAULT_TENANT_ID)
    await dropTenantDatabase()
    await defaultDb.execute(sql.raw(`create database ${TENANT_DB_NAME}`))
    execFileSync(
      'node',
      [
        'scripts/db-migrate.mjs',
        '--apply',
        '--database-env',
        `DATABASE_URL_${TENANT.toUpperCase()}`,
      ],
      { cwd: REPO_ROOT, env: process.env, stdio: 'pipe' },
    )

    tenantDb = getDb(TENANT)
    await tenantDb
      .insert(users)
      .values({ id: OWNER_ID, email: 'owner@census-it.test', role: 'manager' })
    const [pipeline] = await tenantDb
      .insert(pipelines)
      .values({ name: 'Ventas', isDefault: true })
      .returning()
    await tenantDb.insert(pipelineStages).values([
      { pipelineId: pipeline?.id ?? '', name: 'Nuevo', position: 0 },
      { pipelineId: pipeline?.id ?? '', name: 'Contactado', position: 1 },
    ])

    redis = new Redis(IT_REDIS_URL)
    await redis.del(CENSUS_STREAM_KEY, CENSUS_DLQ_KEY)

    const settings = readCensusConsumerSettings(process.env, DEFAULT_TENANT_ID)
    if (!settings.enabled) throw new Error('census consumer settings not enabled')
    consumer = new CensusEventConsumer({
      client: new Redis(IT_REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: null,
      }) as unknown as CensusStreamClient,
      orgTenants: settings.orgTenants,
      handlers: createCensusEventHandlers({
        getDb,
        cache: noCache,
        logger: silent,
        defaultTenantId: DEFAULT_TENANT_ID,
      }),
      logger: silent,
      consumerName: 'census-it',
    })
    await consumer.init()
  }, 120_000)

  afterAll(async () => {
    await consumer?.stop()
    await redis?.del(CENSUS_STREAM_KEY, CENSUS_DLQ_KEY)
    await redis?.quit()
    await (tenantDb as unknown as { $client?: { end(): Promise<void> } })?.$client?.end()
    if (defaultDb) await dropTenantDatabase()
    await (defaultDb as unknown as { $client?: { end(): Promise<void> } })?.$client?.end()
  }, 60_000)

  it('starts from an empty tenant and a default database without census rows', async () => {
    expect(await censusRowsIn(defaultDb)).toBe(0)
    expect(await countAll(tenantDb)).toEqual(Object.fromEntries(TABLES.map((t) => [t, 0])))
  })

  it('a mapped hand-off creates the contact, lead, note and task in the tenant database only', async () => {
    firstEventId = nextEventId()
    await publish('census.pick.handed_off', pickPayload(firstEventId), firstEventId)
    expect(consumer.getCounters().created).toBe(1)

    const lead = await censusLead()
    expect(lead?.source).toBe('creator-census')
    expect(lead?.attribution?.census).toEqual({
      org_id: MAPPED_ORG,
      list_id: 'list_it_1',
      list_name: 'Lista de integración',
      stage: 'shortlisted',
      platform: 'youtube',
      external_id: CHANNEL,
      channel_url: channelUrl(CHANNEL),
      event_id: firstEventId,
      handed_off_at: '2026-11-24T17:00:00Z',
    })
    const [firstStage] = await rows<{ id: string }>(
      tenantDb,
      sql`select id from pipeline_stages where position = 0`,
    )
    expect(lead?.stage_id).toBe(firstStage?.id)

    const [contact] = await rows<{ id: string; name: string }>(
      tenantDb,
      sql`select id, name from contacts where id = ${lead?.contact_id ?? ''}`,
    )
    expect(contact?.name).toBe(`YouTube · ${CHANNEL}`)

    const notes = await rows<{ content: string; author_id: string; entity_type: string }>(
      tenantDb,
      sql`select content, author_id, entity_type from notes where entity_id = ${lead?.id ?? ''}`,
    )
    expect(notes).toEqual([
      {
        entity_type: 'lead',
        author_id: 'service:creator-census',
        content: `Nota de la agencia (lista «Lista de integración» del censo de creadores):\n\nBuen canal: ${channelUrl(CHANNEL)}`,
      },
    ])

    const tasks = await rows<{
      type: string
      title: string
      status: string
      owner_id: string
      due_at: Date
    }>(
      tenantDb,
      sql`select type, title, status, owner_id, due_at from activities where entity_id = ${lead?.id ?? ''}`,
    )
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      type: 'task',
      title: 'Dar seguimiento: selección del censo «Lista de integración»',
      status: 'pending',
      owner_id: OWNER_ID,
    })
    expect(tasks[0]?.due_at).toBeTruthy()

    const links = await rows<{ external_id: string; external_type: string; metadata: unknown }>(
      tenantDb,
      sql`select external_id, external_type, metadata from external_references where provider = 'creator-census'`,
    )
    expect(links).toEqual([
      {
        external_id: `youtube:${CHANNEL}`,
        external_type: 'census_pick',
        metadata: { org_id: MAPPED_ORG, list_id: 'list_it_1', contact_id: contact?.id },
      },
    ])

    const processed = await rows<{ payload: Record<string, unknown> }>(
      tenantDb,
      sql`select payload from webhook_events where provider = 'creator-census'`,
    )
    expect(processed).toHaveLength(1)
    expect(processed[0]?.payload.event_id).toBe(firstEventId)
    expect(JSON.stringify(processed)).not.toContain(CHANNEL)

    expect(await censusRowsIn(defaultDb)).toBe(0)
    expect(await rowsContaining(defaultDb, CHANNEL)).toBe(0)
    tenantCountsAfterCreate = await countAll(tenantDb)
  })

  it('a redelivery of the same event_id creates nothing new', async () => {
    await publish('census.pick.handed_off', pickPayload(firstEventId), firstEventId)
    expect(consumer.getCounters().duplicate).toBe(1)
    expect(await countAll(tenantDb)).toEqual(tenantCountsAfterCreate)
  })

  it('a second hand-off of the same channel updates the stage of the same lead', async () => {
    const eventId = nextEventId()
    await publish(
      'census.pick.handed_off',
      pickPayload(eventId, {
        stage: 'in_talks',
        note: null,
        occurred_at: '2026-11-25T17:00:00Z',
      }),
      eventId,
    )
    expect(consumer.getCounters().updated).toBe(1)

    const leads = await rows(tenantDb, sql`select id from leads where source = 'creator-census'`)
    expect(leads).toHaveLength(1)
    const lead = await censusLead()
    expect(lead?.attribution?.census).toMatchObject({
      stage: 'in_talks',
      event_id: eventId,
      handed_off_at: '2026-11-25T17:00:00Z',
    })
    const stageChanges = await rows<{ title: string; status: string; owner_id: string | null }>(
      tenantDb,
      sql`select title, status, owner_id from activities where entity_id = ${lead?.id ?? ''} and type = 'note'`,
    )
    expect(stageChanges).toEqual([
      {
        title: 'Etapa en el censo: preseleccionado → en conversación',
        status: 'completed',
        owner_id: null,
      },
    ])
    expect(await censusRowsIn(defaultDb)).toBe(0)
  })

  it('a hand-off from an unmapped organization writes nothing anywhere', async () => {
    const tenantBefore = await countAll(tenantDb)
    const defaultBefore = await countAll(defaultDb)
    const eventId = nextEventId()
    await publish(
      'census.pick.handed_off',
      pickPayload(eventId, {
        org_id: UNMAPPED_ORG,
        external_id: OTHER_CHANNEL,
        channel_url: channelUrl(OTHER_CHANNEL),
      }),
      eventId,
    )
    expect(consumer.getCounters().skipped_unmapped).toBe(1)
    expect(await countAll(tenantDb)).toEqual(tenantBefore)
    expect(await countAll(defaultDb)).toEqual(defaultBefore)
    expect(await rowsContaining(tenantDb, OTHER_CHANNEL)).toBe(0)
    expect(await rowsContaining(defaultDb, OTHER_CHANNEL)).toBe(0)
  })

  it('a malformed hand-off is dead-lettered and writes nothing', async () => {
    const tenantBefore = await countAll(tenantDb)
    const eventId = nextEventId()
    await publish('census.pick.handed_off', pickPayload(eventId, { stage: 'signed' }), eventId)
    expect(consumer.getCounters().rejected).toBe(1)
    expect(await countAll(tenantDb)).toEqual(tenantBefore)
    const dlq = await redis.xrange(CENSUS_DLQ_KEY, '-', '+')
    expect(dlq).toHaveLength(1)
    expect(JSON.stringify(dlq)).not.toContain(CHANNEL)
  })

  it('census.optout.completed scrubs the identifiers, URL and derived name and records it', async () => {
    const eventId = nextEventId()
    await publish(
      'census.optout.completed',
      { platform: 'youtube', external_id: CHANNEL, observed_at: '2026-11-26T09:00:00Z' },
      eventId,
    )
    expect(consumer.getCounters().opted_out).toBe(1)

    const lead = await censusLead()
    expect(lead?.attribution?.census).toEqual({
      org_id: MAPPED_ORG,
      list_id: 'list_it_1',
      list_name: 'Lista de integración',
      stage: 'in_talks',
      event_id: expect.any(String),
      handed_off_at: '2026-11-25T17:00:00Z',
      opted_out_at: '2026-11-26T09:00:00Z',
    })
    const [contact] = await rows<{ name: string }>(
      tenantDb,
      sql`select name from contacts where id = ${lead?.contact_id ?? ''}`,
    )
    expect(contact?.name).toBe('YouTube · canal retirado del censo')
    const [note] = await rows<{ content: string }>(
      tenantDb,
      sql`select content from notes where entity_id = ${lead?.id ?? ''} and author_id = 'service:creator-census'`,
    )
    expect(note?.content).toContain(CENSUS_REDACTED)
    const optOutActivity = await rows<{ status: string }>(
      tenantDb,
      sql`select status from activities where entity_id = ${lead?.id ?? ''} and title = 'Canal retirado del censo de creadores'`,
    )
    expect(optOutActivity).toEqual([{ status: 'completed' }])
    expect(
      await rows(
        tenantDb,
        sql`select id from external_references where provider = 'creator-census'`,
      ),
    ).toEqual([])

    // No row of any consumer table, in either database, still holds the channel id.
    expect(await rowsContaining(tenantDb, CHANNEL)).toBe(0)
    expect(await rowsContaining(defaultDb, CHANNEL)).toBe(0)
    expect(await censusRowsIn(defaultDb)).toBe(0)

    // Nothing left pending in the group.
    const pending = (await redis.xpending(CENSUS_STREAM_KEY, CENSUS_CONSUMER_GROUP)) as [number]
    expect(pending[0]).toBe(0)
  })
})
