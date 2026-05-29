import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { buildPilotOpsReport } from '../pp5-pilot-ops-checklist.mjs'

test('buildPilotOpsReport passes static automated gates', () => {
  const report = buildPilotOpsReport({ skipProdAuth: true, live: false })
  assert.equal(report.ok, true)
  assert.ok(report.automated.some((step) => step.id === 'verify-pilot-go-live' && step.ok))
  assert.ok(report.automated.some((step) => step.id === 'db-migrate-artifacts' && step.ok))
  assert.ok(report.automated.some((step) => step.id === 'janua-oidc-checklist' && step.ok))
})

test('pp5-pilot-ops-checklist dry-run exits zero', () => {
  const result = spawnSync(process.execPath, ['scripts/pp5-pilot-ops-checklist.mjs', '--json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const payload = JSON.parse(result.stdout.trim())
  assert.equal(payload.ok, true)
})

test('buildPilotOpsReport fails live mode without CRM_BASE_URL', () => {
  const report = buildPilotOpsReport(
    { skipProdAuth: true, live: true },
    { CRM_BASE_URL: '' },
  )
  assert.equal(report.ok, false)
  const postDeploy = report.automated.find((step) => step.id === 'verify-post-deploy')
  assert.ok(postDeploy?.error?.includes('CRM_BASE_URL'))
})
