#!/usr/bin/env node
/**
 * Idempotent client import for operators (owner-run): contacts → opportunity →
 * engagements → quotes → artifacts → events, from a JSON manifest.
 *
 * Every record carries a stable `key`. The script keeps one
 * `external_references` row per record (provider `madfam-ops`, `external_id` =
 * the key), so a re-run finds what it created and UPDATES it instead of adding
 * a duplicate. A second run of the same manifest reports every record
 * `unchanged`. Artifacts and events are deduplicated the same way.
 *
 * Manifest: JSON Schema `scripts/engagement-import/manifest.schema.json`,
 * synthetic example `scripts/engagement-import/example.manifest.json`. Real
 * client manifests never live in this public repo.
 *
 * Plan actions per record:
 *   create    no reference yet: insert the row and its reference
 *   link      no reference yet, `crm_id` given: adopt that existing row
 *   update    reference found and some field differs
 *   unchanged reference found and every field matches
 *   recreate  reference found but its row is gone: insert again, repoint
 *
 * Safety:
 *   - dry-run is the default and runs in a `BEGIN READ ONLY` transaction;
 *   - `--apply` is all-or-nothing: one transaction, an advisory lock, the plan is
 *     rebuilt inside it, and any blocker aborts before the first write;
 *   - the owner of every created row (and of adopted rows with no owner) is the
 *     CRM user with `--owner-email`; existing owners are never replaced;
 *   - events are refused unless `engagement_events.visibility` exists (migration
 *     0015): without it the portal shows every event to the client. Each event
 *     states its visibility; nothing defaults to client-visible;
 *   - imported quotes appear in the client portal's quote card (draft, sent,
 *     accepted); `sent`/`accepted` offer online payment there.
 *
 * Output: record kinds, keys, actions and changed field NAMES; never values.
 *
 * Usage (local / port-forward):
 *   DATABASE_URL=... node scripts/import-engagements.mjs --owner-email <email> < manifest.json
 *   DATABASE_URL=... node scripts/import-engagements.mjs --owner-email <email> --manifest m.json --apply
 *
 * Usage (in-cluster; stdin carries the manifest, so copy the script first):
 *   kubectl -n phynd-crm exec -i deploy/phynd-crm-worker -- \
 *     sh -c 'cat > /tmp/import-engagements.mjs' < scripts/import-engagements.mjs
 *   kubectl -n phynd-crm exec -i deploy/phynd-crm-worker -- \
 *     node /tmp/import-engagements.mjs --owner-email <email> [--apply] < manifest.json
 *
 * Options:
 *   --owner-email <email>   CRM user who owns created rows (required)
 *   --manifest <file|->     manifest path, `-` = stdin (default)
 *   --apply                 write (all-or-nothing)
 *   --json                  print the machine-readable report only
 *   --database-env <NAME>   read the URL from env NAME (e.g. DATABASE_URL_<TENANT>)
 */

import crypto from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const PROVIDER = 'madfam-ops'
export const MANIFEST_VERSION = 1
export const LOCK_KEY = 7_201_510_002
const IDENT = /^[a-z_][a-z0-9_]*$/

export const ENTITY = {
  contact: 'contact',
  opportunity: 'opportunity',
  engagement: 'engagement',
  quote: 'quote',
  artifact: 'engagement_artifact',
  event: 'engagement_event',
}

export const ENUMS = {
  opportunityStatus: ['open', 'won', 'lost'],
  engagementStatus: ['active', 'completed', 'paused', 'cancelled'],
  quoteStatus: ['draft', 'sent', 'accepted', 'declined', 'expired'],
  eventStatus: ['pending', 'in_progress', 'milestone', 'completed', 'failed', 'blocked'],
  visibility: ['internal', 'client'],
}

export const PATTERNS = {
  key: /^[a-z0-9][a-z0-9._/-]{0,199}$/,
  amount: /^\d{1,10}(\.\d{1,2})?$/,
  currency: /^[A-Z]{3}$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
  dateTime: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  artifactType: /^[a-z][a-z_]{0,29}$/,
  source: /^[a-z][a-z0-9_-]{0,19}$/,
  eventType: /^[a-z][a-z0-9_-]*:[a-z0-9][a-z0-9_.-]*$/,
  httpsUrl: /^https:\/\/[^\s]+$/,
}

