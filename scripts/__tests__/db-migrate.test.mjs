import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  EXIT,
  LOCK_KEY,
  createdObjects,
  exitCodeFor,
  parseArgs,
  planMigrations,
  readMigrations,
  resolveMigrationsDir,
  runDbMigrate,
} from '../db-migrate.mjs'

function migration(tag, when, sqlText) {
  return {
    tag,
    when,
    hash: crypto.createHash('sha256').update(sqlText).digest('hex'),
    statements: sqlText.split('--> statement-breakpoint').filter((s) => s.trim()),
  }
}

const M0 = migration('0000_a', 1000, 'CREATE TABLE "alpha" ("id" text);')
const M1 = migration(
  '0001_b',
  2000,
  'ALTER TABLE "alpha" ADD COLUMN "beta" text;--> statement-breakpoint\nCREATE INDEX "alpha_beta_idx" ON "alpha" ("beta");',
)
const M2 = migration(
  '0002_c',
  3000,
  'CREATE TABLE "gamma" ("id" text);--> statement-breakpoint\nALTER TABLE "gamma" ADD CONSTRAINT "gamma_check" CHECK (true);',
)
const ALL = [M0, M1, M2]
const row = (m) => ({ id: 1, hash: m.hash, created_at: String(m.when) })

test('readMigrations mirrors drizzle: sha256 of the whole file, journal `when`, breakpoints', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'db-migrate-'))
  mkdirSync(path.join(dir, 'meta'))
  const text =
    'CREATE TABLE "x" ("id" text);--> statement-breakpoint\nCREATE INDEX "x_i" ON "x" ("id");'
  writeFileSync(path.join(dir, '0000_x.sql'), text)
  writeFileSync(
    path.join(dir, 'meta/_journal.json'),
    JSON.stringify({ entries: [{ idx: 0, tag: '0000_x', when: 42, breakpoints: true }] }),
  )
  const [m] = readMigrations(dir)
  assert.equal(m.tag, '0000_x')
  assert.equal(m.when, 42)
  assert.equal(m.hash, crypto.createHash('sha256').update(text).digest('hex'))
  assert.equal(m.statements.length, 2)
})

test('the repo journal and files are readable and strictly ordered', () => {
  const migrations = readMigrations(resolveMigrationsDir())
  assert.ok(migrations.length >= 15)
  for (let i = 1; i < migrations.length; i++) {
    assert.ok(migrations[i].when > migrations[i - 1].when, migrations[i].tag)
  }
})

test('createdObjects finds the tables, columns, indexes and constraints a migration creates', () => {
  assert.deepEqual(createdObjects([...M1.statements, ...M2.statements]), [
    { kind: 'column', table: 'alpha', name: 'beta' },
    { kind: 'index', name: 'alpha_beta_idx' },
    { kind: 'table', name: 'gamma' },
    { kind: 'constraint', name: 'gamma_check' },
  ])
})

test('planMigrations: pending is everything newer than the last applied row', () => {
  const plan = planMigrations(ALL, [row(M0)])
  assert.deepEqual(plan.applied, ['0000_a'])
  assert.deepEqual(plan.pending, ['0001_b', '0002_c'])
  assert.deepEqual(plan.blockers, [])
})

test('planMigrations: no migrations table means everything is pending', () => {
  const plan = planMigrations(ALL, null)
  assert.equal(plan.migrationsTable, 'absent')
  assert.deepEqual(plan.pending, ['0000_a', '0001_b', '0002_c'])
})

test('planMigrations blocks on changed files, unknown rows and skipped migrations', () => {
  const changed = planMigrations(ALL, [{ ...row(M0), hash: 'deadbeef' }])
  assert.deepEqual(changed.blockers, [{ reason: 'applied_file_changed', tag: '0000_a' }])

  const unknown = planMigrations(ALL, [row(M0), { id: 9, hash: 'x', created_at: '1500' }])
  assert.deepEqual(unknown.blockers, [{ reason: 'applied_unknown_to_journal', created_at: 1500 }])

  const skipped = planMigrations(ALL, [row(M0), row(M2)])
  assert.deepEqual(skipped.blockers, [{ reason: 'skipped_by_newer_applied', tag: '0001_b' }])
})

test('planMigrations blocks when a pending migration would create an existing object', () => {
  const plan = planMigrations(ALL, [row(M0)], (obj) => obj.kind === 'table' && obj.name === 'gamma')
  assert.deepEqual(plan.blockers, [
    { reason: 'schema_drift', tag: '0002_c', object: { kind: 'table', name: 'gamma' } },
  ])
})

