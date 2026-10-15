// Client portal copy, Spanish (es-MX), in the reader's register.
//
// The register comes from the contact who opened the portal
// (contacts.spanish_formality): 'tu' only when that person chose tú;
// otherwise, including "not asked yet", the portal speaks in usted. Every
// string that addresses the reader exists in both registers; neutral strings
// are shared. The codebase has no i18n framework, so the portal is Spanish
// only (it was English before).

export type PortalRegister = 'tu' | 'usted'

export function portalRegister(formality: string | null | undefined): PortalRegister {
  return formality === 'tu' ? 'tu' : 'usted'
}

export const PORTAL_LOCALE = 'es-MX'
export const PORTAL_TIME_ZONE = 'America/Mexico_City'

interface AddressedCopy {
  projectFallback: string
  greeting: (name: string) => string
  signoffError: string
  quotesEmpty: string
  activityEmpty: string
  clientSide: string
  decisionsTitle: string
  awaitingClient: string
  checkoutErrors: Record<string, string>
  checkoutNotices: Record<string, string>
  payment: {
    failed: string
    cancelled: string
    disputed: string
    refunded: string
    paid: string
  }
}

const TU: AddressedCopy = {
  projectFallback: 'Tu proyecto con MADFAM',
  greeting: (name) => `Hola, ${name}. Aquí ves en vivo cómo va tu proyecto.`,
  signoffError:
    'No pudimos registrar tu aceptación. Intenta de nuevo o escribe a tu contacto en MADFAM.',
  quotesEmpty: 'Estamos preparando tu cotización. La publicaremos aquí cuando esté lista.',
  activityEmpty: 'Aún no hay novedades. Aquí verás los avances del proyecto.',
  clientSide: 'Tú',
  decisionsTitle: 'Decisiones que esperan tu respuesta',
  awaitingClient: 'Espera tu respuesta',
  checkoutErrors: {
    checkout_failed: 'No pudimos iniciar el pago. Intenta de nuevo en un momento.',
    missing_quote: 'No encontramos esa cotización. Recarga la página e intenta de nuevo.',
    quote_not_found: 'No encontramos esa cotización. Recarga la página e intenta de nuevo.',
    provider_unavailable: 'El servicio de pagos no está disponible. Intenta más tarde.',
    quote_not_payable:
      'Esta cotización ya no admite pago en línea. Escribe a tu contacto en MADFAM.',
  },
  checkoutNotices: {
    cancelled: 'Cancelaste el pago. Puedes iniciarlo de nuevo cuando quieras.',
    success: 'Recibimos la confirmación del pago. En unos minutos lo verás reflejado aquí.',
  },
  payment: {
    failed: 'El pago no se completó. Puedes reintentarlo.',
    cancelled: 'El pago se canceló. Puedes iniciarlo de nuevo.',
    disputed: 'El pago está en revisión. Te escribiremos con los siguientes pasos.',
    refunded: 'El pago se reembolsó. Te escribiremos con los siguientes pasos.',
    paid: 'Pago recibido. Tu proyecto está listo para producción.',
  },
}

const USTED: AddressedCopy = {
  projectFallback: 'Su proyecto con MADFAM',
  greeting: (name) => `Hola, ${name}. Aquí puede ver en vivo cómo va su proyecto.`,
  signoffError:
    'No pudimos registrar su aceptación. Intente de nuevo o escriba a su contacto en MADFAM.',
  quotesEmpty: 'Estamos preparando su cotización. La publicaremos aquí cuando esté lista.',
  activityEmpty: 'Aún no hay novedades. Aquí verá los avances del proyecto.',
  clientSide: 'Usted',
  decisionsTitle: 'Decisiones que esperan su respuesta',
  awaitingClient: 'Espera su respuesta',
  checkoutErrors: {
    checkout_failed: 'No pudimos iniciar el pago. Intente de nuevo en un momento.',
    missing_quote: 'No encontramos esa cotización. Recargue la página e intente de nuevo.',
    quote_not_found: 'No encontramos esa cotización. Recargue la página e intente de nuevo.',
    provider_unavailable: 'El servicio de pagos no está disponible. Intente más tarde.',
    quote_not_payable:
      'Esta cotización ya no admite pago en línea. Escriba a su contacto en MADFAM.',
  },
  checkoutNotices: {
    cancelled: 'Canceló el pago. Puede iniciarlo de nuevo cuando guste.',
    success: 'Recibimos la confirmación del pago. En unos minutos lo verá reflejado aquí.',
  },
  payment: {
    failed: 'El pago no se completó. Puede reintentarlo.',
    cancelled: 'El pago se canceló. Puede iniciarlo de nuevo.',
    disputed: 'El pago está en revisión. Le escribiremos con los siguientes pasos.',
    refunded: 'El pago se reembolsó. Le escribiremos con los siguientes pasos.',
    paid: 'Pago recibido. Su proyecto está listo para producción.',
  },
}

