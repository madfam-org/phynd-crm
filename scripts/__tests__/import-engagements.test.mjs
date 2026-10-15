import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  ENTITY,
  ENUMS,
  FIELDS,
  PROVIDER,
  applyPlan,
  parseArgs,
  planImport,
  runImport,
  summarize,
  validateManifest,
} from '../import-engagements.mjs'

const example = () =>
  JSON.parse(readFileSync('scripts/engagement-import/example.manifest.json', 'utf8'))
const schema = JSON.parse(readFileSync('scripts/engagement-import/manifest.schema.json', 'utf8'))
const OWNER = 'operador@example.invalid'

const snake = (s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
const toColumns = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [snake(k), v]))

/** In-memory stand-in for createPgStore(): same methods, snake_case rows. */
function memoryStore({ users = [{ id: 'user-0001-owner', email: OWNER, role: 'admin' }] } = {}) {
  const db = {
    users,
    contacts: [],
    opportunities: [],
    engagements: [],
    quotes: [],
    engagement_artifacts: [],
    engagement_events: [],
    external_references: [],
    pipelines: [{ id: 'pipe-1', name: 'Project Delivery' }],
    pipeline_stages: [{ id: 'stage-1', pipeline_id: 'pipe-1', name: 'Development' }],
  }
  const columns = { engagement_events: ['visibility'] }
  const writes = []
  const defaults = {
    contacts: { deleted_at: null, owner_id: null },
    opportunities: { deleted_at: null, owner_id: null },
    engagements: { deleted_at: null, owner_id: null },
    quotes: { deleted_at: null, owner_id: null },
  }
  return {
    db,
    writes,
    columns,
    lock: async () => {},
    findUsersByEmail: async (email) =>
      db.users.filter((u) => u.email.toLowerCase() === email.trim().toLowerCase()),
    hasColumn: async (t, c) => (columns[t] ?? []).includes(c),
    findRefs: async (keys) => {
      const map = new Map()
      const ids = new Set(keys.map((k) => k.externalId))
      for (const r of db.external_references) {
        if (r.provider === PROVIDER && ids.has(r.external_id))
          map.set(`${r.entity_type}:${r.external_id}`, r)
      }
      return map
    },
    findRefsByEntity: async (type, id) =>
      db.external_references.filter(
        (r) => r.provider === PROVIDER && r.entity_type === type && r.entity_id === id,
      ),
    getRow: async (t, id) => db[t].find((r) => r.id === id) ?? null,
    findContactsByEmail: async (email) =>
      db.contacts.filter((c) => c.email?.toLowerCase() === email && !c.deleted_at),
    findPipelineStage: async (p, s) => {
      const rows = db.pipeline_stages.filter(
        (st) =>
          st.name === s && db.pipelines.some((pl) => pl.id === st.pipeline_id && pl.name === p),
      )
      if (rows.length === 0) return null
      if (rows.length > 1) return { ambiguous: true }
      return { pipelineId: rows[0].pipeline_id, stageId: rows[0].id }
    },
    insert: async (t, row) => {
      writes.push(['insert', t])
      db[t].push({ ...(defaults[t] ?? {}), ...toColumns(row) })
    },
    update: async (t, id, patch) => {
      writes.push(['update', t])
      Object.assign(
        db[t].find((r) => r.id === id),
        toColumns(patch),
      )
    },
    insertRef: async (ref) => {
      writes.push(['insert', 'external_references'])
      db.external_references.push(toColumns(ref))
    },
    updateRef: async (id, patch) => {
      writes.push(['update', 'external_references'])
      Object.assign(
        db.external_references.find((r) => r.id === id),
        toColumns(patch),
      )
    },
  }
}

async function run(store, manifest) {
  const plan = await planImport(store, manifest, { ownerEmail: OWNER })
  if (plan.blockers.length === 0) await applyPlan(store, plan)
  return summarize(plan, { mode: 'apply' })
}

test('the synthetic example manifest is valid', () => {
  assert.deepEqual(validateManifest(example()), [])
})

