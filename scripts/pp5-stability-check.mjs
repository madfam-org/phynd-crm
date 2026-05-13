#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const WEBHOOK_DIR = 'apps/web/src/app/api/webhooks'
const WEBHOOK_FALLBACK_REGEX =
  /process\.env\.[A-Z0-9_]*WEBHOOK_SECRET\s*\?\?\s*process\.env\.[A-Z0-9_]+/g
const STABILITY_FALLBACK_PATTERNS = [
  /process\.env\.JANUA_TELEMETRY_API_URL\s*\?\?\s*process\.env\.JANUA_API_URL/g,
  /process\.env\.JANUA_API_URL\s*\?\?\s*process\.env\.AUTH_JANUA_ISSUER/g,
]

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })

  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim()
  if (result.status !== 0) {
    if (output) console.error(output)
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
  }

  return output
}

function walkWebhookFiles(baseDir, files = []) {
  for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue
    const fullPath = path.join(baseDir, entry.name)
    if (entry.isDirectory()) {
      walkWebhookFiles(fullPath, files)
      continue
    }
    if (!entry.isFile()) continue
    if (!fullPath.endsWith('.ts') && !fullPath.endsWith('.tsx')) continue
    files.push(fullPath)
  }
  return files
}

function walkFiles(baseDir, files = []) {
  for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue
    const fullPath = path.join(baseDir, entry.name)
    if (entry.isDirectory()) {
      walkFiles(fullPath, files)
      continue
    }
    if (!entry.isFile()) continue
    if (!fullPath.endsWith('.ts') && !fullPath.endsWith('.tsx') && !fullPath.endsWith('.js')) continue
    files.push(fullPath)
  }
  return files
}

function scanWebhookFallbacks() {
  const files = walkWebhookFiles(WEBHOOK_DIR)
  const matches = []

  for (const file of files) {
    const text = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
    const hit = text.match(WEBHOOK_FALLBACK_REGEX)
    if (hit) matches.push({ file, snippets: hit })
  }

  return matches
}

function scanSplitFallbacks() {
  const targets = [
    ...walkFiles('apps/web/src/lib'),
    ...walkFiles('apps/worker/src/lib'),
    ...walkFiles('packages/services/src'),
  ]
  const matches = []

  for (const file of targets) {
    const text = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
    for (const pattern of STABILITY_FALLBACK_PATTERNS) {
      const found = text.match(pattern)
      if (found) {
        matches.push({ file, snippets: found })
      }
    }
  }

  return matches
}

function checkAll() {
  run('node', ['scripts/pp5-staging-audit.mjs'])
  run('node', ['scripts/pp5-webhook-probe.mjs', 'list'])

  const matches = scanWebhookFallbacks()
  if (matches.length > 0) {
    console.error('FAILED: webhook secret fallback expressions detected')
    for (const match of matches) {
      console.error(`- ${match.file}`)
      for (const snippet of match.snippets) console.error(`  ${snippet}`)
    }
    throw new Error('Webhook secret fallback guard failed')
  }

  const splitMatches = scanSplitFallbacks()
  if (splitMatches.length > 0) {
    console.error('FAILED: cross-surface env fallback chain detected')
    for (const match of splitMatches) {
      console.error(`- ${match.file}`)
      for (const snippet of match.snippets) console.error(`  ${snippet}`)
    }
    throw new Error('Stability env fallback guard failed')
  }

  console.log('PASS pp5 stability check')
}

checkAll()
