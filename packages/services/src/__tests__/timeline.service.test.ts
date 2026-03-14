import { describe, expect, it } from 'vitest'
import { TimelineService } from '../timeline/timeline.service'
import { createTestContext, makeNote } from './helpers'

function makeActivity(overrides: Record<string, unknown> = {}) {
  return {
    completedAt: null,
    createdAt: new Date('2025-01-15T10:00:00Z'),
    description: 'Test description',
    dueAt: null,
    entityId: 'lead-001',
    entityType: 'lead',
    id: 'act-001',
    ownerId: 'test-user',
    status: 'pending',
    title: 'Test Activity',
    type: 'call',
    updatedAt: new Date('2025-01-15T10:00:00Z'),
    ...overrides,
  }
}

function makeStageTransition(overrides: Record<string, unknown> = {}) {
  return {
    entityId: 'lead-001',
    entityType: 'lead',
    fromStageId: 'stage-001',
    id: 'trans-001',
    toStageId: 'stage-002',
    transitionedAt: new Date('2025-01-16T10:00:00Z'),
    transitionedBy: 'test-user',
    ...overrides,
  }
}

describe('TimelineService', () => {
  it('merges activities, transitions, and notes into a single timeline', async () => {
    const activity = makeActivity({
      createdAt: new Date('2025-01-15T10:00:00Z'),
    })
    const transition = makeStageTransition({
      transitionedAt: new Date('2025-01-16T10:00:00Z'),
    })
    const note = makeNote({
      entityType: 'lead',
      entityId: 'lead-001',
      createdAt: new Date('2025-01-17T10:00:00Z'),
    })

    // The mock DB returns the same result for all queries via Promise.all
    // We need to set up sequential results
    const ctx = createTestContext([activity])

    // Override the mock to return different results for each parallel query
    let callCount = 0
    ctx.mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
      callCount++
      if (callCount <= 3) {
        // First call: activities
        if (callCount === 1) return Promise.resolve([activity]).then(resolve)
        // Second call: stage transitions
        if (callCount === 2) return Promise.resolve([transition]).then(resolve)
        // Third call: notes
        if (callCount === 3) return Promise.resolve([note]).then(resolve)
      }
      return Promise.resolve([]).then(resolve)
    })

    const service = new TimelineService(ctx)
    const timeline = await service.getTimeline('lead', 'lead-001')

    expect(timeline).toHaveLength(3)
    // Should be sorted by timestamp desc (newest first)
    expect(timeline[0]?.type).toBe('note')
    expect(timeline[1]?.type).toBe('stage_move')
    expect(timeline[2]?.type).toBe('activity')
  })

  it('returns empty array when no events exist', async () => {
    const ctx = createTestContext([])

    const service = new TimelineService(ctx)
    const timeline = await service.getTimeline('lead', 'lead-001')

    expect(timeline).toEqual([])
  })

  it('maps activity fields correctly', async () => {
    const activity = makeActivity()
    const ctx = createTestContext([])

    let callCount = 0
    ctx.mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
      callCount++
      if (callCount === 1) return Promise.resolve([activity]).then(resolve)
      return Promise.resolve([]).then(resolve)
    })

    const service = new TimelineService(ctx)
    const timeline = await service.getTimeline('lead', 'lead-001')

    expect(timeline).toHaveLength(1)
    expect(timeline[0]).toMatchObject({
      id: 'act-001',
      type: 'activity',
      title: 'Test Activity',
      description: 'Test description',
      metadata: {
        activityType: 'call',
        status: 'pending',
        ownerId: 'test-user',
      },
    })
  })

  it('maps stage transition fields correctly', async () => {
    const transition = makeStageTransition()
    const ctx = createTestContext([])

    let callCount = 0
    ctx.mockDb._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
      callCount++
      if (callCount === 2) return Promise.resolve([transition]).then(resolve)
      return Promise.resolve([]).then(resolve)
    })

    const service = new TimelineService(ctx)
    const timeline = await service.getTimeline('lead', 'lead-001')

    expect(timeline).toHaveLength(1)
    expect(timeline[0]).toMatchObject({
      id: 'trans-001',
      type: 'stage_move',
      title: 'Stage changed',
      metadata: {
        fromStageId: 'stage-001',
        toStageId: 'stage-002',
        transitionedBy: 'test-user',
      },
    })
  })
})
