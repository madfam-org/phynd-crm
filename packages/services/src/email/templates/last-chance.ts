/**
 * Last chance re-engagement email — sent on day 14 if trial not started.
 */
export function lastChanceEmail(params?: { unsubscribeUrl?: string }): {
  subject: string
  html: string
  preheader: string
} {
  const tezcaUrl = process.env.TEZCA_PUBLIC_URL ?? 'https://tezca.mx'

  return {
    subject: 'No pierdas acceso — Tu prueba gratuita te espera',
    preheader: 'Último recordatorio: tu prueba gratuita de Tezca sigue disponible.',
    html: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f9fafb;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <h1 style="font-size:22px;color:#111827;margin-bottom:8px;">Tu prueba gratuita sigue disponible</h1>
    <p style="color:#6b7280;font-size:15px;line-height:1.6;">
      Hace unas semanas te suscribiste a las actualizaciones de Tezca. Queremos recordarte que puedes probar las funciones avanzadas completamente gratis.
    </p>
    <p style="color:#6b7280;font-size:15px;line-height:1.6;">
      Miles de profesionales del derecho ya usan Tezca para acceder a la legislación mexicana de forma eficiente. No te quedes fuera.
    </p>
    <a href="${tezcaUrl}/precios" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500;margin:16px 0;">
      Activar mi prueba gratuita
    </a>
    <p style="color:#9ca3af;font-size:13px;margin-top:24px;">
      Este es nuestro último recordatorio.
    </p>
    ${
      params?.unsubscribeUrl
        ? `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;">
      <p style="color:#9ca3af;font-size:11px;line-height:1.5;">
        No deseas recibir más correos?
        <a href="${params.unsubscribeUrl}" style="color:#6b7280;text-decoration:underline;">Cancelar suscripción</a>
      </p>
    </div>`
        : ''
    }
  </div>
</body>
</html>`,
  }
}
