import type { LeadTier } from '@phynd/types/crm'

// Rules that qualify a lead from what it carries: its tier from its score, the
// free-mail test the scoring rules use, and the test-traffic rule. Pure
// functions, no database; the scoring service and the intake routes call them.
// Rules only: nothing here names a person, a client or an address of one.

/** Lowest score of a tier-A lead (call within 1 business day). */
export const TIER_A_MIN_SCORE = 7
/** Lowest score of a tier-B lead; anything lower is C. */
export const TIER_B_MIN_SCORE = 4

/**
 * A lead asking to be told when something becomes available. It is always
 * tier C and is followed up as "notify when available", never as a sale: the
 * sender marks what it waits for as not yet for sale.
 */
export const WAITLIST_INTENT = 'waitlist'

/**
 * The tier of a score: A >= 7, B 4-6, C <= 3. A waitlist lead is always C.
 * Null when there is no score yet.
 */
export function tierForScore(
  score: number | null | undefined,
  intent?: string | null,
): LeadTier | null {
  if (score === null || score === undefined || !Number.isFinite(score)) return null
  if (intent === WAITLIST_INTENT) return 'C'
  if (score >= TIER_A_MIN_SCORE) return 'A'
  if (score >= TIER_B_MIN_SCORE) return 'B'
  return 'C'
}

/**
 * Free-mail providers: a lead writing from one of these gets no company-fit
 * points (and no company enrichment). Fixed in code on purpose; matched on the
 * whole domain, so a company's own domain never matches by accident.
 */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.es',
  'hotmail.com.mx',
  'outlook.com',
  'outlook.es',
  'live.com',
  'live.com.mx',
  'msn.com',
  'yahoo.com',
  'yahoo.com.mx',
  'yahoo.es',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'zoho.com',
  'yandex.com',
  'tutanota.com',
  'hey.com',
  'prodigy.net.mx',
])

/** The lower-case domain of an address, or null when it has none. */
export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null
  const at = email.lastIndexOf('@')
  if (at < 1 || at === email.length - 1) return null
  return email
    .slice(at + 1)
    .trim()
    .toLowerCase()
}

/** True when the address is at a free-mail provider; null when there is no address. */
export function isFreeMailAddress(email: string | null | undefined): boolean | null {
  const domain = emailDomain(email)
  if (!domain) return null
  return FREE_MAIL_DOMAINS.has(domain)
}

/** Lead sources that only ever carry synthetic traffic (smoke tests, probes). */
export const TEST_LEAD_SOURCES: ReadonlySet<string> = new Set([
  'provisioning_smoke',
  'synthetic-probe',
])

/** Reserved names (RFC 2606 / RFC 6761) that never belong to a real person. */
const RESERVED_TOP_LEVEL = ['invalid', 'test', 'example', 'localhost']
const RESERVED_DOMAINS = new Set(['example.com', 'example.net', 'example.org'])

/** End-to-end test addresses: the local part starts with `e2e` and a separator. */
const E2E_LOCAL_PART = /^e2e(?:[-+._]|$)/i

/** Labels test runs put in a name or a message (`[e2e]`, `[test]`, `[prueba]`). */
const TEST_LABEL = /\[(?:e2e|test|prueba)\]/i

/** The literal message the Nauta smoke relay sends. */
const NAUTA_PROBE_MESSAGE = 'probe'

export interface TestLeadInput {
  source?: string | null
  email?: string | null
  name?: string | null
  message?: string | null
}

/**
 * Whether a lead is synthetic: a test source, a reserved or end-to-end test
 * address, or a Nauta end-to-end probe (a test label in its name or message,
 * or the smoke relay's literal `probe` message). A rule on what the lead
 * carries; never a list of people.
 */
export function isTestLead(input: TestLeadInput): boolean {
  const source = input.source?.trim().toLowerCase() ?? ''
  if (TEST_LEAD_SOURCES.has(source)) return true
  if (isTestAddress(input.email)) return true
  return source === 'nauta' && isNautaProbe(input)
}

/** A reserved address (RFC 2606 / 6761) or an end-to-end test address. */
function isTestAddress(value: string | null | undefined): boolean {
  const email = value?.trim().toLowerCase() ?? ''
  const domain = emailDomain(email)
  if (!domain) return false
  if (RESERVED_DOMAINS.has(domain)) return true
  const topLevel = domain.slice(domain.lastIndexOf('.') + 1)
  if (RESERVED_TOP_LEVEL.includes(topLevel)) return true
  return E2E_LOCAL_PART.test(email.slice(0, email.lastIndexOf('@')))
}

/** A Nauta end-to-end probe: a test label in its name or message, or the literal `probe`. */
function isNautaProbe(input: TestLeadInput): boolean {
  if (TEST_LABEL.test(input.name ?? '') || TEST_LABEL.test(input.message ?? '')) return true
  return (input.message ?? '').trim().toLowerCase() === NAUTA_PROBE_MESSAGE
}