// ─── Validation (mirrors manifest.schema.json; no dependencies) ─────────────

export const FIELDS = {
  manifest: { required: ['version', 'clients'], optional: [] },
  client: { required: ['key', 'contacts'], optional: ['opportunity', 'engagements'] },
  contact: { required: ['key', 'name'], optional: ['email', 'phone', 'company', 'crm_id'] },
  opportunity: {
    required: ['key', 'name', 'pipeline', 'stage'],
    optional: ['contact', 'value', 'status', 'probability', 'expected_close_date', 'crm_id'],
  },
  engagement: {
    required: ['key', 'project_name'],
    optional: ['description', 'status', 'contact', 'crm_id', 'quotes', 'artifacts', 'events'],
  },
  quote: {
    required: ['key', 'quote_number', 'status', 'total_amount'],
    optional: [
      'currency',
      'valid_until',
      'subtotal',
      'tax_amount',
      'notes',
      'line_items',
      'crm_id',
    ],
  },
  lineItem: { required: ['description', 'quantity', 'unit_price'], optional: ['unit', 'amount'] },
  artifact: { required: ['key', 'type', 'title'], optional: ['url', 'description'] },
  event: {
    required: ['key', 'source', 'event_type', 'occurred_at', 'visibility'],
    optional: ['message', 'status'],
  },
}

function checkObject(value, kind, at, errors) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${at}: must be an object`)
    return false
  }
  const spec = FIELDS[kind]
  for (const name of spec.required) {
    if (value[name] === undefined || value[name] === null) errors.push(`${at}.${name}: required`)
  }
  for (const name of Object.keys(value)) {
    if (!spec.required.includes(name) && !spec.optional.includes(name)) {
      errors.push(`${at}.${name}: unknown property`)
    }
  }
  return true
}

function checkString(value, at, errors, { pattern, max = 255, enumValues } = {}) {
  if (value === undefined || value === null) return
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${at}: must be a non-empty string`)
  } else if (value.length > max) {
    errors.push(`${at}: longer than ${max}`)
  } else if (pattern && !pattern.test(value)) {
    errors.push(`${at}: invalid format`)
  } else if (enumValues && !enumValues.includes(value)) {
    errors.push(`${at}: must be one of ${enumValues.join(', ')}`)
  }
}

function checkArray(value, at, errors, { min = 0 } = {}) {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    errors.push(`${at}: must be an array`)
    return []
  }
  if (value.length < min) errors.push(`${at}: needs at least ${min} item(s)`)
  return value
}

