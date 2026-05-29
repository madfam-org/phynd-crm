#!/usr/bin/env node
/**
 * Sync pilot overlay secrets for keys not yet in Vault (ESO gap workaround).
 *
 * Copies configured keys from the main app secret into a dedicated overlay secret
 * referenced by deployments until Vault backfill completes.
 *
 * Usage:
 *   node scripts/pp5-sync-pilot-overlay.mjs --tier staging
 *   node scripts/pp5-sync-pilot-overlay.mjs --tier production
 *   node scripts/pp5-sync-pilot-overlay.mjs --tier all --dry-run
 */

import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { STAGING_CRM_BASE_URL } from './staging-base-url.mjs'

const TIERS = {
  staging: {
    namespace: 'phynd-crm-staging',
    sourceSecret: 'phynd-crm-staging-secrets',
    overlaySecret: 'phynd-crm-staging-pilot-overlay',
    keys: [
      'SELVA_WEBHOOK_SECRET',
      'PHYND_SELVA_EMBED_ALLOWED',
      'PHYND_CAMPAIGN_IMPORT_SECRET',
      'PHYND_DEPLOYMENT_TIER',
      'FEDERATION_SERVICE_USER_ID',
      'NEXTAUTH_URL',
      'NEXT_PUBLIC_APP_URL',
    ],
    defaults: {
      PHYND_DEPLOYMENT_TIER: 'staging',
      PHYND_SELVA_EMBED_ALLOWED: 'true',
      FEDERATION_SERVICE_USER_ID: 'service:selva',
      NEXTAUTH_URL: STAGING_CRM_BASE_URL,
      NEXT_PUBLIC_APP_URL: STAGING_CRM_BASE_URL,
    },
    generated: ['SELVA_WEBHOOK_SECRET', 'PHYND_CAMPAIGN_IMPORT_SECRET'],
    forceDefaults: ['NEXTAUTH_URL', 'NEXT_PUBLIC_APP_URL'],
  },
  production: {
    namespace: 'phynd-crm',
    sourceSecret: 'phynd-crm-secrets',
    overlaySecret: 'phynd-crm-pilot-overlay',
    keys: [
      'FEDERATION_API_TOKEN',
      'FEDERATION_SERVICE_USER_ID',
      'PHYND_DEPLOYMENT_TIER',
      'NEXTAUTH_URL',
    ],
    defaults: {
      PHYND_DEPLOYMENT_TIER: 'production',
      FEDERATION_SERVICE_USER_ID: 'service:selva',
      NEXTAUTH_URL: 'https://crm.madfam.io',
    },
    generated: ['FEDERATION_API_TOKEN'],
  },
}

function parseArgs(argv) {
  let tier = 'all'
  let dryRun = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') {
      dryRun = true
      continue
    }
    if (arg === '--tier') {
      tier = argv[++i] ?? 'all'
      continue
    }
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/pp5-sync-pilot-overlay.mjs [--tier staging|production|all] [--dry-run]')
      process.exit(0)
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  return { tier, dryRun }
}

function kubectlJson(args) {
  const result = spawnSync('kubectl', [...args, '-o', 'json'], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'kubectl failed').trim())
  }
  return JSON.parse(result.stdout)
}

function decodeData(data) {
  const values = new Map()
  for (const [key, b64] of Object.entries(data ?? {})) {
    values.set(key, Buffer.from(b64, 'base64').toString('utf8'))
  }
  return values
}

function syncTier(config, dryRun) {
  const source = kubectlJson(['get', 'secret', config.sourceSecret, '-n', config.namespace])
  const existing = decodeData(source.data)
  const overlay = new Map()

  for (const key of config.keys) {
    if (config.forceDefaults?.includes(key) && config.defaults[key]) {
      overlay.set(key, config.defaults[key])
      continue
    }
    if (key === 'FEDERATION_API_TOKEN' && process.env.FEDERATION_API_TOKEN?.trim()) {
      overlay.set(key, process.env.FEDERATION_API_TOKEN.trim())
      continue
    }
    if (existing.has(key) && existing.get(key)) {
      overlay.set(key, existing.get(key))
      continue
    }
    if (config.defaults[key]) {
      overlay.set(key, config.defaults[key])
      continue
    }
    if (config.generated.includes(key)) {
      overlay.set(key, randomBytes(16).toString('hex'))
      continue
    }
    throw new Error(`${config.namespace}/${config.sourceSecret} missing overlay key ${key}`)
  }

  const keyList = [...overlay.keys()].sort()
  if (dryRun) {
    console.log(
      `Would sync ${config.overlaySecret} in ${config.namespace} with ${keyList.length} key(s): ${keyList.join(', ')}`,
    )
    return
  }

  const stringData = Object.fromEntries(overlay.entries())
  const manifest = {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: {
      name: config.overlaySecret,
      namespace: config.namespace,
      labels: {
        'app.kubernetes.io/part-of': 'phynd-crm',
        'app.kubernetes.io/component': 'pilot-overlay',
        'phynd.dev/managed-by': 'pp5-sync-pilot-overlay',
      },
    },
    type: 'Opaque',
    stringData,
  }

  const apply = spawnSync('kubectl', ['apply', '-f', '-'], {
    input: JSON.stringify(manifest),
    encoding: 'utf8',
  })
  if (apply.status !== 0) {
    throw new Error((apply.stderr || apply.stdout || 'kubectl apply failed').trim())
  }

  console.log(`Synced ${config.namespace}/${config.overlaySecret} (${keyList.length} keys)`)
}

function main() {
  const { tier, dryRun } = parseArgs(process.argv.slice(2))
  const tiers = tier === 'all' ? Object.entries(TIERS) : TIERS[tier] ? [[tier, TIERS[tier]]] : []

  if (tiers.length === 0) {
    throw new Error(`Unknown tier: ${tier}`)
  }

  for (const [name, config] of tiers) {
    syncTier(config, dryRun)
    if (!dryRun) {
      console.log(`  tier: ${name}`)
    }
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
