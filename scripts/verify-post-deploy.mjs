#!/usr/bin/env node
/**
 * Post-deploy smoke for a live Phynd CRM instance (staging or prod).
 *
 * Usage:
 *   CRM_BASE_URL=https://staging-phynd.app node scripts/verify-post-deploy.mjs
 *   CRM_BASE_URL=https://crm.madfam.io node scripts/verify-post-deploy.mjs --with-prod-auth
 *   CRM_BASE_URL=... FEDERATION_API_TOKEN=... node scripts/verify-post-deploy.mjs --with-selva-agent
 *   node scripts/verify-post-deploy.mjs --dry-run
 *   node scripts/verify-post-deploy.mjs --retries 6 --retry-delay-ms 20000
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function parsePostDeployArgs(argv) {
  const options = {
    dryRun: false,
    withProdAuth: false,
    withSelvaAgent: false,
    json: false,
    retries: 1,
    retryDelayMs: 0,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--') {
      continue
    }
    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }
    if (arg === '--with-prod-auth') {
      options.withProdAuth = true
      continue
    }
    if (arg === '--with-selva-agent') {
      options.withSelvaAgent = true
      continue
    }
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '--retries') {
      options.retries = Number(argv[++i] ?? '1')
      continue
    }
    if (arg === '--retry-delay-ms') {
      options.retryDelayMs = Number(argv[++i] ?? '0')
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!Number.isFinite(options.retries) || options.retries < 1) {
    throw new Error('--retries must be a positive integer')
  }
  if (!Number.isFinite(options.retryDelayMs) || options.retryDelayMs < 0) {
    throw new Error('--retry-delay-ms must be a non-negative integer')
  }

  return options
}

export function baseUrlFromHealthUrl(healthUrl) {
  const trimmed = healthUrl.replace(/\/$/, '')
  if (trimmed.endsWith('/api/health')) {
    return trimmed.slice(0, -'/api/health'.length)
  }
  return trimmed
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function checkHealth(baseUrl) {
  const url = `${baseUrl.replace(/\/$/, '')}/api/health`
  let response
  try {
    response = await fetch(url, { redirect: 'follow' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `Network error for ${url}: ${message}` }
  }
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    return { ok: false, error: `HTTP ${response.status}` }
  }
  if (body?.status !== 'ok' || body?.service !== 'phynd-crm') {
    return { ok: false, error: `Unexpected health payload: ${JSON.stringify(body)}` }
  }
  return { ok: true, version: body.version ?? 'unknown' }
}

export async function checkHealthWithRetries(baseUrl, retries, retryDelayMs) {
  let lastError = 'unknown error'
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const result = await checkHealth(baseUrl)
    if (result.ok) {
      return { ...result, attempts: attempt }
    }
    lastError = result.error ?? 'health check failed'
    if (attempt < retries && retryDelayMs > 0) {
      await sleep(retryDelayMs)
    }
  }
  return { ok: false, error: lastError, attempts: retries }
}

function runNode(script, args = []) {
  const result = spawnSync('node', [script, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim()
  return { ok: result.status === 0, output, status: result.status ?? 1 }
}

export async function runPostDeployChecks(options, env = process.env) {
  const baseUrl = (env.CRM_BASE_URL ?? 'https://staging-phynd.app').replace(/\/$/, '')
  const results = []

  if (options.dryRun) {
    return {
      ok: true,
      dryRun: true,
      baseUrl,
      steps: [
        `GET /api/health (retries=${options.retries})`,
        ...(options.withProdAuth ? ['verify-prod-auth-urls --base'] : []),
        ...(options.withSelvaAgent ? ['verify-selva-agent-integration'] : []),
      ],
    }
  }

  const health = await checkHealthWithRetries(baseUrl, options.retries, options.retryDelayMs)
  results.push({ name: 'health', ...health })
  if (!health.ok) {
    return { ok: false, baseUrl, results }
  }

  if (options.withProdAuth) {
    const auth = runNode('scripts/verify-prod-auth-urls.mjs', ['--base', baseUrl])
    results.push({ name: 'prod-auth', ok: auth.ok })
    if (!auth.ok) {
      return { ok: false, baseUrl, results, output: auth.output }
    }
  }

  if (options.withSelvaAgent) {
    const token = env.FEDERATION_API_TOKEN?.trim()
    if (!token) {
      return {
        ok: false,
        baseUrl,
        results,
        error: 'FEDERATION_API_TOKEN required for --with-selva-agent',
      }
    }
    const selva = runNode('scripts/verify-selva-agent-integration.mjs', ['--json'])
    let selvaOk = selva.ok
    try {
      const parsed = JSON.parse(selva.output)
      selvaOk = parsed.ok === true
    } catch {
      selvaOk = false
    }
    results.push({ name: 'selva-agent', ok: selvaOk })
    if (!selvaOk) {
      return { ok: false, baseUrl, results, output: selva.output }
    }
  }

  return { ok: true, baseUrl, version: health.version, results }
}

async function main() {
  let options
  try {
    options = parsePostDeployArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }

  const payload = await runPostDeployChecks(options)

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2))
  } else if (payload.dryRun) {
    console.log('PASS verify-post-deploy (dry-run)')
    console.log(`  baseUrl: ${payload.baseUrl}`)
    for (const step of payload.steps) console.log(`  - ${step}`)
  } else if (payload.ok) {
    console.log('PASS verify-post-deploy')
    console.log(`  baseUrl: ${payload.baseUrl}`)
    console.log(`  health: ok (v${payload.version})`)
    for (const result of payload.results.slice(1)) {
      console.log(`  ${result.name}: ok`)
    }
  } else {
    console.error('FAIL verify-post-deploy')
    if (payload.error) console.error(`  ${payload.error}`)
    const health = payload.results?.find((entry) => entry.name === 'health')
    if (health?.error) console.error(`  health: ${health.error}`)
    if (payload.output) {
      for (const line of payload.output.split('\n').slice(0, 8)) {
        console.error(`  ${line}`)
      }
    }
  }

  if (!payload.ok) process.exit(1)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