/** Returns a list of `path: problem` strings; empty when the manifest is valid. */
export function validateManifest(manifest) {
  const errors = []
  if (!checkObject(manifest, 'manifest', '$', errors)) return errors
  if (manifest.version !== MANIFEST_VERSION) errors.push(`$.version: must be ${MANIFEST_VERSION}`)
  const seen = new Map()
  const emails = new Map()
  const unique = (kind, key, at) => {
    const id = `${kind}:${key}`
    if (seen.has(id)) errors.push(`${at}.key: duplicate ${kind} key (also at ${seen.get(id)})`)
    else seen.set(id, at)
  }
  const keyed = (value, kind, at) => {
    checkString(value.key, `${at}.key`, errors, { pattern: PATTERNS.key, max: 200 })
    if (typeof value.key === 'string') unique(kind, value.key, at)
    checkString(value.crm_id, `${at}.crm_id`, errors, { max: 255 })
  }

  checkArray(manifest.clients, '$.clients', errors, { min: 1 }).forEach((client, ci) => {
    const at = `$.clients[${ci}]`
    if (!checkObject(client, 'client', at, errors)) return
    checkString(client.key, `${at}.key`, errors, { pattern: PATTERNS.key, max: 200 })
    if (typeof client.key === 'string') unique('client', client.key, at)
    const contactKeys = new Set()
    checkArray(client.contacts, `${at}.contacts`, errors, { min: 1 }).forEach((c, i) => {
      const cat = `${at}.contacts[${i}]`
      if (!checkObject(c, 'contact', cat, errors)) return
      keyed(c, 'contact', cat)
      contactKeys.add(c.key)
      checkString(c.name, `${cat}.name`, errors)
      checkString(c.email, `${cat}.email`, errors, { pattern: PATTERNS.email })
      if (typeof c.email === 'string') {
        const email = c.email.trim().toLowerCase()
        if (emails.has(email)) errors.push(`${cat}.email: same email as ${emails.get(email)}`)
        else emails.set(email, cat)
      }
      checkString(c.phone, `${cat}.phone`, errors, { max: 50 })
      checkString(c.company, `${cat}.company`, errors)
    })
    const contactRef = (value, refAt) => {
      if (value === undefined) return
      checkString(value, refAt, errors, { pattern: PATTERNS.key, max: 200 })
      if (typeof value === 'string' && !contactKeys.has(value))
        errors.push(`${refAt}: not a contact key of this client`)
    }
    if (client.opportunity !== undefined) {
      const o = client.opportunity
      const oat = `${at}.opportunity`
      if (checkObject(o, 'opportunity', oat, errors)) {
        keyed(o, 'opportunity', oat)
        checkString(o.name, `${oat}.name`, errors)
        checkString(o.pipeline, `${oat}.pipeline`, errors)
        checkString(o.stage, `${oat}.stage`, errors)
        contactRef(o.contact, `${oat}.contact`)
        checkString(o.value, `${oat}.value`, errors, { pattern: PATTERNS.amount })
        checkString(o.status, `${oat}.status`, errors, { enumValues: ENUMS.opportunityStatus })
        checkString(o.expected_close_date, `${oat}.expected_close_date`, errors, {
          pattern: PATTERNS.date,
        })
        if (
          o.probability !== undefined &&
          !(Number.isInteger(o.probability) && o.probability >= 0 && o.probability <= 100)
        )
          errors.push(`${oat}.probability: must be an integer 0-100`)
      }
    }
    checkArray(client.engagements, `${at}.engagements`, errors).forEach((e, ei) => {
      const eat = `${at}.engagements[${ei}]`
      if (!checkObject(e, 'engagement', eat, errors)) return
      keyed(e, 'engagement', eat)
      checkString(e.project_name, `${eat}.project_name`, errors)
      checkString(e.description, `${eat}.description`, errors, { max: 2000 })
      checkString(e.status, `${eat}.status`, errors, { enumValues: ENUMS.engagementStatus })
      contactRef(e.contact, `${eat}.contact`)
      validateQuotes(e.quotes, `${eat}.quotes`, errors, keyed)
      checkArray(e.artifacts, `${eat}.artifacts`, errors).forEach((a, i) => {
        const aat = `${eat}.artifacts[${i}]`
        if (!checkObject(a, 'artifact', aat, errors)) return
        keyed(a, 'artifact', aat)
        checkString(a.type, `${aat}.type`, errors, { pattern: PATTERNS.artifactType, max: 30 })
        checkString(a.title, `${aat}.title`, errors)
        checkString(a.url, `${aat}.url`, errors, { pattern: PATTERNS.httpsUrl, max: 2000 })
        checkString(a.description, `${aat}.description`, errors, { max: 2000 })
      })
      checkArray(e.events, `${eat}.events`, errors).forEach((ev, i) => {
        const vat = `${eat}.events[${i}]`
        if (!checkObject(ev, 'event', vat, errors)) return
        keyed(ev, 'event', vat)
        checkString(ev.source, `${vat}.source`, errors, { pattern: PATTERNS.source, max: 20 })
        checkString(ev.event_type, `${vat}.event_type`, errors, {
          pattern: PATTERNS.eventType,
          max: 100,
        })
        checkString(ev.message, `${vat}.message`, errors, { max: 2000 })
        checkString(ev.status, `${vat}.status`, errors, { enumValues: ENUMS.eventStatus })
        checkString(ev.occurred_at, `${vat}.occurred_at`, errors, { pattern: PATTERNS.dateTime })
        checkString(ev.visibility, `${vat}.visibility`, errors, { enumValues: ENUMS.visibility })
      })
    })
  })
  return errors
}

