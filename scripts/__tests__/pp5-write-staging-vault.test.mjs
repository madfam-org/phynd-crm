import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const TEMPLATE_PATH = 'infra/k8s/staging-secrets-template.yaml'

function templateKeys() {
  const source = readFileSync(TEMPLATE_PATH, 'utf8')
  return [...source.matchAll(/^\s{2}([A-Z][A-Z0-9_]*):/gm)].map((entry) => entry[1])
}

function valueFor(key, index) {
  if (key === 'DATABASE_URL') {
    return 'postgresql://phynd_staging:staging-db-password@pgbouncer.data.svc.cluster.local:6432/phynd_crm_staging'
  }
  if (key === 'REDIS_URL') return 'redis://:staging-redis-password@redis.data.svc.cluster.local:6379/0'
  if (key === 'AUTH_JANUA_ISSUER') return 'https://auth.staging.madfam.io'
  if (key === 'NEXT_PUBLIC_APP_URL' || key === 'NEXTAUTH_URL') return 'https://staging-phynd.app'
  if (key === 'PORTAL_BASE_URL') return 'https://portal-staging-phynd.app'
  if (key === 'NODE_ENV') return 'production'
  if (key === 'PHYND_DEPLOYMENT_TIER') return 'staging'
  if (key === 'FEDERATION_SERVICE_USER_ID') return 'service:selva'
  if (key === 'WORKER_HEALTH_PORT') return '3001'
  if (key === 'EMAIL_ALLOWLIST_DOMAINS') return 'madfam.io'

  const urlKeys = new Set([
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
  ])
  if (urlKeys.has(key)) return `https://staging-${index}-${key.toLowerCase().replaceAll('_', '-')}.madfam.test`

  const optionalEmpty = new Set([
    'OPENAI_API_KEY',
    'REDDIT_CLIENT_ID',
    'REDDIT_CLIENT_SECRET',
    'REDDIT_REFRESH_TOKEN',
    'REDDIT_USERNAME',
    'REDDIT_PASSWORD',
    'SENTRY_DSN',
    'OTEL_EXPORTER_OTLP_ENDPOINT',
  ])
  if (optionalEmpty.has(key)) return ''

  return `${key.toLowerCase()}-${index}-staging-secret-value-1234567890abcdefghijklmnopqrstuvwxyz`
}

function writeValidEnv(filePath) {
  const lines = templateKeys().map((key, index) => `${key}=${valueFor(key, index)}`)
  writeFileSync(filePath, `${lines.join('\n')}\n`)
}

test('pp5 staging Vault writer dry-run validates and prints only keys', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pp5-staging-vault-'))
  const envPath = path.join(dir, 'phynd-crm-staging.env')

  try {
    writeValidEnv(envPath)
    const result = spawnSync(
      process.execPath,
      ['scripts/pp5-write-staging-vault.mjs', envPath, '--dry-run'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Would write \d+ property\(s\) to Vault secret\/phynd-crm-staging/)
    assert.match(result.stdout, /auth_janua_client_secret/)
    assert.match(result.stdout, /phynd_crm_probe_token/)
    assert.doesNotMatch(result.stdout, /staging-secret-value/)
    assert.doesNotMatch(result.stdout, /staging-db-password/)
    assert.equal(result.stderr, '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
