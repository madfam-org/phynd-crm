import type { PaymentMethod } from '@phynd/db/schema'
import { isLast4, looksLikeCardOrClabe, maskLongDigitRuns } from './account-guard'
import { extractPdfText } from './pdf-text'

/**
 * Pluggable extraction of payment fields from an evidence file. Extractors
 * only PREFILL the staff form: nothing is saved until staff confirm, and the
 * saved record is validated again (account guard, amounts, dates).
 *
 * Extractors never return an account number beyond its last four digits, and
 * free text has long digit runs masked to •NNNN.
 */
export interface ExtractedPaymentFields {
  method?: PaymentMethod
  bankName?: string
  operationType?: string
  folio?: string
  trackingKey?: string
  paidAt?: Date
  amount?: string
  currency?: string
  reference?: string
  originAccountLast4?: string
  destinationAccountLast4?: string
  beneficiaryName?: string
}

export interface ExtractionResult {
  extractor: string
  /** Share of the expected fields found, 0..1. */
  confidence: number
  fields: ExtractedPaymentFields
}

export interface EvidenceInput {
  bytes: Uint8Array
  mime: string
}

export interface PaymentEvidenceExtractor {
  readonly name: string
  supports(mime: string): boolean
  /** null when the file is not this extractor's kind of document. */
  extract(input: EvidenceInput): Promise<ExtractionResult | null>
}

// ─── BBVA "Comprobante de la operación" ─────────────────────────────────────

const normalize = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()

type FieldKey =
  | 'operationType'
  | 'folio'
  | 'date'
  | 'time'
  | 'reference'
  | 'amount'
  | 'originAccount'
  | 'beneficiaryName'
  | 'bankName'
  | 'destinationAccount'
  | 'trackingKey'

// Most specific labels first, so "folio de la operacion" wins over "folio".
const LABELS: Array<[FieldKey, string]> = [
  ['operationType', 'tipo de operacion'],
  ['folio', 'folio de la operacion'],
  ['folio', 'folio de operacion'],
  ['folio', 'folio'],
  ['date', 'fecha de operacion'],
  ['date', 'fecha de aplicacion'],
  ['date', 'fecha'],
  ['time', 'hora de operacion'],
  ['time', 'hora'],
  ['reference', 'concepto de pago'],
  ['reference', 'concepto'],
  ['amount', 'importe transferido'],
  ['amount', 'importe'],
  ['amount', 'monto'],
  ['originAccount', 'cuenta de origen'],
  ['originAccount', 'cuenta origen'],
  ['beneficiaryName', 'nombre del beneficiario'],
  ['beneficiaryName', 'beneficiario'],
  ['bankName', 'nombre del banco'],
  ['bankName', 'banco destino'],
  ['destinationAccount', 'cuenta de destino'],
  ['destinationAccount', 'cuenta destino'],
  ['trackingKey', 'clave de rastreo'],
]

/** The ten fields of the receipt; confidence is the share found. */
const CORE_FIELDS: FieldKey[] = [
  'operationType',
  'folio',
  'date',
  'time',
  'reference',
  'amount',
  'originAccount',
  'beneficiaryName',
  'bankName',
  'destinationAccount',
]

const MONTHS: Record<string, number> = {
  ene: 1,
  feb: 2,
  mar: 3,
  abr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  sep: 9,
  set: 9,
  oct: 10,
  nov: 11,
  dic: 12,
}

const labelAt = (cell: string): [FieldKey, string] | null => {
  const n = normalize(cell)
  for (const [key, label] of LABELS) {
    if (n === label || n.startsWith(`${label} `) || n.startsWith(`${label}:`)) return [key, label]
  }
  return null
}

/** The original text after `label` (accent- and spacing-insensitive), minus a colon. */
function stripLabel(cell: string, label: string): string {
  for (let k = label.length; k <= Math.min(cell.length, label.length + 12); k++) {
    if (normalize(cell.slice(0, k)) === label) {
      return cell
        .slice(k)
        .replace(/^\s*:\s*/, '')
        .trim()
    }
  }
  return ''
}

