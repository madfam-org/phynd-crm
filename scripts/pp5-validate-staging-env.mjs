#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_NAMESPACE = 'phynd-crm-staging'
const DEFAULT_SECRET_NAME = 'phynd-crm-staging-secrets'
const TEMPLATE_PATH = 'infra/k8s/staging-secrets-template.yaml'
const PRODUCTION_TEMPLATE_PATH = 'infra/k8s/production/secrets-template.yaml'
const STAGING_APP_URL = 'https://staging-phynd.app'

const REQUIRED_NON_EMPTY = new Set([
  'DATABASE_URL',
  'REDIS_URL',
  'AUTH_SECRET',
  'AUTH_JANUA_ISSUER',
  'AUTH_JANUA_CLIENT_ID',
  'AUTH_JANUA_CLIENT_SECRET',
  'JANUA_API_URL',
  'JANUA_TELEMETRY_API_URL',
  'DHANAM_API_URL',
  'COTIZA_API_URL',
  'PRAVARA_BASE_URL',
  'SELVA_API_URL',
  'FORJ_API_URL',
  'TEZCA_API_URL',
  'TEZCA_PUBLIC_URL',
  'PRAVARA_API_KEY',
  'JANUA_WEBHOOK_SECRET',
  'DHANAM_WEBHOOK_SECRET',
  'COTIZA_WEBHOOK_SECRET',
  'PRAVARA_WEBHOOK_SECRET',
  'FORJ_WEBHOOK_SECRET',
  'TEZCA_WEBHOOK_SECRET',
  'FORTUNA_WEBHOOK_SECRET',
  'JANUA_TELEMETRY_WEBHOOK_SECRET',
  'PHYND_CRM_EVENTS_SECRET',
  'COFORMA_WEBHOOK_SECRET',
  'CEQ_WEBHOOK_SECRET',
  'PHYND_ENGAGEMENT_EVENTS_SECRET',
  'PHYND_CAMPAIGN_IMPORT_SECRET',
  'SELVA_WEBHOOK_SECRET',
  'PHYND_DEPLOYMENT_TIER',
  'FEDERATION_SERVICE_USER_ID',
  'PHYNDCRM_OUTBOUND_SECRET',
  'KARAFIEL_WEBHOOK_SECRET',
  'KARAFIEL_API_URL',
  'KARAFIEL_API_KEY',
  'NEXT_PUBLIC_APP_URL',
  'PORTAL_BASE_URL',
  'NODE_ENV',
  'NEXTAUTH_URL',
  'WORKER_HEALTH_PORT',
  'PHYND_CRM_PROBE_TOKEN',
  'FEDERATION_API_TOKEN',
  'RESEND_API_KEY',
  'EMAIL_ALLOWLIST_DOMAINS',
])

const SECRET_MIN_LENGTH = new Map([
  ['AUTH_SECRET', 32],
  ['JANUA_WEBHOOK_SECRET', 32],
  ['DHANAM_WEBHOOK_SECRET', 32],
  ['COTIZA_WEBHOOK_SECRET', 32],
  ['PRAVARA_WEBHOOK_SECRET', 32],
  ['FORJ_WEBHOOK_SECRET', 32],
  ['TEZCA_WEBHOOK_SECRET', 32],
  ['FORTUNA_WEBHOOK_SECRET', 32],
  ['JANUA_TELEMETRY_WEBHOOK_SECRET', 32],
  ['PHYND_CRM_EVENTS_SECRET', 32],
  ['COFORMA_WEBHOOK_SECRET', 32],
  ['CEQ_WEBHOOK_SECRET', 32],
  ['PHYND_ENGAGEMENT_EVENTS_SECRET', 32],
  ['PHYND_CAMPAIGN_IMPORT_SECRET', 32],
  ['SELVA_WEBHOOK_SECRET', 32],
  ['PHYNDCRM_OUTBOUND_SECRET', 32],
  ['KARAFIEL_WEBHOOK_SECRET', 32],
  ['PRAVARA_DISPATCH_SECRET', 32],
  ['SELVA_DISPATCH_SECRET', 32],
  ['PHYND_CRM_PROBE_TOKEN', 32],
  ['FEDERATION_API_TOKEN', 48],
])

