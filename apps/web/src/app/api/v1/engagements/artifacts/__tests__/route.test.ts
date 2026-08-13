/**
 * /api/v1/engagements/artifacts — engagement artifact webhook.
 *
 * Contract verified (mirrors the events-route suite, same secret, same #71 fix):
 *   - 503 when PHYND_ENGAGEMENT_EVENTS_SECRET is unset (fail-closed)
 *   - modern `x-madfam-signature: t=<unix>,v1=<hex hmac-sha256 of "t.body">`
 *     accepted — the scheme nauta's publishArtifact signs — with the
 *     validator's 5-minute replay window
 *   - legacy `x-webhook-signature` still accepted during the deprecation
 *     window (cotiza's recordArtifact sends it for signed-proposal PDFs)
 *   - payloads missing engagement_id/type are dropped silently (200, no write)
 *
 * Signatures are REAL HMACs verified by the real @phynd/federation validators.
 */
import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockCheckRateLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 99 })
vi.mock('@/lib/webhooks/rate-limiter', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}))

vi.mock('@phynd/db', () => ({
  getDb: vi.fn(() => ({})),
}))

vi.mock('@phynd/logging', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

// The route only needs NoopCacheManager from the federation root; the
// signature validators come from @phynd/federation/webhooks, which stays REAL.
vi.mock('@phynd/federation', () => ({
  NoopCacheManager: class NoopCacheManager {},
}))

const { mockAddArtifact, EngagementsServiceMock } = vi.hoisted(() => {
  const mockAddArtifact = vi.fn().mockResolvedValue({ id: 'artifact-1' })
  const EngagementsServiceMock = vi.fn().mockImplementation(() => ({
    addArtifact: mockAddArtifact,
  }))
  return { mockAddArtifact, EngagementsServiceMock }
})

vi.mock('@phynd/services', () => ({
  EngagementsService: EngagementsServiceMock,
}))

import { POST } from '../route'

const SECRET = 'test-events-secret'

// The artifact nauta's publishArtifact emits when N8 publishes a QBR.
const artifactPayload = {
  engagement_id: 'eng_nauta_ctm',
  type: 'deliverable',
  entity_type: 'external_reference',
  entity_id: 'qbr-2026-q3',
  url: 'https://nauta.madfam.io/artifacts/qbr-2026-q3.pdf',
  title: 'QBR 2026-Q3',
  metadata: { source: 'nauta' },
}

// MODERN ecosystem scheme (#71): byte-exact mirror of nauta's signMadfamPayload.
function createModernSignedRequest(
  body: object,
  options: { secret?: string; header?: string; timestamp?: number } = {},
) {
  const secret = options.secret ?? SECRET
  const bodyStr = JSON.stringify(body)
  const ts = options.timestamp ?? Math.floor(Date.now() / 1000)
  const hmac = crypto.createHmac('sha256', secret).update(`${ts}.${bodyStr}`).digest('hex')
  return new Request('http://localhost/api/v1/engagements/artifacts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-madfam-signature': options.header ?? `t=${ts},v1=${hmac}`,
    },
    body: bodyStr,
  })
}

// LEGACY scheme (deprecation window): what cotiza's recordArtifact still sends.
function createLegacySignedRequest(body: object, options: { secret?: string } = {}) {
  const secret = options.secret ?? SECRET
  const bodyStr = JSON.stringify(body)
  const signature = crypto.createHmac('sha256', secret).update(bodyStr).digest('hex')
  return new Request('http://localhost/api/v1/engagements/artifacts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-signature': signature,
      'x-webhook-timestamp': new Date().toISOString(),
    },
    body: bodyStr,
  })
}

describe('POST /api/v1/engagements/artifacts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.PHYND_ENGAGEMENT_EVENTS_SECRET = SECRET
    process.env.REDIS_URL = 'redis://localhost:6379'
    mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 99 })
    mockAddArtifact.mockResolvedValue({ id: 'artifact-1' })
  })

  afterEach(() => {
    delete process.env.PHYND_ENGAGEMENT_EVENTS_SECRET
    delete process.env.REDIS_URL
  })

  it('returns 503 when PHYND_ENGAGEMENT_EVENTS_SECRET is unset (fail-closed)', async () => {
    delete process.env.PHYND_ENGAGEMENT_EVENTS_SECRET
    const res = await POST(createModernSignedRequest(artifactPayload))
    expect(res.status).toBe(503)
    expect(mockAddArtifact).not.toHaveBeenCalled()
  })

  it('accepts a modern-signed artifact (nauta publishArtifact contract) and records it', async () => {
    const res = await POST(createModernSignedRequest(artifactPayload))
    expect(res.status).toBe(200)
    expect(mockAddArtifact).toHaveBeenCalledTimes(1)
    expect(mockAddArtifact).toHaveBeenCalledWith({
      engagementId: 'eng_nauta_ctm',
      type: 'deliverable',
      entityType: 'external_reference',
      entityId: 'qbr-2026-q3',
      url: 'https://nauta.madfam.io/artifacts/qbr-2026-q3.pdf',
      title: 'QBR 2026-Q3',
      metadata: { source: 'nauta' },
    })
  })

  it('rejects a bad modern signature with 401 and records nothing', async () => {
    const res = await POST(
      createModernSignedRequest(artifactPayload, {
        header: `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`,
      }),
    )
    expect(res.status).toBe(401)
    expect(mockAddArtifact).not.toHaveBeenCalled()
  })

  it('rejects a stale modern timestamp (>5 min old) with 401', async () => {
    const res = await POST(
      createModernSignedRequest(artifactPayload, {
        timestamp: Math.floor(Date.now() / 1000) - 6 * 60,
      }),
    )
    expect(res.status).toBe(401)
    expect(mockAddArtifact).not.toHaveBeenCalled()
  })

  it('still accepts the legacy x-webhook-signature scheme (cotiza deprecation window)', async () => {
    const cotizaArtifact = {
      engagement_id: 'eng_tablaco',
      type: 'signed_proposal',
      url: 'https://cotiza.studio/proposals/p-1.pdf',
      title: 'Propuesta firmada',
    }
    const res = await POST(createLegacySignedRequest(cotizaArtifact))
    expect(res.status).toBe(200)
    expect(mockAddArtifact).toHaveBeenCalledTimes(1)
    expect(mockAddArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ engagementId: 'eng_tablaco', type: 'signed_proposal' }),
    )
  })

  it('rejects a forged legacy signature with 401', async () => {
    const res = await POST(
      createLegacySignedRequest(artifactPayload, { secret: 'not-the-configured-secret' }),
    )
    expect(res.status).toBe(401)
    expect(mockAddArtifact).not.toHaveBeenCalled()
  })

  it('drops payloads missing engagement_id/type silently (200, no write)', async () => {
    const res = await POST(createModernSignedRequest({ type: 'deliverable' }))
    expect(res.status).toBe(200)
    expect(mockAddArtifact).not.toHaveBeenCalled()
  })
})
