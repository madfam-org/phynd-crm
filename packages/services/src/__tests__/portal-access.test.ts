import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EngagementContactsService } from '../engagement-items/engagement-contacts.service'
import { EngagementPortalMagicLinkService } from '../engagement-portal/magic-link.service'
import { resolvePortalAccess } from '../engagement-portal/portal-access'
import { NotFoundError, ServiceError, ValidationError } from '../errors'
import { createMockQueryBuilder, createTestContext } from './helpers'

const dialect = new PgDialect()

const PRIMARY = {
  id: 'eng-1',
  contactId: 'contact-primary',
  opportunityId: null,
  projectName: 'Proyecto sintético',
  status: 'active',
  company: 'Acme Ejemplo S.A.',
  contactEmail: 'Persona@Example.invalid',
  contactName: 'Persona Ejemplo',
  preferredName: 'Per',
  spanishFormality: 'tu',
  contactDeletedAt: null,
}
const SECONDARY = {
  contactId: 'contact-billing',
  contactEmail: 'facturacion@example.invalid',
  contactName: 'Facturación Ejemplo',
  preferredName: null,
  spanishFormality: null,
}

/** select() resolves to the given results in order and records each where(). */
function sequence(ctx: ReturnType<typeof createTestContext>, results: unknown[][]) {
  const wheres: unknown[] = []
  let call = 0
  ctx.mockDb.select = (() => {
    const qb = createMockQueryBuilder(results[call++] ?? [])
    qb.where.mockImplementation((w: unknown) => {
      wheres.push(w)
      return qb
    })
    return qb
  }) as unknown as typeof ctx.mockDb.select
  return wheres
}

describe('resolvePortalAccess', () => {
  it('grants the primary contact, case- and space-insensitively, in their register', async () => {
    const ctx = createTestContext()
    sequence(ctx, [[PRIMARY]])
    const access = await resolvePortalAccess(ctx.db, 'eng-1', '  persona@example.INVALID ')
    expect(access.status).toBe('granted')
    if (access.status !== 'granted') return
    expect(access.viewer).toEqual({
      contactId: 'contact-primary',
      name: 'Persona Ejemplo',
      preferredName: 'Per',
      spanishFormality: 'tu',
      isPrimary: true,
    })
  })

  it('grants a portal-enabled engagement contact and only looks at portal_access = true', async () => {
    const ctx = createTestContext()
    const wheres = sequence(ctx, [[PRIMARY], [SECONDARY]])
    const access = await resolvePortalAccess(ctx.db, 'eng-1', 'facturacion@example.invalid')
    expect(access.status).toBe('granted')
    if (access.status === 'granted') expect(access.viewer.isPrimary).toBe(false)

    const query = dialect.sqlToQuery(wheres[1] as SQL)
    expect(query.sql).toContain('"engagement_contacts"."engagement_id" = $1')
    expect(query.sql).toContain('"engagement_contacts"."portal_access" = $2')
    expect(query.sql).toContain('"contacts"."deleted_at" is null')
    expect(query.params).toEqual(['eng-1', true])
  })

  it('denies anyone else, and a deleted primary contact', async () => {
    const ctx = createTestContext()
    sequence(ctx, [[PRIMARY], [SECONDARY]])
    expect((await resolvePortalAccess(ctx.db, 'eng-1', 'otra@example.invalid')).status).toBe(
      'denied',
    )

    const deleted = createTestContext()
    sequence(deleted, [[{ ...PRIMARY, contactDeletedAt: new Date() }], []])
    expect((await resolvePortalAccess(deleted.db, 'eng-1', 'persona@example.invalid')).status).toBe(
      'denied',
    )

    const empty = createTestContext()
    sequence(empty, [[PRIMARY]])
    expect((await resolvePortalAccess(empty.db, 'eng-1', '   ')).status).toBe('denied')
  })

  it('reports a missing or deleted engagement as not_found', async () => {
    const ctx = createTestContext()
    sequence(ctx, [[]])
    expect((await resolvePortalAccess(ctx.db, 'nope', 'persona@example.invalid')).status).toBe(
      'not_found',
    )
  })
})