/** Register-neutral strings (no tú/usted verb or pronoun). */
const SHARED = {
  sections: {
    progress: 'Avance',
    actionables: 'Pendientes',
    decisionsMadfam: 'Decisiones que estamos preparando',
    decisionsDone: 'Decisiones tomadas',
    quotes: 'Cotización y pago',
    files: 'Archivos del proyecto',
    activity: 'Actividad',
  },
  progressEmpty: 'Aún no hay hitos ni entregables publicados.',
  nothingPending: 'Nada pendiente.',
  filesEmpty: 'Aún no hay archivos. Aquí aparecerán propuestas, facturas y entregables.',
  madfamSide: 'MADFAM',
  signoffAccepted: 'Entregable aceptado. Gracias, ya avisamos al equipo.',
  targetDate: 'Fecha objetivo:',
  suggestedDate: 'Fecha sugerida:',
  completedOn: 'Listo el',
  quote: (n: string) => `Cotización ${n}`,
  order: (n: string, status: string) => `Pedido ${n} · ${status}`,
  open: 'Abrir',
  acceptDeliverable: 'Aceptar entregable',
  accepted: 'Aceptado',
  linkedFile: 'Ver archivo',
  partialWithBalance: (remaining: string) =>
    `Recibimos un pago parcial. Saldo pendiente: ${remaining}.`,
  partialChecking: 'Recibimos un pago parcial. Estamos verificando el saldo.',
  actions: {
    accept_and_pay: 'Aceptar y pagar',
    pay_now: 'Pagar ahora',
    retry: 'Reintentar pago',
    paid: 'Pagado',
    awaiting_review: 'En revisión',
  } as Record<string, string>,
  engagementStatus: {
    active: 'En curso',
    completed: 'Concluido',
    paused: 'En pausa',
    cancelled: 'Cancelado',
  } as Record<string, string>,
  itemStatus: {
    planned: 'Planeado',
    in_progress: 'En curso',
    done: 'Listo',
    blocked: 'En espera',
  } as Record<string, string>,
  itemKind: {
    milestone: 'Hito',
    deliverable: 'Entregable',
    actionable: 'Pendiente',
    decision: 'Decisión',
  } as Record<string, string>,
  quoteStatus: {
    draft: 'Borrador',
    sent: 'Enviada',
    accepted: 'Aceptada',
    declined: 'Rechazada',
    expired: 'Vencida',
  } as Record<string, string>,
  orderStatus: {
    pending: 'Pendiente',
    confirmed: 'Confirmado',
    in_production: 'En producción',
    fulfilled: 'Entregado',
    cancelled: 'Cancelado',
  } as Record<string, string>,
  paymentStatus: {
    unpaid: 'Sin pagar',
    paid: 'Pagado',
    partial: 'Pago parcial',
    partial_refund: 'Reembolso parcial',
    failed: 'Pago no completado',
    cancelled: 'Pago cancelado',
    refunded: 'Reembolsado',
    disputed: 'En revisión',
  } as Record<string, string>,
  artifactType: {
    quote: 'Cotización',
    signed_proposal: 'Propuesta firmada',
    service_agreement: 'Contrato de servicios',
    statement_of_work: 'Alcance del trabajo',
    msa: 'Contrato marco',
    invoice: 'Factura',
    deliverable: 'Entregable',
    nft_receipt: 'Comprobante NFT',
  } as Record<string, string>,
  // Labels for the client-visible event types PhyndCRM writes (their stored
  // message is English system copy). Other client-visible events were
  // written or promoted by staff, so their own message is shown.
  eventLabel: {
    'portal:deliverable_accepted': 'Entregable aceptado',
    'dhanam:payment_succeeded': 'Pago recibido',
    'system:quote_sent': 'Cotización publicada en este portal',
    'system:quote_approved': 'Cotización aceptada',
    'cotiza:quote_approved': 'Cotización aceptada',
    'pravara:prototype_shipped': 'Prototipo enviado; va en camino',
    'pravara:deliverable_received': 'Prototipo entregado',
  } as Record<string, string>,
  genericUpdate: 'Actualización del proyecto',
}

export type PortalCopy = AddressedCopy & typeof SHARED & { register: PortalRegister }

export function portalCopy(register: PortalRegister): PortalCopy {
  return { ...SHARED, ...(register === 'tu' ? TU : USTED), register }
}

/** Fallback label for unmapped codes: underscores to spaces, nothing else. */
export function labelFor(map: Record<string, string>, code: string): string {
  return map[code] ?? code.replace(/_/g, ' ')
}

export function itemStatusLabel(copy: PortalCopy, status: string): string {
  if (status === 'awaiting_client') return copy.awaitingClient
  return labelFor(copy.itemStatus, status)
}

export function formatPortalDate(date: Date | string): string {
  return new Intl.DateTimeFormat(PORTAL_LOCALE, {
    dateStyle: 'medium',
    timeZone: PORTAL_TIME_ZONE,
  }).format(new Date(date))
}

export function formatPortalDateTime(date: Date | string): string {
  return new Intl.DateTimeFormat(PORTAL_LOCALE, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: PORTAL_TIME_ZONE,
  }).format(new Date(date))
}

export function formatPortalMoney(amount: string | number | null, currency: string): string {
  if (amount === null || amount === '') return currency
  return new Intl.NumberFormat(PORTAL_LOCALE, { currency, style: 'currency' }).format(
    Number(amount),
  )
}
