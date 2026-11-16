/**
 * Shared pieces of the MCP tests: requests, synthetic fixture rows for two
 * tenants, and a strict JSON-Schema check. Synthetic values only.
 */
import type { FakeRow, FakeTables } from './fake-tenant-db'

export const MCP_URL = 'https://crm.example.test/mcp'
export const MCP_SCOPE = 'phynd-crm-pipeline:read'

export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

export const OWNER_A = uuid(901)
export const OWNER_B = uuid(902)

export function mcpRequest(
  body: unknown,
  options: {
    bearer?: string
    method?: string
    headers?: Record<string, string>
    url?: string
    raw?: string
  } = {},
): Request {
  const method = options.method ?? 'POST'
  const headers = new Headers({ 'content-type': 'application/json', ...options.headers })
  if (options.bearer) headers.set('authorization', `Bearer ${options.bearer}`)
  return new Request(options.url ?? MCP_URL, {
    method,
    headers,
    ...(method === 'POST' ? { body: options.raw ?? JSON.stringify(body) } : {}),
  })
}

export function rpc(method: string, params?: unknown, id: string | number = 1) {
  return { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }
}

export function toolCall(name: string, args: Record<string, unknown> = {}) {
  return rpc('tools/call', { name, arguments: args })
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const T0 = '2026-11-01T12:00:00.000Z'

function contact(n: number, fields: Record<string, string | number | boolean | null>): FakeRow {
  return {
    id: uuid(n),
    name: `Contacto ${String(n)}`,
    email: `contacto${String(n)}@example.test`,
    phone: '+52 55 0000 0000',
    company: 'Empresa Ejemplo',
    preferred_name: null,
    spanish_formality: null,
    status: 'active',
    lifecycle_stage: 'lead',
    owner_id: OWNER_A,
    external_janua_id: `janua-sub-${String(n)}`,
    coforma_cab_membership_id: null,
    coforma_cab_id: null,
    marketing_consent: true,
    consented_at: T0,
    deleted_at: null,
    created_at: T0,
    updated_at: T0,
    ...fields,
  }
}

function lead(n: number, fields: Record<string, string | number | boolean | null>): FakeRow {
  return {
    id: uuid(n),
    contact_id: uuid(1),
    external_janua_id: `janua-lead-${String(n)}`,
    source: 'web',
    status: 'new',
    score: 40,
    unsubscribed: true,
    unsubscribed_at: T0,
    pipeline_id: 'pipeline_default_sales',
    stage_id: 'stage_default_new',
    owner_id: OWNER_A,
    deleted_at: null,
    created_at: T0,
    updated_at: T0,
    ...fields,
  }
}

function deal(n: number, fields: Record<string, string | number | boolean | null>): FakeRow {
  return {
    id: uuid(n),
    name: `Trato ${String(n)}`,
    contact_id: uuid(1),
    pipeline_id: 'pipeline_default_sales',
    stage_id: 'stage_default_proposal',
    value: '15000.00',
    probability: 50,
    status: 'open',
    expected_close_date: '2026-12-15T00:00:00.000Z',
    owner_id: OWNER_A,
    deleted_at: null,
    created_at: T0,
    updated_at: T0,
    ...fields,
  }
}

function activity(n: number, fields: Record<string, string | number | boolean | null>): FakeRow {
  return {
    id: uuid(n),
    type: 'task',
    title: `Tarea ${String(n)}`,
    description: 'Llamar para dar seguimiento',
    status: 'pending',
    due_at: '2026-11-20T15:00:00.000Z',
    completed_at: null,
    entity_type: 'contact',
    entity_id: uuid(1),
    owner_id: OWNER_A,
    created_at: T0,
    updated_at: T0,
    ...fields,
  }
}

function conversion(n: number, contactN: number, type: string, convertedAt: string): FakeRow {
  return { id: uuid(n), contact_id: uuid(contactN), type, converted_at: convertedAt }
}

export const DELETED_CONTACT_ID = uuid(3)
export const DELETED_LEAD_ID = uuid(14)
export const DELETED_DEAL_ID = uuid(24)
export const DELETED_QUOTE_ID = uuid(61)
export const DELETED_ORDER_ID = uuid(62)
export const DELETED_MARK = 'BORRADO-NO-DEBE-SALIR'
export const OTHER_TENANT_MARK = 'OTRO-INQUILINO-NO-DEBE-SALIR'
export const CONSENT_MARK = 'janua-sub-'

/** The tenant the deployment's machine clients are bound to. */
export const TENANT_A_TABLES: FakeTables = {
  contacts: [
    contact(1, {
      name: 'Ana Ejemplo',
      email: 'ana@example.test',
      company: 'Taller Ejemplo',
      lifecycle_stage: 'customer',
    }),
    contact(2, {
      name: 'Beto Muestra',
      email: 'beto@muestra.test',
      owner_id: OWNER_B,
      lifecycle_stage: 'customer',
    }),
    contact(3, {
      name: `Ana ${DELETED_MARK}`,
      email: 'borrada@example.test',
      deleted_at: '2026-11-05T00:00:00.000Z',
    }),
    contact(4, { name: '100% Literal', email: 'literal@example.test' }),
  ],
  leads: [
    lead(11, { status: 'new', source: 'web' }),
    lead(12, { status: 'qualified', source: 'tezca', owner_id: OWNER_B }),
    lead(13, { status: 'new', source: 'tezca', contact_id: uuid(2) }),
    lead(14, { status: 'new', source: DELETED_MARK, deleted_at: '2026-11-05T00:00:00.000Z' }),
  ],
  opportunities: [
    deal(21, { stage_id: 'stage_default_proposal' }),
    deal(22, { stage_id: 'stage_default_negotiation', owner_id: OWNER_B }),
    deal(23, { stage_id: 'stage_default_proposal', status: 'won' }),
    deal(24, {
      name: `Trato ${DELETED_MARK}`,
      stage_id: 'stage_default_proposal',
      deleted_at: '2026-11-05T00:00:00.000Z',
    }),
  ],
  activities: [
    activity(31, { created_at: '2026-11-02T10:00:00.000Z' }),
    activity(32, {
      type: 'call',
      owner_id: OWNER_B,
      due_at: '2026-11-25T15:00:00.000Z',
      created_at: '2026-11-03T10:00:00.000Z',
    }),
    activity(33, { status: 'completed', completed_at: T0, created_at: '2026-11-04T10:00:00.000Z' }),
    activity(34, { status: 'cancelled', created_at: '2026-11-04T11:00:00.000Z' }),
    activity(35, { due_at: null, created_at: '2026-11-04T12:00:00.000Z' }),
    // Attached to the deleted contact: reachable only through that contact.
    activity(36, {
      title: `Tarea ${DELETED_MARK}`,
      status: 'completed',
      entity_id: DELETED_CONTACT_ID,
      created_at: '2026-11-04T13:00:00.000Z',
    }),
    // Never completed, so `pending` forever (the column default): not tasks.
    activity(37, { type: 'note', entity_id: uuid(2) }),
    activity(38, { type: 'fabrication_update', entity_id: uuid(2) }),
    // An open task of another owner, due later.
    activity(39, { owner_id: OWNER_B, due_at: '2026-11-25T15:00:00.000Z', entity_id: uuid(2) }),
    // Open tasks of soft-deleted records: never listed as open tasks.
    activity(40, { title: `Tarea ${DELETED_MARK}`, entity_id: DELETED_CONTACT_ID }),
    activity(41, { title: `Tarea ${DELETED_MARK}`, entity_type: 'lead', entity_id: uuid(14) }),
    activity(42, {
      title: `Tarea ${DELETED_MARK}`,
      entity_type: 'opportunity',
      entity_id: uuid(24),
    }),
    // An open task of a live lead.
    activity(43, { entity_type: 'lead', entity_id: uuid(11) }),
    activity(44, { title: `Tarea ${DELETED_MARK}`, entity_type: 'quote', entity_id: uuid(61) }),
    activity(45, { title: `Tarea ${DELETED_MARK}`, entity_type: 'order', entity_id: uuid(62) }),
  ],
  // Billing outcomes the Dhanam webhook recorded: contact 1 paid; contact 2
  // paid, then a later payment failed; contact 4 has a non-payment conversion.
  conversions: [
    conversion(71, 1, 'dhanam_payment_succeeded', '2026-11-02T00:00:00.000Z'),
    conversion(72, 2, 'dhanam_checkout_completed', '2026-11-02T00:00:00.000Z'),
    conversion(73, 2, 'dhanam_invoice_payment_failed', '2026-11-03T00:00:00.000Z'),
    conversion(74, 4, 'visitor_to_lead', '2026-11-03T00:00:00.000Z'),
  ],
  quotes: [{ id: uuid(61), deleted_at: '2026-11-05T00:00:00.000Z' }],
  orders: [{ id: uuid(62), deleted_at: '2026-11-05T00:00:00.000Z' }],
  pipelines: [
    { id: 'pipeline_default_sales', name: 'Default Sales Pipeline', is_default: true },
    { id: 'pipeline_delivery', name: 'Project Delivery', is_default: false },
  ],
  pipeline_stages: [
    {
      id: 'stage_default_proposal',
      pipeline_id: 'pipeline_default_sales',
      name: 'Proposal',
      position: 2,
      probability: 50,
    },
    {
      id: 'stage_default_new',
      pipeline_id: 'pipeline_default_sales',
      name: 'New',
      position: 1,
      probability: 10,
    },
    {
      id: 'stage_delivery_scoping',
      pipeline_id: 'pipeline_delivery',
      name: 'Scoping',
      position: 1,
      probability: null,
    },
  ],
}

/** Another tenant's database: nothing in it may ever leave through the MCP. */
export const TENANT_B_TABLES: FakeTables = {
  contacts: [
    contact(1, { name: `Ana ${OTHER_TENANT_MARK}` }),
    contact(50, { name: OTHER_TENANT_MARK }),
  ],
  leads: [lead(51, { source: OTHER_TENANT_MARK })],
  opportunities: [deal(52, { name: OTHER_TENANT_MARK })],
  activities: [activity(53, { title: OTHER_TENANT_MARK })],
  pipelines: [{ id: 'pipeline_other', name: OTHER_TENANT_MARK, is_default: true }],
  pipeline_stages: [],
}

/** `count` contacts with ascending ids, for paging. */
export function manyContacts(count: number): FakeRow[] {
  return Array.from({ length: count }, (_unused, index) => contact(1000 + index, {}))
}

/**
 * `count` open tasks for paging, created in groups of three that share one
 * instant, so page boundaries fall inside a tie on `created_at`.
 */
export function manyOpenTasks(count: number): FakeRow[] {
  return Array.from({ length: count }, (_unused, index) =>
    activity(2000 + index, {
      created_at: new Date(Date.UTC(2026, 10, 1, 0, Math.floor(index / 3))).toISOString(),
    }),
  )
}

// ── A strict JSON-Schema check (the subset the tool schemas use) ─────────────

interface Schema {
  type?: string | readonly string[]
  properties?: Readonly<Record<string, Schema>>
  required?: readonly string[]
  items?: Schema
  additionalProperties?: boolean
  enum?: readonly string[]
}

function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number' && Number.isInteger(value)) return 'integer'
  return typeof value
}