describe('magic link with several portal contacts', () => {
  const originalEnv = { ...process.env }
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    process.env.JANUA_API_URL = 'https://janua.example.invalid'
    process.env.PORTAL_BASE_URL = 'https://portal.example.invalid'
    fetchSpy = vi.spyOn(global, 'fetch') as unknown as ReturnType<typeof vi.spyOn>
  })
  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  function janua(email: string) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        user: { id: 'janua-2', email, email_verified: true },
        tokens: {
          access_token: 'a'.repeat(20),
          refresh_token: 'r'.repeat(20),
          expires_in: 900,
          token_type: 'bearer',
        },
      }),
    } as unknown as Response
  }

  it('verifies a portal-enabled secondary contact', async () => {
    const ctx = createTestContext()
    sequence(ctx, [[{ engagementId: 'eng-1' }], [PRIMARY], [SECONDARY]])
    fetchSpy.mockResolvedValueOnce(janua('facturacion@example.invalid'))
    const session = await new EngagementPortalMagicLinkService(ctx).verifyPortalLink({
      token: 't'.repeat(32),
      engagementId: 'eng-1',
    })
    expect(session.email).toBe('facturacion@example.invalid')
  })

  it('rejects a verified email that is not a portal contact', async () => {
    const ctx = createTestContext()
    sequence(ctx, [[{ engagementId: 'eng-1' }], [PRIMARY], []])
    fetchSpy.mockResolvedValueOnce(janua('facturacion@example.invalid'))
    await expect(
      new EngagementPortalMagicLinkService(ctx).verifyPortalLink({
        token: 't'.repeat(32),
        engagementId: 'eng-1',
      }),
    ).rejects.toSatisfy((err) => err instanceof ServiceError && err.code === 'AUTHZ_MISMATCH')
  })

  it('sends to a chosen portal contact and refuses a contact without portal access', async () => {
    const ctx = createTestContext()
    sequence(ctx, [
      [{ engagementId: 'eng-1', primaryContactId: 'contact-primary', contactEmail: 'x' }],
      [{ contactEmail: 'facturacion@example.invalid' }],
    ])
    fetchSpy.mockResolvedValueOnce({ ok: true, status: 200 } as unknown as Response)
    const result = await new EngagementPortalMagicLinkService(ctx).sendPortalLink(
      'eng-1',
      'contact-billing',
    )
    const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string)
    expect(body.email).toBe('facturacion@example.invalid')
    expect(result.emailRedacted).toBe('fa***@example.invalid')

    const denied = createTestContext()
    sequence(denied, [
      [{ engagementId: 'eng-1', primaryContactId: 'contact-primary', contactEmail: 'x' }],
      [],
    ])
    await expect(
      new EngagementPortalMagicLinkService(denied).sendPortalLink('eng-1', 'contact-other'),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('EngagementContactsService.upsert', () => {
  it('refuses portal access for a contact without email', async () => {
    const ctx = createTestContext()
    sequence(ctx, [[{ id: 'eng-1' }], [{ id: 'contact-x', email: null }]])
    await expect(
      new EngagementContactsService(ctx).upsert({
        engagementId: 'eng-1',
        contactId: 'contact-x',
        portalAccess: true,
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('rejects an unknown contact and upserts on (engagement, contact)', async () => {
    const missing = createTestContext()
    sequence(missing, [[{ id: 'eng-1' }], []])
    await expect(
      new EngagementContactsService(missing).upsert({ engagementId: 'eng-1', contactId: 'nope' }),
    ).rejects.toBeInstanceOf(NotFoundError)

    const ctx = createTestContext()
    sequence(ctx, [[{ id: 'eng-1' }], [{ id: 'contact-x', email: 'x@example.invalid' }]])
    const qb = createMockQueryBuilder([{ id: 'ec-1', portalAccess: true }])
    ctx.mockDb.insert = vi.fn(() => qb) as unknown as typeof ctx.mockDb.insert
    await new EngagementContactsService(ctx).upsert({
      engagementId: 'eng-1',
      contactId: 'contact-x',
      role: 'facturacion',
      portalAccess: true,
    })
    expect(qb.values).toHaveBeenCalledWith({
      engagementId: 'eng-1',
      contactId: 'contact-x',
      role: 'facturacion',
      portalAccess: true,
    })
    expect(qb.onConflictDoUpdate).toHaveBeenCalledTimes(1)
  })
})
