import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'

function runScript(scriptPath, args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function parseJsonOutput(result) {
  assert.equal(result.status, 0, `script exited with code ${result.status}: ${result.stderr}`)
  const output = (result.stdout || '').trim()
  assert.ok(output, 'script should emit json output')
  return JSON.parse(output)
}

function extractJsonPath(output) {
  const line = output.split('\n').find((entry) => entry.startsWith('JSON: '))
  assert.ok(line, `stdout did not include JSON artifact path: ${output}`)
  return line.replace('JSON: ', '').trim()
}

test('pp5 webhook batch probe D exposes manual lane checks in JSON mode', () => {
  const result = runScript('scripts/pp5-webhook-batch-probe.mjs', [
    'D',
    '--dry-run',
    '--json',
    '--run-id',
    'pp5-manual',
  ])
  const payload = parseJsonOutput(result)

  assert.equal(payload.ok, true)
  assert.equal(payload.target, 'D')
  assert.equal(payload.failedChecks, 0)
  assert.equal(payload.lanes.length, 4)

  const requiredLanes = [
    'karafiel-grant-award',
    'karafiel-compliance',
    'cotiza-engagement-projection',
    'dhanam-referral-reward',
  ]

  for (const lane of requiredLanes) {
    const record = payload.grouped.find((entry) => entry.lane === lane)
    assert.ok(record, `missing lane ${lane}`)
    assert.equal(record.valid?.runType, 'manual')
    assert.equal(record.invalid?.runType, 'manual')
    assert.equal(record.valid?.passed, null)
    assert.equal(record.valid?.skipped, true)
    assert.equal(record.invalid?.status, null)
    assert.equal(record.valid?.command, 'manual')
    assert.equal(record.valid?.reason, record.invalid?.reason)
  }
})

test('pp5 webhook batch probe all includes Batch D lanes', () => {
  const result = runScript('scripts/pp5-webhook-batch-probe.mjs', [
    'all',
    '--dry-run',
    '--json',
    '--run-id',
    'pp5-all',
  ])
  const payload = parseJsonOutput(result)

  assert.equal(payload.ok, true)
  assert.equal(payload.lanes.length, 20)

  const requiredLanes = [
    'karafiel-grant-award',
    'karafiel-compliance',
    'karafiel',
    'cotiza-engagement-projection',
    'dhanam-referral-reward',
  ]

  for (const lane of requiredLanes) {
    const record = payload.grouped.find((entry) => entry.lane === lane)
    assert.ok(record, `missing lane ${lane}`)
    assert.equal(record.valid?.runType, 'manual')
  }
})

test('pp5 webhook batch probe rejects unknown lane target', () => {
  const result = runScript('scripts/pp5-webhook-batch-probe.mjs', ['lane-does-not-exist'])
  assert.notEqual(result.status, 0)
  assert.ok(
    (result.stderr || '').includes('Unknown batch/lane'),
    `unexpected error output: ${result.stderr}`,
  )
})

test('pp5 batch-run executes Batch D and writes artifacts', () => {
  const outputDir = mkdtempSync(path.join(os.tmpdir(), 'pp5-probe-batch-run-'))

  try {
    const result = runScript('scripts/pp5-probe-batch-run.mjs', [
      '--batches',
      'D',
      '--output-dir',
      outputDir,
      '--run-id',
      'pp5-batch-run-manual',
      '--parallelism',
      '2',
    ])

    assert.equal(result.status, 0, `unexpected exit code ${result.status}: ${result.stderr}`)

    const jsonPath = extractJsonPath(result.stdout || '')
    const artifact = JSON.parse(readFileSync(jsonPath, 'utf8'))

    assert.equal(artifact.batches.length, 1)
    assert.equal(artifact.batches[0].batch, 'D')
    assert.equal(artifact.batches[0].ok, true)
    assert.equal(artifact.summary.failedChecks, 0)

    const grouped = artifact.batchesRaw[0]?.summary?.grouped ?? []
    const groupedLanes = new Set(grouped.map((entry) => entry.lane))
    assert.ok(groupedLanes.has('karafiel-grant-award'))
    assert.ok(groupedLanes.has('karafiel-compliance'))
    assert.ok(groupedLanes.has('cotiza-engagement-projection'))
    assert.ok(groupedLanes.has('dhanam-referral-reward'))
  } finally {
    rmSync(outputDir, { recursive: true, force: true })
  }
})