const STAGING_API_URL_KEYS = [
  'JANUA_API_URL',
  'JANUA_TELEMETRY_API_URL',
  'DHANAM_API_URL',
  'COTIZA_API_URL',
  'PRAVARA_BASE_URL',
  'SELVA_API_URL',
  'FORJ_API_URL',
  'TEZCA_API_URL',
  'TEZCA_PUBLIC_URL',
  'KARAFIEL_API_URL',
]

function usage(message) {
  if (message) console.error(`ERROR: ${message}`)
  console.error(`
Usage:
  node scripts/pp5-validate-staging-env.mjs /secure/path/phynd-crm-staging.env
  node scripts/pp5-validate-staging-env.mjs /secure/path/phynd-crm-staging.env --print-apply-command

This validates that the env file is safe to install as ${DEFAULT_SECRET_NAME}.
It never prints secret values.
`)
  process.exit(message ? 1 : 0)
}

function parseArgs(argv) {
  const opts = { envPath: null, printApplyCommand: false }

  for (const arg of argv) {
    if (arg === '--print-apply-command') {
      opts.printApplyCommand = true
      continue
    }
    if (arg.startsWith('-')) usage(`Unknown option: ${arg}`)
    if (opts.envPath) usage('Only one env file path is accepted')
    opts.envPath = arg
  }

  if (!opts.envPath) usage('Missing env file path')
  return opts
}

function readTemplateKeys() {
  const text = fs.readFileSync(path.join(process.cwd(), TEMPLATE_PATH), 'utf8')
  const keys = []
  const regex = /^\s{2}([A-Z][A-Z0-9_]*):\s*"[^"]*"/gm
  for (const match of text.matchAll(regex)) keys.push(match[1])
  return keys
}

function readTemplateValues(templatePath) {
  const text = fs.readFileSync(path.join(process.cwd(), templatePath), 'utf8')
  const values = new Map()
  const regex = /^\s{2}([A-Z][A-Z0-9_]*):\s*\"([^\"]*)\"/gm
  for (const match of text.matchAll(regex)) {
    values.set(match[1], match[2])
  }
  return values
}

function parseEnvFile(envPath) {
  const text = fs.readFileSync(envPath, 'utf8')
  const values = new Map()
  const duplicates = []

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const eq = line.indexOf('=')
    if (eq <= 0) {
      throw new Error(`Invalid env line ${index + 1}: missing KEY=VALUE`)
    }

    const key = line.slice(0, eq).trim()
    const rawValue = line.slice(eq + 1).trim()
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      throw new Error(`Invalid env key on line ${index + 1}: ${key}`)
    }
    if (values.has(key)) duplicates.push(key)
    values.set(key, unquoteEnvValue(rawValue))
  }

  return { values, duplicates }
}

function unquoteEnvValue(rawValue) {
  if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
    try {
      return JSON.parse(rawValue)
    } catch {
      throw new Error(`Invalid quoted env value: ${rawValue}`)
    }
  }
  if (rawValue.startsWith("'") && rawValue.endsWith("'")) return rawValue.slice(1, -1)
  return rawValue
}