test('the JSON Schema and the script agree on fields and enums', () => {
  const defs = {
    client: 'client',
    contact: 'contact',
    opportunity: 'opportunity',
    engagement: 'engagement',
    quote: 'quote',
    lineItem: 'lineItem',
    artifact: 'artifact',
    event: 'event',
  }
  for (const [kind, def] of Object.entries(defs)) {
    const s = schema.$defs[def]
    assert.equal(s.additionalProperties, false, def)
    assert.deepEqual([...s.required].sort(), [...FIELDS[kind].required].sort(), `${def} required`)
    assert.deepEqual(
      Object.keys(s.properties).sort(),
      [...FIELDS[kind].required, ...FIELDS[kind].optional].sort(),
      `${def} properties`,
    )
  }
  assert.deepEqual(schema.$defs.opportunity.properties.status.enum, ENUMS.opportunityStatus)
  assert.deepEqual(schema.$defs.engagement.properties.status.enum, ENUMS.engagementStatus)
  assert.deepEqual(schema.$defs.quote.properties.status.enum, ENUMS.quoteStatus)
  assert.deepEqual(schema.$defs.event.properties.status.enum, ENUMS.eventStatus)
  assert.deepEqual(schema.$defs.event.properties.visibility.enum, ENUMS.visibility)
})

test('validation rejects typos, bad amounts, missing visibility, duplicates and http URLs', () => {
  const m = example()
  const eng = m.clients[0].engagements[0]
  eng.projectName = 'typo'
  eng.quotes[0].total_amount = '11,600'
  eng.events[0].visibility = undefined
  eng.artifacts[1].key = eng.artifacts[0].key
  eng.artifacts[0].url = 'http://example.invalid/x'
  m.clients[0].contacts[1].email = 'PERSONA@example.invalid'
  const errors = validateManifest(m).join('\n')
  assert.match(errors, /engagements\[0\]\.projectName: unknown property/)
  assert.match(errors, /quotes\[0\]\.total_amount: invalid format/)
  assert.match(errors, /events\[0\]\.visibility: required/)
  assert.match(errors, /artifacts\[1\]\.key: duplicate artifact key/)
  assert.match(errors, /artifacts\[0\]\.url: invalid format/)
  assert.match(errors, /contacts\[1\]\.email: same email as/)
})

test('first run creates everything with the owner; second run is all unchanged', async () => {
  const store = memoryStore()
  const first = await run(store, example())
  assert.deepEqual(first.blockers, [])
  assert.deepEqual(first.counts, { create: 9, link: 0, update: 0, unchanged: 0, recreate: 0 })
  for (const t of ['contacts', 'opportunities', 'engagements', 'quotes']) {
    assert.ok(
      store.db[t].every((r) => r.owner_id === 'user-0001-owner'),
      `${t} owner`,
    )
  }
  assert.equal(store.db.external_references.length, 9)
  assert.ok(store.db.external_references.every((r) => r.provider === 'madfam-ops'))
  const quoteRef = store.db.external_references.find((r) => r.entity_type === ENTITY.quote)
  assert.equal(quoteRef.metadata.line_items.length, 2)
  assert.equal(quoteRef.metadata.line_items[0].amount, '8000.00')
  const [quote] = store.db.quotes
  assert.equal(quote.currency, 'MXN')
  assert.equal(quote.total_amount, '11600.00')

  store.writes.length = 0
  const second = await run(store, example())
  assert.deepEqual(second.counts, { create: 0, link: 0, update: 0, unchanged: 9, recreate: 0 })
  assert.deepEqual(store.writes, [])
})

