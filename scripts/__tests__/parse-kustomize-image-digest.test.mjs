import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parseKustomizeImageDigest } from '../parse-kustomize-image-digest.mjs'

const WEB = 'ghcr.io/madfam-org/phynd-crm/web'
const WORKER = 'ghcr.io/madfam-org/phynd-crm/worker'

test('parseKustomizeImageDigest reads digest-before-name staging kustomization', () => {
  const content = readFileSync('infra/k8s/overlays/staging/kustomization.yaml', 'utf8')
  const webDigest = parseKustomizeImageDigest(content, WEB)
  const workerDigest = parseKustomizeImageDigest(content, WORKER)
  assert.match(webDigest ?? '', /^sha256:[a-f0-9]+$/)
  assert.match(workerDigest ?? '', /^sha256:[a-f0-9]+$/)
})

test('parseKustomizeImageDigest reads digest-before-name production kustomization', () => {
  const content = readFileSync('infra/k8s/production/kustomization.yaml', 'utf8')
  assert.equal(parseKustomizeImageDigest(content, WEB)?.startsWith('sha256:'), true)
  assert.equal(parseKustomizeImageDigest(content, WORKER)?.startsWith('sha256:'), true)
})

test('parseKustomizeImageDigest supports name-before-digest blocks', () => {
  const content = `
images:
- name: ${WEB}
  newName: ${WEB}
  digest: sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
`
  assert.equal(
    parseKustomizeImageDigest(content, WEB),
    'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  )
})
