import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import {
  baseUrlFromHealthUrl,
  checkHealth,
  checkHealthWithRetries,
  parsePostDeployArgs,
  runPostDeployChecks,
} from '../verify-post-deploy.mjs'

function runScript(args = []) {
  return spawnSync(process.execPath, ['scripts/verify-post-deploy.mjs', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

test('parsePostDeployArgs accepts retry flags', () => {
  const options = parsePostDeployArgs(['--retries', '6', '--retry-delay-ms', '20000'])
  assert.equal(options.retries, 6)
  assert.equal(options.retryDelayMs, 20000)
})

test('parsePostDeployArgs ignores pnpm separator --', () => {
  const options = parsePostDeployArgs(['--', '--dry-run', '--retries', '3'])
  assert.equal(options.dryRun, true)
  assert.equal(options.retries, 3)
})

test('baseUrlFromHealthUrl strips /api/health suffix', () => {
  assert.equal(baseUrlFromHealthUrl('https://staging-phynd.app/api/health'), 'https://staging-phynd.app')
})

test('checkHealthWithRetries succeeds after transient failures', async () => {
  let calls = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    calls += 1
    if (calls < 3) {
      return new Response('{}', { status: 503 })
    }
    return Response.json({ status: 'ok', service: 'phynd-crm', version: '0.1.0' })
  }

  try {
    const result = await checkHealthWithRetries('https://staging-phynd.app', 6, 0)
    assert.equal(result.ok, true)
    assert.equal(result.attempts, 3)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('checkHealth surfaces network errors', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed')
  }

  try {
    const result = await checkHealth('https://staging-phynd.app')
    assert.equal(result.ok, false)
    assert.match(result.error ?? '', /Network error/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('verify-post-deploy dry-run lists health and optional steps', () => {
  const result = runScript(['--dry-run', '--with-prod-auth', '--json'])
  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout.trim())
  assert.equal(payload.ok, true)
  assert.equal(payload.dryRun, true)
  assert.ok(payload.steps.some((step) => step.includes('GET /api/health')))
})

test('runPostDeployChecks dry-run does not require network', async () => {
  const payload = await runPostDeployChecks(
    parsePostDeployArgs(['--dry-run', '--retries', '6']),
    { CRM_BASE_URL: 'https://crm.madfam.io' },
  )
  assert.equal(payload.ok, true)
  assert.equal(payload.baseUrl, 'https://crm.madfam.io')
})
