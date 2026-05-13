#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_BASE_URL = 'https://staging-phynd.app'
const DEFAULT_EMAIL = 'pp5-probe@staging.madfam.io'
const DEFAULT_RUN_ID = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
const DEFAULT_PARALLELISM = 4
const BATCH_ORDER = ['A', 'B', 'C', 'D']
const DEFAULT_OUTPUT_DIR = 'artifacts/pp5'
const TEMPLATE_PATH = 'docs/PP_5_BATCH_PROBE_EVIDENCE_TEMPLATE.md'

function usage(message) {
  if (message) console.error(`ERROR: ${message}`)
  console.error(`
Usage:
  node scripts/pp5-probe-batch-run.mjs [--batches A,B,C,D] [--base-url URL] [--email EMAIL] [--run-id ID] [--engagement-id ID] [--parallelism N] [--output-dir PATH]

Examples:
  node scripts/pp5-probe-batch-run.mjs
  node scripts/pp5-probe-batch-run.mjs --batches A,B,D --engagement-id <id>
  node scripts/pp5-probe-batch-run.mjs --base-url https://staging-phynd.app --parallelism 6
`)
  process.exit(message ? 1 : 0)
}

function normalizeBatchToken(token) {
  const value = token.trim().toUpperCase()
  if (!value) return []
  if (value === 'ALL') return BATCH_ORDER
  if (value.includes(',')) {
    const list = []
    const seen = new Set()
    for (const part of value.split(',').map((part) => part.trim()).filter(Boolean)) {
      for (const batch of normalizeBatchToken(part)) {
        if (!seen.has(batch)) {
          seen.add(batch)
          list.push(batch)
        }
      }
    }
    return list
  }

  if (!BATCH_ORDER.includes(value)) usage(`Unknown batch: ${token}`)
  return [value]
}

function parseArgs(argv) {
  const opts = {
    baseUrl: DEFAULT_BASE_URL,
    email: DEFAULT_EMAIL,
    runId: DEFAULT_RUN_ID,
    engagementId: undefined,
    parallelism: DEFAULT_PARALLELISM,
    outputDir: DEFAULT_OUTPUT_DIR,
    batches: [...BATCH_ORDER],
    positionalBatches: [],
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]

    if (arg.startsWith('--')) {
      if (arg === '--base-url') {
        if (!next) usage('Missing value for --base-url')
        opts.baseUrl = next.replace(/\/$/, '')
        i += 1
        continue
      }

      if (arg === '--email') {
        if (!next) usage('Missing value for --email')
        opts.email = next
        i += 1
        continue
      }

      if (arg === '--run-id') {
        if (!next) usage('Missing value for --run-id')
        opts.runId = next
        i += 1
        continue
      }

      if (arg === '--engagement-id') {
        if (!next) usage('Missing value for --engagement-id')
        opts.engagementId = next
        i += 1
        continue
      }

      if (arg === '--parallelism') {
        if (!next || Number.isNaN(Number(next)) || Number(next) < 1) usage('Invalid --parallelism')
        opts.parallelism = Number(next)
        i += 1
        continue
      }

      if (arg === '--output-dir') {
        if (!next) usage('Missing value for --output-dir')
        opts.outputDir = next
        i += 1
        continue
      }

      if (arg === '--batches') {
        if (!next) usage('Missing value for --batches')
        opts.batches = normalizeBatchToken(next)
        i += 1
        continue
      }

      usage(`Unknown option: ${arg}`)
    }

    if (arg.includes(',') || BATCH_ORDER.includes(arg.toUpperCase())) {
      const selected = normalizeBatchToken(arg)
      for (const batch of selected) {
        if (!opts.positionalBatches.includes(batch)) opts.positionalBatches.push(batch)
      }
      continue
    }

    usage(`Unknown argument: ${arg}`)
  }

  if (opts.positionalBatches.length > 0) opts.batches = opts.positionalBatches
  const unique = []
  const seen = new Set()
  for (const batch of opts.batches) {
    if (seen.has(batch)) continue
    seen.add(batch)
    unique.push(batch)
  }
  opts.batches = unique

  return opts
}