/** A value only counts when it looks like that field (e.g. "Importe con letra" is skipped). */
const ACCEPTS: Partial<Record<FieldKey, (value: string) => boolean>> = {
  amount: (v) => parseAmount(v).amount !== undefined,
  date: (v) => parseDate(v) !== null,
  time: (v) => /\d{1,2}:\d{2}/.test(v),
  originAccount: (v) => /\d{4}/.test(v),
  destinationAccount: (v) => /\d{4}/.test(v),
}

/** Reads label/value pairs whether the value follows on the same line or the next. */
function readFields(text: string): Partial<Record<FieldKey, string>> {
  const cells = text
    .split('\n')
    .flatMap((line) => line.split(/\t| {2,}/))
    .map((c) => c.trim())
    .filter(Boolean)
  const found: Partial<Record<FieldKey, string>> = {}
  const accept = (key: FieldKey, value: string) => {
    if (!value || found[key] !== undefined) return false
    if (!(ACCEPTS[key]?.(value) ?? true)) return false
    found[key] = value
    return true
  }
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i] ?? ''
    const hit = labelAt(cell)
    if (!hit) continue
    const [key, label] = hit
    if (accept(key, stripLabel(cell, label))) continue
    const next = cells[i + 1]
    if (next && !labelAt(next) && accept(key, next.replace(/^:\s*/, '').trim())) i++
  }
  return found
}

/** Money as receipts print it: "$11,603.56", "11603.56 MXN" (not "56/100 M.N."). */
function parseAmount(value: string | undefined): { amount?: string; currency?: string } {
  if (!value) return {}
  const compact = value.replace(/\s/g, '')
  const m =
    /\$(\d{1,3}(?:,\d{3})+|\d+)(\.\d{2})?/.exec(compact) ??
    /(\d{1,3}(?:,\d{3})+|\d+)(\.\d{2})(?!\d)/.exec(compact)
  if (!m) return {}
  const amount = Number(`${(m[1] ?? '').replace(/,/g, '')}${m[2] ?? ''}`).toFixed(2)
  const currency = /usd|dls|dolar/i.test(normalize(value)) ? 'USD' : 'MXN'
  return Number(amount) > 0 ? { amount, currency } : {}
}

function parseDate(value: string | undefined): { y: number; m: number; d: number } | null {
  if (!value) return null
  const n = normalize(value)
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(n)
  if (m) return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
  m = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(n)
  if (m) return { y: Number(m[3]), m: Number(m[2]), d: Number(m[1]) }
  m = /(\d{1,2})(?: de)?[ /.-]([a-z]{3})[a-z]*\.?(?: de)?[ /.-](\d{4})/.exec(n)
  if (m && MONTHS[m[2] ?? ''])
    return { y: Number(m[3]), m: MONTHS[m[2] ?? ''] ?? 0, d: Number(m[1]) }
  return null
}

function parseTime(value: string | undefined): { h: number; min: number; s: number } {
  const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?/.exec(
    normalize(value ?? ''),
  )
  if (!m) return { h: 12, min: 0, s: 0 }
  let h = Number(m[1])
  const pm = m[4]?.startsWith('p')
  if (m[4] && pm && h < 12) h += 12
  if (m[4] && !pm && h === 12) h = 0
  return { h, min: Number(m[2]), s: Number(m[3] ?? 0) }
}

/** Mexico City has been UTC-6 all year since 2022 (no DST). */
function mexicoCityInstant(
  date: { y: number; m: number; d: number },
  time: { h: number; min: number; s: number },
): Date | undefined {
  const pad = (n: number) => String(n).padStart(2, '0')
  const iso = `${date.y}-${pad(date.m)}-${pad(date.d)}T${pad(time.h)}:${pad(time.min)}:${pad(time.s)}-06:00`
  const result = new Date(iso)
  return Number.isNaN(result.getTime()) ? undefined : result
}

/** Last four digits of an account shown as •1234, ****1234, …1234 or in full. */
function last4(value: string | undefined): string | undefined {
  if (!value) return undefined
  const digits = value.replace(/\D/g, '')
  const four = digits.slice(-4)
  return four.length === 4 && isLast4(four) ? four : undefined
}

