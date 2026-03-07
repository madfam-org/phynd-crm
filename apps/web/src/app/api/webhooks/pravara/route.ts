import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const signature = req.headers.get('x-webhook-signature') ?? ''
  const body = await req.text()

  console.log('[webhook:pravara] Received event', { signature: signature.slice(0, 8) + '...' })

  return NextResponse.json({ received: true })
}
