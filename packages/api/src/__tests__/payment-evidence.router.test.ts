import { PAYMENT_EVIDENCE_SOURCES, PAYMENT_METHODS } from '@phynd/db/schema'
import type { ServiceContext } from '@phynd/services/context'
import type { AuthContext } from '@phynd/types/auth'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appRouter } from '../router'
import { PAYMENT_EVIDENCE_INPUT_ENUMS } from '../routers/payment-evidence'
import { createCallerFactory } from '../trpc'

vi.mock('@phynd/config/features', () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(false),
}))

const createCaller = createCallerFactory(appRouter)

function ctxWith(results: unknown[][], authOverrides: Partial<AuthContext> = {}) {
  const writes: unknown[] = []
  let call = 0
  const builder = (): Record<string, unknown> => {
    const qb: Record<string, unknown> = {}
    for (const m of ['from', 'where', 'limit', 'orderBy', 'for']) qb[m] = vi.fn(() => qb)
    // biome-ignore lint/suspicious/noThenProperty: awaitable query-builder stub
    qb.then = (resolve: (v: unknown) => void) =>
      Promise.resolve(results[call++] ?? []).then(resolve)
    return qb
  }
  const db = {
    select: vi.fn(() => builder()),
    insert: vi.fn(() => ({
      values: (values: unknown) => {
        writes.push(values)
        return { returning: async () => [values] }
      },
    })),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(db)),
  }
  const auth: AuthContext = {
    accessToken: 'tok',
    roles: ['admin'],
    scopes: ['*'],
    tenantId: 'madfam',
    userId: 'user-001',
    crmUserId: 'crm-user-001',
    ...authOverrides,
  }
  return {
    ctx: { auth, cache: {}, db, tenantId: 'madfam' } as unknown as ServiceContext,
    writes,
  }
}

const base = {
  engagementId: 'eng-1',
  method: 'spei_transfer' as const,
  paidAt: '2026-10-15T16:30:15Z' as unknown as Date,
  amount: '11603.56',
}

const R2_ENV = ['R2_BUCKET_NAME', 'R2_ENDPOINT_URL', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']

afterEach(() => {
  for (const key of R2_ENV) delete process.env[key]
})

describe('paymentEvidence router', () => {
  it('accepts exactly the values the database CHECK constraints allow', () => {
    expect([...PAYMENT_EVIDENCE_INPUT_ENUMS.methods]).toEqual([...PAYMENT_METHODS])
    expect([...PAYMENT_EVIDENCE_INPUT_ENUMS.sources]).toEqual([...PAYMENT_EVIDENCE_SOURCES])
  })

  it('refuses more than four account digits and bad amounts at the input boundary', async () => {
    const { ctx, writes } = ctxWith([])
    const caller = createCaller(ctx)
    for (const bad of [
      { originAccountLast4: '012345' },
      { destinationAccountLast4: '•5678' },
      { amount: '11,603.56' },
      { amount: '-1' },
      { method: 'crypto' },
    ]) {
      await expect(
        caller.paymentEvidence.create({ ...base, ...(bad as object) } as typeof base),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    }
    expect(writes).toEqual([])
  })

  it('refuses a full account number in free text (service guard) without writing', async () => {
    const { ctx, writes } = ctxWith([])
    await expect(
      createCaller(ctx).paymentEvidence.create({ ...base, notes: 'CLABE 0121 8000 1234 5678 90' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(writes).toEqual([])
  })

  it('is out of reach of a read-scoped service token', async () => {
    const service = { roles: ['service'], scopes: ['engagements:read'], userId: 'service:selva' }
    const { ctx } = ctxWith([], service)
    await expect(
      createCaller(ctx).paymentEvidence.list({ engagementId: 'eng-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      createCaller(ctx).paymentEvidence.evidenceUrl({ id: 'pe-1' }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('mints a short-lived signed URL for staff, only when storage is configured', async () => {
    const row = {
      id: 'pe-1',
      engagementId: 'eng-1',
      clientVisible: false,
      status: 'verified',
      evidenceStorageKey: `payment-evidence/${'a'.repeat(64)}.png`,
      evidenceMime: 'image/png',
    }
    const unconfigured = ctxWith([[row]])
    await expect(
      createCaller(unconfigured.ctx).paymentEvidence.evidenceUrl({ id: 'pe-1' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })

    Object.assign(process.env, {
      R2_BUCKET_NAME: 'phynd-crm-payment-evidence',
      R2_ENDPOINT_URL: 'https://example-account.r2.cloudflarestorage.com',
      R2_ACCESS_KEY_ID: 'test-access-key',
      R2_SECRET_ACCESS_KEY: 'test-secret-key',
    })
    const { ctx } = ctxWith([[row]])
    const result = await createCaller(ctx).paymentEvidence.evidenceUrl({ id: 'pe-1' })
    const url = new URL(result.url)
    expect(url.pathname).toBe(`/phynd-crm-payment-evidence/${row.evidenceStorageKey}`)
    expect(url.searchParams.get('X-Amz-Expires')).toBe('120')
    expect(result.url).not.toContain('test-secret-key')

    const noFile = ctxWith([[{ ...row, evidenceStorageKey: null }]])
    await expect(
      createCaller(noFile.ctx).paymentEvidence.evidenceUrl({ id: 'pe-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
