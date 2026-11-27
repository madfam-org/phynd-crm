import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  AVALA_SERVICE_ACTOR,
  missingAttribution,
  parseArgs,
  planEvent,
  runBackfill,
} from '../backfill-avala-lead-context.mjs'

// Synthetic data only.
function capture(eventId, avalaLeadId, lead = {}, extra = {}) {
  return {
    id: `we-${eventId}`,
    created_at: new Date('2026-06-01T12:00:00.000Z'),
    payload: {
      schema_version: '1',
      event_id: eventId,
      event_type: 'avala.lead.captured',
      source: 'avala',
      payload: {
        lead: { id: avalaLeadId, email: 'lead.uno@example.org', source: 'marketing_contact', ...lead },
        attribution: { sourcePage: '/contacto' },
      },
      ...extra,
    },
  }
}

/**
 * A `postgres`-shaped fake over in-memory tables. It answers the script's
 * queries by their text and records every write.
 */
function fakeSql({ events, leads, conversions, notes = [], readOnly = true }) {
  const writes = []
  const tx = (strings, ...values) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim()
    if (text.startsWith('set local')) return Promise.resolve([])
    if (text.startsWith('show transaction_read_only'))
      return Promise.resolve([{ transaction_read_only: readOnly ? 'on' : 'off' }])
    if (text.startsWith('select id, payload, created_at from webhook_events'))
      return Promise.resolve(events)
    if (text.includes("metadata ->> 'event_id'") || text.includes("metadata ->> 'avala_lead_id'")) {
      const key = text.includes("'event_id'") ? 'event_id' : 'avala_lead_id'
      const conversion = conversions.find((c) => c.metadata[key] === values[0])
      const lead = conversion && leads.find((l) => l.id === conversion.lead_id)
      return Promise.resolve(lead ? [{ ...lead }] : [])
    }
    if (text.startsWith('select 1 from notes'))
      return Promise.resolve(
        notes.filter((n) => n.entity_id === values[0] && n.author_id === values[1]).map(() => ({ 1: 1 })),
      )
    if (text.startsWith('insert into notes')) {
      if (readOnly) throw new Error('write in a read-only transaction')
      const [id, content, entityId, authorId] = values
      notes.push({ id, content, entity_id: entityId, author_id: authorId })
      writes.push({ table: 'notes', entityId, content })
      return Promise.resolve([])
    }
    if (text.startsWith('update leads')) {
      if (readOnly) throw new Error('write in a read-only transaction')
      const [patch, id] = values
      const lead = leads.find((l) => l.id === id)
      lead.attribution = { ...(lead.attribution ?? {}), ...patch }
      writes.push({ table: 'leads', id, patch })
      return Promise.resolve([])
    }
    throw new Error(`unexpected query: ${text}`)
  }
  tx.json = (value) => value
  const sql = {
    begin: async (modeOrWork, maybeWork) => {
      const work = typeof modeOrWork === 'function' ? modeOrWork : maybeWork
      readOnly = typeof modeOrWork === 'string'
      return work(tx)
    },
  }
  return { sql, writes, notes, leads }
}

function fixture() {
  return {
    events: [
      capture('ev-1', 'avala-1', { message: 'Queremos una demostración.', leadType: 'ORGANIZATION' }),
      capture('ev-2', 'avala-2'),
      capture('ev-3', 'avala-3'),
      capture('ev-4', 'avala-4', {}, { redacted: true }),
      capture('ev-5', 'avala-5'),
    ],
    leads: [
      { id: 'lead-1', attribution: null, deleted_at: null },
      { id: 'lead-2', attribution: { landing_page: '/otra' }, deleted_at: null },
      { id: 'lead-3', attribution: null, deleted_at: new Date() },
    ],
    conversions: [
      { lead_id: 'lead-1', metadata: { event_id: 'ev-1', avala_lead_id: 'avala-1' } },
      // matched by the Avala lead id only
      { lead_id: 'lead-2', metadata: { avala_lead_id: 'avala-2' } },
      { lead_id: 'lead-3', metadata: { event_id: 'ev-3' } },
    ],
  }
}

test('dry-run reads only and reports counts', async () => {
  const { sql, writes } = fakeSql(fixture())
  const report = await runBackfill(sql, { apply: false })
  assert.equal(writes.length, 0)
  assert.deepEqual(report, {
    mode: 'dry-run',
    capture_events: 5,
    skipped_redacted: 1,
    skipped_no_lead: 1,
    skipped_lead_deleted: 1,
    leads_matched: 2,
    notes_to_write: 2,
    notes_with_message: 1,
    notes_already_present: 0,
    // lead-2 already has the only key its capture carries
    attributions_to_fill: 1,
    notes_written: 0,
    attributions_written: 0,
  })
})

test('the report never carries messages, emails or ids', async () => {
  const { sql } = fakeSql(fixture())
  const text = JSON.stringify(await runBackfill(sql, { apply: false }))
  for (const secret of ['Queremos', 'example.org', 'lead-1', 'avala-1', 'ev-1']) {
    assert.equal(text.includes(secret), false, secret)
  }
})

test('apply writes one note per lead and only the missing attribution keys', async () => {
  const state = fakeSql(fixture())
  const report = await runBackfill(state.sql, { apply: true })
  assert.equal(report.notes_written, 2)
  assert.equal(report.attributions_written, 1)

  const note = state.writes.find((w) => w.table === 'notes' && w.entityId === 'lead-1')
  assert.ok(note.content.startsWith('Queremos una demostración.\n\n— vía formulario de Avala'))
  assert.ok(note.content.includes('— tipo de lead: ORGANIZATION'))
  assert.equal(state.notes.every((n) => n.author_id === AVALA_SERVICE_ACTOR), true)

  assert.deepEqual(state.leads[0].attribution, { landing_page: '/contacto', lead_type: 'ORGANIZATION' })
  // an existing key is never changed
  assert.deepEqual(state.leads[1].attribution, { landing_page: '/otra' })
})

test('a second run writes nothing', async () => {
  const state = fakeSql(fixture())
  await runBackfill(state.sql, { apply: true })
  const before = state.writes.length
  const again = await runBackfill(state.sql, { apply: true })
  assert.equal(state.writes.length, before)
  assert.equal(again.notes_already_present, 2)
  assert.equal(again.notes_written, 0)
  assert.equal(again.attributions_written, 0)
})

test('missingAttribution keeps existing keys and returns null when nothing is missing', () => {
  assert.deepEqual(missingAttribution({ a: '1' }, { a: '2', b: '3' }), { b: '3' })
  assert.equal(missingAttribution({ a: '1' }, { a: '2' }), null)
  assert.equal(missingAttribution(null, null), null)
})

test('planEvent skips redacted records and deleted leads', () => {
  assert.equal(planEvent({ redacted: true }, { id: 'x' }).status, 'redacted')
  assert.equal(planEvent({}, null).status, 'no_lead')
  assert.equal(planEvent({}, { id: 'x', deleted_at: new Date() }).status, 'lead_deleted')
})

test('parseArgs: dry-run by default, rejects unknown arguments', () => {
  assert.equal(parseArgs([]).apply, false)
  assert.equal(parseArgs(['--apply']).apply, true)
  assert.throws(() => parseArgs(['--force']))
  assert.throws(() => parseArgs(['--database-env', 'not a name']))
})