function objectViolations(record: Record<string, unknown>, schema: Schema, path: string): string[] {
  const properties = schema.properties ?? {}
  const problems = (schema.required ?? [])
    .filter((name) => !(name in record))
    .map((name) => `${path}.${name}: missing`)
  for (const [name, inner] of Object.entries(record)) {
    const declared = properties[name]
    if (declared) problems.push(...schemaViolations(inner, declared, `${path}.${name}`))
    else if (schema.additionalProperties === false) problems.push(`${path}.${name}: undeclared`)
  }
  return problems
}

/** Every way `value` breaks `schema`; an undeclared property is a violation. */
export function schemaViolations(value: unknown, schema: Schema, path = '$'): string[] {
  const types = schema.type === undefined ? [] : [schema.type].flat()
  const actual = typeOf(value)
  const accepted = types.includes(actual) || (actual === 'integer' && types.includes('number'))
  if (types.length > 0 && !accepted) {
    return [`${path}: expected ${types.join('|')}, got ${actual}`]
  }
  const problems: string[] = []
  if (schema.enum && !schema.enum.includes(value as string)) problems.push(`${path}: not in enum`)
  const items = schema.items
  if (Array.isArray(value) && items) {
    value.forEach((item, index) => {
      problems.push(...schemaViolations(item, items, `${path}[${String(index)}]`))
    })
  }
  if (actual === 'object') {
    problems.push(...objectViolations(value as Record<string, unknown>, schema, path))
  }
  return problems
}

/** Parsed JSON-RPC bodies in the tests: read loosely, asserted exactly. */
// biome-ignore lint/suspicious/noExplicitAny: parsed JSON whose shape each test asserts
export type Loose = Record<string, any>
