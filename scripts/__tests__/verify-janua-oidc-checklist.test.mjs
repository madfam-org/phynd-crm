import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import {
  JANUA_OIDC_CALLBACK_PATH,
  REQUIRED_JANUA_REDIRECT_URIS,
  buildJanuaOidcChecklist,
} from '../verify-janua-oidc-checklist.mjs'

test('REQUIRED_JANUA_REDIRECT_URIS includes pilot hosts', () => {
  assert.equal(JANUA_OIDC_CALLBACK_PATH, '/api/auth/callback/janua')
  assert.ok(REQUIRED_JANUA_REDIRECT_URIS.some((uri) => uri.includes('crm.madfam.io')))
  assert.ok(REQUIRED_JANUA_REDIRECT_URIS.some((uri) => uri.includes('staging-crm.madfam.io')))
})

test('REQUIRED_JANUA_PORTAL_VERIFY_ORIGINS includes MADFAM production portal', async () => {
  const { REQUIRED_JANUA_PORTAL_VERIFY_ORIGINS } = await import('../verify-janua-oidc-checklist.mjs')
  assert.ok(
    REQUIRED_JANUA_PORTAL_VERIFY_ORIGINS.some((uri) => uri === 'https://crm.madfam.io/portal/verify'),
  )
})

test('buildJanuaOidcChecklist passes without live probes', () => {
  const report = buildJanuaOidcChecklist({ verifyLive: false })
  assert.equal(report.ok, true)
  assert.equal(report.requiredRedirectUris.length, 3)
})

test('verify-janua-oidc-checklist prints redirect URIs', () => {
  const result = spawnSync(process.execPath, ['scripts/verify-janua-oidc-checklist.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /crm\.madfam\.io\/api\/auth\/callback\/janua/)
})
