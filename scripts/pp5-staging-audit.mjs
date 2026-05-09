#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const REQUIRED_KEYS = [
  'JANUA_API_URL',
  'JANUA_TELEMETRY_API_URL',
  'DHANAM_API_URL',
  'COTIZA_API_URL',
  'PRAVARA_BASE_URL',
  'FORJ_API_URL',
  'TEZCA_API_URL',
  'KARAFIEL_API_URL',
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
  'PHYNDCRM_OUTBOUND_SECRET',
  'KARAFIEL_WEBHOOK_SECRET',
  'KARAFIEL_API_KEY',
  'FEDERATION_API_TOKEN',
  'AUTH_JANUA_CLIENT_ID',
  'AUTH_JANUA_CLIENT_SECRET',
  'AUTH_JANUA_ISSUER',
  'NEXT_PUBLIC_APP_URL',
  'NEXTAUTH_URL',
  'REDIS_URL',
  'DATABASE_URL',
  'PORTAL_BASE_URL',
  'EMAIL_ALLOWLIST_DOMAINS',
]

function readFile(filePath) {
  return fs.readFileSync(path.join(process.cwd(), filePath), 'utf8')
}

function extractEnvKeysFromYaml(filePath) {
  const yaml = readFile(filePath)
  const keyRegex = /^\s{2,}([A-Z][A-Z0-9_]*):/gm
  const keys = new Set()
  for (const match of yaml.matchAll(keyRegex)) {
    keys.add(match[1])
  }
  return keys
}

function walkFiles(baseDir, predicate, acc = []) {
  for (const entry of fs.readdirSync(path.join(process.cwd(), baseDir), { withFileTypes: true })) {
    const full = path.join(baseDir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue
      walkFiles(full, predicate, acc)
      continue
    }
    if (entry.isFile() && predicate(full)) {
      acc.push(full)
    }
  }
  return acc
}

function collectEnvNamesFromFiles(filePaths) {
  const secretRegex = /process\.env\.([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|WEBHOOK)[A-Z0-9_]*)/g
  const env = new Set()

  for (const file of filePaths) {
    const text = readFile(file)
    for (const match of text.matchAll(secretRegex)) {
      env.add(match[1])
    }
  }

  return env
}

function summarizeDiff(required, present, label) {
  const missing = required.filter((key) => !present.has(key))
  if (missing.length === 0) {
    console.log(`PASS ${label}`)
    return
  }

  console.error(`FAIL ${label}`)
  for (const key of missing) {
    console.error(`  - ${key}`)
  }
  throw new Error(`Missing ${missing.length} key(s) for ${label}`)
}

function main() {
  const stagingKeys = extractEnvKeysFromYaml('infra/k8s/staging-secrets-template.yaml')
  summarizeDiff(REQUIRED_KEYS, stagingKeys, 'required split-sensitive staging keys')

  const webhookFiles = walkFiles(
    'apps/web/src/app/api/webhooks',
    (filePath) => path.basename(filePath) === 'route.ts',
  )
  const eventFiles = [
    'apps/web/src/app/api/v1/events/payment.succeeded/route.ts',
    'apps/web/src/app/api/v1/engagements/events/route.ts',
    'apps/web/src/app/api/v1/engagements/artifacts/route.ts',
  ]

  const observedSecrets = [...collectEnvNamesFromFiles([...webhookFiles, ...eventFiles])]
  const missingFromCode = [...observedSecrets].filter((envKey) => !stagingKeys.has(envKey))
  if (missingFromCode.length > 0) {
    console.error('FAIL observed webhook/event secret envs not in staging template')
    for (const key of missingFromCode) {
      console.error(`  - ${key}`)
    }
    throw new Error('Staging template missing observed env keys')
  }

  const stagingTemplate = readFile('infra/k8s/staging-secrets-template.yaml')
  const appUrlMatch = stagingTemplate.match(/NEXT_PUBLIC_APP_URL:\s*\"([^\"]+)\"/)
  if (!appUrlMatch || !appUrlMatch[1].includes('staging-phynd.app')) {
    throw new Error('NEXT_PUBLIC_APP_URL must include staging-phynd.app in staging-secrets-template.yaml')
  }

  console.log('PASS staging web entrypoint and env coverage checks')
}

main()
