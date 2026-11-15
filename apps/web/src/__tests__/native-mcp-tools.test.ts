/**
 * The native MCP's tools through the real route, the real Janua verifier and
 * the REAL services, against in-memory tenant databases that evaluate the SQL
 * the services build (`lib/mcp/__tests__/fake-tenant-db.ts`). What is pinned:
 * each tool's happy path and schema, the page cap, that a deleted row or
 * another tenant's row cannot leave, what is withheld, and the audit record.
 */
import { setFeatureFlags } from '@phynd/config/features'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { type FakeQuery, createFakeTenantDb } from '@/lib/mcp/__tests__/fake-tenant-db'
import {
  DELETED_CONTACT_ID,
  DELETED_MARK,
  type Loose,
  MCP_SCOPE,
  OTHER_TENANT_MARK,
  OWNER_A,
  OWNER_B,
  TENANT_A_TABLES,
  TENANT_B_TABLES,
  manyContacts,
  mcpRequest,
  rpc,
  schemaViolations,
  toolCall,
  uuid,
} from '@/lib/mcp/__tests__/harness'
import {
  CLIENT_ID,
  MACHINE_ENV,
  ORG_ID,
  TENANT_ID,
  createMachineTokenStub,
} from '@/lib/trpc/__tests__/machine-token-stub'

const { rateLimit, logCalls, getDb } = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  logCalls: [] as unknown[][],
  getDb: vi.fn(),
}))

vi.mock('@/lib/rate-limiter', () => ({ checkApiRateLimit: rateLimit }))
vi.mock('@phynd/db', () => ({ getDb }))
vi.mock('@/lib/federation/clients', () => ({ getCacheManager: () => ({}) }))
vi.mock('@phynd/logging', () => ({
  createLogger: () => {
    const record =
      (level: string) =>
      (...args: unknown[]) =>
        logCalls.push([level, ...args])
    return {
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
      debug: record('debug'),
    }
  },
}))

import { POST } from '@/app/mcp/route'
import { MCP_TOOLS } from '@/lib/mcp/tools'

const OTHER_TENANT = 'phynd'

let stub: Awaited<ReturnType<typeof createMachineTokenStub>>
let token: string
let queries: FakeQuery[]
let otherTenantQueries: FakeQuery[]

function useTables(tables = TENANT_A_TABLES) {
  const bound = createFakeTenantDb(tables)
  const other = createFakeTenantDb(TENANT_B_TABLES)
  queries = bound.queries
  otherTenantQueries = other.queries
  getDb.mockReset()
  getDb.mockImplementation((tenantId: string) => {
    if (tenantId === TENANT_ID) return bound.db
    if (tenantId === OTHER_TENANT) return other.db
    throw new Error(`unexpected tenant ${tenantId}`)
  })
}

interface ToolAnswer {
  status: number
  isError: boolean
  text: string
  data: Loose
  raw: string
}

async function callTool(
  name: string,
  args: Record<string, unknown> = {},
  options: Parameters<typeof mcpRequest>[1] = {},
): Promise<ToolAnswer> {
  const res = await POST(mcpRequest(toolCall(name, args), { bearer: token, ...options }))
  const raw = await res.text()
  const body = JSON.parse(raw) as { result?: Loose; error?: Loose }
  if (!body.result) throw new Error(`no result: ${raw}`)
  return {
    status: res.status,
    isError: body.result.isError === true,
    text: body.result.content[0].text as string,
    data: (body.result.structuredContent ?? {}) as Loose,
    raw,
  }
}

function outputSchemaOf(name: string) {
  const tool = MCP_TOOLS.find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`no tool ${name}`)
  return tool.outputSchema
}

function audits(): Array<Loose> {
  return logCalls
    .filter(([, fields]) => (fields as { event?: string }).event === 'mcp_call')
    .map(([, fields]) => fields as Loose)
}

beforeAll(async () => {
  stub = await createMachineTokenStub()
})

