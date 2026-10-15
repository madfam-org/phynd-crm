import crypto from 'node:crypto'

/**
 * Private evidence storage on Cloudflare R2 (S3-compatible), signed with AWS
 * Signature V4 using node:crypto only (no SDK dependency).
 *
 * Credentials come from the keys `enclii buckets create` writes into the
 * project Secret: R2_BUCKET_NAME, R2_ENDPOINT_URL, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY. Objects are never public: viewers get a short-lived
 * presigned GET URL, minted server-side after an authorization check.
 */

export interface EvidenceStorage {
  put(key: string, bytes: Uint8Array, opts: { contentType: string; sha256: string }): Promise<void>
  exists(key: string): Promise<boolean>
  /** Presigned GET; `expiresIn` seconds (1..604800). */
  presignGet(
    key: string,
    opts: { expiresIn: number; contentType?: string; inlineFilename?: string },
  ): string
}

export interface R2Config {
  bucket: string
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  region: string
}

/** Short-lived on purpose: viewers re-request through the authorizing route. */
export const EVIDENCE_URL_TTL_SECONDS = 120

export function readR2Config(
  env: Record<string, string | undefined> = process.env,
): R2Config | null {
  const bucket = env.R2_BUCKET_NAME?.trim()
  const endpoint = env.R2_ENDPOINT_URL?.trim()
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim()
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim()
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) return null
  return {
    bucket,
    endpoint: endpoint.replace(/\/+$/, ''),
    accessKeyId,
    secretAccessKey,
    region: 'auto',
  }
}

// ─── SigV4 ──────────────────────────────────────────────────────────────────

export const EMPTY_PAYLOAD_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

const hmac = (key: crypto.BinaryLike, data: string) =>
  crypto.createHmac('sha256', key).update(data).digest()
const hashHex = (data: string) => crypto.createHash('sha256').update(data).digest('hex')

