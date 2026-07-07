/**
 * Legal tip email — sent on day 2 of drip sequence.
 * Pulls content context from the lead's legal domain.
 */
export function legalTipEmail(params: { domain?: string; unsubscribeUrl?: string }): {
  subject: string
  html: string
  preheader: string
} {
  const domain = params.domain ?? ''
  const tezcaUrl = process.env.TEZCA_PUBLIC_URL ?? 'https://tezca.mx'
  const searchUrl = domain
    ? `${tezcaUrl}/busqueda?q=${encodeURIComponent(domain)}`
    : `${tezcaUrl}/categorias`

  const DOMAIN_TIPS: Record<string, { title: string; tip: string }> = {
    labor: {
      title: 'Tip: Derechos laborales en México',
      tip: 'La Ley Federal del Trabajo establece derechos fundamentales como el aguinaldo (15 días mínimo), prima vacacional, y participación en utilidades. Conocer estos artículos es esencial para cualquier consulta laboral.',
    },
    tax: {
      title: 'Tip: Obligaciones fiscales',
      tip: 'El Código Fiscal de la Federación y la Ley del ISR establecen las obligaciones tributarias. Tezca te permite buscar artículos específicos y ver sus reformas históricas.',
    },
    criminal: {
      title: 'Tip: Código Penal Federal',
      tip: 'El Código Nacional de Procedimientos Penales (CNPP) es la base del sistema penal acusatorio en México. Consulta los artículos clave directamente en Tezca.',
    },
    civil: {
      title: 'Tip: Derecho civil mexicano',
      tip: 'El Código Civil Federal y los códigos civiles estatales regulan relaciones entre particulares. En Tezca puedes comparar las diferencias entre estados.',
    },
  }

  const tipContent = DOMAIN_TIPS[domain] ?? {
    title: 'Tip: Legislación mexicana',
    tip: 'México tiene un sistema jurídico complejo con legislación federal, estatal y municipal. Tezca te ayuda a navegar más de 30,000 leyes de forma eficiente.',
  }

  return {
    subject: tipContent.title,
    preheader: tipContent.tip.length > 140 ? `${tipContent.tip.slice(0, 137)}...` : tipContent.tip,
    html: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f9fafb;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <h1 style="font-size:22px;color:#111827;margin-bottom:8px;">${tipContent.title}</h1>
    <p style="color:#6b7280;font-size:15px;line-height:1.6;">
      ${tipContent.tip}
    </p>
    <a href="${searchUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500;margin:16px 0;">
      Buscar legislación relacionada
    </a>
    <p style="color:#9ca3af;font-size:13px;margin-top:24px;">
      Tezca — La plataforma abierta de leyes mexicanas
    </p>
    ${
      params.unsubscribeUrl
        ? `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;">
      <p style="color:#9ca3af;font-size:11px;line-height:1.5;">
        Recibes este correo porque te registraste en tezca.mx.
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
