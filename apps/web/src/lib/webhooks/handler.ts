import { validateWebhookSignature } from '@phynd/federation/webhooks'
import { createLogger } from '@phynd/logging'
import { NextResponse } from 'next/server'
import { checkRateLimit } from './rate-limiter'

const logger = createLogger('web:webhook')

const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000 // 5 minutes

type ParsedWebhookRequest =
  | { ok: true; payload: Record<string, unknown>; remaining: number }
  | { ok: false; response: NextResponse }

export async function parseSignedWebhookRequest(
  request: Request,
  secret: string,
): Promise<ParsedWebhookRequest> {
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
  onEvent: (payload: Record<string, unknown>) => Promise<void>
}

export async function handleWebhook(
  request: Request,
  options: WebhookHandlerOptions,
): Promise<NextResponse> {
  const parsed = await parseSignedWebhookRequest(request, options.secret)
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
