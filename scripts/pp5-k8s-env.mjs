#!/usr/bin/env node
/**
 * Read operator env from live Kubernetes secrets (break-glass / local probes).
 *
 * Usage:
 *   node scripts/pp5-k8s-env.mjs --federation-token --base-url https://staging-crm.madfam.io
 *   node scripts/pp5-k8s-env.mjs --export-webhook-env --tier staging
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { STAGING_CRM_BASE_URL } from './staging-base-url.mjs'

const TIERS = {
  staging: {
    namespace: 'phynd-crm-staging',
    secrets: ['phynd-crm-staging-secrets', 'phynd-crm-staging-pilot-overlay'],
  },
  production: {
    namespace: 'phynd-crm',
    secrets: ['phynd-crm-secrets', 'phynd-crm-pilot-overlay', 'phynd-crm-lifecycle-secrets'],
  },
}

const LIFECYCLE_ENV_KEYS = [
  'PORTAL_BASE_URL',
  'JANUA_API_URL',
  'PHYND_ENGAGEMENT_EVENTS_SECRET',
  'DHANAM_WEBHOOK_SECRET',
  'PRAVARA_API_KEY',
  'PRAVARA_BASE_URL',
  'PRAVARA_DISPATCH_URL',
  'SELVA_API_KEY',
  'SELVA_DISPATCH_SECRET',
  'SELVA_API_URL',
  'SELVA_DISPATCH_URL',
  'COTIZA_API_URL',
  'PHYNDCRM_OUTBOUND_SECRET',
]

function exportEnvKeys(secrets, keys) {
  for (const key of keys) {
    const value = secrets.get(key)
    if (!value) continue
    const escaped = value.replace(/'/g, `'\\''`)
    console.log(`export ${key}='${escaped}'`)
  }
}

const WEBHOOK_ENV_KEYS = [
  'COTIZA_WEBHOOK_SECRET',
  'FORJ_WEBHOOK_SECRET',
  'JANUA_TELEMETRY_WEBHOOK_SECRET',
  'JANUA_WEBHOOK_SECRET',
  'TEZCA_WEBHOOK_SECRET',
  'CEQ_WEBHOOK_SECRET',
  'DHANAM_WEBHOOK_SECRET',
  'FORTUNA_WEBHOOK_SECRET',
  'PRAVARA_WEBHOOK_SECRET',
  'KARAFIEL_WEBHOOK_SECRET',
  'PHYND_CRM_EVENTS_SECRET',
  'COFORMA_WEBHOOK_SECRET',
  'PHYND_ENGAGEMENT_EVENTS_SECRET',
  'SELVA_WEBHOOK_SECRET',
  'PHYND_CAMPAIGN_IMPORT_SECRET',
]

export function tierForBaseUrl(baseUrl) {
  const normalized = baseUrl.replace(/\/$/, '')
  if (normalized === STAGING_CRM_BASE_URL || normalized.includes('staging-crm')) {
    return 'staging'
  }
  if (normalized.includes('crm.madfam.io') || normalized.includes('crm.phynd.app')) {
    return 'production'
  }
  return null
}

function kubectlSecretData(namespace, name) {
  const result = spawnSync(
    'kubectl',
    ['get', 'secret', name, '-n', namespace, '-o', 'jsonpath={.data}'],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) {
    return null
  }
  try {
    const raw = JSON.parse(result.stdout || '{}')
    const values = new Map()
    for (const [key, b64] of Object.entries(raw)) {
      values.set(key, Buffer.from(b64, 'base64').toString('utf8'))
    }
    return values
  } catch {
    return null
  }
}

export function readTierSecrets(tier) {
  const config = TIERS[tier]
  if (!config) {
    throw new Error(`Unknown tier: ${tier}`)
  }
  const merged = new Map()
  for (const secretName of config.secrets) {
    const data = kubectlSecretData(config.namespace, secretName)
    if (!data) continue
    for (const [key, value] of data) {
      if (value) merged.set(key, value)
    }
  }
  return merged
}

export function resolveFederationApiToken(env = process.env) {
  const fromEnv = env.FEDERATION_API_TOKEN?.trim()
  if (fromEnv) return fromEnv

  const baseUrl = env.CRM_BASE_URL?.trim()
  const tier = env.PP5_K8S_TIER?.trim() || (baseUrl ? tierForBaseUrl(baseUrl) : null)
  if (!tier) return ''

  const secrets = readTierSecrets(tier)
  return secrets.get('FEDERATION_API_TOKEN')?.trim() ?? ''
}

function parseArgs(argv) {
  const opts = {
    federationToken: false,
    exportWebhookEnv: false,
    exportLifecycleEnv: false,
    tier: null,
    baseUrl: process.env.CRM_BASE_URL?.trim() ?? '',
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--federation-token') {
      opts.federationToken = true
      continue
    }
    if (arg === '--export-webhook-env') {
      opts.exportWebhookEnv = true
      continue
    }
    if (arg === '--export-lifecycle-env') {
      opts.exportLifecycleEnv = true
      continue
    }
    if (arg === '--tier') {
      opts.tier = argv[++i] ?? null
      continue
    }
    if (arg === '--base-url') {
      opts.baseUrl = argv[++i] ?? ''
      continue
    }
    if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/pp5-k8s-env.mjs [--federation-token] [--export-webhook-env] [--export-lifecycle-env] [--tier staging|production] [--base-url URL]`)
      process.exit(0)
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  return opts
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const tier = opts.tier ?? tierForBaseUrl(opts.baseUrl)
  if (!tier) {
    throw new Error('Specify --tier or --base-url (staging-crm / crm.madfam.io)')
  }

  const secrets = readTierSecrets(tier)

  if (opts.federationToken) {
    const token = secrets.get('FEDERATION_API_TOKEN')?.trim()
    if (!token) {
      process.exit(1)
    }
    process.stdout.write(token)
    return
  }

  if (opts.exportWebhookEnv) {
    exportEnvKeys(secrets, WEBHOOK_ENV_KEYS)
    return
  }

  if (opts.exportLifecycleEnv) {
    exportEnvKeys(secrets, LIFECYCLE_ENV_KEYS)
    return
  }

  throw new Error('Pass --federation-token, --export-webhook-env, or --export-lifecycle-env')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
