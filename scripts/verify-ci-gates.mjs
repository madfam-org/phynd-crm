#!/usr/bin/env node

import fs from 'node:fs'

function fail(message) {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}

const ciConfig = fs.readFileSync('.github/workflows/ci.yml', 'utf8')
const e2eConfig = fs.readFileSync('.github/workflows/e2e.yml', 'utf8')

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

console.log('PASS workflow gate wiring checks')