function runBatch(batch, opts) {
  const args = [
    'scripts/pp5-webhook-batch-probe.mjs',
    batch,
    '--json',
    '--base-url',
    opts.baseUrl,
    '--email',
    opts.email,
    '--run-id',
    opts.runId,
    '--parallelism',
    String(opts.parallelism),
  ]

  if (opts.engagementId) {
    args.push('--engagement-id', opts.engagementId)
  }

  const result = spawnSync('node', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const output = (result.stdout || '').trim()
  let summary = null
  try {
    summary = JSON.parse(output)
  } catch {
    summary = {
      ok: false,
      failedChecks: null,
      parseError: 'Unable to parse JSON output',
      rawOutput: output,
      rawError: (result.stderr || '').trim(),
      target: batch,
      exitCode: result.status ?? 0,
      startedAt: new Date().toISOString(),
    }
  }

  return {
    batch,
    exitCode: result.status ?? 0,
    output,
    error: (result.stderr || '').trim(),
    summary,
  }
}

function statusForResult(result) {
  if (result.skipped) return 'SKIP'
  if (result.passed === true) return 'PASS'
  if (result.passed === false) return 'FAIL'
  return 'SKIP'
}

function tableRowForLane(laneRecord) {
  const valid = laneRecord.valid
  const invalid = laneRecord.invalid
  const validStatus = statusForResult(valid)
  const invalidStatus = statusForResult(invalid)
  const validCode = valid ? (valid.status === null ? 'n/a' : String(valid.status)) : 'n/a'
  const invalidCode = invalid ? (invalid.status === null ? 'n/a' : String(invalid.status)) : 'n/a'
  const notes = [...new Set([valid?.reason, invalid?.reason].filter(Boolean))].join(' | ') || ''
  return `| ${laneRecord.lane} | ${validStatus} (${validCode}) | ${invalidStatus} (${invalidCode}) | ${notes || '—'} |`
}

function collectArtifacts(resultsByBatch, opts) {
  const byLane = new Map()
  const batchSummaries = []
  let failedChecks = 0
  let totalChecks = 0
  let passedChecks = 0
  let skippedChecks = 0

  for (const { batch, summary } of resultsByBatch) {
    const batchChecks = Array.isArray(summary?.checks) ? summary.checks : []
    let localFailedChecks = 0
    let localPassedChecks = 0
    let localSkippedChecks = 0

    if (batchChecks.length > 0) {
      for (const check of batchChecks) {
        if (!check) continue
        if (check.passed === true) {
          localPassedChecks += 1
          continue
        }
        if (check.passed === null || check.skipped) {
          localSkippedChecks += 1
          continue
        }
        localFailedChecks += 1
      }
    } else if (summary?.parseError) {
      localFailedChecks = 1
    } else if (typeof summary?.failedChecks === 'number' && summary.failedChecks > 0) {
      localFailedChecks = summary.failedChecks
    }

    passedChecks += localPassedChecks
    failedChecks += localFailedChecks
    skippedChecks += localSkippedChecks
    totalChecks += batchChecks.length || (localFailedChecks + localPassedChecks + localSkippedChecks)

    const batchFailedChecks = typeof summary?.failedChecks === 'number'
      ? summary.failedChecks
      : localFailedChecks
    const batchFailureReason = summary?.parseError ? `parse error: ${summary.parseError}` : ''

    const grouped = Array.isArray(summary?.grouped) ? summary.grouped : []
    for (const laneRecord of grouped) {
      const existing = byLane.get(laneRecord.lane) ?? { lane: laneRecord.lane, valid: null, invalid: null, batches: [] }
      existing.valid = existing.valid ?? laneRecord.valid
      existing.invalid = existing.invalid ?? laneRecord.invalid
      existing.batches.push(batch)
      byLane.set(laneRecord.lane, existing)
    }

    batchSummaries.push({
      batch,
      ok: summary?.ok === true && !summary?.parseError,
      failedChecks: batchFailedChecks,
      reason: batchFailureReason || '',
      lanes: summary?.lanes || [],
      exitCode: summary?.exitCode ?? (summary?.parseError ? 1 : 0),
      startedAt: summary?.startedAt,
      checks: batchChecks,
    })
  }

  const passing = totalChecks - failedChecks - skippedChecks
  return {
    summary: {
      startedAt: new Date().toISOString(),
      batches: opts.batches,
      baseUrl: opts.baseUrl,
      email: opts.email,
      runId: opts.runId,
      engagementId: opts.engagementId,
      parallelism: opts.parallelism,
      totals: { totalChecks, passingChecks: passing, skippedChecks, failedChecks },
      batches: batchSummaries,
      lanes: Array.from(byLane.values()),
    },
    lanes: Array.from(byLane.values()),
  }
}

function renderMarkdown(artifacts, opts, files) {
  const md = []
  md.push('# PP.5 webhook batch evidence artifact')
  md.push('')
  md.push(`Generated: ${new Date().toISOString()}`)
  md.push(`Run ID: ${opts.runId}`)
  md.push(`Batches: ${opts.batches.join(', ')}`)
  md.push(`Base URL: ${opts.baseUrl}`)
  md.push(`Parallelism: ${opts.parallelism}`)
  if (opts.engagementId) md.push(`Engagement ID: ${opts.engagementId}`)
  md.push(`JSON artifact: ${files.json}`)
  md.push('')
  md.push('## Summary')
  md.push(`- Total checks: ${artifacts.summary.totals.totalChecks}`)
  md.push(`- Passing checks: ${artifacts.summary.totals.passingChecks}`)
  md.push(`- Skipped checks: ${artifacts.summary.totals.skippedChecks}`)
  md.push(`- Failing checks: ${artifacts.summary.totals.failedChecks}`)
  md.push('')
  md.push('## Batch results')
  md.push('| Batch | Exit code | OK | Failed checks |')
  md.push('| --- | --- | --- | ---: |')
  for (const batch of artifacts.summary.batches) {
    const maybeReason = batch.reason ? ` (${batch.reason})` : ''
    md.push(`| ${batch.batch} | ${batch.exitCode} | ${batch.ok ? 'yes' : 'no'} | ${batch.failedChecks}${maybeReason} |`)
  }
  md.push('')
  md.push('## Per-lane pass/fail')
  md.push('| Lane | Valid path | Invalid path | Notes |')
  md.push('| --- | --- | --- | --- |')
  if (artifacts.lanes.length > 0) {
    for (const lane of artifacts.lanes) {
      md.push(tableRowForLane(lane))
    }
  } else {
    md.push('| — | — | — | No lane results were captured. |')
  }
  md.push('')
  md.push('## Re-run command')
  const command = [
    'pnpm pp5:probe-batch-run',
    `--run-id ${opts.runId}`,
    `--parallelism ${opts.parallelism}`,
    `--batches ${opts.batches.join(',')}`,
    `--output-dir ${opts.outputDir}`,
  ]
  if (opts.engagementId) command.push(`--engagement-id ${opts.engagementId}`)
  md.push('```bash')
  md.push(command.join(' '))
  md.push('```')
  md.push('')
  md.push('## Evidence')
  md.push(`- JSON artifact: \`${files.json}\``)
  md.push('- Attach raw provider responses and any DB screenshots per lane in this ticket.')
  return md.join('\n')
}

function readTemplateFileIfExists() {
  const full = path.join(process.cwd(), TEMPLATE_PATH)
  try {
    return fs.readFileSync(full, 'utf8')
  } catch {
    return null
  }
}

function renderTemplate(template, artifacts, opts, files) {
  const laneRows = artifacts.lanes.map(tableRowForLane).join('\n')
  const batchRows = artifacts.summary.batches
    .map((batch) => `| ${batch.batch} | ${batch.exitCode} | ${batch.ok ? 'yes' : 'no'} | ${batch.failedChecks} |`)
    .join('\n')
  const command = [
    'pnpm pp5:probe-batch-run',
    `--run-id ${opts.runId}`,
    `--parallelism ${opts.parallelism}`,
    `--batches ${opts.batches.join(',')}`,
    `--output-dir ${opts.outputDir}`,
  ]
  if (opts.engagementId) command.push(`--engagement-id ${opts.engagementId}`)

  const replacements = {
    GENERATED_AT: new Date().toISOString(),
    RUN_ID: opts.runId,
    BATCHES: opts.batches.join(', '),
    BASE_URL: opts.baseUrl,
    EMAIL: opts.email,
    PARALLELISM: String(opts.parallelism),
    ENGAGEMENT_ID: opts.engagementId || 'N/A',
    OUTPUT_DIR: path.dirname(files.json),
    OUTPUT_JSON: files.json,
    TOTAL_CHECKS: String(artifacts.summary.totals.totalChecks),
    PASSING_CHECKS: String(artifacts.summary.totals.passingChecks),
    SKIPPED_CHECKS: String(artifacts.summary.totals.skippedChecks),
    FAILED_CHECKS: String(artifacts.summary.totals.failedChecks),
    BATCH_SUMMARY_TABLE: batchRows,
    LANE_TABLE: laneRows,
    RE_RUN_COMMAND: `\n\`\`\`bash\n${command.join(' ')}\n\`\`\``,
  }

  return template.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => replacements[key] || match)
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const startedAt = new Date().toISOString()

  const results = opts.batches.map((batch) => runBatch(batch, opts))
  const artifacts = collectArtifacts(results, opts)
  artifacts.summary.startedAt = startedAt

  const runId = `${opts.runId}-${Date.now()}`
  const safeRunId = runId.replace(/[^a-zA-Z0-9_-]/g, '')
  const jsonPath = path.join(opts.outputDir, `${safeRunId}-pp5-probe-batch-report.json`)
  const mdPath = path.join(opts.outputDir, `${safeRunId}-pp5-probe-batch-report.md`)

  const payload = {
    ...artifacts.summary,
    batchesRaw: results,
    generatedAt: new Date().toISOString(),
  }
  writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`)

  const template = readTemplateFileIfExists()
  const md = template
    ? renderTemplate(template, artifacts, opts, { json: path.resolve(jsonPath) })
    : renderMarkdown(artifacts, opts, { json: path.resolve(jsonPath) })
  writeFile(mdPath, md.trim())

  const pass = artifacts.summary.totals.failedChecks === 0
  const status = pass ? 'PASS' : 'FAIL'
  console.log(`${status} PP.5 batch evidence run completed`)
  console.log(`JSON: ${path.resolve(jsonPath)}`)
  console.log(`Markdown: ${path.resolve(mdPath)}`)
  if (!pass) process.exit(1)
}

main()
