import { getDb } from '@phyne/db'
import { leads } from '@phyne/db/schema'
import { verifyUnsubscribeToken } from '@phyne/services/email/unsubscribe-token'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) {
    return new NextResponse('Missing token', { status: 400 })
  }

  const leadId = verifyUnsubscribeToken(token)
  if (!leadId) {
    return new NextResponse('Invalid or expired link', { status: 400 })
  }

  const db = getDb()

  await db
    .update(leads)
    .set({ unsubscribed: true, unsubscribedAt: new Date() })
    .where(eq(leads.id, leadId))

  return new NextResponse(
    `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Suscripción cancelada</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;text-align:center;padding:60px;background:#f9fafb;">
  <h1 style="font-size:24px;color:#111827;">Suscripción cancelada</h1>
  <p style="color:#6b7280;font-size:16px;margin-top:12px;">Ya no recibirás correos de marketing de nuestra parte.</p>
  <p style="color:#9ca3af;font-size:13px;margin-top:24px;">Puedes cerrar esta pestaña.</p>
</body>
</html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}
