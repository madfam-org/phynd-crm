import { describe, expect, it } from 'vitest'
import { SuppressionService } from '../consent/suppression.service'
import { ValidationError } from '../errors'
import { type MockDatabase, createTestContext } from './helpers'

function sequenceResults(db: MockDatabase, results: unknown[]) {
  let call = 0
  db._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
    const result = call < results.length ? results[call] : []
    call += 1
    return Promise.resolve(result).then(resolve)
  })
}

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sup-001',
    identifier: 'persona@example.mx',
    channel: 'all',
    reason: 'complaint',
    source: 'resend_webhook',
    evidence: null,
    metadata: {},
    createdAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  }
}

describe('SuppressionService.add', () => {
  it('normalizes the identifier and inserts a new entry', async () => {
    const ctx = createTestContext()
    sequenceResults(ctx.mockDb, [[], [makeEntry()]])

    const service = new SuppressionService(ctx)
    const result = await service.add({
      identifier: ' Persona@Example.MX ',
      reason: 'complaint',
      source: 'resend_webhook',
    })

    expect(result.created).toBe(true)
    expect(ctx.mockDb.insert).toHaveBeenCalledTimes(1)
    const values = ctx.mockDb._qb.values.mock.calls[0]?.[0]
    expect(values.identifier).toBe('persona@example.mx')
    expect(values.channel).toBe('all')
  })

  it('is idempotent — existing entry returned without insert', async () => {
    const ctx = createTestContext()
    sequenceResults(ctx.mockDb, [[makeEntry()]])

    const service = new SuppressionService(ctx)
    const result = await service.add({
      identifier: 'persona@example.mx',
      reason: 'complaint',
      source: 'resend_webhook',
    })

    expect(result.created).toBe(false)
    expect(ctx.mockDb.insert).not.toHaveBeenCalled()
  })

  it('rejects an empty identifier', async () => {
    const ctx = createTestContext()
    const service = new SuppressionService(ctx)
    await expect(
      service.add({ identifier: '  ', reason: 'manual', source: 'phynd_crm' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('rejects an invalid channel', async () => {
    const ctx = createTestContext()
    const service = new SuppressionService(ctx)
    await expect(
      service.add({
        identifier: 'persona@example.mx',
        // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
        channel: 'fax' as any,
        reason: 'manual',
        source: 'phynd_crm',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('SuppressionService.check', () => {
  it("reports suppressed when a channel-scoped or 'all' entry matches", async () => {
    const ctx = createTestContext([makeEntry({ channel: 'all' })])
    const service = new SuppressionService(ctx)
    const result = await service.check('persona@example.mx', 'email')
    expect(result.suppressed).toBe(true)
    expect(result.entries).toHaveLength(1)
  })

  it('reports not suppressed when no entries match', async () => {
    const ctx = createTestContext([])
    const service = new SuppressionService(ctx)
    const result = await service.check('clean@example.mx', 'email')
    expect(result.suppressed).toBe(false)
    expect(result.entries).toHaveLength(0)
  })

  it('returns not suppressed for an empty identifier without querying', async () => {
    const ctx = createTestContext()
    const service = new SuppressionService(ctx)
    const result = await service.check('', 'email')
    expect(result.suppressed).toBe(false)
    expect(ctx.mockDb.select).not.toHaveBeenCalled()
  })
})

describe('SuppressionService.list', () => {
  it('paginates with cursor semantics', async () => {
    const rows = [makeEntry({ id: 'sup-001' }), makeEntry({ id: 'sup-002' })]
    const ctx = createTestContext(rows)
    const service = new SuppressionService(ctx)
    const result = await service.list({ limit: 1 })
    expect(result.items).toHaveLength(1)
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBe('sup-001')
  })
})
