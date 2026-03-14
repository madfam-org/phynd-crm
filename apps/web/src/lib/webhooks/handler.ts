import { validateWebhookSignature } from '@phyne/federation/webhooks'
import { NextResponse } from 'next/server'
import { checkRateLimit } from './rate-limiter'

const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000 // 5 minutes

interface WebhookHandlerOptions {
  secret: string
  onEvent: (payload: Record<string, unknown>) => Promise<void>
}

export async function handleWebhook(
  request: Request,
  options: WebhookHandlerOptions,
): Promise<NextResponse> {
  // Rate limiting
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const { allowed, remaining } = await checkRateLimit(ip)

  if (!allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      {
        status: 429,
        headers: { 'Retry-After': '60', 'X-RateLimit-Remaining': '0' },
      },
    )
  }

  // Timestamp validation
  const timestamp = request.headers.get('x-webhook-timestamp')
  if (timestamp) {
    const age = Date.now() - new Date(timestamp).getTime()
    if (Number.isNaN(age) || age > MAX_TIMESTAMP_AGE_MS) {
      return NextResponse.json({ error: 'Webhook timestamp expired' }, { status: 401 })
    }
  }

  // Signature validation
  const body = await request.text()
  const signature = request.headers.get('x-webhook-signature') ?? ''

  if (!validateWebhookSignature(body, signature, options.secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // Process event
  try {
    const payload = JSON.parse(body) as Record<string, unknown>
    await options.onEvent(payload)

    return NextResponse.json(
      { received: true },
      { headers: { 'X-RateLimit-Remaining': String(remaining) } },
    )
  } catch (error) {
    console.error('Webhook processing error:', error)
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}
