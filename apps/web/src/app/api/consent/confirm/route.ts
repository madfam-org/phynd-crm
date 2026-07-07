import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import { ConsentService, createServiceContext } from '@phynd/services'
import { NotFoundError, ValidationError } from '@phynd/services/errors'
import { type NextRequest, NextResponse } from 'next/server'

const logger = createLogger('web:consent-confirm')

function htmlPage(title: string, body: string, subtext: string): NextResponse {
  return new NextResponse(
    `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;text-align:center;padding:60px;background:#f9fafb;">
  <h1 style="font-size:24px;color:#111827;">${title}</h1>
  <p style="color:#6b7280;font-size:16px;margin-top:12px;">${body}</p>
  <p style="color:#9ca3af;font-size:13px;margin-top:24px;">${subtext}</p>
</body>
</html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

// Double-opt-in confirmation landing (LFPDPPP Art. 8). The token in the
// query string is the credential — issued by ConsentService.capture with
// action=request_double_opt_in and delivered via the confirmation email.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) {
    return new NextResponse('Missing token', { status: 400 })
  }

  const db = getDb()
  const service = new ConsentService(
    createServiceContext(db, {} as never, {
      userId: 'subject:double-opt-in',
      tenantId: 'madfam',
      roles: ['service'],
      scopes: ['consent:write'],
      accessToken: '',
    }),
  )

  try {
    const { alreadyConfirmed } = await service.confirmDoubleOptIn(token, { actor: 'subject' })
    logger.info({ alreadyConfirmed }, 'double opt-in confirmed')
    return htmlPage(
      'Suscripción confirmada',
      alreadyConfirmed
        ? 'Tu consentimiento ya estaba confirmado. No necesitas hacer nada más.'
        : 'Gracias por confirmar tu consentimiento. Ya puedes recibir nuestras comunicaciones.',
      'Puedes cerrar esta pestaña. Puedes revocar tu consentimiento en cualquier momento.',
    )
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) {
      return htmlPage(
        'Enlace no válido',
        'Este enlace de confirmación no es válido o ha expirado.',
        'Solicita un nuevo correo de confirmación desde el sitio donde te registraste.',
      )
    }
    logger.error({ err: error }, 'consent confirm failed')
    return new NextResponse('Internal error', { status: 500 })
  }
}
