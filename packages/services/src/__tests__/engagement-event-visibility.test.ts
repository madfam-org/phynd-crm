import { activities, engagementEvents, notes, stageTransitions } from '@phynd/db/schema'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { EngagementsService } from '../engagements/engagements.service'
import {
  CLIENT_VISIBLE_EVENT_TYPES,
  defaultEventVisibility,
  isEngagementEventVisibility,
} from '../engagements/event-visibility'
import { NotFoundError } from '../errors'
import { createTestContext } from './helpers'

const dialect = new PgDialect()

function render(condition: unknown) {
  return dialect.sqlToQuery(condition as SQL)
}

function makeEngagement() {
  return {
    id: 'eng-001',
    contactId: 'contact-001',
    opportunityId: 'opp-001',
    projectName: 'Synthetic project',
    description: null,
    status: 'active',
    ownerId: null,
    deletedAt: null,
    createdAt: new Date('2026-10-01T10:00:00Z'),
    updatedAt: new Date('2026-10-01T10:00:00Z'),
  }
}

/** Captures every insert().values() payload instead of hitting a database. */
function captureInserts(ctx: ReturnType<typeof createTestContext>) {
  const values: Array<Record<string, unknown>> = []
  ctx.mockDb.insert = (() => ({
    values: (v: Record<string, unknown>) => {
      values.push(v)
      return { returning: async () => [{ id: 'evt-new', ...v }] }
    },
  })) as unknown as typeof ctx.mockDb.insert
  return values
}

describe('engagement event visibility allowlist', () => {
  it('makes only the listed PhyndCRM-authored event types client-visible', () => {
    expect(defaultEventVisibility('portal:deliverable_accepted')).toBe('client')
    expect(defaultEventVisibility('dhanam:payment_succeeded')).toBe('client')
    expect(defaultEventVisibility('system:quote_sent')).toBe('client')
    expect(defaultEventVisibility('system:quote_approved')).toBe('client')
    expect(defaultEventVisibility('pravara:prototype_shipped')).toBe('client')
  })

  it('keeps everything else internal, including near-miss names', () => {
    for (const eventType of [
      'system:deliverable_accepted',
      'system:payment_reconciled',
      'system:payment_unmatched',
      'system:production_dispatch_blocked',
      'dhanam:payment_failed',
      'dhanam:invoice.payment_failed',
      'pravara:shipped',
      'selva:deliverable_ready',
      'karafiel:cfdi_stamped',
      'nauta:qbr_published',
      'portal:deliverable_accepted_extra',
      'PORTAL:DELIVERABLE_ACCEPTED',
      'x:payment_succeeded',
      '',
    ]) {
      expect(defaultEventVisibility(eventType), eventType).toBe('internal')
    }
  })

  it('lists exact event types only (no wildcards)', () => {
    for (const eventType of CLIENT_VISIBLE_EVENT_TYPES) {
      expect(eventType).toMatch(/^[a-z_]+:[a-z_]+$/)
    }
  })

  it('validates visibility values', () => {
    expect(isEngagementEventVisibility('client')).toBe(true)
    expect(isEngagementEventVisibility('internal')).toBe(true)
    expect(isEngagementEventVisibility('public')).toBe(false)
    expect(isEngagementEventVisibility(undefined)).toBe(false)
  })
})

describe('EngagementsService.recordEvent visibility', () => {
  it('writes internal for a producer event type that is not allowlisted', async () => {
    const ctx = createTestContext([makeEngagement()])
    const inserted = captureInserts(ctx)
    await new EngagementsService(ctx).recordEvent({
      engagementId: 'eng-001',
      source: 'selva',
      eventType: 'selva:pr_opened',
      message: 'internal review note',
    })
    expect(inserted[0]?.visibility).toBe('internal')
  })

  it('writes client for an allowlisted event type', async () => {
    const ctx = createTestContext([makeEngagement()])
    const inserted = captureInserts(ctx)
    await new EngagementsService(ctx).recordEvent({
      engagementId: 'eng-001',
      source: 'pravara',
      eventType: 'pravara:prototype_shipped',
    })
    expect(inserted[0]?.visibility).toBe('client')
  })

  it('lets the writer override the allowlist in both directions', async () => {
    const ctx = createTestContext([makeEngagement()])
    const inserted = captureInserts(ctx)
    const service = new EngagementsService(ctx)
    await service.recordEvent({
      engagementId: 'eng-001',
      source: 'cotiza',
      eventType: 'cotiza:quote_approved',
      visibility: 'internal',
    })
    await service.recordEvent({
      engagementId: 'eng-001',
      source: 'system',
      eventType: 'system:kickoff_scheduled',
      visibility: 'client',
    })
    expect(inserted.map((v) => v.visibility)).toEqual(['internal', 'client'])
  })
})