function validateQuotes(quotes, at, errors, keyed) {
  checkArray(quotes, at, errors).forEach((q, i) => {
    const qat = `${at}[${i}]`
    if (!checkObject(q, 'quote', qat, errors)) return
    keyed(q, 'quote', qat)
    checkString(q.quote_number, `${qat}.quote_number`, errors, { max: 50 })
    checkString(q.status, `${qat}.status`, errors, { enumValues: ENUMS.quoteStatus })
    checkString(q.currency, `${qat}.currency`, errors, { pattern: PATTERNS.currency })
    for (const f of ['total_amount', 'subtotal', 'tax_amount'])
      checkString(q[f], `${qat}.${f}`, errors, { pattern: PATTERNS.amount })
    checkString(q.valid_until, `${qat}.valid_until`, errors, { pattern: PATTERNS.date })
    checkString(q.notes, `${qat}.notes`, errors, { max: 2000 })
    checkArray(q.line_items, `${qat}.line_items`, errors).forEach((li, j) => {
      const lat = `${qat}.line_items[${j}]`
      if (!checkObject(li, 'lineItem', lat, errors)) return
      checkString(li.description, `${lat}.description`, errors, { max: 500 })
      checkString(li.unit, `${lat}.unit`, errors, { max: 30 })
      for (const f of ['unit_price', 'amount'])
        checkString(li[f], `${lat}.${f}`, errors, { pattern: PATTERNS.amount })
      if (!(typeof li.quantity === 'number' && li.quantity > 0))
        errors.push(`${lat}.quantity: must be a positive number`)
    })
  })
}

// ─── Normalization and comparison ───────────────────────────────────────────

const amount = (v) => (v === undefined || v === null ? null : Number(v).toFixed(2))
const text = (v) => (v === undefined || v === null || v === '' ? null : String(v))
const instant = (v) => (v === undefined || v === null ? null : new Date(v).getTime())
/** Calendar dates are stored at noon UTC so no Mexico/UTC offset moves the day. */
const dateOnly = (v) => (v ? new Date(`${v}T12:00:00Z`) : null)

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return `{${Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(',')}}`
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  return JSON.stringify(value ?? null)
}

const COMPARE = {
  amount: (a, b) => amount(a) === amount(b),
  instant: (a, b) => instant(a) === instant(b),
  json: (a, b) => stable(a ?? {}) === stable(b ?? {}),
  text: (a, b) => text(a) === text(b),
}

/** Changed column names, comparing desired (camelCase) against the row (snake_case). */
function diff(row, desired, kinds) {
  const changed = []
  for (const [field, value] of Object.entries(desired)) {
    const column = snake(field)
    const same = (COMPARE[kinds[field] ?? 'text'] ?? COMPARE.text)(row[column], value)
    if (!same) changed.push(field)
  }
  return changed
}

const snake = (s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)

// ─── Planning ───────────────────────────────────────────────────────────────

/** Desired column values per record kind (camelCase), plus comparison kinds. */
const SHAPES = {
  contact: (c) => ({
    values: {
      name: c.name,
      email: c.email ? c.email.trim().toLowerCase() : null,
      phone: c.phone ?? null,
      company: c.company ?? null,
    },
    owned: true,
  }),
  opportunity: (o, { contactId, stage }) => ({
    values: {
      name: o.name,
      contactId,
      pipelineId: stage?.pipelineId ?? null,
      stageId: stage?.stageId ?? null,
      value: amount(o.value),
      status: o.status ?? 'open',
      probability: o.probability ?? null,
      expectedCloseDate: dateOnly(o.expected_close_date),
    },
    kinds: { value: 'amount', expectedCloseDate: 'instant' },
    owned: true,
  }),
  engagement: (e, { contactId, opportunityId }) => ({
    values: {
      contactId,
      opportunityId,
      projectName: e.project_name,
      description: e.description ?? null,
      status: e.status ?? 'active',
    },
    owned: true,
  }),
  quote: (q, { contactId, opportunityId }) => ({
    values: {
      quoteNumber: q.quote_number,
      opportunityId,
      contactId,
      status: q.status,
      totalAmount: amount(q.total_amount),
      currency: q.currency ?? 'MXN',
      validUntil: dateOnly(q.valid_until),
    },
    kinds: { totalAmount: 'amount', validUntil: 'instant' },
    owned: true,
    refMetadata: {
      line_items: (q.line_items ?? []).map((li) => ({
        description: li.description,
        quantity: li.quantity,
        unit: li.unit ?? null,
        unit_price: amount(li.unit_price),
        amount: amount(li.amount ?? Number(li.unit_price) * li.quantity),
      })),
      subtotal: amount(q.subtotal),
      tax_amount: amount(q.tax_amount),
      notes: q.notes ?? null,
    },
  }),
  artifact: (a, { engagementId }) => ({
    values: {
      engagementId,
      type: a.type,
      title: a.title,
      url: a.url ?? null,
      metadata: { import_key: a.key, description: a.description ?? null },
    },
    kinds: { metadata: 'json' },
  }),
  event: (ev, { engagementId }) => ({
    values: {
      engagementId,
      source: ev.source,
      eventType: ev.event_type,
      status: ev.status ?? null,
      message: ev.message ?? null,
      metadata: { import_key: ev.key },
      dedupKey: `${PROVIDER}:${ev.key}`,
      visibility: ev.visibility,
      createdAt: new Date(ev.occurred_at),
    },
    kinds: { metadata: 'json', createdAt: 'instant' },
  }),
}

