import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  applyPlan,
  hasLongDigitRun,
  looksLikeCardOrClabe,
  planImport,
  validateManifest,
} from '../import-engagements.mjs'
import { OWNER, OWNER_ID, byKey, example, memoryStore, run } from './helpers/import-store.mjs'

const ENG = 'acme-ejemplo/plataforma'
const engagementOf = (m) => m.clients[0].engagements[0]

// ─── (d) Data-loss guard ────────────────────────────────────────────────────

/** A CRM that already holds the client's records, created by hand (no references). */
function existingCrm() {
  const store = memoryStore()
  store.db.contacts.push({
    id: 'crm-contact',
    name: 'Persona Ejemplo',
    email: 'persona@example.invalid',
    phone: '+52 55 0000 0000',
    company: 'Acme Ejemplo S.A.',
    preferred_name: 'Pers',
    spanish_formality: 'usted',
    owner_id: 'someone-else',
    deleted_at: null,
  })
  store.db.engagements.push({
    id: 'crm-engagement',
    contact_id: 'crm-contact',
    opportunity_id: null,
    project_name: 'Plataforma de ejemplo',
    description: 'Descripción escrita en el CRM',
    status: 'paused',
    owner_id: null,
    deleted_at: null,
  })
  return store
}

/** Manifest adopting both rows, with every optional field left out. */
function sparseAdoption() {
  return {
    version: 1,
    clients: [
      {
        key: 'acme-ejemplo',
        contacts: [{ key: 'acme-ejemplo/contacto-direccion', name: 'Persona Ejemplo', crm_id: 'crm-contact' }],
        engagements: [{ key: ENG, project_name: 'Plataforma de ejemplo', crm_id: 'crm-engagement' }],
      },
    ],
  }
}

test('(d) adopting a row never clears a field the manifest omits', async () => {
  const store = existingCrm()
  const plan = await planImport(store, sparseAdoption(), { ownerEmail: OWNER })
  assert.deepEqual(plan.blockers, [])
  const records = Object.fromEntries(plan.records.map((r) => [r.key, r]))
  // Only the owner fill on the engagement (it had none) and the references.
  assert.deepEqual(records['acme-ejemplo/contacto-direccion'].changed, [])
  assert.deepEqual(records[ENG].changed, ['ownerId'])
  for (const r of plan.records) {
    for (const [field, value] of Object.entries(r.values)) {
      assert.notEqual(value, null, `${r.key}.${field} would be set to NULL`)
    }
  }

  await applyPlan(store, plan)
  const [contact] = store.db.contacts
  const [engagement] = store.db.engagements
  assert.equal(engagement.description, 'Descripción escrita en el CRM')
  assert.equal(engagement.status, 'paused')
  assert.equal(engagement.owner_id, OWNER_ID)
  assert.equal(contact.phone, '+52 55 0000 0000')
  assert.equal(contact.company, 'Acme Ejemplo S.A.')
  assert.equal(contact.preferred_name, 'Pers')
  assert.equal(contact.spanish_formality, 'usted')
  assert.equal(contact.owner_id, 'someone-else')

  const again = await run(store, sparseAdoption())
  assert.deepEqual(
    again.records.map((r) => r.action),
    ['unchanged', 'unchanged'],
  )
})

test('(d) the same guard holds for rows an earlier run created', async () => {
  const store = memoryStore()
  await run(store, example())
  const trimmed = example()
  const e = engagementOf(trimmed)
  delete e.description
  delete e.status
  delete trimmed.clients[0].contacts[0].company
  delete trimmed.clients[0].opportunity.probability
  delete e.quotes[0].valid_until
  delete e.quotes[0].notes
  delete e.quotes[0].line_items
  delete e.artifacts[0].url
  delete e.items[0].completed_at
  delete e.items[0].status
  delete e.payments[0].reference
  delete e.payments[0].tracking_key
  e.payments[0].status = undefined
  const report = await run(store, trimmed)
  assert.deepEqual(report.counts, { create: 0, link: 0, update: 0, unchanged: 15, recreate: 0 })
  assert.equal(store.db.engagements[0].description, 'Engagement sintético para probar la importación.')
  assert.equal(store.db.quotes[0].valid_until.toISOString(), '2026-09-30T12:00:00.000Z')
  const quoteRef = store.db.external_references.find((r) => r.entity_type === 'quote')
  assert.equal(quoteRef.metadata.line_items.length, 2)
  assert.equal(quoteRef.metadata.notes, 'Ciclo 1 (sintético).')
  assert.equal(store.db.engagement_artifacts[0].url, 'https://example.invalid/propuesta.pdf')
  assert.equal(store.db.payment_evidence[0].reference, 'Pago anticipo proyecto ejemplo')
})

test('(d) an explicitly changed value is still updated', async () => {
  const store = existingCrm()
  const m = sparseAdoption()
  m.clients[0].engagements[0].description = 'Nueva descripción'
  const report = await run(store, m)
  assert.deepEqual(byKey(report)[ENG].changed, ['description', 'ownerId'])
  assert.equal(store.db.engagements[0].description, 'Nueva descripción')
})

