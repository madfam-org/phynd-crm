import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const signature = req.headers.get('x-webhook-signature') ?? ''
  const body = await req.text()

  // TODO: Wire WebhookHandler with real deps
  console.log('[webhook:janua] Received event', { signature: signature.slice(0, 8) + '...' })

  return NextResponse.json({ received: true })
}
