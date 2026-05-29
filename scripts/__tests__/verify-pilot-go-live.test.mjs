import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

function runScript(args = []) {
  return spawnSync(process.execPath, ['scripts/verify-pilot-go-live.mjs', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

const EXPECTED_CHECKS = [
  'pp5-stability',
  'verify-migrations',
  'pp5-staging-audit',
  'verify-pilot-readiness',
  'verify-post-deploy-dry-run',
]

test('verify-pilot-go-live passes static pre-flight checks', () => {
  const result = runScript(['--skip-prod-auth', '--json'])
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const payload = JSON.parse(result.stdout.trim())
  assert.equal(payload.ok, true)
  for (const name of EXPECTED_CHECKS) {
    const check = payload.checks.find((entry) => entry.name === name)
    assert.ok(check, `missing check: ${name}`)
    assert.equal(check.ok, true, `${name} failed`)
  }
})
