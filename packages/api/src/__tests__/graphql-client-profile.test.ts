import type { ServiceContext } from '@phynd/services'
import { createYoga } from 'graphql-yoga'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { schema } from '../graphql/schema'

const findFirst = vi.fn(async () => ({ id: 'u1', email: 'staff@example.com', name: 'Staff' }))

/** Runs a query through Yoga, as /api/graphql does, with a fixed auth principal. */
async function query(source: string, userId: string) {
  const yoga = createYoga({
    schema,
    // Only the fields clientProfile reads; the rest of ServiceContext is unused here.
    context: () =>
      ({
        db: { query: { users: { findFirst } } },
        cache: {},
        auth: { userId, tenantId: 'madfam', roles: [], scopes: [], accessToken: '' },
        tenantId: 'madfam',
      }) as unknown as ServiceContext,
  })
  const response = await yoga.fetch('http://localhost/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: source }),
  })
  return (await response.json()) as {
    data?: { clientProfile: unknown } | null
    errors?: Array<{ message: string; extensions?: { code?: string } }>
  }
}

beforeEach(() => {
  findFirst.mockClear()
})

describe('GraphQL clientProfile', () => {
  it('refuses a request without an authenticated principal and reads nothing', async () => {
    const result = await query('{ clientProfile(id: "u1") { id email } }', '')

    expect(result.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED')
    expect(result.data?.clientProfile ?? null).toBeNull()
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('returns the CRM base profile to an authenticated principal', async () => {
    const result = await query('{ clientProfile(id: "u1") { id email name } }', 'janua-subject-1')

    expect(result.errors).toBeUndefined()
    expect(result.data?.clientProfile).toEqual({
      id: 'u1',
      email: 'staff@example.com',
      name: 'Staff',
    })
  })
})
