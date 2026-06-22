import assert from 'node:assert/strict'
import { test } from 'node:test'
import { INTERNAL_HOST_RE, validateJanuaProviderUrls } from '../verify-prod-auth-urls.mjs'

test('validateJanuaProviderUrls rejects internal pod hosts', () => {
  const result = validateJanuaProviderUrls('https://crm.madfam.io', {
    signinUrl: 'https://auth.madfam.io/signin',
    callbackUrl: 'http://phynd-crm-web-abc:3000/api/auth/callback/janua',
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /Internal host leaked/)
  assert.match('http://phynd-crm-web-abc:3000/x', INTERNAL_HOST_RE)
})

test('validateJanuaProviderUrls requires callback host to match request base', () => {
  const result = validateJanuaProviderUrls('https://crm.madfam.io', {
    signinUrl: 'https://auth.madfam.io/signin',
    callbackUrl: 'https://phynd.app/api/auth/callback/janua',
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /Callback host mismatch/)
})

test('validateJanuaProviderUrls accepts canonical callback for marketing host', () => {
  const result = validateJanuaProviderUrls(
    'https://phynd.app',
    {
      signinUrl: 'https://crm.phynd.app/api/auth/signin/janua',
      callbackUrl: 'https://crm.phynd.app/api/auth/callback/janua',
    },
    'https://crm.phynd.app',
  )
  assert.equal(result.ok, true)
})

test('validateJanuaProviderUrls accepts matching callback for staff CRM host', () => {
  const result = validateJanuaProviderUrls('https://crm.phynd.app', {
    signinUrl: 'https://crm.phynd.app/api/auth/signin/janua',
    callbackUrl: 'https://crm.phynd.app/api/auth/callback/janua',
  })
  assert.equal(result.ok, true)
})
