/**
 * Trial invitation email — sent on day 5 of drip sequence.
 * Links to pricing page with pre-filled trial start.
 */
export function trialInviteEmail(params?: { unsubscribeUrl?: string }): { subject: string; html: string } {
  const tezcaUrl = process.env.TEZCA_PUBLIC_URL ?? 'https://tezca.mx'

  return {
    subject: 'Prueba Tezca gratis — Accede a funciones avanzadas',
    html: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f9fafb;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <h1 style="font-size:22px;color:#111827;margin-bottom:8px;">Prueba Tezca sin compromiso</h1>
    <p style="color:#6b7280;font-size:15px;line-height:1.6;">
      Como suscriptor, tienes acceso a una prueba gratuita de 3 días (sin tarjeta de crédito) de las funciones avanzadas de Tezca:
    </p>
    <ul style="color:#6b7280;font-size:15px;line-height:1.8;padding-left:20px;">
      <li>Exportación LaTeX, DOCX y EPUB</li>
      <li>Descarga masiva de artículos</li>
      <li>Análisis de búsqueda avanzado</li>
      <li>Claves API para integración</li>
    </ul>
    <a href="${tezcaUrl}/precios" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500;margin:16px 0;">
      Iniciar prueba gratuita
    </a>
    <p style="color:#9ca3af;font-size:13px;margin-top:24px;">
      Sin compromiso. Cancela en cualquier momento.
    </p>
    ${params?.unsubscribeUrl ? `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;">
      <p style="color:#9ca3af;font-size:11px;line-height:1.5;">
        Recibes este correo porque te registraste en tezca.mx.
        <a href="${params.unsubscribeUrl}" style="color:#6b7280;text-decoration:underline;">Cancelar suscripción</a>
      </p>
    </div>` : ''}
  </div>
</body>
</html>`,
  }
}