function validate(values, duplicates, templateKeys) {
  const issues = []
  const templateKeySet = new Set(templateKeys)

  for (const key of duplicates) issues.push(`${key}: duplicate key`)

  for (const key of templateKeys) {
    if (!values.has(key)) issues.push(`${key}: missing key from env file`)
  }

  for (const key of values.keys()) {
    if (!templateKeySet.has(key)) issues.push(`${key}: key is not present in staging template`)
  }

  for (const key of REQUIRED_NON_EMPTY) {
    const value = values.get(key) ?? ''
    if (!value.trim()) issues.push(`${key}: required value is empty`)
  }

  for (const [key, value] of values.entries()) {
    if (value.startsWith('REPLACE_ME_')) issues.push(`${key}: unresolved REPLACE_ME placeholder`)
    if (value.includes('<PASSWORD>')) issues.push(`${key}: contains template password placeholder`)
    if (value.includes('example.com')) issues.push(`${key}: contains example.com template URL`)
  }

  const januaWebhookSecret = values.get('JANUA_WEBHOOK_SECRET') ?? ''
  const januaTelemetryWebhookSecret = values.get('JANUA_TELEMETRY_WEBHOOK_SECRET') ?? ''
  if (januaWebhookSecret && januaTelemetryWebhookSecret) {
    if (januaWebhookSecret === januaTelemetryWebhookSecret) {
      issues.push(
        'JANUA_TELEMETRY_WEBHOOK_SECRET must not equal JANUA_WEBHOOK_SECRET in staging',
      )
    }
  }

  const splitSensitiveWebhookSecrets = [
    'JANUA_WEBHOOK_SECRET',
    'JANUA_TELEMETRY_WEBHOOK_SECRET',
    'DHANAM_WEBHOOK_SECRET',
    'COTIZA_WEBHOOK_SECRET',
    'PRAVARA_WEBHOOK_SECRET',
    'FORJ_WEBHOOK_SECRET',
    'TEZCA_WEBHOOK_SECRET',
    'FORTUNA_WEBHOOK_SECRET',
    'PHYND_CRM_EVENTS_SECRET',
    'COFORMA_WEBHOOK_SECRET',
    'CEQ_WEBHOOK_SECRET',
    'PHYND_ENGAGEMENT_EVENTS_SECRET',
    'PHYND_CAMPAIGN_IMPORT_SECRET',
    'SELVA_WEBHOOK_SECRET',
    'KARAFIEL_WEBHOOK_SECRET',
    'PHYNDCRM_OUTBOUND_SECRET',
    'PRAVARA_DISPATCH_SECRET',
    'SELVA_DISPATCH_SECRET',
  ]

  const usedWebhookSecrets = new Map()
  for (const key of splitSensitiveWebhookSecrets) {
    const value = values.get(key) ?? ''
    if (!value || value.startsWith('REPLACE_ME_')) continue

    const previous = usedWebhookSecrets.get(value)
    if (previous && previous !== key) {
      issues.push(
        `${key}: secret value duplicates ${previous}; split-sensitive webhook credentials must be distinct`,
      )
    }
    usedWebhookSecrets.set(value, key)
  }

  for (const [key, minLength] of SECRET_MIN_LENGTH) {
    const value = values.get(key) ?? ''
    if (value && value.length < minLength) {
      issues.push(`${key}: secret is shorter than ${minLength} characters`)
    }
  }

  for (const key of STAGING_API_URL_KEYS) {
    const value = values.get(key) ?? ''
    if (!value || value.startsWith('REPLACE_ME_')) continue

    if (!value.includes('staging')) {
      issues.push(`${key}: must target a staging endpoint`)
    }
    if (value.includes('localhost') || value.includes('127.0.0.1')) {
      issues.push(`${key}: localhost is not allowed in staging`)
    }
  }

  const usedApiUrls = new Map()
  for (const key of STAGING_API_URL_KEYS) {
    const value = values.get(key) ?? ''
    if (!value || value.startsWith('REPLACE_ME_')) continue

    const previous = usedApiUrls.get(value)
    if (previous && previous !== key) {
      issues.push(`${key}: endpoint value duplicates ${previous}; split-sensitive endpoints must be distinct`)
    }
    usedApiUrls.set(value, key)
  }

  const databaseUrl = values.get('DATABASE_URL') ?? ''
  if (databaseUrl && !databaseUrl.startsWith('postgresql://')) {
    issues.push('DATABASE_URL: must be a postgresql:// URL')
  }
  if (databaseUrl && !databaseUrl.includes('phynd_crm_staging')) {
    issues.push('DATABASE_URL: must target phynd_crm_staging')
  }
  if (databaseUrl && !databaseUrl.includes('phynd_staging')) {
    issues.push('DATABASE_URL: must use a staging database role')
  }

  const redisUrl = values.get('REDIS_URL') ?? ''
  if (redisUrl && !redisUrl.startsWith('redis://')) issues.push('REDIS_URL: must be a redis:// URL')

  if (values.get('NODE_ENV') !== 'production') issues.push('NODE_ENV: must be production')
  if (values.get('PHYND_DEPLOYMENT_TIER') !== 'staging') {
    issues.push('PHYND_DEPLOYMENT_TIER: must be staging')
  }
  const serviceUserId = values.get('FEDERATION_SERVICE_USER_ID') ?? ''
  if (!serviceUserId.startsWith('service:')) {
    issues.push('FEDERATION_SERVICE_USER_ID: must be a service:* machine principal')
  }
  if (values.get('NEXT_PUBLIC_APP_URL') !== STAGING_APP_URL) {
    issues.push(`NEXT_PUBLIC_APP_URL: must be ${STAGING_APP_URL}`)
  }
  if (values.get('NEXTAUTH_URL') !== STAGING_APP_URL) {
    issues.push(`NEXTAUTH_URL: must be ${STAGING_APP_URL}`)
  }
  if (!(values.get('PORTAL_BASE_URL') ?? '').includes('staging')) {
    issues.push('PORTAL_BASE_URL: must be a staging portal URL')
  }
  if (!(values.get('AUTH_JANUA_ISSUER') ?? '').includes('staging')) {
    issues.push('AUTH_JANUA_ISSUER: must point at staging Janua')
  }
  if (!(values.get('EMAIL_ALLOWLIST_DOMAINS') ?? '').trim()) {
    issues.push('EMAIL_ALLOWLIST_DOMAINS: must constrain staging outbound email')
  }
  if (
    !(values.get('SELVA_API_KEY') ?? '').trim() &&
    !(values.get('SELVA_DISPATCH_SECRET') ?? '').trim()
  ) {
    issues.push('SELVA_API_KEY or SELVA_DISPATCH_SECRET: one Selva dispatch credential is required')
  }

  return issues
}

