#!/usr/bin/env node
/**
 * WS0 post-deploy check: Auth.js provider URLs must use public hosts, not pod names.
 *
 * Usage:
 *   node scripts/verify-prod-auth-urls.mjs
 *   node scripts/verify-prod-auth-urls.mjs --base https://crm.madfam.io
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const INTERNAL_HOST_RE = /phynd-crm-web|\.svc\.|:\d{4,5}\//i

/** @param {string} base */
/** @param {{ signinUrl?: string, callbackUrl?: string }} janua */
export function validateJanuaProviderUrls(base, janua) {
  if (!janua?.signinUrl && !janua?.callbackUrl) {
    return { ok: false, error: 'Missing janua provider in response' }
  }

  const urls = [janua.signinUrl, janua.callbackUrl].filter(Boolean)
  const leaking = urls.filter((u) => INTERNAL_HOST_RE.test(String(u)))

  if (leaking.length > 0) {
    return {
      ok: false,
      error: `Internal host leaked in provider URLs: ${leaking.join(', ')}`,
    }
  }

  const baseHostname = new URL(base).hostname
  if (janua.callbackUrl) {
    let callbackHostname
    try {
      callbackHostname = new URL(janua.callbackUrl).hostname
    } catch {
      return { ok: false, error: `Invalid callbackUrl: ${janua.callbackUrl}` }
    }
    if (callbackHostname !== baseHostname) {
      return {
        ok: false,
        error: `Callback host mismatch: expected ${baseHostname}, got ${callbackHostname}`,
      }
    }
  }

  if (janua.signinUrl && !String(janua.signinUrl).startsWith('https://')) {
    return { ok: false, error: 'signinUrl must use https' }
  }

  return { ok: true, signinUrl: janua.signinUrl, callbackUrl: janua.callbackUrl }
}

const DEFAULT_BASES = ['https://phynd.app', 'https://crm.madfam.io', 'https://crm.phynd.app']

function parseArgs(argv) {
  const bases = []
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--base' && argv[i + 1]) {
      bases.push(argv[++i].replace(/\/$/, ''))
    }
  }
  return bases.length > 0 ? bases : DEFAULT_BASES
}

async function checkBase(base) {
  const url = `${base}/api/auth/providers`
  const res = await fetch(url, { redirect: 'follow' })
  const body = await res.text()

  let json
  try {
    json = JSON.parse(body)
  } catch {
    return { base, ok: false, error: `Non-JSON response (${res.status})` }
  }

  const result = validateJanuaProviderUrls(base, json?.janua)
  if (!result.ok) {
    return { base, ok: false, error: result.error }
  }

  return { base, ok: true, signinUrl: result.signinUrl, callbackUrl: result.callbackUrl }
}

async function main() {
  const bases = parseArgs(process.argv)
  let failed = 0

  for (const base of bases) {
    try {
      const result = await checkBase(base)
      if (result.ok) {
        console.log(`PASS ${base} signin=${result.signinUrl}`)
      } else {
        failed++
        console.error(`FAIL ${base}: ${result.error}`)
      }
    } catch (err) {
      failed++
      console.error(`FAIL ${base}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  process.exit(failed > 0 ? 1 : 0)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main()
}
