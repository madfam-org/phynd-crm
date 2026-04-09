/**
 * Welcome email — sent immediately when a lead is created from newsletter/interest.
 * Links to relevant Tezca legal content based on lead source domain.
 */
export function welcomeEmail(params: { domain?: string; unsubscribeUrl?: string }): { subject: string; html: string } {
  const domain = params.domain ?? ''
  const tezcaUrl = process.env.TEZCA_PUBLIC_URL ?? 'https://tezca.mx'
  const searchUrl = domain
    ? `${tezcaUrl}/busqueda?q=${encodeURIComponent(domain)}`
    : `${tezcaUrl}/busqueda`

  return {
    subject: 'Bienvenido a Tezca — Tu acceso a la legislación mexicana',
    html: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f9fafb;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <h1 style="font-size:22px;color:#111827;margin-bottom:8px;">Bienvenido a Tezca</h1>
    <p style="color:#6b7280;font-size:15px;line-height:1.6;">
      Gracias por tu interés en la legislación mexicana. Tezca te da acceso a más de 30,000 leyes federales, estatales y municipales.
    </p>
    ${domain ? `<p style="color:#6b7280;font-size:15px;line-height:1.6;">Notamos tu interés en <strong>${domain}</strong>. Aquí puedes explorar legislación relevante:</p>` : ''}
    <a href="${searchUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500;margin:16px 0;">
      Explorar legislación
    </a>
    <p style="color:#9ca3af;font-size:13px;margin-top:24px;">
      Si tienes preguntas, responde a este correo. Estamos para ayudarte.
    </p>
    ${params.unsubscribeUrl ? `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;">
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
