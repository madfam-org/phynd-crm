#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const DEFAULT_VAULT_PATH = 'secret/phynd-crm-staging'
const DEFAULT_VAULT_NAMESPACE = 'vault'
const DEFAULT_VAULT_POD = 'vault-0'
const VALIDATOR = 'scripts/pp5-validate-staging-env.mjs'

function usage(message) {
  if (message) console.error(`ERROR: ${message}`)
  console.error(`
Usage:
  node scripts/pp5-write-staging-vault.mjs /secure/path/phynd-crm-staging.env --dry-run
  VAULT_TOKEN_FILE=/secure/vault-token node scripts/pp5-write-staging-vault.mjs /secure/path/phynd-crm-staging.env

This validates the PP.5 staging env file, converts env keys to lower-snake
Vault properties, and writes them to ${DEFAULT_VAULT_PATH}. Secret values are
never printed.
`)
  process.exit(message ? 1 : 0)
}

function parseArgs(argv) {
  const opts = {
    envPath: null,
    dryRun: false,
    vaultPath: DEFAULT_VAULT_PATH,
    vaultNamespace: DEFAULT_VAULT_NAMESPACE,
    vaultPod: DEFAULT_VAULT_POD,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') {
      opts.dryRun = true
      continue
    }
    if (arg === '--vault-path') {
      opts.vaultPath = argv[++i]
      continue
    }
    if (arg === '--vault-namespace') {
      opts.vaultNamespace = argv[++i]
      continue
    }
    if (arg === '--vault-pod') {
      opts.vaultPod = argv[++i]
      continue
    }
    if (arg === '--help' || arg === '-h') usage()
    if (arg.startsWith('-')) usage(`Unknown option: ${arg}`)
    if (opts.envPath) usage('Only one env file path is accepted')
    opts.envPath = arg
  }

  if (!opts.envPath) usage('Missing env file path')
  if (!opts.vaultPath) usage('--vault-path cannot be empty')
  if (!opts.vaultNamespace) usage('--vault-namespace cannot be empty')
  if (!opts.vaultPod) usage('--vault-pod cannot be empty')
  return opts
}

function runValidator(envPath) {
  const result = spawnSync(process.execPath, [VALIDATOR, envPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    const detail = result.stderr || result.stdout || `validator exited ${result.status}`
    console.error(detail.trim())
    process.exit(result.status || 1)
  }
}

function unquoteEnvValue(rawValue) {
  if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
    return JSON.parse(rawValue)
  }
  if (rawValue.startsWith("'") && rawValue.endsWith("'")) return rawValue.slice(1, -1)
  return rawValue
}

function parseEnvFile(envPath) {
  const text = readFileSync(envPath, 'utf8')
  const values = new Map()

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const eq = line.indexOf('=')
    if (eq <= 0) throw new Error(`Invalid env line ${index + 1}: missing KEY=VALUE`)
    const key = line.slice(0, eq).trim()
    const rawValue = line.slice(eq + 1).trim()
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      throw new Error(`Invalid env key on line ${index + 1}: ${key}`)
    }
    values.set(key, unquoteEnvValue(rawValue))
  }

  return values
}

function lowerSnake(key) {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function toVaultPayload(values) {
  const payload = {}
  for (const [key, value] of values.entries()) {
    payload[lowerSnake(key)] = value
  }
  return payload
}

function loadVaultToken() {
  if (process.env.VAULT_TOKEN) return process.env.VAULT_TOKEN.trim()
  if (process.env.VAULT_TOKEN_FILE) {
    return readFileSync(process.env.VAULT_TOKEN_FILE, 'utf8').trim()
  }
  throw new Error('VAULT_TOKEN or VAULT_TOKEN_FILE is required for writes')
}

function writeVault(opts, payload) {
  const token = loadVaultToken()
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
    {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    },
  )

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exit status ${result.status}`)
      .split('\n')
      .filter(Boolean)
      .slice(0, 4)
      .join('\n')
    throw new Error(`Vault write failed:\n${detail}`)
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const envPath = path.resolve(opts.envPath)

  runValidator(envPath)
  const payload = toVaultPayload(parseEnvFile(envPath))
  const keys = Object.keys(payload).sort()

  if (opts.dryRun) {
    console.log(
      `Would write ${keys.length} property(s) to Vault ${opts.vaultPath}: ${keys.join(', ')}`,
    )
    return
  }

  writeVault(opts, payload)
  console.log(`Wrote ${keys.length} property(s) to Vault ${opts.vaultPath}: ${keys.join(', ')}`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