function methodFor(
  operationType: string | undefined,
  trackingKey: string | undefined,
): PaymentMethod {
  const n = normalize(operationType ?? '')
  if (/spei|transfer/.test(n) || (!n && trackingKey)) return 'spei_transfer'
  if (/tarjeta|card/.test(n)) return 'card'
  if (/efectivo|cash/.test(n)) return 'cash'
  return 'other'
}

const cleanText = (value: string | undefined, max = 255) =>
  value
    ? maskLongDigitRuns(value).replace(/\s+/g, ' ').trim().slice(0, max) || undefined
    : undefined

const cleanIdentifier = (value: string | undefined) => {
  const v = value?.replace(/\s+/g, '').slice(0, 64)
  return v && !looksLikeCardOrClabe(v) ? v : undefined
}

/** Deterministic parser for the text of a BBVA México "Comprobante de la operación". */
export function parseBbvaComprobante(text: string): ExtractionResult | null {
  if (!normalize(text).includes('comprobante de la operacion')) return null
  const raw = readFields(text)
  const { amount, currency } = parseAmount(raw.amount)
  const date = parseDate(raw.date)
  const trackingKey = cleanIdentifier(raw.trackingKey)
  const fields: ExtractedPaymentFields = {
    method: methodFor(raw.operationType, trackingKey),
    operationType: cleanText(raw.operationType, 100),
    folio: cleanIdentifier(raw.folio),
    trackingKey,
    paidAt: date ? mexicoCityInstant(date, parseTime(raw.time ?? raw.date)) : undefined,
    amount,
    currency,
    reference: cleanText(raw.reference),
    originAccountLast4: last4(raw.originAccount),
    destinationAccountLast4: last4(raw.destinationAccount),
    beneficiaryName: cleanText(raw.beneficiaryName),
    bankName: cleanText(raw.bankName, 100),
  }
  const present: Record<FieldKey, unknown> = {
    operationType: fields.operationType,
    folio: fields.folio,
    date,
    time: raw.time,
    reference: fields.reference,
    amount: fields.amount,
    originAccount: fields.originAccountLast4,
    beneficiaryName: fields.beneficiaryName,
    bankName: fields.bankName,
    destinationAccount: fields.destinationAccountLast4,
    trackingKey,
  }
  const found = CORE_FIELDS.filter((k) => present[k] !== undefined && present[k] !== null).length
  const defined = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  ) as ExtractedPaymentFields
  return {
    extractor: 'bbva-comprobante-pdf',
    confidence: found / CORE_FIELDS.length,
    fields: defined,
  }
}

export const bbvaComprobantePdfExtractor: PaymentEvidenceExtractor = {
  name: 'bbva-comprobante-pdf',
  supports: (mime) => mime === 'application/pdf',
  async extract({ bytes }) {
    return parseBbvaComprobante(extractPdfText(bytes))
  },
}

/**
 * Images (photos or screenshots of a receipt) are not read: staff type the
 * fields next to the image. A vision/OCR extractor would plug in HERE: an
 * object implementing PaymentEvidenceExtractor for image/* that returns the
 * same ExtractionResult (its output is only a prefill, validated on save).
 * Add it to DEFAULT_EXTRACTORS before this no-op.
 */
export const imageNoopExtractor: PaymentEvidenceExtractor = {
  name: 'image-manual',
  supports: (mime) => mime.startsWith('image/'),
  async extract() {
    return null
  },
}

export const DEFAULT_EXTRACTORS: PaymentEvidenceExtractor[] = [
  bbvaComprobantePdfExtractor,
  imageNoopExtractor,
]

/** First extractor that recognises the file wins; null means manual entry. */
export async function extractPaymentEvidence(
  input: EvidenceInput,
  extractors: PaymentEvidenceExtractor[] = DEFAULT_EXTRACTORS,
): Promise<ExtractionResult | null> {
  for (const extractor of extractors) {
    if (!extractor.supports(input.mime)) continue
    try {
      const result = await extractor.extract(input)
      if (result) return result
    } catch {
      // A failing extractor only means no prefill.
    }
  }
  return null
}
