#!/usr/bin/env node
/**
 * WS0 post-deploy check: Auth.js provider URLs must use public hosts, not pod names.
 *
 * Usage:
 *   node scripts/verify-prod-auth-urls.mjs
 *   node scripts/verify-prod-auth-urls.mjs --base https://crm.madfam.io
 */

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

const INTERNAL_HOST_RE = /phynd-crm-web|\.svc\.|:\d{4,5}\//i

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

  const janua = json?.janua
  if (!janua) {
    return { base, ok: false, error: 'Missing janua provider in response' }
  }

  const urls = [janua.signinUrl, janua.callbackUrl].filter(Boolean)
  const leaking = urls.filter((u) => INTERNAL_HOST_RE.test(String(u)))

  if (leaking.length > 0) {
    return {
      base,
      ok: false,
      error: `Internal host leaked in provider URLs: ${leaking.join(', ')}`,
    }
  }

  return { base, ok: true, signinUrl: janua.signinUrl }
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

main()
