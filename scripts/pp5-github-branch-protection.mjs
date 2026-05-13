#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import process from 'node:process'
import fs from 'node:fs'

const DEFAULT_BRANCH = 'main'
const DEFAULT_REQUIRED_CHECKS = [
  'CI / PP5 Guardrails',
  'CI / NetworkPolicy port consistency',
  'CI / Lint & Typecheck',
  'CI / Unit Tests',
  'CI / Build',
  'CI / E2E Tests',
]
const DEFAULT_CI_WORKFLOW = '.github/workflows/ci.yml'

function asDisplayCheckName(rawName) {
  const trimmedName = rawName.trim()
  if (!trimmedName) return trimmedName
  return trimmedName.startsWith('CI / ') ? trimmedName : `CI / ${trimmedName}`
}

function parseCiRequiredChecks(path = DEFAULT_CI_WORKFLOW) {
  const ciConfig = fs.readFileSync(path, 'utf8')
  const lines = ciConfig.split('\n')
  const checks = []
  let inJobs = false
  let inJob = false
  let currentJobName = null

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]

    if (/^jobs:/m.test(line)) {
      inJobs = true
      continue
    }

    if (!inJobs) continue

    const jobLine = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (jobLine) {
      if (inJob && currentJobName) checks.push(currentJobName)
      inJob = true
      currentJobName = null
      continue
    }

    if (!inJob) continue

    const nameLine = /^ {4}name:\s*(.+)\s*$/.exec(line)
    if (nameLine) {
      currentJobName = asDisplayCheckName(nameLine[1])
      continue
    }

    if (/^ {0,2}\S/.test(line)) {
      if (inJob && currentJobName) checks.push(currentJobName)
      inJob = false
      currentJobName = null
      inJobs = false
      continue
    }
  }

  if (inJob && currentJobName) checks.push(currentJobName)

  return [...new Set(checks)]
}

function normalizeGitRemoteUrl(remoteUrl) {
  if (!remoteUrl) return ''
  const normalized = remoteUrl.trim()
  if (!normalized) return ''

  const httpsMatch = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/i.exec(normalized)
  if (httpsMatch) return httpsMatch[1]

  const sshMatch = /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/i.exec(normalized)
  if (sshMatch) return sshMatch[1]

  const sshUrlMatch = /^ssh:\/\/git@github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/i.exec(normalized)
  if (sshUrlMatch) return sshUrlMatch[1]

  return ''
}

function detectRepoFromGit() {
  const result = spawnSync('git', ['config', '--get', 'remote.origin.url'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.status !== 0) return ''
  return normalizeGitRemoteUrl(result.stdout || '')
}

function usage(message) {
  if (message) console.error(`ERROR: ${message}`)
  console.error(`
Usage:
  node scripts/pp5-github-branch-protection.mjs --repo owner/repo [--branch main]
  node scripts/pp5-github-branch-protection.mjs --mode check --repo owner/repo [--required-checks "A,B,C" | --required-checks-from-ci [--ci-workflow path]]
  node scripts/pp5-github-branch-protection.mjs --mode apply --repo owner/repo [--required-checks "A,B,C" | --required-checks-from-ci [--ci-workflow path]]
  node scripts/pp5-github-branch-protection.mjs --mode apply --repo owner/repo --confirm

Options:
  --mode check|apply          Operation mode (default: check)
  --repo owner/repo           Target repository (defaults to GITHUB_REPOSITORY)
  --branch branch-name        Branch name (default: main)
  --required-checks-from-ci   Use CI workflow job names as required checks
  --required-checks checks    Comma list of required status checks
  --ci-workflow path         CI workflow path when using --required-checks-from-ci (default: .github/workflows/ci.yml)
  --required-approvals N      Required approving reviews (default: 1)
  --confirm                   Required for --mode apply
  --dry-run                   Print would-be payload for apply mode
`)
  process.exit(message ? 1 : 0)
}

function parseArgs(argv) {
  const opts = {
    mode: 'check',
    repo: process.env.GITHUB_REPOSITORY || process.env.GH_REPO || detectRepoFromGit(),
    branch: DEFAULT_BRANCH,
    requiredChecks: DEFAULT_REQUIRED_CHECKS,
    requiredApprovals: 1,
    confirm: false,
    dryRun: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]

    if (!arg.startsWith('--')) usage(`Unknown positional arg: ${arg}`)

    if (arg === '--mode') {
      if (!next || (next !== 'check' && next !== 'apply')) usage('Mode must be check or apply')
      opts.mode = next
      i += 1
      continue
    }

    if (arg === '--required-checks-from-ci') {
      opts.requiredChecksFromCi = true
      continue
    }

    if (arg === '--ci-workflow') {
      if (!next) usage('Missing value for --ci-workflow')
      opts.ciWorkflow = next
      i += 1
      continue
    }

    if (arg === '--repo') {
      if (!next) usage('Missing value for --repo')
      opts.repo = next
      i += 1
      continue
    }

    if (arg === '--branch') {
      if (!next) usage('Missing value for --branch')
      opts.branch = next
      i += 1
      continue
    }

    if (arg === '--required-checks') {
      if (!next) usage('Missing value for --required-checks')
      opts.requiredChecks = next
        .split(',')
        .map((check) => check.trim())
        .filter(Boolean)
      i += 1
      opts.requiredChecksFromCi = false
      continue
    }

    if (arg === '--required-approvals') {
      if (!next || Number.isNaN(Number(next)) || Number(next) < 1) usage('Invalid --required-approvals')
      opts.requiredApprovals = Number(next)
      i += 1
      continue
    }

    if (arg === '--confirm') {
      opts.confirm = true
      continue
    }

    if (arg === '--dry-run') {
      opts.dryRun = true
      continue
    }

    usage(`Unknown option: ${arg}`)
  }

  if (!opts.repo) usage('Missing --repo')
  if (!opts.branch) usage('Missing branch')

  return opts
}

