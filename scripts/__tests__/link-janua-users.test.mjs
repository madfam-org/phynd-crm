import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

import {
  isValidJanuaSub,
  parseArgs,
  planLinks,
  runLinkJanuaUsers,
  shortId,
  summarizeReport,
} from '../link-janua-users.mjs'

const SUB_A = '5b0f2c1e-7a7d-4c1e-9d55-2f3b8f6a9c01'
const SUB_B = '0d6f9e2a-1111-4b2c-8c3d-000000000002'
const users = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000001', external_janua_id: null },
  { id: 'bbbbbbbb-0000-4000-8000-000000000002', external_janua_id: SUB_B },
  { id: 'cccccccc-0000-4000-8000-000000000003', external_janua_id: null },
]

test('isValidJanuaSub accepts Janua ids and rejects principals and junk', () => {
  assert.equal(isValidJanuaSub(SUB_A), true)
  for (const bad of ['service:selva', 'system', 'dev-user', 'demo-x', '', 'a b', 'x'.repeat(256)]) {
    assert.equal(isValidJanuaSub(bad), false, bad)
  }
})

test('planLinks writes free pairs, skips links in place and rejects unknown users', () => {
  const plan = planLinks(users, {
    [users[0].id]: ` ${SUB_A} `,
    [users[1].id]: SUB_B, // already in place
    'dddddddd-missing': '9a1c7d1e-0000-4000-8000-000000000009',
  })
  assert.deepEqual(plan.writes, [{ userId: users[0].id, januaSub: SUB_A }])
  assert.deepEqual(plan.alreadyLinked, [{ userId: users[1].id }])
  assert.deepEqual(plan.rejected, [{ userId: 'dddddddd-missing', reason: 'unknown_user' }])
})

test('planLinks rejects a subject already held by another user', () => {
  const plan = planLinks(users, { [users[2].id]: SUB_B })
  assert.deepEqual(plan.rejected, [{ userId: users[2].id, reason: 'subject_taken' }])
  assert.equal(plan.writes.length, 0)
})

test('planLinks rejects a user linked elsewhere, duplicate and invalid subjects', () => {
  const linkedElsewhere = planLinks(users, { [users[1].id]: SUB_A })
  assert.equal(linkedElsewhere.rejected[0].reason, 'user_linked_elsewhere')

  const dup = planLinks(users, { [users[0].id]: SUB_A, [users[2].id]: `${SUB_A} ` })
  assert.deepEqual(
    dup.rejected.map((r) => r.reason),
    ['duplicate_subject', 'duplicate_subject'],
  )

  const invalid = planLinks(users, { [users[0].id]: 'service:selva' })
  assert.equal(invalid.rejected[0].reason, 'invalid_subject')
})

test('the report holds counts and short ids only, never Janua subjects', () => {
  const plan = planLinks(users, { [users[0].id]: SUB_A, [users[2].id]: SUB_B })
  const report = summarizeReport({ users, plan, applied: 0, mode: 'dry-run' })
  const text = JSON.stringify(report)
  assert.equal(report.users_unlinked, 2)
  assert.deepEqual(report.unlinked_short_ids, [shortId(users[0].id), shortId(users[2].id)])
  assert.equal(report.links_valid, 1)
  assert.equal(report.links_rejected.subject_taken.count, 1)
  assert.ok(!text.includes(SUB_A) && !text.includes(SUB_B))
  assert.ok(!text.includes(users[0].id))
})

test('parseArgs: dry-run by default, --apply needs links, links must be a string map', () => {
  assert.deepEqual(parseArgs([]), {
    json: false,
    apply: false,
    databaseEnv: 'DATABASE_URL',
    links: null,
  })
  assert.throws(() => parseArgs(['--apply']), /--apply needs/)
  assert.throws(() => parseArgs(['--links-json', '["x"]']), /JSON object/)
  assert.deepEqual(parseArgs(['-', '--links-json', `{"u":"${SUB_A}"}`, '--apply']).links, {
    u: SUB_A,
  })
})

/** Minimal stand-in for the `postgres` tagged-template client. */
function fakeSql(rows) {
  const log = { modes: [], updates: [] }
  const tx = async (strings, ...values) => {
    const q = strings.join('?')
    if (q.includes('show transaction_read_only')) return [{ transaction_read_only: 'on' }]
    if (q.includes('select id, external_janua_id')) return rows
    if (q.includes('update users')) {
      log.updates.push(values)
      return [{ id: values[1] }]
    }
    return []
  }
  return {
    log,
    begin: async (modeOrFn, maybeFn) => {
      const fn = typeof modeOrFn === 'function' ? modeOrFn : maybeFn
      log.modes.push(typeof modeOrFn === 'string' ? modeOrFn : 'read write')
      return fn(tx)
    },
  }
}

test('dry-run runs read-only and writes nothing', async () => {
  const sql = fakeSql(users)
  const report = await runLinkJanuaUsers(sql, { links: { [users[0].id]: SUB_A }, apply: false })
  assert.deepEqual(sql.log.modes, ['read only'])
  assert.equal(sql.log.updates.length, 0)
  assert.equal(report.links_valid, 1)
  assert.equal(report.links_written, 0)
})

test('--apply writes valid links in one transaction', async () => {
  const sql = fakeSql(users)
  const report = await runLinkJanuaUsers(sql, { links: { [users[0].id]: SUB_A }, apply: true })
  assert.deepEqual(sql.log.modes, ['read write'])
  assert.deepEqual(sql.log.updates, [[SUB_A, users[0].id]])
  assert.equal(report.links_written, 1)
})

test('--apply is all-or-nothing when any link is invalid', async () => {
  const sql = fakeSql(users)
  const report = await runLinkJanuaUsers(sql, {
    links: { [users[0].id]: SUB_A, [users[2].id]: SUB_B },
    apply: true,
  })
  assert.equal(sql.log.updates.length, 0)
  assert.equal(report.aborted_invalid_links, true)
})

test('the script refuses to run without a database URL', () => {
  const res = spawnSync(process.execPath, ['scripts/link-janua-users.mjs'], {
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  })
  assert.equal(res.status, 2)
  assert.match(res.stderr, /DATABASE_URL is required/)
})
