#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

const checks = [
  {
    name: 'stability guardrails',
    command: ['node', 'scripts/pp5-stability-check.mjs'],
  },
  {
    name: 'staging overlay render',
    command: ['kubectl', 'kustomize', 'infra/k8s/overlays/staging'],
  },
  {
    name: 'staging namespace',
    command: ['kubectl', 'get', 'ns', 'phynd-crm-staging'],
  },
  {
    name: 'staging secret',
    command: ['kubectl', '-n', 'phynd-crm-staging', 'get', 'secret', 'phynd-crm-staging-secrets'],
  },
  {
    name: 'staging image pull secret',
    command: ['kubectl', '-n', 'phynd-crm-staging', 'get', 'secret', 'ghcr-credentials'],
  },
  {
    name: 'staging ArgoCD app',
    command: ['kubectl', '-n', 'argocd', 'get', 'application', 'phynd-crm-staging'],
  },
  {
    name: 'staging ArgoCD sync',
    command: [
      'kubectl',
      '-n',
      'argocd',
      'wait',
      '--for=jsonpath={.status.sync.status}=Synced',
      'application/phynd-crm-staging',
      '--timeout=30s',
    ],
  },
  {
    name: 'staging web rollout',
    command: [
      'kubectl',
      '-n',
      'phynd-crm-staging',
      'rollout',
      'status',
      'deployment/phynd-crm-web',
      '--timeout=30s',
    ],
  },
  {
    name: 'staging worker rollout',
    command: [
      'kubectl',
      '-n',
      'phynd-crm-staging',
      'rollout',
      'status',
      'deployment/phynd-crm-worker',
      '--timeout=30s',
    ],
  },
  {
    name: 'staging health DNS/HTTP',
    command: ['curl', '-fsS', '--connect-timeout', '5', '--max-time', '12', 'https://staging-phynd.app/api/health'],
  },
]

function run(check) {
  try {
    const result = spawnSync(check.command[0], check.command.slice(1), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 18000,
      killSignal: 'SIGKILL',
    })

    return {
      ...check,
      ok: result.status === 0,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
      status: result.status,
      timedOut: false,
    }
  } catch (error) {
    const message = error?.message || 'unknown command error'
    return {
      ...check,
      ok: false,
      stdout: '',
      stderr: message,
      status: 1,
      timedOut: true,
    }
  }
}

function main() {
  let failed = 0

  for (const check of checks.map(run)) {
    if (check.ok) {
      console.log(`PASS ${check.name}`)
      continue
    }

    failed += 1
    console.log(`BLOCKED ${check.name}`)
    const timedOutSuffix = check.timedOut ? ' (timed out)' : ''
    const detail = check.stderr || check.stdout || `exit status ${check.status}`
    for (const line of detail.split('\n').filter(Boolean).slice(0, 4)) {
      console.log(`  ${line}${timedOutSuffix}`)
    }
  }

  if (failed > 0) {
    console.log(`Wave 0 blocked: ${failed} check(s) failed`)
    process.exit(1)
  }

  console.log('Wave 0 ready')
}

main()