function computeRequiredChecks(opts) {
  if (opts.requiredChecksFromCi) {
    return parseCiRequiredChecks(opts.ciWorkflow)
  }

  return opts.requiredChecks
}

function runGh(args, input) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    input: input || undefined,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || '').trim() || `gh command failed: gh ${args.join(' ')}`
    console.error(message)
    process.exit(1)
  }

  return result.stdout
}

function normalizeStatusChecks(checks) {
  return [...checks].sort((a, b) => a.localeCompare(b))
}

function eqStringArrays(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function inspectBranchProtection(payload, expectedChecks) {
  const missing = []
  const checks = payload.required_status_checks
  const contexts = normalizeStatusChecks(checks?.contexts || [])
  const expected = normalizeStatusChecks(expectedChecks)

  if (!checks) missing.push('required_status_checks block is missing')
  if (checks && !checks.strict) missing.push('required_status_checks.strict must be true')
  if (!eqStringArrays(contexts, expected)) {
    missing.push(`required checks mismatch: got [${contexts.join(', ')}], expected [${expected.join(', ')}]`)
  }
  const requiredApprovals = payload.required_pull_request_reviews?.required_approving_review_count || 0
  if (requiredApprovals < 1) missing.push('required approving reviews must be at least 1')
  const allowForcePushes = payload.allow_force_pushes
  if (allowForcePushes !== false) missing.push('allow_force_pushes must be false')
  const allowDeletions = payload.allow_deletions
  if (allowDeletions !== false) missing.push('allow_deletions must be false')
  const enforceAdmins = payload.enforce_admins?.enabled ?? payload.enforce_admins
  if (enforceAdmins !== false) missing.push('enforce_admins must be false')

  return missing
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const requiredChecks = computeRequiredChecks(opts)
  if (!requiredChecks || requiredChecks.length === 0) {
    console.error('FAIL: no required checks resolved')
    process.exit(1)
  }

  const endpoint = `repos/${opts.repo}/branches/${opts.branch}/protection`
  const protection = JSON.parse(runGh(['api', endpoint]))

  if (opts.mode === 'check') {
    const missing = inspectBranchProtection(protection, requiredChecks)
    if (missing.length > 0) {
      console.error('FAIL branch protection policy mismatch')
      for (const line of missing) console.error(`  - ${line}`)
      process.exit(1)
    }
    console.log(`PASS branch protection matches expected policy on ${opts.repo}:${opts.branch}`)
    return
  }

  if (!opts.confirm) {
    console.error('Refusing apply without --confirm')
    process.exit(1)
  }

  if (opts.dryRun) {
    const payload = {
      required_status_checks: {
        strict: true,
        contexts: requiredChecks,
      },
      enforce_admins: false,
      required_pull_request_reviews: {
        required_approving_review_count: opts.requiredApprovals,
      },
      allow_force_pushes: false,
      allow_deletions: false,
      restrictions: null,
    }
    console.log(`Dry run: would apply to ${opts.repo}:${opts.branch}`)
    console.log(JSON.stringify(payload, null, 2))
    return
  }

  const payload = {
    required_status_checks: {
      strict: true,
      contexts: requiredChecks,
    },
    enforce_admins: false,
    required_pull_request_reviews: {
      required_approving_review_count: opts.requiredApprovals,
    },
    allow_force_pushes: false,
    allow_deletions: false,
    restrictions: null,
  }

  runGh(['api', endpoint, '--method', 'PUT', '--input', '-'], JSON.stringify(payload))
  console.log(`APPLY branch protection configured on ${opts.repo}:${opts.branch}`)
}

main()
