#!/usr/bin/env node
/**
 * Merge live Kubernetes Secret values into a Vault KV path for ESO recovery.
 *
 * Enclii-first: prefer `enclii/scripts/migrate-eso-targets-to-vault.py` with an
 * operator-approved VAULT_TOKEN. This script targets a single namespace/secret
 * when only phynd-crm-staging (or prod) gaps need closing.
 *
 * Usage:
 *   VAULT_TOKEN=<write-capable> node scripts/pp5-backfill-vault-from-k8s.mjs \
 *     --namespace phynd-crm-staging --secret phynd-crm-staging-secrets \
 *     --vault-path secret/phynd-crm-staging --dry-run
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

function lowerSnake(key) {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function parseArgs(argv) {
  const opts = {
    namespace: 'phynd-crm-staging',
    secret: 'phynd-crm-staging-secrets',
    vaultPath: 'secret/phynd-crm-staging',
    vaultNamespace: 'vault',
    vaultPod: 'vault-0',
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') {
      opts.dryRun = true
      continue
    }
    if (arg === '--namespace') {
      opts.namespace = argv[++i] ?? ''
      continue
    }
    if (arg === '--secret') {
      opts.secret = argv[++i] ?? ''
      continue
    }
    if (arg === '--vault-path') {
      opts.vaultPath = argv[++i] ?? ''
      continue
    }
    if (arg === '--help' || arg === '-h') {
      console.log(`Usage: VAULT_TOKEN=... node scripts/pp5-backfill-vault-from-k8s.mjs [--dry-run]`)
      process.exit(0)
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  return opts
}

function kubectlJson(args) {
  const result = spawnSync('kubectl', [...args, '-o', 'json'], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'kubectl failed').trim())
  }
  return JSON.parse(result.stdout)
}

function decodeSecretData(data) {
  const values = new Map()
  for (const [key, b64] of Object.entries(data ?? {})) {
    values.set(key, Buffer.from(b64, 'base64').toString('utf8'))
  }
  return values
}

function readVaultPath(opts, token) {
  const result = spawnSync(
    'kubectl',
    [
      'exec',
      '-n',
      opts.vaultNamespace,
      opts.vaultPod,
      '--',
      'env',
      `VAULT_TOKEN=${token}`,
      'vault',
      'kv',
      'get',
      '-format=json',
      opts.vaultPath,
    ],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) {
    if ((result.stderr || '').includes('No value found')) return {}
    throw new Error((result.stderr || result.stdout || 'vault read failed').trim())
  }
  const parsed = JSON.parse(result.stdout)
  return parsed?.data?.data ?? {}
}

function writeVaultPath(opts, token, payload) {
  const result = spawnSync(
    'kubectl',
    [
      'exec',
      '-i',
      '-n',
      opts.vaultNamespace,
      opts.vaultPod,
      '--',
      'env',
      `VAULT_TOKEN=${token}`,
      'vault',
      'kv',
      'put',
      '-format=json',
      opts.vaultPath,
      '-',
    ],
    { input: JSON.stringify(payload), encoding: 'utf8' },
  )
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'vault write failed').trim())
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const secret = kubectlJson(['get', 'secret', opts.secret, '-n', opts.namespace])
  const k8sValues = decodeSecretData(secret.data)
  const vaultPayload = {}
  for (const [key, value] of k8sValues.entries()) {
    vaultPayload[lowerSnake(key)] = value
  }

  const readToken =
    process.env.VAULT_READ_TOKEN?.trim() ||
    (() => {
      const eso = kubectlJson(['get', 'secret', 'vault-eso-token', '-n', 'external-secrets'])
      return Buffer.from(eso.data.token, 'base64').toString('utf8')
    })()

  const existing = readVaultPath(opts, readToken)
  const merged = { ...existing, ...vaultPayload }
  const added = Object.keys(vaultPayload).filter((key) => !(key in existing))
  const updated = Object.keys(vaultPayload).filter(
    (key) => key in existing && existing[key] !== vaultPayload[key],
  )

  console.log(`Plan ${opts.vaultPath}: ${Object.keys(merged).length} properties`)
  console.log(`  new: ${added.length}${added.length ? ` (${added.sort().join(', ')})` : ''}`)
  console.log(`  updated: ${updated.length}`)

  if (opts.dryRun) {
    console.log('Dry-run only — no Vault write performed')
    return
  }

  const writeToken = process.env.VAULT_TOKEN?.trim()
  if (!writeToken) {
    console.error('BLOCKED: VAULT_TOKEN with write access is required (omit --dry-run)')
    process.exit(1)
  }

  writeVaultPath(opts, writeToken, merged)
  console.log(`Wrote ${opts.vaultPath}`)
  console.log('Next: kubectl annotate externalsecret -n', opts.namespace, opts.secret, `force-sync=$(date +%s) --overwrite`)
}

main()