describe('EngagementsService.getClientTimeline (portal feed)', () => {
  function setup(rows: unknown[]) {
    const ctx = createTestContext(rows)
    const fromTables: unknown[] = []
    const projections: unknown[] = []
    const whereArgs: unknown[] = []
    const qb = ctx.mockDb._qb
    ctx.mockDb.select = ((projection?: unknown) => {
      projections.push(projection)
      return qb
    }) as unknown as typeof ctx.mockDb.select
    qb.from.mockImplementation((table: unknown) => {
      fromTables.push(table)
      return qb
    })
    qb.where.mockImplementation((condition: unknown) => {
      whereArgs.push(condition)
      return qb
    })
    return { ctx, fromTables, projections, whereArgs }
  }

  it("reads engagement_events only, filtered to this engagement and visibility = 'client'", async () => {
    const { ctx, fromTables, whereArgs } = setup([])
    await new EngagementsService(ctx).getClientTimeline('eng-001', 25)

    expect(fromTables).toEqual([engagementEvents])
    const query = render(whereArgs[0])
    expect(query.sql).toContain('"engagement_events"."engagement_id" = $1')
    expect(query.sql).toContain('"engagement_events"."visibility" = $2')
    expect(query.params).toEqual(['eng-001', 'client'])
  })

  it('never touches activities, notes or stage transitions', async () => {
    const { ctx, fromTables } = setup([])
    await new EngagementsService(ctx).getClientTimeline('eng-001')
    for (const table of [activities, notes, stageTransitions]) {
      expect(fromTables).not.toContain(table)
    }
  })

  it('never returns metadata (internal ids, emails, amounts)', async () => {
    const { ctx, projections } = setup([])
    await new EngagementsService(ctx).getClientTimeline('eng-001')
    const projection = projections[0] as Record<string, unknown>
    expect(Object.keys(projection).sort()).toEqual([
      'createdAt',
      'eventType',
      'id',
      'message',
      'status',
    ])
  })
})

describe('EngagementsService.setEventVisibility', () => {
  it('scopes the update to the engagement and the event', async () => {
    const ctx = createTestContext()
    let setArg: unknown
    let whereArg: unknown
    ctx.mockDb.update = (() => ({
      set: (value: unknown) => {
        setArg = value
        return {
          where: (condition: unknown) => {
            whereArg = condition
            return { returning: async () => [{ id: 'evt-1', visibility: 'client' }] }
          },
        }
      },
    })) as unknown as typeof ctx.mockDb.update

    const row = await new EngagementsService(ctx).setEventVisibility({
      engagementId: 'eng-001',
      eventId: 'evt-1',
      visibility: 'client',
    })

    expect(row.visibility).toBe('client')
    expect(setArg).toEqual({ visibility: 'client' })
    const query = render(whereArg)
    expect(query.sql).toContain('"engagement_events"."id" = $1')
    expect(query.sql).toContain('"engagement_events"."engagement_id" = $2')
    expect(query.params).toEqual(['evt-1', 'eng-001'])
  })

  it('throws NotFoundError when the event is not on that engagement', async () => {
    const ctx = createTestContext()
    ctx.mockDb.update = (() => ({
      set: () => ({ where: () => ({ returning: async () => [] }) }),
    })) as unknown as typeof ctx.mockDb.update

    await expect(
      new EngagementsService(ctx).setEventVisibility({
        engagementId: 'eng-other',
        eventId: 'evt-1',
        visibility: 'client',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