const TABLE_OF = {
  contact: 'contacts',
  opportunity: 'opportunities',
  engagement: 'engagements',
  quote: 'quotes',
  artifact: 'engagement_artifacts',
  event: 'engagement_events',
}
const SOFT_DELETED = new Set(['contact', 'opportunity', 'engagement', 'quote'])

class ImportPlanner {
  constructor(store, refs, ownerId, plan) {
    this.store = store
    this.refs = refs
    this.ownerId = ownerId
    this.plan = plan
    this.claimed = new Map()
  }

  block(reason, detail = {}) {
    this.plan.blockers.push({ reason, ...detail })
  }

  /** Finds the row a record maps to: its reference, an adopted crm_id, or none. */
  async resolve(kind, item) {
    const table = TABLE_OF[kind]
    const ref = this.refs.get(`${ENTITY[kind]}:${item.key}`) ?? null
    let row = null
    let action = 'create'
    if (ref) {
      row = await this.store.getRow(table, ref.entity_id)
      action = row ? 'update' : 'recreate'
    } else if (item.crm_id) {
      row = await this.store.getRow(table, item.crm_id)
      action = 'link'
      if (!row) this.block('crm_id_not_found', { kind, key: item.key })
      else if ((await this.store.findRefsByEntity(ENTITY[kind], row.id)).length > 0)
        this.block('crm_id_already_linked', { kind, key: item.key })
    }
    if (row && SOFT_DELETED.has(kind) && row.deleted_at)
      this.block('ref_target_deleted', { kind, key: item.key })
    const id = row?.id ?? crypto.randomUUID()
    const claim = `${table}:${id}`
    if (this.claimed.has(claim))
      this.block('same_row_twice', { kind, key: item.key, other: this.claimed.get(claim) })
    this.claimed.set(claim, item.key)
    return { ref, row, action, id }
  }

  /** Resolves and records one item; returns the id it has or will have. */
  async add(kind, item, context = {}) {
    const resolved = await this.resolve(kind, item)
    const shape = SHAPES[kind](item, context)
    const { ref, row, id } = resolved
    const values = { ...shape.values }
    // Owner: set on create; fill on adopted/updated rows that have none; never replace.
    if (shape.owned && this.ownerId && !row?.owner_id) values.ownerId = this.ownerId
    let action = resolved.action
    let changed = Object.keys(values)
    if (row) {
      changed = diff(row, values, shape.kinds ?? {})
      if (ref && !COMPARE.json(ref.metadata, shape.refMetadata ?? null))
        changed.push('reference.metadata')
      if (action === 'update' && changed.length === 0) action = 'unchanged'
    }
    this.plan.records.push({
      kind,
      table: TABLE_OF[kind],
      key: item.key,
      id,
      action,
      changed,
      values,
      refId: ref?.id ?? null,
      refMetadata: shape.refMetadata ?? null,
      hasUpdatedAt: SOFT_DELETED.has(kind),
    })
    return { id, action }
  }