function validateAgainstProduction(values, issues) {
  const prodValues = readTemplateValues(PRODUCTION_TEMPLATE_PATH)
  const productionSensitiveEndpoints = [
    'AUTH_JANUA_ISSUER',
    'JANUA_API_URL',
    'JANUA_TELEMETRY_API_URL',
    'DHANAM_API_URL',
    'COTIZA_API_URL',
    'PRAVARA_BASE_URL',
    'SELVA_API_URL',
    'FORJ_API_URL',
    'TEZCA_API_URL',
    'TEZCA_PUBLIC_URL',
    'KARAFIEL_API_URL',
    'NEXT_PUBLIC_APP_URL',
    'NEXTAUTH_URL',
    'PORTAL_BASE_URL',
  ]

  for (const key of productionSensitiveEndpoints) {
    const stagingValue = values.get(key) ?? ''
    const productionValue = prodValues.get(key) ?? ''
    if (!stagingValue || !productionValue) continue
    if (stagingValue === productionValue) {
      issues.push(`${key}: must differ from production template value`)
    }
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const envPath = path.resolve(opts.envPath)
  const { values, duplicates } = parseEnvFile(envPath)
  const templateKeys = readTemplateKeys()
  const issues = validate(values, duplicates, templateKeys)
  validateAgainstProduction(values, issues)

  if (issues.length > 0) {
    console.error(`BLOCKED ${path.basename(envPath)} is not safe to apply:`)
    for (const issue of issues) console.error(`- ${issue}`)
    process.exit(1)
  }

  console.log(`PASS ${path.basename(envPath)} covers ${templateKeys.length} staging keys`)
  if (opts.printApplyCommand) {
    console.log(
      [
        `kubectl -n ${DEFAULT_NAMESPACE} create secret generic ${DEFAULT_SECRET_NAME}`,
        `  --from-env-file=${envPath}`,
        '  --dry-run=client -o yaml | kubectl apply -f -',
      ].join(' \\\n'),
    )
  }
}

main()
