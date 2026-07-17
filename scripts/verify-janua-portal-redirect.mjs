#!/usr/bin/env node
/**
 * Verify Janua magic-link redirect host allowlist includes Phynd CRM portal hosts.
 *
 * Uses kubectl exec against janua-api (break-glass). Does not send real magic-link emails.
 *
 * Usage:
 *   node scripts/verify-janua-portal-redirect.mjs
 *   node scripts/verify-janua-portal-redirect.mjs --json
 */

import { spawnSync } from 'node:child_process'
import { PRODUCTION_MADFAM_PORTAL_BASE_URL, REQUIRED_JANUA_PORTAL_VERIFY_ORIGINS } from './verify-janua-oidc-checklist.mjs'

function parseArgs(argv) {
  return { json: argv.includes('--json') }
}

function checkRedirect(url) {
  const py = `from app.core.url_security import is_safe_redirect_url; print('OK' if is_safe_redirect_url(${JSON.stringify(url)}) else 'NO')`
  const result = spawnSync(
    'kubectl',
    ['exec', '-n', 'janua', 'deploy/janua-api', '--', 'python', '-c', py],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) {
    return { url, ok: false, error: (result.stderr || result.stdout || 'kubectl exec failed').trim() }
  }
  const lines = (result.stdout || '').trim().split('\n')
  const last = lines[lines.length - 1]?.trim()
  return { url, ok: last === 'OK' }
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const urls = REQUIRED_JANUA_PORTAL_VERIFY_ORIGINS.map(
    (origin) => `${origin}?engagement=probe&token=probe`,
  )
  const checks = urls.map(checkRedirect)
  const failed = checks.filter((row) => !row.ok)

  const report = {
    ok: failed.length === 0,
    productionPortalBaseUrl: PRODUCTION_MADFAM_PORTAL_BASE_URL,
    checks,
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log('Janua portal magic-link redirect host check')
    for (const row of checks) {
      console.log(row.ok ? `PASS ${row.url}` : `FAIL ${row.url}`)
      if (row.error) console.log(`  ${row.error}`)
    }
    console.log('')
    console.log(report.ok ? 'Janua portal redirect: PASS' : `Janua portal redirect: FAIL (${failed.length})`)
  }

  process.exit(report.ok ? 0 : 1)
}

main()