// ─── (a) Contact preferred name and tú/usted ────────────────────────────────

test('(a) preferred_name and spanish_formality are set when present, never cleared', async () => {
  const store = memoryStore()
  await run(store, example())
  const contact = () => store.db.contacts.find((c) => c.email === 'persona@example.invalid')
  assert.equal(contact().preferred_name, 'Per')
  assert.equal(contact().spanish_formality, 'tu')

  const changed = example()
  changed.clients[0].contacts[0].spanish_formality = 'usted'
  const report = await run(store, changed)
  assert.deepEqual(byKey(report)['acme-ejemplo/contacto-direccion'].changed, ['spanishFormality'])
  assert.equal(contact().spanish_formality, 'usted')

  const omitted = example()
  delete omitted.clients[0].contacts[0].spanish_formality
  delete omitted.clients[0].contacts[0].preferred_name
  const kept = await run(store, omitted)
  assert.equal(byKey(kept)['acme-ejemplo/contacto-direccion'].action, 'unchanged')
  assert.equal(contact().spanish_formality, 'usted')
  assert.equal(contact().preferred_name, 'Per')
})

test('(a) only tu or usted are accepted', () => {
  const m = example()
  m.clients[0].contacts[0].spanish_formality = 'vos'
  assert.match(validateManifest(m).join('\n'), /spanish_formality: must be one of tu, usted/)
})

// ─── (b) Engagement items ───────────────────────────────────────────────────

test('(b) items are created with safe defaults and keyed by external_key', async () => {
  const store = memoryStore()
  await run(store, example())
  const items = Object.fromEntries(store.db.engagement_items.map((i) => [i.external_key, i]))
  assert.equal(store.db.engagement_items.length, 4)
  assert.equal(items['acme-ejemplo/nota-interna'].client_visible, false)
  assert.equal(items['acme-ejemplo/nota-interna'].status, 'planned')
  assert.equal(items['acme-ejemplo/nota-interna'].side, 'madfam')
  assert.equal(items['acme-ejemplo/nota-interna'].sort_order, 3)
  assert.equal(items['acme-ejemplo/hito-arranque'].completed_at.toISOString(), '2026-08-20T12:00:00.000Z')
  assert.equal(items['acme-ejemplo/pendiente-logotipo'].due_at.toISOString(), '2026-11-01T12:00:00.000Z')
  assert.equal(items['acme-ejemplo/decision-paleta'].side, 'client')
})

test('(b) a stated status moves completed_at like the service does', async () => {
  const store = memoryStore()
  await run(store, example())
  const m = example()
  const logo = engagementOf(m).items[1]
  logo.status = 'done'
  const report = await run(store, m)
  assert.deepEqual(byKey(report)['acme-ejemplo/pendiente-logotipo'].changed, ['status', 'completedAt'])
  const item = store.db.engagement_items.find((i) => i.external_key === logo.key)
  assert.ok(item.completed_at instanceof Date)
  // Re-running keeps the date it got (no churn).
  const again = await run(store, m)
  assert.equal(byKey(again)['acme-ejemplo/pendiente-logotipo'].action, 'unchanged')
})

test('(b) items need migration 0016 and validate kind, status, side and keys', async () => {
  const store = memoryStore()
  store.columns.engagement_items = []
  const plan = await planImport(store, example(), { ownerEmail: OWNER })
  assert.ok(plan.blockers.some((b) => b.reason === 'table_missing' && /0016/.test(b.hint)))

  const m = example()
  const items = engagementOf(m).items
  items[0].kind = 'task'
  items[1].side = 'vendor'
  items[2].key = items[3].key
  items[3].sort_order = -1
  const errors = validateManifest(m).join('\n')
  assert.match(errors, /items\[0\]\.kind: must be one of/)
  assert.match(errors, /items\[1\]\.side: must be one of/)
  assert.match(errors, /items\[3\]\.key: duplicate item key/)
  assert.match(errors, /items\[3\]\.sort_order/)
})

// ─── (c) Engagement contacts ────────────────────────────────────────────────

test('(c) engagement contacts are created once and updated only when stated', async () => {
  const store = memoryStore()
  await run(store, example())
  assert.equal(store.db.engagement_contacts.length, 1)
  const [ec] = store.db.engagement_contacts
  assert.equal(ec.role, 'facturacion')
  assert.equal(ec.portal_access, true)

  const m = example()
  delete engagementOf(m).contacts[0].role
  engagementOf(m).contacts[0].portal_access = false
  const report = await run(store, m)
  assert.deepEqual(byKey(report)[`${ENG}#acme-ejemplo/contacto-facturacion`].changed, ['portalAccess'])
  assert.equal(store.db.engagement_contacts[0].role, 'facturacion')
  assert.equal(store.db.engagement_contacts.length, 1)
})

