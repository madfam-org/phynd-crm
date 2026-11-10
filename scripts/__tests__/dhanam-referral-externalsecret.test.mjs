import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

/**
 * Guard for the referral-reward signing key. It comes from Dhanam's Vault path
 * secret/dhanam/referral:referral_webhook_secret, which does not exist until
 * the Enclii intake mints it. Until then external-secret-dhanam-referral.yaml
 * is SPEC ONLY, NOT WIRED: listed in kustomization.yaml it would fail every
 * refresh and hold Argo Degraded.
 *
 * WIRING IS DELIBERATE: after the key is minted and Dhanam is wired, uncomment
 * the kustomization entry, add the optional envFrom secretRef to the worker
 * Deployment, and flip WIRED below, all in the same PR.
 */
const WIRED = false

const PROD = 'infra/k8s/production'
const ES_FILE = 'external-secret-dhanam-referral.yaml'
const ES_NAME = 'phynd-crm-dhanam-referral'

const read = (path) => readFileSync(path, 'utf8')
const activeLines = (text) => text.split('\n').filter((line) => !line.trimStart().startsWith('#'))

test('reads the verifier-owned Dhanam property into its own Secret', () => {
  const es = activeLines(read(`${PROD}/${ES_FILE}`)).join('\n')

  assert.match(es, /^kind: ExternalSecret$/m)
  assert.match(es, new RegExp(`^  name: ${ES_NAME}$`, 'm'))
  assert.match(es, /^  namespace: phynd-crm$/m)
  assert.match(es, /secretStoreRef:\n {4}name: vault-store\n {4}kind: ClusterSecretStore/)
  assert.match(
    es,
    new RegExp(`target:\\n {4}name: ${ES_NAME}\\n {4}creationPolicy: Owner\\n {4}deletionPolicy: Retain`),
  )
  // Exactly one key, read cross-path from Dhanam's path (never a copy in ours).
  assert.deepEqual([...es.matchAll(/- secretKey: (\S+)/g)].map((m) => m[1]), [
    'DHANAM_REFERRAL_WEBHOOK_SECRET',
  ])
  assert.match(es, /key: secret\/dhanam\/referral\n {8}property: referral_webhook_secret\n/)
})

test(`is ${WIRED ? 'wired' : 'NOT wired'} in the production kustomization`, () => {
  const resources = activeLines(read(`${PROD}/kustomization.yaml`))
  assert.equal(resources.some((line) => line.trim() === `- ${ES_FILE}`), WIRED)
})

test(`the worker ${WIRED ? 'mounts' : 'does not mount'} the Secret, and only optionally`, () => {
  const worker = activeLines(read(`${PROD}/worker-deployment.yaml`)).join('\n')
  const ref = new RegExp(`- secretRef:\\n\\s+name: ${ES_NAME}\\n\\s+optional: true`)
  assert.equal(ref.test(worker), WIRED)
  if (!WIRED) assert.doesNotMatch(worker, new RegExp(ES_NAME))
})

test('staging never reads the PRODUCTION Dhanam key', () => {
  const staging = activeLines(read('infra/k8s/overlays/staging/kustomization.yaml')).join('\n')
  assert.doesNotMatch(staging, new RegExp(ES_FILE.replace('.', '\\.')))
  assert.doesNotMatch(read('infra/k8s/overlays/staging/external-secret.yaml'), /secret\/dhanam\b/)
})