test('re-runs update changed fields and never duplicate artifacts or events', async () => {
  const store = memoryStore()
  await run(store, example())
  const changed = example()
  const eng = changed.clients[0].engagements[0]
  eng.events[0].message = 'Arrancamos el proyecto (actualizado).'
  eng.artifacts[0].title = 'Propuesta firmada v2 (ejemplo)'
  eng.quotes[0].line_items[1].quantity = 2
  eng.artifacts.push({
    key: 'acme-ejemplo/artefacto-entregable-2',
    type: 'deliverable',
    title: 'Entregable 2 (ejemplo)',
  })
  const report = await run(store, changed)
  const byKey = Object.fromEntries(report.records.map((r) => [r.key, r]))
  assert.equal(byKey['acme-ejemplo/evento-arranque'].action, 'update')
  assert.deepEqual(byKey['acme-ejemplo/evento-arranque'].changed, ['message'])
  assert.deepEqual(byKey['acme-ejemplo/artefacto-propuesta'].changed, ['title'])
  assert.deepEqual(byKey['acme-ejemplo/cotizacion-ciclo-1'].changed, ['reference.metadata'])
  assert.equal(byKey['acme-ejemplo/artefacto-entregable-2'].action, 'create')
  assert.equal(store.db.engagement_artifacts.length, 3)
  assert.equal(store.db.engagement_events.length, 2)
  assert.equal(store.db.external_references.length, 10)

  const again = await run(store, changed)
  assert.equal(again.counts.unchanged, 10)
})

test('events keep their explicit visibility and occurred_at', async () => {
  const store = memoryStore()
  await run(store, example())
  const byKey = Object.fromEntries(
    store.db.engagement_events.map((e) => [e.metadata.import_key, e]),
  )
  assert.equal(byKey['acme-ejemplo/evento-arranque'].visibility, 'client')
  assert.equal(byKey['acme-ejemplo/evento-nota-interna'].visibility, 'internal')
  assert.equal(
    byKey['acme-ejemplo/evento-arranque'].created_at.toISOString(),
    '2026-08-20T16:00:00.000Z',
  )
  assert.equal(
    byKey['acme-ejemplo/evento-arranque'].dedup_key,
    'madfam-ops:acme-ejemplo/evento-arranque',
  )
})

test('blocks without engagement_events.visibility (the portal would show every event)', async () => {
  const store = memoryStore()
  store.columns.engagement_events = []
  const plan = await planImport(store, example(), { ownerEmail: OWNER })
  assert.ok(plan.blockers.some((b) => b.reason === 'visibility_column_missing'))
  await assert.rejects(applyPlan(store, plan), /blockers/)
  assert.deepEqual(store.writes, [])
})

test('blocks on a missing or ambiguous owner', async () => {
  const none = await planImport(memoryStore({ users: [] }), example(), { ownerEmail: OWNER })
  assert.deepEqual(
    none.blockers.map((b) => b.reason),
    ['owner_not_found'],
  )
  const two = memoryStore({
    users: [
      { id: 'u1', email: OWNER, role: 'admin' },
      { id: 'u2', email: OWNER.toUpperCase(), role: 'viewer' },
    ],
  })
  const ambiguous = await planImport(two, example(), { ownerEmail: OWNER })
  assert.deepEqual(
    ambiguous.blockers.map((b) => b.reason),
    ['owner_ambiguous'],
  )
})

test('refuses to create a second contact with an existing email; crm_id adopts it', async () => {
  const store = memoryStore()
  store.db.contacts.push({
    id: 'existing-contact',
    name: 'Persona Ejemplo',
    email: 'persona@example.invalid',
    owner_id: null,
    deleted_at: null,
  })
  const blocked = await planImport(store, example(), { ownerEmail: OWNER })
  assert.deepEqual(
    blocked.blockers.map((b) => [b.reason, b.key]),
    [['email_in_use', 'acme-ejemplo/contacto-direccion']],
  )

  const adopt = example()
  adopt.clients[0].contacts[0].crm_id = 'existing-contact'
  const report = await run(store, adopt)
  assert.deepEqual(report.blockers, [])
  assert.equal(report.records[0].action, 'link')
  assert.equal(store.db.contacts.length, 2)
  assert.equal(store.db.contacts[0].owner_id, 'user-0001-owner')
  const again = await run(store, adopt)
  assert.equal(again.records[0].action, 'unchanged')
})

