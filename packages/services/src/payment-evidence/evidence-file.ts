import crypto from 'node:crypto'

/** 10 MB. */
export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024

export const EVIDENCE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
} as const
export type EvidenceMime = keyof typeof EVIDENCE_TYPES

const KEY_PATTERN = /^payment-evidence\/([0-9a-f]{64})\.(jpg|png|webp|heic|pdf)$/

/**
 * The file type from its first bytes. The browser-sent content type is never
 * trusted. Returns null for anything that is not JPEG, PNG, WebP, HEIC or PDF.
 */
export function sniffEvidenceMime(bytes: Uint8Array): EvidenceMime | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to))
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (ascii(0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  if (ascii(0, 5) === '%PDF-') return 'application/pdf'
  // ISO-BMFF: <size>"ftyp"<brand>; HEIC/HEIF brands.
  if (ascii(4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx|mif1|msf1)$/.test(ascii(8, 12))) {
    return 'image/heic'
  }
  return null
}

export function sha256Hex(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

/** Content-addressed key: identical files share one object. */
export function evidenceStorageKey(sha256: string, mime: EvidenceMime): string {
  return `payment-evidence/${sha256}.${EVIDENCE_TYPES[mime]}`
}

/** Checks a key against its claimed sha256 and mime (both come from the upload). */
export function isEvidenceKeyFor(key: string, sha256: string, mime: string): boolean {
  const match = KEY_PATTERN.exec(key)
  if (!match) return false
  return match[1] === sha256 && EVIDENCE_TYPES[mime as EvidenceMime] === match[2]
}

export type EvidenceFileCheck =
  | { ok: true; mime: EvidenceMime; sha256: string; key: string; size: number }
  | { ok: false; reason: 'empty' | 'too_large' | 'unsupported_type' }

export function checkEvidenceFile(bytes: Uint8Array): EvidenceFileCheck {
  if (bytes.byteLength === 0) return { ok: false, reason: 'empty' }
  if (bytes.byteLength > MAX_EVIDENCE_BYTES) return { ok: false, reason: 'too_large' }
  const mime = sniffEvidenceMime(bytes)
  if (!mime) return { ok: false, reason: 'unsupported_type' }
  const sha256 = sha256Hex(bytes)
  return { ok: true, mime, sha256, key: evidenceStorageKey(sha256, mime), size: bytes.byteLength }
}
