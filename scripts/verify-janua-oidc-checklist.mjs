#!/usr/bin/env node
/**
 * Phase 0 Janua OIDC prep — canonical redirect URIs for Phynd CRM.
 *
 * Janua admins must register these callback URLs on the Phynd OIDC client.
 * This script does not call Janua; it prints the contract and optionally
 * verifies live Auth.js provider URLs via verify-prod-auth-urls.
 *
 * Usage:
 *   node scripts/verify-janua-oidc-checklist.mjs
 *   node scripts/verify-janua-oidc-checklist.mjs --json
 *   node scripts/verify-janua-oidc-checklist.mjs --verify-live
 */

import { spawnSync } from 'node:child_process'
import { STAGING_CRM_BASE_URL } from './staging-base-url.mjs'

export const JANUA_OIDC_CALLBACK_PATH = '/api/auth/callback/janua'

export const REQUIRED_JANUA_REDIRECT_URIS = [
  'https://crm.madfam.io/api/auth/callback/janua',
  'https://crm.phynd.app/api/auth/callback/janua',
  `${STAGING_CRM_BASE_URL}/api/auth/callback/janua`,
]

export const LIVE_AUTH_BASES = [
  'https://crm.madfam.io',
  'https://crm.phynd.app',
  STAGING_CRM_BASE_URL,
]

export const JANUA_ADMIN_REQUIREMENTS = [
  'Register all REQUIRED_JANUA_REDIRECT_URIS on the Phynd CRM OIDC client in Janua',
  'Confirm admin@madfam.io has admin role/claims accepted by Phynd middleware',
  'Use distinct Janua staging issuer (AUTH_JANUA_ISSUER) for staging CRM host',
  'Never share production Janua client secret with staging',
]

function parseArgs(argv) {
  return {
    json: argv.includes('--json'),
    verifyLive: argv.includes('--verify-live'),
  }
}

function runVerifyProdAuth(base) {
  const result = spawnSync('node', ['scripts/verify-prod-auth-urls.mjs', '--base', base], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  })
  return {
    base,
    ok: result.status === 0,
    output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
  }
}

export function buildJanuaOidcChecklist(options = {}) {
  const liveChecks = []
  if (options.verifyLive) {
    for (const base of LIVE_AUTH_BASES) {
      liveChecks.push(runVerifyProdAuth(base))
    }
  }

  const failedLive = liveChecks.filter((check) => !check.ok).length

  return {
    ok: failedLive === 0,
    callbackPath: JANUA_OIDC_CALLBACK_PATH,
    requiredRedirectUris: REQUIRED_JANUA_REDIRECT_URIS,
    adminRequirements: JANUA_ADMIN_REQUIREMENTS,
    liveChecks,
    failedLive,
    encliiGap:
      'Live staging host is staging-crm.madfam.io (tunnel wired); staging-phynd.app alias not provisioned',
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = buildJanuaOidcChecklist(options)

  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log('Janua OIDC checklist (Phase 0)')
    console.log('')
    console.log('Register these redirect URIs on the Phynd CRM Janua OIDC client:')
    for (const uri of report.requiredRedirectUris) {
      console.log(`  - ${uri}`)
    }
    console.log('')
    console.log('Janua admin requirements:')
    for (const item of report.adminRequirements) {
      console.log(`  - ${item}`)
    }
    console.log('')
    console.log(`Enclii: ${report.encliiGap}`)
    if (options.verifyLive) {
      console.log('')
      for (const check of report.liveChecks) {
        console.log(check.ok ? `PASS live auth ${check.base}` : `FAIL live auth ${check.base}`)
        if (!check.ok && check.output) {
          for (const line of check.output.split('\n').slice(0, 4)) {
            console.log(`  ${line}`)
          }
        }
      }
    } else {
      console.log('')
      console.log('Live Auth.js probe: node scripts/verify-janua-oidc-checklist.mjs --verify-live')
    }
  }

  if (!report.ok) process.exit(1)
}

import path from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main()
}
