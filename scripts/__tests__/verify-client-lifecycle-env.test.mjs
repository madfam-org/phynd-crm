import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'

test('verify-client-lifecycle-env exits 1 when required keys missing from empty env subset', () => {
  const result = spawnSync('node', ['scripts/verify-client-lifecycle-env.mjs', '--json'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PORTAL_BASE_URL: '',
      JANUA_API_URL: '',
      PHYND_ENGAGEMENT_EVENTS_SECRET: '',
      DHANAM_WEBHOOK_SECRET: '',
      PRAVARA_API_KEY: '',
      COTIZA_API_URL: '',
      PHYNDCRM_OUTBOUND_SECRET: '',
      SELVA_API_KEY: '',
      SELVA_DISPATCH_SECRET: '',
    },
  })
  assert.notEqual(result.status, 0)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.ok, false)
})
