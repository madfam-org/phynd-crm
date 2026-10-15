import { describe, expect, it, vi } from 'vitest'
import {
  MAX_EVIDENCE_BYTES,
  checkEvidenceFile,
  isEvidenceKeyFor,
  sniffEvidenceMime,
} from '../payment-evidence/evidence-file'
import {
  EMPTY_PAYLOAD_SHA256,
  createR2EvidenceStorage,
  presignUrl,
  readR2Config,
  signHeaders,
} from '../payment-evidence/storage'

// AWS's published SigV4 examples (S3 docs, "Authenticating Requests: Using
// Query Parameters" and "...Using the Authorization Header"); the example
// credentials are AWS's documentation placeholders.
const AWS_EXAMPLE = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  date: new Date('2013-05-24T00:00:00Z'),
}

const CONFIG = {
  bucket: 'phynd-crm-payment-evidence',
  endpoint: 'https://example-account.r2.cloudflarestorage.com',
  accessKeyId: 'test-access-key',
  secretAccessKey: 'test-secret-key',
  region: 'auto',
}

describe('SigV4', () => {
  it('matches the AWS presigned-URL example', () => {
    const url = presignUrl({
      ...AWS_EXAMPLE,
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      expiresIn: 86400,
    })
    expect(url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    )
  })

  it('matches the AWS header-signed GET example', () => {
    const headers = signHeaders({
      ...AWS_EXAMPLE,
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: { Range: 'bytes=0-9' },
      payloadSha256: EMPTY_PAYLOAD_SHA256,
    })
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    )
  })
})

describe('R2 evidence storage', () => {
  it('needs all four R2_* keys', () => {
    const env = {
      R2_BUCKET_NAME: CONFIG.bucket,
      R2_ENDPOINT_URL: `${CONFIG.endpoint}/`,
      R2_ACCESS_KEY_ID: 'a',
      R2_SECRET_ACCESS_KEY: 'b',
    }
    expect(readR2Config(env)).toMatchObject({
      bucket: CONFIG.bucket,
      endpoint: CONFIG.endpoint,
      region: 'auto',
    })
    for (const key of Object.keys(env)) {
      expect(readR2Config({ ...env, [key]: '' }), key).toBeNull()
    }
  })

  it('presigns a short-lived, private, path-style GET', () => {
    const storage = createR2EvidenceStorage(CONFIG, { now: () => new Date('2026-10-15T00:00:00Z') })
    const url = new URL(
      storage.presignGet(`payment-evidence/${'a'.repeat(64)}.pdf`, {
        expiresIn: 120,
        contentType: 'application/pdf',
        inlineFilename: 'comprobante.pdf',
      }),
    )
    expect(url.host).toBe('example-account.r2.cloudflarestorage.com')
    expect(url.pathname).toBe(`/phynd-crm-payment-evidence/payment-evidence/${'a'.repeat(64)}.pdf`)
    expect(url.searchParams.get('X-Amz-Expires')).toBe('120')
    expect(url.searchParams.get('X-Amz-Credential')).toMatch(
      /^test-access-key\/20261015\/auto\/s3\/aws4_request$/,
    )
    expect(url.searchParams.get('response-content-disposition')).toBe(
      'inline; filename="comprobante.pdf"',
    )
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
    expect(url.toString()).not.toContain(CONFIG.secretAccessKey)
  })

  it('PUTs with the content hash it was given and HEADs for existence', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
    const storage = createR2EvidenceStorage(CONFIG, { fetch: fetchMock as unknown as typeof fetch })
    const sha = 'c'.repeat(64)
    await storage.put(`payment-evidence/${sha}.png`, new Uint8Array([1, 2, 3]), {
      contentType: 'image/png',
      sha256: sha,
    })
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(init.method).toBe('PUT')
    expect(headers['x-amz-content-sha256']).toBe(sha)
    expect(headers['content-type']).toBe('image/png')
    expect(headers.authorization).toMatch(
      /SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date/,
    )
    expect(await storage.exists('payment-evidence/missing.png')).toBe(false)
  })
})

describe('evidence files', () => {
  const pad = (head: number[] | string) =>
    Buffer.concat([Buffer.from(head as never), Buffer.alloc(16)])

  it('sniffs JPEG, PNG, WebP, HEIC and PDF from bytes, nothing else', () => {
    expect(sniffEvidenceMime(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffEvidenceMime(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'image/png',
    )
    expect(sniffEvidenceMime(pad('RIFF\0\0\0\0WEBP'))).toBe('image/webp')
    expect(sniffEvidenceMime(pad('\0\0\0\x18ftypheic'))).toBe('image/heic')
    expect(sniffEvidenceMime(pad('%PDF-1.7'))).toBe('application/pdf')
    expect(sniffEvidenceMime(pad('GIF89a'))).toBeNull()
    expect(sniffEvidenceMime(pad('<svg'))).toBeNull()
  })

  it('refuses empty and >10 MB files, and content-addresses the rest', () => {
    expect(checkEvidenceFile(new Uint8Array())).toEqual({ ok: false, reason: 'empty' })
    const big = new Uint8Array(MAX_EVIDENCE_BYTES + 1)
    big.set(Buffer.from('%PDF-'))
    expect(checkEvidenceFile(big)).toEqual({ ok: false, reason: 'too_large' })
    const ok = checkEvidenceFile(pad('%PDF-1.7'))
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.key).toBe(`payment-evidence/${ok.sha256}.pdf`)
      expect(isEvidenceKeyFor(ok.key, ok.sha256, 'application/pdf')).toBe(true)
      expect(isEvidenceKeyFor(ok.key, ok.sha256, 'image/png')).toBe(false)
      expect(isEvidenceKeyFor('../secrets.pdf', ok.sha256, 'application/pdf')).toBe(false)
    }
  })
})
