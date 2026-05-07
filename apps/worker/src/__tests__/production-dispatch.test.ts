import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockDb = { kind: 'db' }
const mockDispatchPending = vi.fn()
const mockDispatchReference = vi.fn()

vi.mock('@phyne/db', () => ({
  getDb: vi.fn(() => mockDb),
}))

vi.mock('@phyne/services', () => ({
  dispatchPendingProductionDispatches: (...args: unknown[]) => mockDispatchPending(...args),
  dispatchProductionDispatchReference: (...args: unknown[]) => mockDispatchReference(...args),
}))

vi.mock('@phyne/logging', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

import { processProductionDispatch } from '../processors/production-dispatch'

describe('processProductionDispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.PRODUCTION_DISPATCH_SCAN_LIMIT
  })

  it('runs a pending production dispatch scan', async () => {
    mockDispatchPending.mockResolvedValueOnce({ failed: 0, scanned: 1, sent: 1, skipped: 0 })

    await processProductionDispatch({ data: {}, id: 'job-001' } as never)

    expect(mockDispatchPending).toHaveBeenCalledWith(mockDb, { limit: 25 })
    expect(mockDispatchReference).not.toHaveBeenCalled()
  })

  it('honors scan limit from job data', async () => {
    mockDispatchPending.mockResolvedValueOnce({ failed: 0, scanned: 5, sent: 5, skipped: 0 })

    await processProductionDispatch({ data: { limit: 5 }, id: 'job-002' } as never)

    expect(mockDispatchPending).toHaveBeenCalledWith(mockDb, { limit: 5 })
  })

  it('processes an explicit reference id', async () => {
    mockDispatchReference.mockResolvedValueOnce({
      provider: 'pravara',
      referenceId: 'ref-001',
      status: 'sent',
    })

    await processProductionDispatch({
      data: { referenceId: 'ref-001' },
      id: 'job-003',
    } as never)

    expect(mockDispatchReference).toHaveBeenCalledWith(mockDb, 'ref-001')
    expect(mockDispatchPending).not.toHaveBeenCalled()
  })
})