/** RFC 3986 encoding as SigV4 wants it; `/` kept in paths. */
export function uriEncode(value: string, keepSlash = false): string {
  return Array.from(new TextEncoder().encode(value))
    .map((byte) => {
      const ch = String.fromCharCode(byte)
      if (/[A-Za-z0-9\-_.~]/.test(ch) || (keepSlash && ch === '/')) return ch
      return `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
    })
    .join('')
}

export function amzDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

interface SigningParams {
  accessKeyId: string
  secretAccessKey: string
  region: string
  service?: string
  date: Date
}

function scopeOf(p: SigningParams) {
  const day = amzDate(p.date).slice(0, 8)
  return `${day}/${p.region}/${p.service ?? 's3'}/aws4_request`
}

function signature(p: SigningParams, canonicalRequest: string): string {
  const day = amzDate(p.date).slice(0, 8)
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate(p.date),
    scopeOf(p),
    hashHex(canonicalRequest),
  ].join('\n')
  const kDate = hmac(`AWS4${p.secretAccessKey}`, day)
  const kRegion = hmac(kDate, p.region)
  const kService = hmac(kRegion, p.service ?? 's3')
  const kSigning = hmac(kService, 'aws4_request')
  return crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex')
}

function canonicalQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(params[k] ?? '')}`)
    .join('&')
}

/** Query-string (presigned) SigV4 URL; only `host` is signed. */
export function presignUrl(
  p: SigningParams & {
    method: string
    url: URL
    expiresIn: number
    query?: Record<string, string>
  },
): string {
  const params: Record<string, string> = {
    ...(p.query ?? {}),
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${p.accessKeyId}/${scopeOf(p)}`,
    'X-Amz-Date': amzDate(p.date),
    'X-Amz-Expires': String(p.expiresIn),
    'X-Amz-SignedHeaders': 'host',
  }
  const query = canonicalQuery(params)
  const canonicalRequest = [
    p.method,
    uriEncode(p.url.pathname, true),
    query,
    `host:${p.url.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n')
  return `${p.url.origin}${uriEncode(p.url.pathname, true)}?${query}&X-Amz-Signature=${signature(p, canonicalRequest)}`
}

/** Header-signed SigV4 request headers (Authorization, x-amz-date, x-amz-content-sha256). */
export function signHeaders(
  p: SigningParams & {
    method: string
    url: URL
    headers: Record<string, string>
    payloadSha256: string
  },
): Record<string, string> {
  const headers: Record<string, string> = {
    ...Object.fromEntries(Object.entries(p.headers).map(([k, v]) => [k.toLowerCase(), v.trim()])),
    host: p.url.host,
    'x-amz-content-sha256': p.payloadSha256,
    'x-amz-date': amzDate(p.date),
  }
  const names = Object.keys(headers).sort()
  const canonicalRequest = [
    p.method,
    uriEncode(p.url.pathname, true),
    canonicalQuery(Object.fromEntries(p.url.searchParams)),
    `${names.map((n) => `${n}:${headers[n]}`).join('\n')}\n`,
    names.join(';'),
    p.payloadSha256,
  ].join('\n')
  const { host: _host, ...sent } = headers
  return {
    ...sent,
    authorization: `AWS4-HMAC-SHA256 Credential=${p.accessKeyId}/${scopeOf(p)}, SignedHeaders=${names.join(';')}, Signature=${signature(p, canonicalRequest)}`,
  }
}

// ─── R2 storage ─────────────────────────────────────────────────────────────

export function createR2EvidenceStorage(
  config: R2Config,
  deps: { fetch?: typeof fetch; now?: () => Date } = {},
): EvidenceStorage {
  const doFetch = deps.fetch ?? fetch
  const now = deps.now ?? (() => new Date())
  const objectUrl = (key: string) =>
    new URL(`${config.endpoint}/${uriEncode(config.bucket)}/${uriEncode(key, true)}`)
  const signing = () => ({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: config.region,
    date: now(),
  })

  return {
    async put(key, bytes, { contentType, sha256 }) {
      const url = objectUrl(key)
      const headers = signHeaders({
        ...signing(),
        method: 'PUT',
        url,
        headers: { 'content-type': contentType },
        payloadSha256: sha256,
      })
      const res = await doFetch(url, {
        method: 'PUT',
        headers,
        // Node's fetch accepts any Uint8Array; DOM typings only ArrayBuffer-backed ones.
        body: bytes as unknown as RequestInit['body'],
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) throw new Error(`evidence storage PUT failed (${res.status})`)
    },
    async exists(key) {
      const url = objectUrl(key)
      const headers = signHeaders({
        ...signing(),
        method: 'HEAD',
        url,
        headers: {},
        payloadSha256: EMPTY_PAYLOAD_SHA256,
      })
      const res = await doFetch(url, {
        method: 'HEAD',
        headers,
        signal: AbortSignal.timeout(15_000),
      })
      if (res.status === 404) return false
      if (!res.ok) throw new Error(`evidence storage HEAD failed (${res.status})`)
      return true
    },
    presignGet(key, { expiresIn, contentType, inlineFilename }) {
      const query: Record<string, string> = {}
      if (contentType) query['response-content-type'] = contentType
      if (inlineFilename) {
        query['response-content-disposition'] =
          `inline; filename="${inlineFilename.replace(/[^\w.-]/g, '_')}"`
      }
      return presignUrl({
        ...signing(),
        method: 'GET',
        url: objectUrl(key),
        expiresIn: Math.min(Math.max(Math.floor(expiresIn), 1), 604800),
        query,
      })
    },
  }
}

/** The configured storage, or null when the R2_* keys are not set (feature off). */
export function evidenceStorageFromEnv(
  env: Record<string, string | undefined> = process.env,
): EvidenceStorage | null {
  const config = readR2Config(env)
  return config ? createR2EvidenceStorage(config) : null
}
