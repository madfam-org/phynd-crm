import { SignJWT, exportJWK, generateKeyPair, importJWK } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetJwksCacheForTesting, verifyJanuaAccessToken } from '../jwks'

// jose v6 dropped the KeyLike type export; the unified runtime type is
// CryptoKey | Uint8Array. We accept `unknown` here and hand it to sign()
// which narrows internally — keeps the test self-contained.
type SigningKey = Parameters<SignJWT['sign']>[0]

const ISSUER = 'https://auth.madfam.io'

async function mintToken(
  signingKey: SigningKey,
  overrides: {
    sub?: string
    email?: string
    iss?: string
    exp?: number
    alg?: string
  } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({
    email: overrides.email ?? 'tablaco@example.com',
    email_verified: true,
  })
    .setProtectedHeader({ alg: overrides.alg ?? 'RS256', kid: 'test-kid' })
    .setIssuer(overrides.iss ?? ISSUER)
    .setSubject(overrides.sub ?? 'usr-janua-001')
    .setIssuedAt(now)
    .setExpirationTime(overrides.exp ?? now + 900)
    .sign(signingKey)
}

// Generate a RSA keypair once and stand up a mock JWKS endpoint by
// intercepting the global fetch that `createRemoteJWKSet` uses.
describe('verifyJanuaAccessToken', () => {
  const originalEnv = { ...process.env }
  let publicJwk: Record<string, unknown>
  let privateKey: SigningKey
  // biome-ignore lint/suspicious/noExplicitAny: vi.spyOn type ergonomics for global.fetch
  let fetchSpy: any

  beforeEach(async () => {
    process.env.JANUA_API_URL = ISSUER
    const kp = await generateKeyPair('RS256', { extractable: true })
    privateKey = kp.privateKey
    publicJwk = { ...(await exportJWK(kp.publicKey)), kid: 'test-kid', alg: 'RS256', use: 'sig' }

    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ keys: [publicJwk] }),
      // biome-ignore lint/suspicious/noExplicitAny: minimal Response stub
    } as any)

    __resetJwksCacheForTesting()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  it('verifies a valid RS256 token signed by the published key', async () => {
    const token = await mintToken(privateKey)
    const claims = await verifyJanuaAccessToken(token)
    expect(claims.sub).toBe('usr-janua-001')
    expect(claims.email).toBe('tablaco@example.com')
    expect(fetchSpy).toHaveBeenCalled()
  })

  it('rejects tokens signed by a different key', async () => {
    const otherKp = await generateKeyPair('RS256', { extractable: true })
    const forged = await mintToken(otherKp.privateKey)
    await expect(verifyJanuaAccessToken(forged)).rejects.toThrow()
  })

  it('rejects expired tokens', async () => {
    const token = await mintToken(privateKey, { exp: Math.floor(Date.now() / 1000) - 60 })
    await expect(verifyJanuaAccessToken(token)).rejects.toThrow()
  })

  it('rejects tokens with a mismatched issuer', async () => {
    const token = await mintToken(privateKey, { iss: 'https://attacker.example' })
    await expect(verifyJanuaAccessToken(token)).rejects.toThrow()
  })

  it('rejects tokens missing sub', async () => {
    const now = Math.floor(Date.now() / 1000)
    const token = await new SignJWT({ email: 'x@y.z' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
      .setIssuer(ISSUER)
      .setIssuedAt(now)
      .setExpirationTime(now + 900)
      .sign(privateKey)
    await expect(verifyJanuaAccessToken(token)).rejects.toThrow(/sub/i)
  })

  it('rejects tokens using HS256 (algorithm confusion defense)', async () => {
    const hsKey = new TextEncoder().encode('x'.repeat(32))
    // Reuse the JWKS-served public key's kid so the verifier finds a
    // key but then rejects the algorithm mismatch. This is the
    // classic alg=HS256 attack against RS256-only verifiers.
    const token = await new SignJWT({ sub: 'usr', email: 'x@y.z' })
      .setProtectedHeader({ alg: 'HS256', kid: 'test-kid' })
      .setIssuer(ISSUER)
      .setIssuedAt(Math.floor(Date.now() / 1000))
      .setExpirationTime(Math.floor(Date.now() / 1000) + 900)
      .sign(hsKey)
    await expect(verifyJanuaAccessToken(token)).rejects.toThrow()
  })

  it('throws when JANUA_API_URL is not configured', async () => {
    delete process.env.JANUA_API_URL
    __resetJwksCacheForTesting()
    const token = await mintToken(privateKey)
    await expect(verifyJanuaAccessToken(token)).rejects.toThrow(/JANUA_API_URL/)
  })

  it('can accept a JWK import round-trip (safety sanity check)', async () => {
    // Meta-test: prove the test fixture would also work with a
    // verification key imported directly. Catches breakage in the jose
    // version we're pulling transitively.
    const imported = await importJWK(publicJwk, 'RS256')
    expect(imported).toBeDefined()
  })
})
