import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockDb = { kind: 'db' }
const mockCache = { kind: 'cache' }
const mockPush = vi.fn()

vi.mock('@phynd/config/constants', () => ({
  DEFAULT_TENANT_ID: 'madfam',
}))

vi.mock('@phynd/db', () => ({
  getDb: vi.fn(() => mockDb),
}))

vi.mock('@phynd/services', () => ({
  pushBuyerSignalsToSelva: (...args: unknown[]) => mockPush(...args),
}))

vi.mock('@phynd/logging', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

vi.mock('../lib/federation', () => ({
  getCacheManager: vi.fn(() => mockCache),
}))

import { processBuyerSignalPush } from '../processors/buyer-signal-push'

describe('processBuyerSignalPush', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('pushes signals since the current high-water mark with a system context', async () => {
    mockPush.mockResolvedValueOnce({ pushed: 1, skus: 1 })

    await processBuyerSignalPush({ data: {}, id: 'job-001' } as never)

    expect(mockPush).toHaveBeenCalledTimes(1)
    const call = mockPush.mock.calls.at(0)
    const ctx = call?.[0]
    const options = call?.[1]
    expect(ctx.db).toBe(mockDb)
    expect(ctx.cache).toBe(mockCache)
    expect(ctx.tenantId).toBe('madfam')
    expect(ctx.auth.userId).toBe('system')
    expect(options.since).toBeInstanceOf(Date)
  })

  it('advances the export window only after a fully successful run', async () => {
    // Partial failure (1 of 2 SKU aggregates pushed): the high-water mark must
    // hold so the next tick retries the same window.
    mockPush.mockResolvedValueOnce({ pushed: 1, skus: 2 })
    await processBuyerSignalPush({ data: {}, id: 'job-002' } as never)
    const sinceAfterPartial = mockPush.mock.calls.at(0)?.[1].since

    mockPush.mockResolvedValueOnce({ pushed: 2, skus: 2 })
    await processBuyerSignalPush({ data: {}, id: 'job-003' } as never)
    // Same Date instance — the partial failure did not advance the mark.
    expect(mockPush.mock.calls.at(1)?.[1].since).toBe(sinceAfterPartial)

    // Full success above: the next run reads from the advanced window end.
    mockPush.mockResolvedValueOnce({ pushed: 0, skus: 0 })
    await processBuyerSignalPush({ data: {}, id: 'job-004' } as never)
    const sinceAfterSuccess = mockPush.mock.calls.at(2)?.[1].since
    expect(sinceAfterSuccess).not.toBe(sinceAfterPartial)
    expect(sinceAfterSuccess.getTime()).toBeGreaterThanOrEqual(sinceAfterPartial.getTime())
  })

  it('holds the window when the service reports a skipped (unconfigured) run', async () => {
    mockPush.mockResolvedValueOnce({ pushed: 0, skus: 0, skipped: true, reason: 'not_configured' })
    await processBuyerSignalPush({ data: {}, id: 'job-005' } as never)
    const sinceSkipped = mockPush.mock.calls.at(0)?.[1].since

    mockPush.mockResolvedValueOnce({ pushed: 0, skus: 0, skipped: true, reason: 'not_configured' })
    await processBuyerSignalPush({ data: {}, id: 'job-006' } as never)
    expect(mockPush.mock.calls.at(1)?.[1].since).toBe(sinceSkipped)
  })
})