  async addClient(client) {
    const contactIds = new Map()
    for (const c of client.contacts ?? []) {
      const { id, action } = await this.add('contact', c)
      contactIds.set(c.key, id)
      if (action === 'create' && c.email) await this.checkEmailFree(c)
    }
    const contactFor = (key) => (key ? contactIds.get(key) : contactIds.get(client.contacts[0].key))

    let opportunityId = null
    const o = client.opportunity
    if (o) {
      const stage = await this.store.findPipelineStage(o.pipeline, o.stage)
      if (!stage) this.block('pipeline_stage_not_found', { kind: 'opportunity', key: o.key })
      else if (stage.ambiguous)
        this.block('pipeline_stage_ambiguous', { kind: 'opportunity', key: o.key })
      opportunityId = (
        await this.add('opportunity', o, { contactId: contactFor(o.contact), stage })
      ).id
    }

    for (const e of client.engagements ?? []) {
      const contactId = contactFor(e.contact)
      const { id: engagementId } = await this.add('engagement', e, { contactId, opportunityId })
      for (const q of e.quotes ?? []) await this.add('quote', q, { contactId, opportunityId })
      for (const a of e.artifacts ?? []) await this.add('artifact', a, { engagementId })
      for (const ev of e.events ?? []) await this.add('event', ev, { engagementId })
    }
  }

  async checkEmailFree(contact) {
    const holders = await this.store.findContactsByEmail(contact.email.trim().toLowerCase())
    if (holders.length > 0)
      this.block('email_in_use', {
        kind: 'contact',
        key: contact.key,
        hint: 'set crm_id to adopt the existing contact',
      })
  }
}

/**
 * Builds the plan against a store (see createPgStore / tests' memory store).
 * Every record gets the id it has or will have, so dependants can point at it.
 */
export async function planImport(store, manifest, { ownerEmail }) {
  const plan = { owner: null, records: [], blockers: [] }
  const owners = await store.findUsersByEmail(ownerEmail)
  if (owners.length === 1) plan.owner = owners[0]
  else if (owners.length === 0) plan.blockers.push({ reason: 'owner_not_found' })
  else plan.blockers.push({ reason: 'owner_ambiguous', count: owners.length })

  const keys = collectKeys(manifest)
  if (
    keys.some((k) => k.entityType === ENTITY.event) &&
    !(await store.hasColumn('engagement_events', 'visibility'))
  ) {
    plan.blockers.push({
      reason: 'visibility_column_missing',
      hint: 'apply migration 0015 first; without it the portal shows every event',
    })
  }

  const planner = new ImportPlanner(store, await store.findRefs(keys), plan.owner?.id, plan)
  for (const client of manifest.clients ?? []) await planner.addClient(client)
  return plan
}

function collectKeys(manifest) {
  const keys = []
  const add = (kind, item) => item && keys.push({ entityType: ENTITY[kind], externalId: item.key })
  for (const c of manifest.clients ?? []) {
    for (const contact of c.contacts ?? []) add('contact', contact)
    add('opportunity', c.opportunity)
    for (const e of c.engagements ?? []) {
      add('engagement', e)
      for (const q of e.quotes ?? []) add('quote', q)
      for (const a of e.artifacts ?? []) add('artifact', a)
      for (const ev of e.events ?? []) add('event', ev)
    }
  }
  return keys
}

/** Writes a plan with no blockers. Callers run it inside one transaction. */
export async function applyPlan(store, plan) {
  if (plan.blockers.length > 0) throw new Error('plan has blockers; nothing written')
  const written = { create: 0, link: 0, update: 0, recreate: 0 }
  for (const r of plan.records) {
    if (r.action === 'unchanged') continue
    const now = new Date()
    if (r.action === 'create' || r.action === 'recreate') {
      const row = { id: r.id, ...r.values }
      if (r.hasUpdatedAt) row.updatedAt = now
      await store.insert(r.table, row)
    } else {
      const patch = Object.fromEntries(
        r.changed.filter((f) => f in r.values).map((f) => [f, r.values[f]]),
      )
      if (Object.keys(patch).length > 0) {
        if (r.hasUpdatedAt) patch.updatedAt = now
        await store.update(r.table, r.id, patch)
      }
    }
    if (r.refId) {
      await store.updateRef(r.refId, { entityId: r.id, metadata: r.refMetadata, updatedAt: now })
    } else {
      await store.insertRef({
        id: crypto.randomUUID(),
        entityType: ENTITY[r.kind],
        entityId: r.id,
        provider: PROVIDER,
        externalId: r.key,
        externalType: `import:${r.kind}`,
        metadata: r.refMetadata,
      })
    }
    written[r.action] += 1
  }
  return written
}

// ─── Postgres store ─────────────────────────────────────────────────────────

