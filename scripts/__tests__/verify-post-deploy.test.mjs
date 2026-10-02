import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import {
  IMAGE_OPTIMIZER_PROBE_PATH,
  baseUrlFromHealthUrl,
  checkHealth,
  checkImageOptimizerDisabled,
  checkHealthWithRetries,
  parsePostDeployArgs,
  runPostDeployChecks,
} from '../verify-post-deploy.mjs'
import { STAGING_CRM_BASE_URL } from '../staging-base-url.mjs'

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
  assert.equal(baseUrlFromHealthUrl(`${STAGING_CRM_BASE_URL}/api/health`), STAGING_CRM_BASE_URL)
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
    const result = await checkHealthWithRetries(STAGING_CRM_BASE_URL, 6, 0)
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
    const result = await checkHealth(STAGING_CRM_BASE_URL)
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

function stubFetch(routes) {
  const seen = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const { pathname } = new URL(url)
    seen.push(pathname)
    const route = routes[pathname]
    if (!route) throw new Error(`unexpected fetch ${url}`)
    return route()
  }
  return { seen, restore: () => (globalThis.fetch = originalFetch) }
}

const healthy = () => Response.json({ status: 'ok', service: 'phynd-crm', version: '0.1.0' })

test('checkImageOptimizerDisabled passes only on 404', async () => {
  for (const [status, ok] of [
    [404, true],
    [400, false],
    [200, false],
    [307, false],
  ]) {
    const stub = stubFetch({ '/_next/image': () => new Response('', { status }) })
    try {
      const result = await checkImageOptimizerDisabled(`${STAGING_CRM_BASE_URL}/`)
      assert.equal(result.ok, ok, `HTTP ${status}`)
      if (!ok) assert.match(result.error ?? '', new RegExp(`HTTP ${status}, expected 404`))
    } finally {
      stub.restore()
    }
  }
})

test('runPostDeployChecks fails when the image optimizer answers', async () => {
  const stub = stubFetch({
    '/api/health': healthy,
    '/_next/image': () => new Response('"url" parameter is valid but upstream response is invalid', { status: 400 }),
  })
  try {
    const payload = await runPostDeployChecks(parsePostDeployArgs([]), {
      CRM_BASE_URL: STAGING_CRM_BASE_URL,
    })
    assert.equal(payload.ok, false)
    const step = payload.results.find((entry) => entry.name === 'image-optimizer-off')
    assert.equal(step?.ok, false)
    assert.deepEqual(stub.seen, ['/api/health', '/_next/image'])
  } finally {
    stub.restore()
  }
})

test('runPostDeployChecks passes with health ok and /_next/image 404', async () => {
  const stub = stubFetch({
    '/api/health': healthy,
    '/_next/image': () => new Response('Not Found', { status: 404 }),
  })
  try {
    const payload = await runPostDeployChecks(parsePostDeployArgs([]), {
      CRM_BASE_URL: STAGING_CRM_BASE_URL,
    })
    assert.equal(payload.ok, true)
    assert.deepEqual(
      payload.results.map((entry) => entry.name),
      ['health', 'image-optimizer-off'],
    )
  } finally {
    stub.restore()
  }
})

test('the image-optimizer probe targets /_next/image with a same-origin url', () => {
  const probe = new URL(IMAGE_OPTIMIZER_PROBE_PATH, STAGING_CRM_BASE_URL)
  assert.equal(probe.pathname, '/_next/image')
  assert.equal(probe.searchParams.get('url'), '/favicon.ico')
})