/** Minimal stand-in for the `postgres` client used by runDbMigrate. */
function fakeSql({ applied = null, existing = [] } = {}) {
  const log = { modes: [], unsafe: [], inserts: [], locks: [] }
  const tx = async (strings, ...values) => {
    const q = strings.join('?')
    if (q.includes('show transaction_read_only')) return [{ transaction_read_only: 'on' }]
    if (q.includes("to_regclass('drizzle.__drizzle_migrations')"))
      return [{ present: applied !== null }]
    if (q.includes('from drizzle.__drizzle_migrations')) return applied ?? []
    if (q.includes('pg_advisory_xact_lock')) {
      log.locks.push(values[0])
      return []
    }
    if (q.includes('insert into drizzle.__drizzle_migrations')) {
      log.inserts.push(values)
      return []
    }
    if (q.includes('to_regclass(')) return existing.includes(values[0]) ? [{}] : []
    return []
  }
  tx.unsafe = async (text) => {
    log.unsafe.push(text)
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

test('dry-run is read-only and writes nothing', async () => {
  const sql = fakeSql({ applied: [row(M0)] })
  const report = await runDbMigrate(sql, { migrations: ALL, apply: false })
  assert.deepEqual(sql.log.modes, ['read only'])
  assert.equal(sql.log.unsafe.length, 0)
  assert.equal(sql.log.inserts.length, 0)
  assert.equal(report.pending_count, 2)
  assert.equal(exitCodeFor(report, { failOnPending: false }), EXIT.ok)
  assert.equal(exitCodeFor(report, { failOnPending: true }), EXIT.pending)
})

test('--apply locks, applies pending statements in order and records drizzle rows', async () => {
  const sql = fakeSql({ applied: [row(M0)] })
  const report = await runDbMigrate(sql, { migrations: ALL, apply: true })
  assert.deepEqual(sql.log.modes, ['read write'])
  assert.deepEqual(sql.log.locks, [LOCK_KEY])
  const statements = sql.log.unsafe.filter((s) => !s.startsWith('set local'))
  assert.deepEqual(statements, [...M1.statements, ...M2.statements])
  assert.deepEqual(sql.log.inserts, [
    [M1.hash, M1.when],
    [M2.hash, M2.when],
  ])
  assert.deepEqual(report.applied_now, ['0001_b', '0002_c'])
  assert.equal(report.pending_count, 0)
  assert.equal(report.last_applied, '0002_c')
})

test('--apply on an up-to-date database is a no-op', async () => {
  const sql = fakeSql({ applied: ALL.map(row) })
  const report = await runDbMigrate(sql, { migrations: ALL, apply: true })
  assert.deepEqual(report.applied_now, [])
  assert.equal(sql.log.inserts.length, 0)
})

test('--apply refuses on schema drift and writes nothing', async () => {
  const sql = fakeSql({ applied: [row(M0)], existing: ['public."gamma"'] })
  const report = await runDbMigrate(sql, { migrations: ALL, apply: true })
  assert.equal(report.mode, 'apply-refused')
  assert.equal(exitCodeFor(report, { failOnPending: false }), EXIT.blocked)
  assert.equal(sql.log.inserts.length, 0)
  assert.deepEqual(
    sql.log.unsafe.filter((s) => !s.startsWith('set local')),
    [],
  )
})

test('parseArgs: dry-run by default; validates env name and lock timeout', () => {
  assert.deepEqual(parseArgs([]), {
    apply: false,
    json: false,
    failOnPending: false,
    databaseEnv: 'DATABASE_URL',
    migrationsDir: null,
    lockTimeout: '10s',
  })
  assert.equal(parseArgs(['-', '--apply']).apply, true)
  assert.throws(() => parseArgs(['--database-env', 'x;y']), /env var name/)
  assert.throws(() => parseArgs(['--lock-timeout', "1s'; drop"]), /lock-timeout/)
  assert.throws(() => parseArgs(['--apply', '--fail-on-pending']), /dry-run option/)
  assert.throws(() => parseArgs(['--force']), /unknown argument/)
})

test('the script refuses to run without a database URL', () => {
  const res = spawnSync(process.execPath, ['scripts/db-migrate.mjs'], {
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  })
  assert.equal(res.status, EXIT.usage)
  assert.match(res.stderr, /DATABASE_URL is required/)
})

test('production runs the script as an Argo CD PreSync hook from the worker image', () => {
  const job = readFileSync('infra/k8s/production/db-migrate-job.yaml', 'utf8')
  const kustomization = readFileSync('infra/k8s/production/kustomization.yaml', 'utf8')
  assert.match(kustomization, /^- db-migrate-job\.yaml$/m)
  assert.match(job, /argocd\.argoproj\.io\/hook: PreSync/)
  assert.match(job, /image: ghcr\.io\/madfam-org\/phynd-crm\/worker/)
  assert.match(job, /node scripts\/db-migrate\.mjs --apply/)
  assert.match(job, /backoffLimit: 0/)
  const dockerfile = readFileSync('docker/Dockerfile.worker', 'utf8')
  assert.match(dockerfile, /cp scripts\/db-migrate\.mjs \/deploy\/scripts\/db-migrate\.mjs/)
})

test('staging runs the same hook against the staging secret', () => {
  const job = readFileSync('infra/k8s/overlays/staging/db-migrate-job.yaml', 'utf8')
  const kustomization = readFileSync('infra/k8s/overlays/staging/kustomization.yaml', 'utf8')
  assert.match(kustomization, /^- db-migrate-job\.yaml$/m)
  assert.match(job, /argocd\.argoproj\.io\/hook: PreSync/)
  assert.match(job, /namespace: phynd-crm-staging$/m)
  assert.match(job, /name: phynd-crm-staging-secrets$/m)
  assert.doesNotMatch(job, /name: phynd-crm-secrets$/m)
})
