import { validateMadfamSignature, validateWebhookSignature } from '@phynd/federation/webhooks'
import { createLogger } from '@phynd/logging'
import { NextResponse } from 'next/server'
import { checkRateLimit } from './rate-limiter'

const logger = createLogger('web:webhook')

const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Signature schemes the shared parser can verify:
 *
 *  - 'madfam' — the ecosystem scheme: `x-madfam-signature: t=<unix>,v1=<hex>`
 *    with v1 = hmac-sha256(secret, `${t}.${rawBody}`). The timestamp is
 *    in-band and covered by the HMAC; `validateMadfamSignature` enforces the
 *    same 5-minute replay window as the nauta/avala/routecraft routes.
 *  - 'legacy' — `x-webhook-signature: <hex hmac-sha256 of body>` plus an
 *    optional separate `x-webhook-timestamp` header.
 *
 * Defaults to legacy-only so existing consumers (consent, ops, campaigns)
 * keep their contract until they opt in.
 */
export type WebhookSignatureScheme = 'madfam' | 'legacy'

interface ParseSignedWebhookOptions {
  schemes?: readonly WebhookSignatureScheme[]
}

type ParsedWebhookRequest =
  | { ok: true; payload: Record<string, unknown>; remaining: number }
  | { ok: false; response: NextResponse }

export async function parseSignedWebhookRequest(
  request: Request,
  secret: string,
  options: ParseSignedWebhookOptions = {},
): Promise<ParsedWebhookRequest> {
  const schemes = options.schemes ?? ['legacy']

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const { allowed, remaining } = await checkRateLimit(ip)

  if (!allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Rate limit exceeded' },
        {
          status: 429,
          headers: { 'Retry-After': '60', 'X-RateLimit-Remaining': '0' },
        },
      ),
    }
  }

  const madfamHeader = request.headers.get('x-madfam-signature')
  if (schemes.includes('madfam') && madfamHeader !== null) {
    // Modern-first, and its verdict is final: a request that carries
    // x-madfam-signature never falls back to the legacy check, so an attacker
    // cannot downgrade a modern producer to the weaker legacy scheme.
    const body = await request.text()
    const result = validateMadfamSignature(body, madfamHeader, secret)
    if (!result.ok) {
      logger.warn({ reason: result.reason }, 'rejected webhook: invalid x-madfam-signature')
      return {
        ok: false,
        response: NextResponse.json({ error: 'Invalid signature' }, { status: 401 }),
      }
    }
    return parseJsonBody(body, remaining)
  }

  if (!schemes.includes('legacy')) {
    // Modern-only route and the modern header is absent.
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid signature' }, { status: 401 }),
    }
  }

  const timestamp = request.headers.get('x-webhook-timestamp')
  if (timestamp) {
    const age = Date.now() - new Date(timestamp).getTime()
    if (Number.isNaN(age) || age > MAX_TIMESTAMP_AGE_MS) {
      return {
        ok: false,
        response: NextResponse.json({ error: 'Webhook timestamp expired' }, { status: 401 }),
      }
    }
  }

  const body = await request.text()
  const signature = request.headers.get('x-webhook-signature') ?? ''

  if (!validateWebhookSignature(body, signature, secret)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid signature' }, { status: 401 }),
    }
  }

  return parseJsonBody(body, remaining)
}

function parseJsonBody(body: string, remaining: number): ParsedWebhookRequest {
  try {
    const payload = JSON.parse(body) as Record<string, unknown>
    return { ok: true, payload, remaining }
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 }),
    }
  }
}

interface WebhookHandlerOptions {
  secret: string
  schemes?: readonly WebhookSignatureScheme[]
  onEvent: (payload: Record<string, unknown>) => Promise<void>
}

export async function handleWebhook(
  request: Request,
  options: WebhookHandlerOptions,
): Promise<NextResponse> {
  const parsed = await parseSignedWebhookRequest(request, options.secret, {
    schemes: options.schemes,
  })
  if (!parsed.ok) {
    return parsed.response
  }

  try {
    await options.onEvent(parsed.payload)

    return NextResponse.json(
      { received: true },
      { headers: { 'X-RateLimit-Remaining': String(parsed.remaining) } },
    )
  } catch (error) {
    logger.error({ err: error }, 'Webhook processing error')
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}
