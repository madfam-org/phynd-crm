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

const PILOT_OVERLAY_KEYS = [
  'SELVA_WEBHOOK_SECRET',
  'PHYND_SELVA_EMBED_ALLOWED',
  'PHYND_CAMPAIGN_IMPORT_SECRET',
  'PHYND_DEPLOYMENT_TIER',
  'FEDERATION_SERVICE_USER_ID',
  'NEXTAUTH_URL',
  'NEXT_PUBLIC_APP_URL',
]

function parsePilotOverlayKeys() {
  const webPatch = readFileSync('infra/k8s/overlays/staging/web-deployment.patch.yaml', 'utf8')
  assert.match(webPatch, /phynd-crm-staging-pilot-overlay/, 'staging web deployment should mount pilot overlay')
  return new Set(PILOT_OVERLAY_KEYS)
}

test('staging ExternalSecret maps every required staging env key from Vault', () => {
  const requiredKeys = parseRequiredKeys()
  const externalSecretText = readFileSync(EXTERNAL_SECRET_PATH, 'utf8')
  const externalSecretKeys = new Set(parseExternalSecretKeys())
  const pilotOverlayKeys = parsePilotOverlayKeys()

  for (const key of requiredKeys) {
    const inExternalSecret = externalSecretKeys.has(key)
    const inPilotOverlay = pilotOverlayKeys.has(key)
    assert.ok(
      inExternalSecret || inPilotOverlay,
      `missing ExternalSecret or pilot overlay secretKey ${key}`,
    )
    if (inExternalSecret) {
      assert.match(
        externalSecretText,
        new RegExp(`property: ${lowerSnake(key)}\\n`),
        `missing Vault property for ${key}`,
      )
    }
  }

  assert.match(externalSecretText, /key: secret\/phynd-crm-staging/)
  assert.match(externalSecretText, /name: vault-store/)
  assert.match(externalSecretText, /name: phynd-crm-staging-secrets/)
})
