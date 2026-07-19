import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tulanaCampaignImportSchema } from '../campaigns/tulana-import.schema'

// Guards docs/DHANAM_ESSENTIALS_G4_CAMPAIGN_IMPORT_PAYLOAD_2026-07.json against
// schema drift: the payload must stay importable verbatim via
// POST /api/v1/campaigns/import, with the claims audit + clickable CTAs intact.
const PAYLOAD_PATH = join(
  __dirname,
  '../../../../docs/DHANAM_ESSENTIALS_G4_CAMPAIGN_IMPORT_PAYLOAD_2026-07.json',
)

describe('dhanam essentials campaign import payload', () => {
  const payload = JSON.parse(readFileSync(PAYLOAD_PATH, 'utf8'))

  it('validates against the tulana import schema', () => {
    const result = tulanaCampaignImportSchema.safeParse(payload)
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2))
    }
    expect(result.success).toBe(true)
  })

  it('carries only structured variants with claims audit and https CTAs', () => {
    const result = tulanaCampaignImportSchema.parse(payload)
    const structured = result.draft_variants.filter(
      (v): v is Exclude<typeof v, string> => typeof v !== 'string',
    )
    expect(structured).toHaveLength(result.draft_variants.length)
    expect(structured.length).toBeGreaterThanOrEqual(3)
    for (const variant of structured) {
      expect(variant.claim_keys_used.length).toBeGreaterThan(0)
      expect(variant.cta_url).toMatch(/^https:\/\/app\.dhan\.am\//)
      expect(variant.language).toBe('es-MX')
    }
  })

  it('never claims live bank sync and always carries the Belvo Aug 2026 roadmap statement', () => {
    const result = tulanaCampaignImportSchema.parse(payload)
    const structured = result.draft_variants.filter(
      (v): v is Exclude<typeof v, string> => typeof v !== 'string',
    )
    for (const variant of structured) {
      const body = variant.body.toLowerCase()
      // Live-sync phrasings are banned (Belvo is sandbox-only in prod).
      expect(body).not.toMatch(/sincronizaci[oó]n autom[aá]tica en vivo|tiempo real/)
      expect(body).not.toMatch(/conecta tu banco hoy/)
      // The roadmap statement is required, with the August 2026 date.
      expect(body).toContain('belvo')
      expect(body).toContain('agosto de 2026')
    }
    const doNotClaim = result.guardrails?.do_not_claim ?? []
    expect(doNotClaim.some((c) => c.toLowerCase().includes('belvo'))).toBe(true)
  })
})
