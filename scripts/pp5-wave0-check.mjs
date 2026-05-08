#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

const checks = [
  {
    name: 'secret template coverage',
    command: ['node', 'scripts/pp5-staging-audit.mjs'],
  },
  {
    name: 'webhook probe coverage',
    command: ['node', 'scripts/pp5-webhook-probe.mjs', 'list'],
  },
  {
    name: 'staging overlay render',
    command: ['kubectl', 'kustomize', 'infra/k8s/overlays/staging'],
  },
  {
    name: 'staging namespace',
    command: ['kubectl', 'get', 'ns', 'phyne-crm-staging'],
  },
  {
    name: 'staging secret',
    command: ['kubectl', '-n', 'phyne-crm-staging', 'get', 'secret', 'phyne-crm-staging-secrets'],
  },
  {
    name: 'staging image pull secret',
    command: ['kubectl', '-n', 'phyne-crm-staging', 'get', 'secret', 'ghcr-credentials'],
  },
  {
    name: 'staging ArgoCD app',
    command: ['kubectl', '-n', 'argocd', 'get', 'application', 'phyne-crm-staging'],
  },
  {
    name: 'staging ArgoCD sync',
    command: [
      'kubectl',
      '-n',
      'argocd',
      'wait',
      '--for=jsonpath={.status.sync.status}=Synced',
      'application/phyne-crm-staging',
      '--timeout=30s',
    ],
  },
  {
    name: 'staging web rollout',
    command: [
      'kubectl',
      '-n',
      'phyne-crm-staging',
      'rollout',
      'status',
      'deployment/phyne-crm-web',
      '--timeout=30s',
    ],
  },
  {
    name: 'staging worker rollout',
    command: [
      'kubectl',
      '-n',
      'phyne-crm-staging',
      'rollout',
      'status',
      'deployment/phyne-crm-worker',
      '--timeout=30s',
    ],
  },
  {
    name: 'staging health DNS/HTTP',
    command: ['curl', '-fsS', 'https://staging-crm.madfam.io/api/health'],
  },
]

function run(check) {
  const result = spawnSync(check.command[0], check.command.slice(1), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  return {
    ...check,
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    status: result.status,
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
    const detail = check.stderr || check.stdout || `exit status ${check.status}`
    for (const line of detail.split('\n').filter(Boolean).slice(0, 4)) {
      console.log(`  ${line}`)
    }
  }

  if (failed > 0) {
    console.log(`Wave 0 blocked: ${failed} check(s) failed`)
    process.exit(1)
  }

  console.log('Wave 0 ready')
}

main()
