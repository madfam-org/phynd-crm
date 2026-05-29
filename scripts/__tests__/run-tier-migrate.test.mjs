import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

test('run-tier-migrate --check-only validates migration artifacts', () => {
  const result = spawnSync(process.execPath, ['scripts/run-tier-migrate.mjs', '--check-only'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /PASS run-tier-migrate --check-only/)
})

test('run-tier-migrate blocks without DATABASE_URL', () => {
  const result = spawnSync(process.execPath, ['scripts/run-tier-migrate.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr + result.stdout, /DATABASE_URL is required/)
})
