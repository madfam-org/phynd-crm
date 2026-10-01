import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

import {
  TARGETS,
  classifyActor,
  summarize,
  targetLabel,
  valueExpression,
} from '../audit-session-user-ids.mjs'

const known = {
  januaSubjects: new Set(['janua-sub-a']),
  crmUserIds: new Set(['crm-user-1']),
}

test('classifyActor buckets service, demo, Janua, CRM and unmatched ids', () => {
  assert.equal(classifyActor('service:selva', known), 'service_or_system')
  assert.equal(classifyActor('system', known), 'service_or_system')
  assert.equal(classifyActor('dev-user', known), 'service_or_system')
  assert.equal(classifyActor('ops@example.com (via service:selva)', known), 'service_or_system')
  assert.equal(classifyActor('demo-abc123', known), 'demo')
  assert.equal(classifyActor('janua-sub-a', known), 'janua_subject')
  assert.equal(classifyActor('crm-user-1', known), 'crm_user_id')
  assert.equal(classifyActor('3f2b9c1e-0000-4000-8000-000000000000', known), 'unmatched')
})

test('summarize reports counts and date range only, never the values', () => {
  const report = summarize(
    [
      {
        value: 'janua-sub-a',
        rows: 4,
        first_at: '2026-08-01T00:00:00Z',
        last_at: '2026-09-01T00:00:00Z',
      },
      {
        value: 'random-1',
        rows: 1,
        first_at: '2026-08-10T00:00:00Z',
        last_at: '2026-08-10T00:00:00Z',
      },
      {
        value: 'random-2',
        rows: 2,
        first_at: '2026-07-05T00:00:00Z',
        last_at: '2026-09-20T00:00:00Z',
      },
    ],
    known,
  )
  assert.deepEqual(report.unmatched, {
    rows: 3,
    distinct_values: 2,
    first_at: '2026-07-05T00:00:00.000Z',
    last_at: '2026-09-20T00:00:00.000Z',
  })
  assert.equal(report.janua_subject.rows, 4)
  assert.equal(report.crm_user_id.rows, 0)
  assert.doesNotMatch(JSON.stringify(report), /random-1|random-2|janua-sub-a/)
})

test('valueExpression reads columns and nested jsonb keys', () => {
  assert.equal(valueExpression({ table: 'notes', column: 'author_id' }), 't."author_id"::text')
  assert.equal(
    valueExpression({
      table: 'engagement_events',
      column: 'metadata',
      path: ['resolution', 'resolved_by'],
    }),
    `(t."metadata"->'resolution'->>'resolved_by')`,
  )
  assert.throws(
    () => valueExpression({ table: 'x; drop table users', column: 'a' }),
    /unsafe identifier/,
  )
})

test('targets cover the columns the services write the session user id into', () => {
  const labels = TARGETS.map(targetLabel)
  for (const expected of [
    'activities.owner_id',
    'notifications.user_id',
    'notes.author_id',
    'referral_codes.owner_janua_id',
    'campaign_authorizations.decided_by',
    'engagement_events.metadata->published_by',
  ]) {
    assert.ok(labels.includes(expected), `missing target ${expected}`)
  }
})

test('the script refuses to run without a database URL', () => {
  const result = spawnSync(process.execPath, ['scripts/audit-session-user-ids.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /DATABASE_URL is required/)
})
