/**
 * Double-opt-in confirmation email — sent when a marketing-consent capture
 * requires confirmation (LFPDPPP Art. 7). The link carries the raw
 * double-opt-in token; clicking it confirms consent via
 * GET /api/consent/confirm.
 */
export function consentConfirmEmail(params: {
  confirmUrl: string
  /** Product surface that captured the consent (dhanam, karafiel, tezca…). */
  sourceLabel?: string
}): { subject: string; html: string } {
  const sourceLabel = params.sourceLabel ?? 'MADFAM'

  return {
    subject: 'Confirma tu suscripción a comunicaciones de MADFAM',
    html: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f9fafb;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <h1 style="font-size:22px;color:#111827;margin-bottom:8px;">Confirma tu suscripción</h1>
    <p style="color:#6b7280;font-size:15px;line-height:1.6;">
      Recibimos una solicitud para enviarte comunicaciones de marketing de ${sourceLabel}.
      Para completar tu suscripción, confirma tu consentimiento haciendo clic en el botón:
    </p>
    <a href="${params.confirmUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500;margin:16px 0;">
      Confirmar suscripción
    </a>
    <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin-top:24px;">
      Si no solicitaste esta suscripción, ignora este correo — no recibirás
      comunicaciones de marketing sin tu confirmación. El enlace expira en 7 días.
    </p>
    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;">
      <p style="color:#9ca3af;font-size:11px;line-height:1.5;margin:0 0 6px;">
        Innovaciones MADFAM S.A.S. de C.V. · Cuernavaca, Morelos, México ·
        <a href="https://www.madfam.io/privacy" style="color:#6b7280;text-decoration:underline;">Aviso de Privacidad</a>
      </p>
      <p style="color:#9ca3af;font-size:11px;line-height:1.5;margin:0;">
        Tratamos tus datos conforme a la LFPDPPP. Puedes revocar tu
        consentimiento en cualquier momento desde cualquier correo que te enviemos.
      </p>
    </div>
  </div>
</body>
</html>`,
  }
}
