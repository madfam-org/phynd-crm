import { afterEach, describe, expect, it, vi } from 'vitest'
import { januaLogoutUrl, januaLogoutUrlFromEnv } from '../janua-logout'

const ISSUER = 'https://auth.example.test'
const CLIENT = 'synthetic-client-id'

afterEach(() => vi.unstubAllEnvs())

describe('Janua end-session URL', () => {
  it('names the client and returns to the CRM origin root', () => {
    const url = new URL(
      januaLogoutUrl({ issuer: ISSUER, clientId: CLIENT, origin: 'https://crm.example.test' }) ?? '',
    )
    expect(`${url.origin}${url.pathname}`).toBe('https://auth.example.test/logout')
    expect(url.searchParams.get('client_id')).toBe(CLIENT)
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('https://crm.example.test/')
  })

  it('keeps an issuer path', () => {
    const url = januaLogoutUrl({
      issuer: 'https://auth.example.test/tenant/',
      clientId: CLIENT,
      origin: 'https://crm.example.test',
    })
    expect(url?.startsWith('https://auth.example.test/tenant/logout?')).toBe(true)
  })

  it.each([
    { issuer: undefined, clientId: CLIENT, origin: 'https://crm.example.test' },
    { issuer: ISSUER, clientId: '', origin: 'https://crm.example.test' },
    { issuer: ISSUER, clientId: CLIENT, origin: '' },
    { issuer: 'http://auth.example.test', clientId: CLIENT, origin: 'https://crm.example.test' },
    { issuer: 'https://user:pw@auth.example.test', clientId: CLIENT, origin: 'https://crm.example.test' },
    { issuer: 'not a url', clientId: CLIENT, origin: 'https://crm.example.test' },
  ])('returns null when configuration is missing or unsafe (%o)', (input) => {
    expect(januaLogoutUrl(input)).toBeNull()
  })

  it('reads the issuer and client id from the environment', () => {
    vi.stubEnv('AUTH_JANUA_ISSUER', ISSUER)
    vi.stubEnv('AUTH_JANUA_CLIENT_ID', CLIENT)
    expect(januaLogoutUrlFromEnv('https://crm.example.test')).toContain('client_id=synthetic-client-id')
    vi.stubEnv('AUTH_JANUA_CLIENT_ID', '')
    expect(januaLogoutUrlFromEnv('https://crm.example.test')).toBeNull()
  })
})