beforeEach(async () => {
  logCalls.length = 0
  rateLimit.mockReset()
  rateLimit.mockResolvedValue({ allowed: true, remaining: 1 })
  stub.installJwks()
  for (const [name, value] of Object.entries(MACHINE_ENV)) vi.stubEnv(name, value)
  vi.stubEnv('PHYND_CRM_MCP_ENABLED', 'true')
  vi.stubEnv('PHYND_CRM_MCP_READ_CLIENTS', `${CLIENT_ID}@${ORG_ID}`)
  token = await stub.mint({ claims: { scope: MCP_SCOPE } })
  useTables()
})

afterEach(() => {
  setFeatureFlags({ piiMasking: false })
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('contacts_search', () => {
  it('lists the contacts an operator sees, in the published shape', async () => {
    const answer = await callTool('contacts_search')
    expect(answer.isError).toBe(false)
    expect(answer.data.contacts.map((row: { id: string }) => row.id)).toEqual([
      uuid(1),
      uuid(2),
      uuid(4),
    ])
    expect(answer.data.contacts[0]).toEqual({
      id: uuid(1),
      name: 'Ana Ejemplo',
      email: 'ana@example.test',
      phone: '+52 55 0000 0000',
      company: 'Taller Ejemplo',
      preferred_name: null,
      status: 'active',
      owner_id: OWNER_A,
      created_at: '2026-11-01T12:00:00.000Z',
      updated_at: '2026-11-01T12:00:00.000Z',
    })
    expect(answer.data).toMatchObject({ next_cursor: null, has_more: false })
    expect(JSON.parse(answer.text)).toEqual(answer.data)
    expect(schemaViolations(answer.data, outputSchemaOf('contacts_search'))).toEqual([])
  })

  it('searches name, email and company, case-insensitively', async () => {
    const byName = await callTool('contacts_search', { query: 'ana' })
    expect(byName.data.contacts.map((row: { id: string }) => row.id)).toEqual([uuid(1)])
    const byEmail = await callTool('contacts_search', { query: 'MUESTRA.test' })
    expect(byEmail.data.contacts.map((row: { id: string }) => row.id)).toEqual([uuid(2)])
    const byCompany = await callTool('contacts_search', { query: 'taller' })
    expect(byCompany.data.contacts.map((row: { id: string }) => row.id)).toEqual([uuid(1)])
  })

  it('takes the search text literally: % and _ are not wildcards', async () => {
    const percent = await callTool('contacts_search', { query: '%' })
    expect(percent.data.contacts.map((row: { id: string }) => row.id)).toEqual([uuid(4)])
    const underscore = await callTool('contacts_search', { query: '_' })
    expect(underscore.data.contacts).toEqual([])
  })

  it('filters by owner', async () => {
    const answer = await callTool('contacts_search', { owner_id: OWNER_B })
    expect(answer.data.contacts.map((row: { id: string }) => row.id)).toEqual([uuid(2)])
  })
})

describe('contacts_get', () => {
  it('returns the contact with its recent activities, newest first', async () => {
    const answer = await callTool('contacts_get', { contact_id: uuid(1) })
    expect(answer.isError).toBe(false)
    expect(answer.data.contact).toMatchObject({ id: uuid(1), name: 'Ana Ejemplo' })
    expect(answer.data.recent_activities.map((row: { id: string }) => row.id)).toEqual([
      uuid(35),
      uuid(34),
      uuid(33),
      uuid(32),
      uuid(31),
    ])
    expect(answer.data.recent_activities[4]).toEqual({
      id: uuid(31),
      type: 'task',
      title: 'Tarea 31',
      description: 'Llamar para dar seguimiento',
      status: 'pending',
      due_at: '2026-11-20T15:00:00.000Z',
      completed_at: null,
      entity_type: 'contact',
      entity_id: uuid(1),
      owner_id: OWNER_A,
      created_at: '2026-11-02T10:00:00.000Z',
    })
    expect(schemaViolations(answer.data, outputSchemaOf('contacts_get'))).toEqual([])
  })

  it('caps the activities at activity_limit', async () => {
    const answer = await callTool('contacts_get', { contact_id: uuid(1), activity_limit: 2 })
    expect(answer.data.recent_activities.map((row: { id: string }) => row.id)).toEqual([
      uuid(35),
      uuid(34),
    ])
  })

  it('an unknown contact is not found', async () => {
    const answer = await callTool('contacts_get', { contact_id: uuid(999) })
    expect(answer.isError).toBe(true)
    expect(answer.text).toBe('not_found: no such contact')
  })

  it('needs a UUID', async () => {
    for (const args of [{}, { contact_id: 'abc' }, { contact_id: 42 }]) {
      const answer = await callTool('contacts_get', args)
      expect(answer.isError).toBe(true)
      expect(answer.text).toMatch(/^invalid_arguments: contact_id /)
    }
    expect(queries).toEqual([])
  })
})

describe('leads_list', () => {
  it('lists leads and filters by status, source and owner', async () => {
    const all = await callTool('leads_list')
    expect(all.data.leads.map((row: { id: string }) => row.id)).toEqual([
      uuid(11),
      uuid(12),
      uuid(13),
    ])
    expect(all.data.leads[0]).toEqual({
      id: uuid(11),
      contact_id: uuid(1),
      source: 'web',
      status: 'new',
      score: 40,
      pipeline_id: 'pipeline_default_sales',
      stage_id: 'stage_default_new',
      owner_id: OWNER_A,
      created_at: '2026-11-01T12:00:00.000Z',
      updated_at: '2026-11-01T12:00:00.000Z',
    })
    expect(schemaViolations(all.data, outputSchemaOf('leads_list'))).toEqual([])

    const fresh = await callTool('leads_list', { status: 'new' })
    expect(fresh.data.leads.map((row: { id: string }) => row.id)).toEqual([uuid(11), uuid(13)])
    const tezca = await callTool('leads_list', { source: 'tezca' })
    expect(tezca.data.leads.map((row: { id: string }) => row.id)).toEqual([uuid(12), uuid(13)])
    const both = await callTool('leads_list', { status: 'new', source: 'tezca' })
    expect(both.data.leads.map((row: { id: string }) => row.id)).toEqual([uuid(13)])
    const owned = await callTool('leads_list', { owner_id: OWNER_B })
    expect(owned.data.leads.map((row: { id: string }) => row.id)).toEqual([uuid(12)])
  })

  it('refuses a status outside the enumeration', async () => {
    const answer = await callTool('leads_list', { status: 'deleted' })
    expect(answer.isError).toBe(true)
    expect(queries).toEqual([])
  })
})

describe('tasks_list_open', () => {
  it('lists only pending activities', async () => {
    const answer = await callTool('tasks_list_open')
    expect(answer.data.tasks.map((row: { id: string }) => row.id)).toEqual([
      uuid(31),
      uuid(32),
      uuid(35),
    ])
    expect(schemaViolations(answer.data, outputSchemaOf('tasks_list_open'))).toEqual([])
  })

  it('filters by owner, type and due window', async () => {
    const owned = await callTool('tasks_list_open', { owner_id: OWNER_B })
    expect(owned.data.tasks.map((row: { id: string }) => row.id)).toEqual([uuid(32)])
    const calls = await callTool('tasks_list_open', { type: 'call' })
    expect(calls.data.tasks.map((row: { id: string }) => row.id)).toEqual([uuid(32)])

    const dueSoon = await callTool('tasks_list_open', { due_before: '2026-11-21T00:00:00-06:00' })
    expect(dueSoon.data.tasks.map((row: { id: string }) => row.id)).toEqual([uuid(31)])
    const dueLater = await callTool('tasks_list_open', { due_from: '2026-11-21T00:00:00-06:00' })
    expect(dueLater.data.tasks.map((row: { id: string }) => row.id)).toEqual([uuid(32)])
    const window = await callTool('tasks_list_open', {
      due_from: '2026-11-20T15:00:00Z',
      due_before: '2026-11-25T15:00:00Z',
    })
    expect(window.data.tasks.map((row: { id: string }) => row.id)).toEqual([uuid(31)])
  })

  it('refuses a date without an offset', async () => {
    const answer = await callTool('tasks_list_open', { due_before: '2026-11-21' })
    expect(answer.isError).toBe(true)
    expect(answer.text).toContain('due_before must be an ISO 8601 date-time')
  })
})

describe('deals_list', () => {
  it('lists deals and filters by stage, pipeline, status and owner', async () => {
    const all = await callTool('deals_list')
    expect(all.data.deals.map((row: { id: string }) => row.id)).toEqual([
      uuid(21),
      uuid(22),
      uuid(23),
    ])
    expect(all.data.deals[0]).toEqual({
      id: uuid(21),
      name: 'Trato 21',
      contact_id: uuid(1),
      pipeline_id: 'pipeline_default_sales',
      stage_id: 'stage_default_proposal',
      value: '15000.00',
      probability: 50,
      status: 'open',
      expected_close_date: '2026-12-15T00:00:00.000Z',
      owner_id: OWNER_A,
      created_at: '2026-11-01T12:00:00.000Z',
      updated_at: '2026-11-01T12:00:00.000Z',
    })
    expect(schemaViolations(all.data, outputSchemaOf('deals_list'))).toEqual([])

    const proposal = await callTool('deals_list', { stage_id: 'stage_default_proposal' })
    expect(proposal.data.deals.map((row: { id: string }) => row.id)).toEqual([uuid(21), uuid(23)])
    const open = await callTool('deals_list', {
      stage_id: 'stage_default_proposal',
      status: 'open',
    })
    expect(open.data.deals.map((row: { id: string }) => row.id)).toEqual([uuid(21)])
    const owned = await callTool('deals_list', { owner_id: OWNER_B })
    expect(owned.data.deals.map((row: { id: string }) => row.id)).toEqual([uuid(22)])
    const elsewhere = await callTool('deals_list', { pipeline_id: 'pipeline_delivery' })
    expect(elsewhere.data.deals).toEqual([])
  })
})

describe('pipelines_list', () => {
  it('returns each pipeline with its stages in order', async () => {
    const answer = await callTool('pipelines_list')
    expect(answer.data).toEqual({
      pipelines: [
        {
          id: 'pipeline_default_sales',
          name: 'Default Sales Pipeline',
          is_default: true,
          stages: [
            { id: 'stage_default_new', name: 'New', position: 1, probability: 10 },
            { id: 'stage_default_proposal', name: 'Proposal', position: 2, probability: 50 },
          ],
        },
        {
          id: 'pipeline_delivery',
          name: 'Project Delivery',
          is_default: false,
          stages: [
            { id: 'stage_delivery_scoping', name: 'Scoping', position: 1, probability: null },
          ],
        },
      ],
      has_more: false,
    })
    expect(schemaViolations(answer.data, outputSchemaOf('pipelines_list'))).toEqual([])
  })
})

describe('pagination (cursor, hard cap of 50)', () => {
  beforeEach(() => {
    useTables({ ...TENANT_A_TABLES, contacts: manyContacts(120) })
  })

  it('pages 25 by default and never more than 50, without repeating a row', async () => {
    const first = await callTool('contacts_search')
    expect(first.data.contacts).toHaveLength(25)
    expect(first.data.has_more).toBe(true)

    const seen = new Set<string>()
    let cursor: string | null = null
    let pages = 0
    do {
      const answer: ToolAnswer = await callTool('contacts_search', {
        limit: 50,
        ...(cursor ? { cursor } : {}),
      })
      expect(answer.data.contacts.length).toBeLessThanOrEqual(50)
      for (const row of answer.data.contacts as Array<{ id: string }>) {
        expect(seen.has(row.id)).toBe(false)
        seen.add(row.id)
      }
      cursor = answer.data.next_cursor as string | null
      pages += 1
    } while (cursor !== null && pages < 10)
    expect(pages).toBe(3)
    expect(seen.size).toBe(120)
  })

  it.each([51, 200, 100000, 0, -1, 2.5, '50'])(
    'limit %s is refused, and nothing is read',
    async (limit) => {
      const answer = await callTool('contacts_search', { limit })
      expect(answer.isError).toBe(true)
      expect(answer.text).toBe('invalid_arguments: limit must be an integer from 1 to 50')
      expect(queries).toEqual([])
    },
  )

  it('no listing tool asks the database for more than the cap plus one', async () => {
    for (const name of ['contacts_search', 'leads_list', 'tasks_list_open', 'deals_list']) {
      await callTool(name, { limit: 50 })
    }
    await callTool('contacts_get', { contact_id: uuid(1000), activity_limit: 50 })
    await callTool('pipelines_list')
    const limits = queries
      .filter((query) => /limit \$\d+$/.test(query.sql))
      .map((query) => Number(query.params.at(-1)))
    expect(limits.length).toBeGreaterThanOrEqual(6)
    expect(Math.max(...limits)).toBeLessThanOrEqual(51)
  })

  it('refuses a malformed cursor', async () => {
    const answer = await callTool('contacts_search', { cursor: "x' or 1=1 --" })
    expect(answer.isError).toBe(true)
    expect(queries).toEqual([])
  })
})

describe('deleted rows never leave', () => {
  it('no list or search returns a soft-deleted contact, lead or deal', async () => {
    const answers = [
      await callTool('contacts_search'),
      await callTool('contacts_search', { query: 'ana' }),
      await callTool('contacts_search', { query: DELETED_MARK }),
      await callTool('leads_list'),
      await callTool('leads_list', { source: DELETED_MARK }),
      await callTool('deals_list'),
      await callTool('deals_list', { stage_id: 'stage_default_proposal' }),
    ]
    for (const answer of answers) {
      expect(answer.isError).toBe(false)
      expect(answer.raw).not.toContain(DELETED_MARK)
    }
    // Every read of a soft-deletable table carried the predicate.
    for (const query of queries) {
      expect(query.sql).toContain(`"${query.table}"."deleted_at" is null`)
    }
    expect(queries.length).toBe(answers.length)
  })

  it('a deleted contact is not found, and its activities are never read', async () => {
    const answer = await callTool('contacts_get', { contact_id: DELETED_CONTACT_ID })
    expect(answer.isError).toBe(true)
    expect(answer.text).toBe('not_found: no such contact')
    expect(answer.raw).not.toContain(DELETED_MARK)
    expect(queries.map((query) => query.table)).toEqual(['contacts'])
  })

  it('no output carries a deleted_at field at all', async () => {
    for (const name of ['contacts_search', 'leads_list', 'deals_list', 'tasks_list_open']) {
      expect((await callTool(name)).raw).not.toContain('deleted_at')
    }
  })
})

describe('tenancy (the tenant is the deployment’s, never the caller’s)', () => {
  it('reads only the bound tenant’s database, whatever Host the request names', async () => {
    const hosts = ['crm.phynd.app', 'phynd.app', 'crm.madfam.io']
    for (const host of hosts) {
      const options = {
        url: `https://${host}/mcp`,
        headers: { host, 'x-forwarded-host': host, 'x-tenant-id': OTHER_TENANT },
      }
      const answers = [
        await callTool('contacts_search', {}, options),
        await callTool('contacts_get', { contact_id: uuid(1) }, options),
        await callTool('leads_list', {}, options),
        await callTool('tasks_list_open', {}, options),
        await callTool('deals_list', {}, options),
        await callTool('pipelines_list', {}, options),
      ]
      for (const answer of answers) {
        expect(answer.isError).toBe(false)
        expect(answer.raw).not.toContain(OTHER_TENANT_MARK)
      }
    }
    expect(otherTenantQueries).toEqual([])
    expect(new Set(getDb.mock.calls.map(([tenantId]) => tenantId))).toEqual(new Set([TENANT_ID]))
  })

  it('an id that exists only in another tenant is not found', async () => {
    const answer = await callTool('contacts_get', { contact_id: uuid(50) })
    expect(answer.isError).toBe(true)
    expect(otherTenantQueries).toEqual([])
  })

  it('no argument can name a tenant', async () => {
    for (const name of [
      'contacts_search',
      'leads_list',
      'tasks_list_open',
      'deals_list',
      'pipelines_list',
    ]) {
      const answer = await callTool(name, { tenant_id: OTHER_TENANT })
      expect(answer.isError).toBe(true)
      // The unknown key is counted, never echoed.
      expect(answer.text).toMatch(/^invalid_arguments: 1 unknown argument\(s\)/)
      expect(answer.text).not.toContain('tenant_id')
    }
    expect(queries).toEqual([])
  })

  it('runs as the least-privilege service principal of the calling client', async () => {
    await callTool('contacts_search')
    expect(audits().at(-1)).toMatchObject({ clientId: CLIENT_ID, tenantId: TENANT_ID })
  })
})

describe('privacy (what is withheld)', () => {
  it('never returns consent state, cross-system identifiers or tokens', async () => {
    const answers = [
      await callTool('contacts_search'),
      await callTool('contacts_get', { contact_id: uuid(1) }),
      await callTool('leads_list'),
      await callTool('tasks_list_open'),
      await callTool('deals_list'),
    ]
    for (const answer of answers) {
      for (const withheld of [
        'marketing_consent',
        'consented_at',
        'unsubscribed',
        'external_janua_id',
        'janua-sub-',
        'janua-lead-',
        'coforma',
        'spanish_formality',
        token,
      ]) {
        expect(answer.raw).not.toContain(withheld)
      }
    }
  })

  it('masks personal fields for the machine principal when piiMasking is on', async () => {
    setFeatureFlags({ piiMasking: true })
    const contact = (await callTool('contacts_get', { contact_id: uuid(1) })).data
    expect(contact.contact).toMatchObject({
      name: 'Ana ***',
      email: 'a***@example.test',
      phone: '***0000',
    })
    expect(contact.recent_activities[0].description).toBe('Llamar para …[redacted]')
    expect(schemaViolations(contact, outputSchemaOf('contacts_get'))).toEqual([])
    const deals = (await callTool('deals_list')).data
    expect(deals.deals[0].name).toBe('[redacted]')
  })
})

describe('audit (one record per call)', () => {
  it('records client, tenant, tool, outcome, row count and a summary without personal data', async () => {
    await callTool('contacts_search', { query: 'ana@example.test', owner_id: OWNER_A, limit: 10 })
    const records = audits()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      event: 'mcp_call',
      clientId: CLIENT_ID,
      tenantId: TENANT_ID,
      rpcMethod: 'tools/call',
      tool: 'contacts_search',
      outcome: 'ok',
      httpStatus: 200,
      resultCount: 1,
      args: { has_query: true, owner_id: OWNER_A, has_cursor: false, limit: 10 },
      detail: null,
    })
    expect(typeof records[0]?.latencyMs).toBe('number')
    const logged = JSON.stringify(logCalls)
    expect(logged).not.toContain('ana@example.test')
    expect(logged).not.toContain('Ana Ejemplo')
    expect(logged).not.toContain(token)
  })

  it('counts the contact and its activities, and records which contact was read', async () => {
    await callTool('contacts_get', { contact_id: uuid(1), activity_limit: 2 })
    expect(audits().at(-1)).toMatchObject({
      tool: 'contacts_get',
      outcome: 'ok',
      resultCount: 3,
      args: { contact_id: uuid(1), activity_limit: 2 },
    })
  })

  it('records refusals too, without the refused values', async () => {
    await callTool('contacts_get', { contact_id: DELETED_CONTACT_ID })
    expect(audits().at(-1)).toMatchObject({
      tool: 'contacts_get',
      outcome: 'not_found',
      resultCount: null,
    })

    await callTool('leads_list', { source: 'x'.repeat(101), status: 'new' })
    const refused = audits().at(-1)
    expect(refused).toMatchObject({ tool: 'leads_list', outcome: 'invalid_arguments', args: null })
    expect(JSON.stringify(refused)).not.toContain('xxxx')
  })

  it('a failing database is an internal error by class name only', async () => {
    getDb.mockImplementation(() => {
      throw new Error('connection to 10.0.0.5 refused: password authentication failed')
    })
    const res = await POST(mcpRequest(toolCall('leads_list'), { bearer: token }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32603, message: 'internal error' },
    })
    expect(audits().at(-1)).toMatchObject({ outcome: 'internal_error', detail: 'Error' })
    expect(JSON.stringify(logCalls)).not.toContain('10.0.0.5')
  })

  it('logs protocol calls without a tool', async () => {
    await POST(mcpRequest(rpc('tools/list'), { bearer: token }))
    expect(audits().at(-1)).toMatchObject({ rpcMethod: 'tools/list', tool: null, args: null })
  })
})