const TABLES = new Set([
  'contacts',
  'opportunities',
  'engagements',
  'quotes',
  'engagement_artifacts',
  'engagement_events',
])

const toColumns = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [snake(k), v]))

export function createPgStore(tx) {
  const table = (name) => {
    if (!TABLES.has(name)) throw new Error(`table not allowed: ${name}`)
    return tx(name)
  }
  return {
    lock: () => tx`select pg_advisory_xact_lock(${LOCK_KEY})`,
    findUsersByEmail: (email) =>
      tx`select id, role from users where lower(email) = ${String(email).trim().toLowerCase()}`,
    hasColumn: async (t, column) =>
      (
        await tx`select 1 from information_schema.columns
          where table_schema = 'public' and table_name = ${t} and column_name = ${column}`
      ).length > 0,
    async findRefs(keys) {
      const map = new Map()
      if (keys.length === 0) return map
      const ids = [...new Set(keys.map((k) => k.externalId))]
      const rows = await tx`
        select id, entity_type, entity_id, external_id, metadata from external_references
        where provider = ${PROVIDER} and external_id in ${tx(ids)}`
      for (const row of rows) map.set(`${row.entity_type}:${row.external_id}`, row)
      return map
    },
    findRefsByEntity: (entityType, entityId) =>
      tx`select id from external_references
        where provider = ${PROVIDER} and entity_type = ${entityType} and entity_id = ${entityId}`,
    async getRow(t, id) {
      const [row] = await tx`select * from ${table(t)} where id = ${id}`
      return row ?? null
    },
    findContactsByEmail: (email) =>
      tx`select id from contacts where lower(email) = ${email} and deleted_at is null`,
    async findPipelineStage(pipelineName, stageName) {
      const rows = await tx`
        select p.id as pipeline_id, s.id as stage_id from pipelines p
        join pipeline_stages s on s.pipeline_id = p.id
        where p.name = ${pipelineName} and s.name = ${stageName}`
      if (rows.length === 0) return null
      if (rows.length > 1) return { ambiguous: true }
      return { pipelineId: rows[0].pipeline_id, stageId: rows[0].stage_id }
    },
    insert: (t, row) => tx`insert into ${table(t)} ${tx(toColumns(row))}`,
    update: (t, id, patch) => tx`update ${table(t)} set ${tx(toColumns(patch))} where id = ${id}`,
    insertRef: (ref) => tx`insert into external_references ${tx(toColumns(ref))}`,
    updateRef: (id, patch) =>
      tx`update external_references set ${tx(toColumns(patch))} where id = ${id}`,
  }
}

// ─── Report and CLI ─────────────────────────────────────────────────────────

export function summarize(plan, { mode, written = null }) {
  const counts = { create: 0, link: 0, update: 0, unchanged: 0, recreate: 0 }
  for (const r of plan.records) counts[r.action] += 1
  return {
    mode,
    owner_user: plan.owner ? String(plan.owner.id).slice(0, 8) : null,
    counts,
    records: plan.records.map((r) => ({
      kind: r.kind,
      key: r.key,
      action: r.action,
      changed: r.action === 'unchanged' ? [] : r.changed,
    })),
    blockers: plan.blockers,
    written,
  }
}

export async function runImport(
  sql,
  { manifest, ownerEmail, apply, storeFactory = createPgStore },
) {
  const errors = validateManifest(manifest)
  if (errors.length > 0) {
    return { mode: 'invalid', errors, counts: null, records: [], blockers: [], written: null }
  }
  if (!apply) {
    return sql.begin('read only', async (tx) => {
      await tx`set local statement_timeout = '60s'`
      const [{ transaction_read_only: ro }] = await tx`show transaction_read_only`
      if (ro !== 'on') throw new Error('transaction is not read-only; aborting')
      const plan = await planImport(storeFactory(tx), manifest, { ownerEmail })
      return summarize(plan, { mode: 'dry-run' })
    })
  }
  return sql.begin(async (tx) => {
    await tx`set local statement_timeout = '120s'`
    const store = storeFactory(tx)
    await store.lock()
    const plan = await planImport(store, manifest, { ownerEmail })
    if (plan.blockers.length > 0) return summarize(plan, { mode: 'apply-refused' })
    const written = await applyPlan(store, plan)
    return summarize(plan, { mode: 'apply', written })
  })
}

