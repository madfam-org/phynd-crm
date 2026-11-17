// Where a lead came from, as staff name it (G3): the feed behind
// `leads.source`. Rules on the source string, never a list of people.

export interface LeadChannel {
  /** Short label: «Avala», «Kalya», «Sitio», «Cotiza»… */
  label: string
  /** The page or form inside the channel, when the source says more than the channel. */
  detail: string | null
}

const EXACT: Record<string, string> = {
  kalya: 'Kalya',
  'madfam-site': 'Sitio MADFAM',
  cotiza: 'Cotiza',
  nauta: 'Nauta',
  avala: 'Avala',
  web: 'Web',
  'synthetic-probe': 'Prueba',
  provisioning_smoke: 'Prueba',
}

/** Avala's own capture points (`leads.source` values it sends). */
const AVALA_PREFIXES = ['ec_', 'marketing', 'explorer', 'demo-', 'producto-']

export function leadChannel(source: string | null | undefined): LeadChannel {
  const value = source?.trim() ?? ''
  if (!value) return { label: 'Sin origen', detail: null }
  if (value === '[redacted]') return { label: 'Oculto', detail: null }
  const exact = EXACT[value]
  if (exact) return { label: exact, detail: null }
  if (value.startsWith('tezca_')) return { label: 'Tezca', detail: value.slice('tezca_'.length) }
  if (value.startsWith('ceq_')) return { label: 'CEQ', detail: value.slice('ceq_'.length) }
  if (AVALA_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    return { label: 'Avala', detail: value }
  }
  return { label: value, detail: null }
}

/** Whether a value came back masked from the server (agent principals). */
export function isMaskedValue(value: string | null | undefined): boolean {
  if (!value) return false
  return value === '[redacted]' || value.includes('***') || value.endsWith('…[redacted]')
}

/** Mexico's country code, assumed for a bare 10-digit number. */
const DEFAULT_COUNTRY_CODE = '52'

/** Digits of a phone in international form (a bare 10-digit number gets +52), or null. */
export function internationalDigits(phone: string | null | undefined): string | null {
  if (!phone || isMaskedValue(phone)) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 15) return null
  return digits.length === 10 && !phone.trim().startsWith('+')
    ? `${DEFAULT_COUNTRY_CODE}${digits}`
    : digits
}

/** `tel:` link that opens the user's phone app. */
export function telHref(phone: string | null | undefined): string | null {
  const digits = internationalDigits(phone)
  return digits ? `tel:+${digits}` : null
}

/** WhatsApp link that opens a chat in the user's client; nothing is sent. */
export function whatsappHref(phone: string | null | undefined): string | null {
  const digits = internationalDigits(phone)
  return digits ? `https://wa.me/${digits}` : null
}

/** `mailto:` link that opens the user's mail client; nothing is sent. */
export function mailtoHref(email: string | null | undefined): string | null {
  if (!email || isMaskedValue(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  return `mailto:${email}`
}
