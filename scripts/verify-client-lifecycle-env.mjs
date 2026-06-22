#!/usr/bin/env node
/**
 * Client lifecycle env readiness — onboarding → portal → pay → dispatch.
 *
 * Usage:
 *   node scripts/verify-client-lifecycle-env.mjs --file /secure/phynd-crm.env
 *   node scripts/verify-client-lifecycle-env.mjs --json
 */

import fs from 'node:fs'
import { readTierSecrets } from './pp5-k8s-env.mjs'

const REQUIRED_GROUPS = [
  {
    name: 'portal',
    keys: ['PORTAL_BASE_URL', 'JANUA_API_URL'],
  },
  {
    name: 'engagement-seam',
    keys: ['PHYND_ENGAGEMENT_EVENTS_SECRET'],
  },
  {
    name: 'payment',
    keys: ['DHANAM_WEBHOOK_SECRET'],
  },
  {
    name: 'dispatch-pravara',
    anyOf: ['PRAVARA_API_KEY', 'PRAVARA_DISPATCH_SECRET', 'PHYNDCRM_OUTBOUND_SECRET'],
    optionalUrlKeys: ['PRAVARA_BASE_URL', 'PRAVARA_DISPATCH_URL'],
  },
  {
    name: 'dispatch-selva',
    anyOf: ['SELVA_API_KEY', 'SELVA_DISPATCH_SECRET', 'PHYNDCRM_OUTBOUND_SECRET'],
    keys: ['SELVA_API_URL'],
    optionalUrlKeys: ['SELVA_DISPATCH_URL'],
  },
  {
    name: 'cotiza-outbound',
    keys: ['COTIZA_API_URL', 'PHYNDCRM_OUTBOUND_SECRET'],
  },
]

const WARN_IF_SET_IN_PROD = ['AUTH_URL', 'NEXTAUTH_URL']

function parseEnvFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8')
  const values = new Map()
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    values.set(key, value)
  }
  return values
}

function loadValues(options) {
  if (options.fromK8s) return readTierSecrets(options.fromK8s)
  if (options.file) return parseEnvFile(options.file)
  return new Map(Object.entries(process.env).filter(([, value]) => value != null))
}

function parseArgs(argv) {
  let file = null
  let fromK8s = null
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--file' && argv[i + 1]) {
      file = argv[++i]
    }
    if (argv[i] === '--from-k8s' && argv[i + 1]) {
      fromK8s = argv[++i]
    }
  }
  return { file, fromK8s, json: argv.includes('--json') }
}

function evaluateGroup(group, values) {
  const missing = []
  for (const key of group.keys ?? []) {
    if (!values.get(key)?.trim()) missing.push(key)
  }

  if (group.anyOf) {
    const satisfied = group.anyOf.some((key) => Boolean(values.get(key)?.trim()))
    if (!satisfied) missing.push(`one of: ${group.anyOf.join(', ')}`)
  }

  const optionalMissing = (group.optionalUrlKeys ?? []).filter(
    (key) => !values.get(key)?.trim(),
  )

  return {
    name: group.name,
    ok: missing.length === 0,
    missing,
    optionalMissing,
  }
}

function main() {
  const options = parseArgs(process.argv)
  const values = loadValues(options)
  const groups = REQUIRED_GROUPS.map((group) => evaluateGroup(group, values))
  const warnings = WARN_IF_SET_IN_PROD.filter((key) => Boolean(values.get(key)?.trim()))
  const failed = groups.filter((group) => !group.ok)

  const report = {
    ok: failed.length === 0,
    failedGroups: failed.length,
    groups,
    warnings: warnings.map((key) => ({
      key,
      message:
        'Multi-host production should omit AUTH_URL/NEXTAUTH_URL; Auth.js derives origin from Host.',
    })),
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    for (const group of groups) {
      console.log(group.ok ? `PASS ${group.name}` : `FAIL ${group.name}`)
      if (!group.ok) {
        for (const key of group.missing) console.log(`  missing: ${key}`)
      }
      for (const key of group.optionalMissing ?? []) {
        console.log(`  optional unset: ${key}`)
      }
    }
    for (const warning of report.warnings) {
      console.log(`WARN ${warning.key}: ${warning.message}`)
    }
    console.log('')
    console.log(report.ok ? 'Client lifecycle env: PASS' : `Client lifecycle env: FAIL (${failed.length})`)
  }

  process.exit(report.ok ? 0 : 1)
}

main()
