#!/usr/bin/env node

import fs from 'node:fs'

function asDisplayCheckName(rawName) {
  const trimmedName = rawName.trim()
  if (!trimmedName) return trimmedName
  return trimmedName.startsWith('CI / ') ? trimmedName : `CI / ${trimmedName}`
}

function extractBranchProtectionChecks(scriptPath) {
  const text = fs.readFileSync(scriptPath, 'utf8')
  const definitionIndex = text.indexOf('const DEFAULT_REQUIRED_CHECKS')
  if (definitionIndex < 0) {
    throw new Error('Unable to read DEFAULT_REQUIRED_CHECKS from branch protection script')
  }

  const arrayStart = text.indexOf('[', definitionIndex)
  if (arrayStart < 0) {
    throw new Error('Unable to read DEFAULT_REQUIRED_CHECKS from branch protection script')
  }

  const arrayEnd = text.indexOf(']', arrayStart)
  if (arrayEnd < 0) {
    throw new Error('Unable to read DEFAULT_REQUIRED_CHECKS from branch protection script')
  }

  const match = text.slice(arrayStart + 1, arrayEnd)
  const checks = [...match.matchAll(/'([^']+)'/g)].map((entry) => entry[1])
  if (!checks.length) {
    throw new Error('Unable to read DEFAULT_REQUIRED_CHECKS from branch protection script')
  }

  return checks
}

function collectJobNamesFromWorkflow(ciConfig) {
  const lines = ciConfig.split('\n')
  const jobNames = new Set()
  let inJobs = false
  let inJob = false
  let currentJobName = null

  for (const line of lines) {
    if (/^jobs:/m.test(line)) {
      inJobs = true
      continue
    }

    if (!inJobs) continue

    const jobLine = /^\s{2}([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (jobLine) {
      if (inJob && currentJobName) jobNames.add(currentJobName)
      inJob = true
      currentJobName = null
      continue
    }

    const nameLine = /^\s{4}name:\s*(.+)\s*$/.exec(line)
    if (inJob && nameLine) {
      currentJobName = asDisplayCheckName(nameLine[1])
      continue
    }

    if (/^ {0,2}\S/.test(line)) {
      if (inJob && currentJobName) jobNames.add(currentJobName)
      inJob = false
      currentJobName = null
      inJobs = false
      continue
    }
  }

  if (inJob && currentJobName) jobNames.add(currentJobName)

  return jobNames
}

function fail(message, details) {
  console.error(`FAIL: ${message}`)
  if (details && details.length > 0) {
    for (const detail of details) {
      console.error(`  - ${detail}`)
    }
  }
  process.exit(1)
}

const ciConfig = fs.readFileSync('.github/workflows/ci.yml', 'utf8')
const e2eConfig = fs.readFileSync('.github/workflows/e2e.yml', 'utf8')
const requiredChecks = extractBranchProtectionChecks('scripts/pp5-github-branch-protection.mjs')

const ciRefsE2E = /uses:\s*\.\/\.github\/workflows\/e2e\.yml/.test(ciConfig)
if (!ciRefsE2E) {
  fail('ci.yml does not call ./.github/workflows/e2e.yml')
}

const hasWorkflowCall = /workflow_call:/m.test(e2eConfig)
if (!hasWorkflowCall) {
  fail('e2e.yml missing workflow_call trigger')
}

if (/pull_request:/.test(e2eConfig) || /push:/.test(e2eConfig)) {
  fail('e2e.yml must not trigger on push/pull_request once invoked from CI')
}

const hasReusableOutput = /name:\s*E2E Tests/.test(ciConfig) && /name:\s*Playwright E2E/.test(e2eConfig)
if (!hasReusableOutput) {
  fail('E2E workflow names are not both present')
}

const ciJobNames = collectJobNamesFromWorkflow(ciConfig)
const missingChecks = requiredChecks.filter((check) => !ciJobNames.has(check))
if (missingChecks.length > 0) {
  fail('required branch-protection checks do not match CI job names', missingChecks)
}

console.log('PASS workflow gate wiring checks')
