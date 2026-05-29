import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

function runScript(args = []) {
  return spawnSync(process.execPath, ['scripts/verify-selva-agent-integration.mjs', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

test('verify-selva-agent-integration dry-run prints planned steps', () => {
  const result = runScript(['--dry-run', '--json'])
  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout.trim())
  assert.equal(payload.ok, true)
  assert.equal(payload.dryRun, true)
  assert.ok(payload.steps.includes('search.search'))
  assert.ok(payload.steps.includes('leads.create (expect FORBIDDEN)'))
})

test('verify-selva-agent-integration fails without token', () => {
  const result = runScript(['--json'])
  assert.notEqual(result.status, 0)
  const payload = JSON.parse(result.stdout.trim())
  assert.equal(payload.ok, false)
  assert.match(payload.error, /FEDERATION_API_TOKEN/)
})
