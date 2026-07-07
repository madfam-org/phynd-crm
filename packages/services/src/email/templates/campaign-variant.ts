/**
 * Campaign copy variant email — renders a structured draft variant handed off
 * from Selva's generate-copy output ({subject, preheader, body, cta}) into
 * the house email layout. The preheader is returned alongside subject/html so
 * EmailService.send() can inject the hidden-preheader div.
 */

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function campaignVariantEmail(params: {
  subject: string
  body: string
  preheader?: string | null
  cta?: string | null
  ctaUrl?: string | null
  unsubscribeUrl?: string
}): { subject: string; html: string; preheader?: string } {
  const bodyHtml = escapeHtml(params.body)
  const cta = params.cta?.trim()
  const ctaUrl = params.ctaUrl?.trim()

  const ctaHtml = cta
    ? ctaUrl
      ? `<a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500;margin:16px 0;">${escapeHtml(cta)}</a>`
      : `<p style="color:#111827;font-size:15px;font-weight:600;margin:16px 0;">${escapeHtml(cta)}</p>`
    : ''

  return {
    subject: params.subject,
    ...(params.preheader?.trim() ? { preheader: params.preheader.trim() } : {}),
    html: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f9fafb;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <p style="color:#374151;font-size:15px;line-height:1.6;white-space:pre-wrap;">${bodyHtml}</p>
    ${ctaHtml}
    ${
      params.unsubscribeUrl
        ? `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;">
      <p style="color:#9ca3af;font-size:11px;line-height:1.5;">
        <a href="${escapeHtml(params.unsubscribeUrl)}" style="color:#6b7280;text-decoration:underline;">Cancelar suscripción</a>
      </p>
    </div>`
        : ''
    }
  </div>
</body>
</html>`,
  }
}