test('blocks when the pipeline stage does not exist', async () => {
  const m = example()
  m.clients[0].opportunity.stage = 'Nope'
  const plan = await planImport(memoryStore(), m, { ownerEmail: OWNER })
  assert.deepEqual(
    plan.blockers.map((b) => b.reason),
    ['pipeline_stage_not_found'],
  )
})

test('recreates a record whose row disappeared and repoints its reference', async () => {
  const store = memoryStore()
  await run(store, example())
  store.db.engagement_events = store.db.engagement_events.filter(
    (e) => e.metadata.import_key !== 'acme-ejemplo/evento-nota-interna',
  )
  const report = await run(store, example())
  assert.equal(report.counts.recreate, 1)
  assert.equal(store.db.engagement_events.length, 2)
  assert.equal(store.db.external_references.length, 9)
})

/** Minimal `postgres` stand-in: records the transaction mode. */
function fakeSql() {
  const log = { modes: [] }
  const tx = async (strings) => {
    const q = strings.join('?')
    if (q.includes('show transaction_read_only')) return [{ transaction_read_only: 'on' }]
    return []
  }
  return {
    log,
    begin: async (modeOrFn, maybeFn) => {
      log.modes.push(typeof modeOrFn === 'string' ? modeOrFn : 'read write')
      return (typeof modeOrFn === 'function' ? modeOrFn : maybeFn)(tx)
    },
  }
}

test('dry-run plans in a read-only transaction and writes nothing', async () => {
  const sql = fakeSql()
  const store = memoryStore()
  const report = await runImport(sql, {
    manifest: example(),
    ownerEmail: OWNER,
    apply: false,
    storeFactory: () => store,
  })
  assert.deepEqual(sql.log.modes, ['read only'])
  assert.equal(report.mode, 'dry-run')
  assert.equal(report.counts.create, 9)
  assert.deepEqual(store.writes, [])
})

test('--apply writes in one transaction; an invalid manifest never connects', async () => {
  const sql = fakeSql()
  const store = memoryStore()
  const report = await runImport(sql, {
    manifest: example(),
    ownerEmail: OWNER,
    apply: true,
    storeFactory: () => store,
  })
  assert.deepEqual(sql.log.modes, ['read write'])
  assert.equal(report.mode, 'apply')
  assert.equal(report.written.create, 9)

  const bad = fakeSql()
  const invalid = await runImport(bad, {
    manifest: { version: 2, clients: [] },
    ownerEmail: OWNER,
    apply: true,
    storeFactory: () => store,
  })
  assert.equal(invalid.mode, 'invalid')
  assert.deepEqual(bad.log.modes, [])
})

test('the report carries keys, actions and field names, never values', async () => {
  const store = memoryStore()
  const plan = await planImport(store, example(), { ownerEmail: OWNER })
  const text = JSON.stringify(summarize(plan, { mode: 'dry-run' }))
  for (const value of ['persona@example.invalid', 'Persona Ejemplo', '11600', 'Arrancamos']) {
    assert.ok(!text.includes(value), value)
  }
})

test('parseArgs requires --owner-email and defaults to dry-run on stdin', () => {
  assert.deepEqual(parseArgs(['--owner-email', OWNER]), {
    apply: false,
    json: false,
    databaseEnv: 'DATABASE_URL',
    manifest: '-',
    ownerEmail: OWNER,
  })
  assert.throws(() => parseArgs([]), /--owner-email/)
  assert.throws(() => parseArgs(['--owner-email', OWNER, '--force']), /unknown argument/)
})

test('the script refuses to run without a database URL', () => {
  const res = spawnSync(
    process.execPath,
    ['scripts/import-engagements.mjs', '--owner-email', OWNER],
    { env: { PATH: process.env.PATH }, encoding: 'utf8', input: '{}' },
  )
  assert.equal(res.status, 2)
  assert.match(res.stderr, /DATABASE_URL is required/)
})
