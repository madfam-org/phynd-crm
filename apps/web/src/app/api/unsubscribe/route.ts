import { getDb } from '@phynd/db'
import { contacts, leads } from '@phynd/db/schema'
import { SuppressionService, createServiceContext } from '@phynd/services'
import { verifyUnsubscribeToken } from '@phynd/services/email/unsubscribe-token'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'

/**
 * One-click unsubscribe.
 *
 * GET  — link clicks from the email footer; renders a confirmation page.
 * POST — RFC 8058 one-click: mail clients POST `List-Unsubscribe=One-Click`
 *        with no user interaction and only inspect the status code.
 *
 * Both mark the lead unsubscribed AND write an email-channel suppression
 * entry, so the opt-out also gates every future send path (the send gate
 * checks suppression before consent, and suppression always wins).
 */
async function processUnsubscribe(token: string | null): Promise<boolean> {
  if (!token) return false

  const leadId = verifyUnsubscribeToken(token)
  if (!leadId) return false

  const db = getDb()

  await db
    .update(leads)
    .set({ unsubscribed: true, unsubscribedAt: new Date() })
    .where(eq(leads.id, leadId))

  // Belt-and-braces: suppress the contact's email so campaign/drip paths that
  // key on the suppression list (not the lead flag) also honor the opt-out.
  try {
    const [lead] = await db
      .select({ contactId: leads.contactId })
      .from(leads)
      .where(eq(leads.id, leadId))
      .limit(1)
    if (lead?.contactId) {
      const [contact] = await db
        .select({ email: contacts.email })
        .from(contacts)
        .where(eq(contacts.id, lead.contactId))
        .limit(1)
      if (contact?.email) {
        const suppression = new SuppressionService(
          createServiceContext(
            db,
            {} as never,
            {
              userId: 'service:unsubscribe',
              roles: ['service'],
              scopes: ['campaigns:write'],
              accessToken: '',
            } as never,
          ),
        )
        await suppression.add({
          identifier: contact.email,
          channel: 'email',
          reason: 'unsubscribe',
          source: 'unsubscribe_link',
          evidence: `lead:${leadId}`,
        })
      }
    }
  } catch (err) {
    // The lead-level opt-out already succeeded; a suppression write failure
    // must not surface an error to the unsubscribing user.
    console.error('unsubscribe suppression write failed', err)
  }

  return true
}

export async function GET(req: NextRequest) {
  const ok = await processUnsubscribe(req.nextUrl.searchParams.get('token'))
  if (!ok) {
    return new NextResponse('Invalid or expired link', { status: 400 })
  }

  return new NextResponse(
    `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Suscripción cancelada</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;text-align:center;padding:60px;background:#f9fafb;">
  <h1 style="font-size:24px;color:#111827;">Suscripción cancelada</h1>
  <p style="color:#6b7280;font-size:16px;margin-top:12px;">Ya no recibirás correos de marketing de nuestra parte.</p>
  <p style="color:#9ca3af;font-size:13px;margin-top:24px;">Puedes cerrar esta pestaña.</p>
  <p style="color:#9ca3af;font-size:12px;margin-top:32px;">Innovaciones MADFAM S.A.S. de C.V. · Cuernavaca, Morelos, México</p>
</body>
</html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

// RFC 8058 one-click: the token arrives on the query string of the
// List-Unsubscribe URL; the POST body is `List-Unsubscribe=One-Click`.
// Success is signalled purely by the 2xx status — no HTML.
export async function POST(req: NextRequest) {
  const ok = await processUnsubscribe(req.nextUrl.searchParams.get('token'))
  return NextResponse.json(
    { status: ok ? 'unsubscribed' : 'invalid_token' },
    { status: ok ? 200 : 400 },
  )
}