test('(c) portal access needs an email, and the contact must belong to the client', async () => {
  const m = example()
  delete m.clients[0].contacts[1].email
  const plan = await planImport(memoryStore(), m, { ownerEmail: OWNER })
  assert.ok(plan.blockers.some((b) => b.reason === 'portal_contact_without_email'))

  const bad = example()
  engagementOf(bad).contacts.push({ contact: 'otro-cliente/persona' })
  assert.match(validateManifest(bad).join('\n'), /contacts\[1\]\.contact: not a contact key of this client/)
})

// ─── Payments ──────────────────────────────────────────────────────────────

test('payments are keyed by external_key, verified by the owner, and idempotent', async () => {
  const store = memoryStore()
  await run(store, example())
  const [p] = store.db.payment_evidence
  assert.equal(p.external_key, 'acme-ejemplo/pago-anticipo')
  assert.equal(p.status, 'verified')
  assert.equal(p.verified_by_user_id, OWNER_ID)
  assert.equal(p.verified_at.toISOString(), '2026-10-15T16:30:15.000Z')
  assert.equal(p.created_by, OWNER_ID)
  assert.equal(p.currency, 'MXN')
  assert.equal(p.client_visible, true)
  assert.equal(p.quote_id, store.db.quotes[0].id)
  assert.equal(p.origin_account_last4, '1234')
  const again = await run(store, example())
  assert.equal(byKey(again)['acme-ejemplo/pago-anticipo'].action, 'unchanged')
  assert.equal(store.db.payment_evidence.length, 1)
})

test('payments refuse full account, CLABE or card numbers anywhere', () => {
  const m = example()
  const p = engagementOf(m).payments[0]
  p.reference = 'Pago desde cuenta 0123456789'
  p.notes = 'Tarjeta 4111 1111 1111 1111'
  p.origin_account_last4 = '012345'
  p.folio = '4111111111111111'
  const errors = validateManifest(m).join('\n')
  assert.match(errors, /payments\[0\]\.reference: remove the account/)
  assert.match(errors, /payments\[0\]\.notes: remove the account/)
  assert.match(errors, /payments\[0\]\.origin_account_last4: only the last 4 digits/)
  assert.match(errors, /payments\[0\]\.folio: is a CLABE or card number/)
  assert.equal(hasLongDigitRun('$11,603.56 el 15/10/2026'), false)
  assert.equal(looksLikeCardOrClabe('MBAN01002610150012345678'), false)
})

test('payment status only moves forward; voiding needs a date and a reason', async () => {
  const store = memoryStore()
  await run(store, example())
  const back = example()
  engagementOf(back).payments[0].status = 'recorded'
  const plan = await planImport(store, back, { ownerEmail: OWNER })
  assert.deepEqual(
    plan.blockers.map((b) => [b.reason, b.from, b.to]),
    [['payment_status_transition', 'verified', 'recorded']],
  )

  const voided = example()
  engagementOf(voided).payments[0].status = 'voided'
  assert.match(validateManifest(voided).join('\n'), /needs voided_at and void_reason/)
  Object.assign(engagementOf(voided).payments[0], {
    voided_at: '2026-10-20T09:00:00-06:00',
    void_reason: 'Pago duplicado (sintético)',
  })
  const report = await run(store, voided)
  assert.deepEqual(byKey(report)['acme-ejemplo/pago-anticipo'].changed, [
    'status',
    'voidedAt',
    'voidReason',
    'voidedByUserId',
  ])
  assert.equal(store.db.payment_evidence[0].voided_by_user_id, OWNER_ID)
})

test('payments need migration 0017 and a quote key of the same engagement', async () => {
  const store = memoryStore()
  store.columns.payment_evidence = []
  const plan = await planImport(store, example(), { ownerEmail: OWNER })
  assert.ok(plan.blockers.some((b) => b.reason === 'table_missing' && /0017/.test(b.hint)))

  const m = example()
  engagementOf(m).payments[0].quote = 'otra/cotizacion'
  assert.match(validateManifest(m).join('\n'), /quote: not a quote key of this engagement/)
})

// ─── Quote status transitions ──────────────────────────────────────────────

test('quote status moves forward on re-import and never backwards', async () => {
  const draft = example()
  engagementOf(draft).quotes[0].status = 'draft'
  const store = memoryStore()
  await run(store, draft)

  const sent = example()
  engagementOf(sent).quotes[0].status = 'sent'
  const forward = await run(store, sent)
  assert.deepEqual(byKey(forward)['acme-ejemplo/cotizacion-ciclo-1'].changed, ['status'])
  assert.equal(store.db.quotes[0].status, 'sent')

  await run(store, example()) // accepted
  const plan = await planImport(store, draft, { ownerEmail: OWNER })
  assert.deepEqual(
    plan.blockers.map((b) => [b.reason, b.from, b.to]),
    [['quote_status_transition', 'accepted', 'draft']],
  )
})
