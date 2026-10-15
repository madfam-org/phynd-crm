import { readFileSync } from 'node:fs'
import { PROVIDER, applyPlan, planImport, summarize } from '../../import-engagements.mjs'

export const OWNER = 'operador@example.invalid'
export const OWNER_ID = 'user-0001-owner'

export const example = () =>
  JSON.parse(readFileSync('scripts/engagement-import/example.manifest.json', 'utf8'))

const snake = (s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
const toColumns = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [snake(k), v]))

/** In-memory stand-in for createPgStore(): same methods, snake_case rows. */
export function memoryStore({ users = [{ id: OWNER_ID, email: OWNER, role: 'admin' }] } = {}) {
  const db = {
    users,
    contacts: [],
    opportunities: [],
    engagements: [],
    quotes: [],
    engagement_artifacts: [],
    engagement_events: [],
    engagement_items: [],
    engagement_contacts: [],
    payment_evidence: [],
    external_references: [],
    pipelines: [{ id: 'pipe-1', name: 'Project Delivery' }],
    pipeline_stages: [{ id: 'stage-1', pipeline_id: 'pipe-1', name: 'Development' }],
  }
  const columns = {
    engagement_events: ['visibility'],
    engagement_items: ['external_key'],
    engagement_contacts: ['portal_access'],
    payment_evidence: ['external_key'],
  }
  const writes = []
  const defaults = {
    contacts: { deleted_at: null, owner_id: null },
    opportunities: { deleted_at: null, owner_id: null },
    engagements: { deleted_at: null, owner_id: null },
    quotes: { deleted_at: null, owner_id: null },
    engagement_items: { completed_at: null, due_at: null },
  }
  const byEngagement = (t, engagementId, pred) =>
    db[t].find((r) => r.engagement_id === engagementId && pred(r)) ?? null
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
    findItem: async (e, key) => byEngagement('engagement_items', e, (r) => r.external_key === key),
    findPayment: async (e, key) =>
      byEngagement('payment_evidence', e, (r) => r.external_key === key),
    findEngagementContact: async (e, contactId) =>
      byEngagement('engagement_contacts', e, (r) => r.contact_id === contactId),
    insert: async (t, row) => {
      writes.push(['insert', t])
      db[t].push({ ...(defaults[t] ?? {}), ...toColumns(row) })
    },
    update: async (t, id, patch) => {
      writes.push(['update', t, Object.keys(patch)])
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

export async function run(store, manifest) {
  const plan = await planImport(store, manifest, { ownerEmail: OWNER })
  if (plan.blockers.length === 0) await applyPlan(store, plan)
  return summarize(plan, { mode: 'apply' })
}

export const byKey = (report) => Object.fromEntries(report.records.map((r) => [r.key, r]))
