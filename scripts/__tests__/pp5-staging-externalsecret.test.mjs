import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const VALIDATOR_PATH = 'scripts/pp5-validate-staging-env.mjs'
const EXTERNAL_SECRET_PATH = 'infra/k8s/overlays/staging/external-secret.yaml'
const KUSTOMIZATION_PATH = 'infra/k8s/overlays/staging/kustomization.yaml'

function parseRequiredKeys() {
  const source = readFileSync(VALIDATOR_PATH, 'utf8')
  const match = source.match(/const REQUIRED_NON_EMPTY = new Set\(\[\n([\s\S]*?)\n\]\)/)
  assert.ok(match, 'validator should declare REQUIRED_NON_EMPTY')

  return [...match[1].matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((entry) => entry[1])
}

function parseExternalSecretKeys() {
  const source = readFileSync(EXTERNAL_SECRET_PATH, 'utf8')
  return [...source.matchAll(/^\s+- secretKey: ([A-Z][A-Z0-9_]*)$/gm)].map((entry) => entry[1])
}

function lowerSnake(key) {
  return key.toLowerCase()
}

test('staging ExternalSecret is included in the staging overlay', () => {
  const kustomization = readFileSync(KUSTOMIZATION_PATH, 'utf8')
  assert.match(kustomization, /- external-secret\.yaml/)
})

test('staging ExternalSecret maps every required staging env key from Vault', () => {
  const requiredKeys = parseRequiredKeys()
  const externalSecretText = readFileSync(EXTERNAL_SECRET_PATH, 'utf8')
  const externalSecretKeys = new Set(parseExternalSecretKeys())

  for (const key of requiredKeys) {
    assert.ok(externalSecretKeys.has(key), `missing ExternalSecret secretKey ${key}`)
    assert.match(
      externalSecretText,
      new RegExp(`property: ${lowerSnake(key)}\\n`),
      `missing Vault property for ${key}`,
    )
  }

  assert.match(externalSecretText, /key: secret\/phynd-crm-staging/)
  assert.match(externalSecretText, /name: vault-store/)
  assert.match(externalSecretText, /name: phynd-crm-staging-secrets/)
})