export function parseArgs(argv) {
  const args = {
    apply: false,
    json: false,
    databaseEnv: 'DATABASE_URL',
    manifest: '-',
    ownerEmail: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') args.apply = true
    else if (a === '--json') args.json = true
    else if (a === '--database-env') args.databaseEnv = argv[++i] ?? ''
    else if (a === '--manifest') args.manifest = argv[++i] ?? ''
    else if (a === '--owner-email') args.ownerEmail = argv[++i] ?? ''
    else throw new Error(`unknown argument: ${a}`)
  }
  if (!IDENT.test(args.databaseEnv.toLowerCase()))
    throw new Error('--database-env must be an env var name')
  if (!args.ownerEmail || !PATTERNS.email.test(args.ownerEmail))
    throw new Error('--owner-email <email> is required')
  if (!args.manifest) throw new Error('--manifest needs a path or -')
  return args
}

/** Same rules as scripts/link-janua-users.mjs (inlined: the script runs standalone). */
export function resolvePostgresPath({ cwd = process.cwd(), scriptUrl = import.meta.url } = {}) {
  const bases = [path.join(cwd, 'node_modules/@phynd/db'), path.join(cwd, 'packages/db')]
  try {
    bases.push(path.join(path.dirname(fileURLToPath(scriptUrl)), '../packages/db'))
  } catch {
    // piped on stdin
  }
  bases.push(cwd)
  for (const base of bases) {
    try {
      const real = realpathSync(base)
      return createRequire(path.join(real, 'package.json')).resolve('postgres')
    } catch {
      // try the next location
    }
  }
  throw new Error(`cannot resolve the \`postgres\` package from ${cwd}`)
}

function printHuman(report) {
  if (report.mode === 'invalid') {
    process.stdout.write(`manifest is invalid:\n${report.errors.map((e) => `  ${e}`).join('\n')}\n`)
    return
  }
  const lines = [
    `mode: ${report.mode}${report.mode === 'dry-run' ? ' (no writes)' : ''}`,
    `owner: ${report.owner_user ?? '—'}`,
  ]
  for (const r of report.records) {
    const fields = r.changed.length > 0 && r.action !== 'create' ? ` [${r.changed.join(', ')}]` : ''
    lines.push(`  ${r.action.padEnd(9)} ${r.kind.padEnd(11)} ${r.key}${fields}`)
  }
  const c = report.counts
  lines.push(
    `${report.mode === 'apply' ? 'result' : 'plan'}: create ${c.create}, link ${c.link}, update ${c.update}, recreate ${c.recreate}, unchanged ${c.unchanged}`,
  )
  for (const b of report.blockers) {
    lines.push(
      `BLOCKER ${b.reason}${b.kind ? ` (${b.kind} ${b.key})` : ''}${b.hint ? `: ${b.hint}` : ''}`,
    )
  }
  if (report.mode === 'apply-refused') lines.push('REFUSED: blockers present; nothing was written')
  if (report.mode === 'apply') lines.push(`written: ${JSON.stringify(report.written)}`)
  process.stdout.write(`${lines.join('\n')}\n`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const url = process.env[args.databaseEnv]
  if (!url) {
    process.stderr.write(`${args.databaseEnv} is required\n`)
    process.exit(2)
  }
  const raw = readFileSync(args.manifest === '-' ? 0 : args.manifest, 'utf8')
  const manifest = JSON.parse(raw)
  const resolved = resolvePostgresPath()
  const postgres = createRequire(resolved)(resolved)
  const sql = postgres(url, { max: 1, connect_timeout: 10, idle_timeout: 5, onnotice: () => {} })
  try {
    const report = await runImport(sql, {
      manifest,
      ownerEmail: args.ownerEmail,
      apply: args.apply,
    })
    if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    else printHuman(report)
    if (report.mode === 'invalid') process.exitCode = 4
    else if (report.blockers.length > 0) process.exitCode = 3
  } finally {
    await sql.end({ timeout: 5 })
  }
}

const invokedPath = process.argv[1]
const isMain =
  !invokedPath ||
  invokedPath === '-' ||
  import.meta.url === pathToFileURL(path.resolve(invokedPath)).href
if (isMain) {
  main().catch((err) => {
    process.stderr.write(
      `import-engagements failed: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(1)
  })
}
