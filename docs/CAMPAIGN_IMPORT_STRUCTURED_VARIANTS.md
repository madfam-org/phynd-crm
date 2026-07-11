# Campaign import: structured variants are canonical

Status: canonical guidance
Date: 2026-07-11

## TL;DR

For claims-audited campaigns, POST **structured** `draft_variants` directly to
PhyndCRM `POST /api/v1/campaigns/import`. Do not route them through Selva's
`crm-handoff` endpoint: it wraps each variant as a plain string
(`CrmCampaignHandoffRequest.draft_variants: list[str]`), which PhyndCRM
persists as `format='legacy_string'` with **no `claim_keys_used`** — the claims
audit trail is silently dropped.

## The two paths

| Path | Wire shape | Persisted format | `claim_keys_used` |
| --- | --- | --- | --- |
| Selva `crm-handoff` → PhyndCRM import | `draft_variants: string[]` | `legacy_string` | lost |
| Direct PhyndCRM import (canonical) | `draft_variants: object[]` | `structured` | preserved |

PhyndCRM's import schema
(`packages/services/src/campaigns/tulana-import.schema.ts`) accepts a
`string | structured` union per variant, so both shapes validate — but only the
structured object carries the claims audit. Variants persist to
`campaign_draft_variants` via `CampaignDraftVariantService`, where
`claim_keys_used` survives the draft → approved review flow and is surfaced in
the Tulana review dialog (`campaigns.listDraftVariants`).

## Structured variant shape

Matches Selva's generate-copy output (`CampaignCopyVariant`):

```json
{
  "draft_variants": [
    {
      "variant_id": "karafiel-contador-es-a",
      "language": "es-MX",
      "subject": "Piloto pagado de Karafiel Contador",
      "preheader": "Cupo limitado para despachos contables",
      "body": "Estamos abriendo un piloto pagado y controlado de Karafiel Contador…",
      "cta": "Responde este correo para recibir el enlace de pago",
      "claim_keys_used": ["price_mxn_1299_month", "controlled_pilot_only"]
    }
  ]
}
```

`variant_id`, `language`, `subject`, and `body` are required; `preheader` and
`cta` are optional; `claim_keys_used` defaults to `[]` (an empty array means
"no claims audit", so populate it for any copy that makes product claims).

## How to send

`scripts/import-tulana-campaign.mjs` signs and sends the payload file
**verbatim** — structured variants, including `claim_keys_used`, survive
exactly as written in the payload JSON:

```bash
PHYND_CAMPAIGN_IMPORT_SECRET=... \
node scripts/import-tulana-campaign.mjs path/to/payload.json
```

The script prints a variant-format preflight (`N structured, M legacy_string`)
and warns when the payload contains legacy string variants, so claim-audit
loss is visible before the send. Full operator flow (review, approve, send):
`docs/KARAFIEL_CONTADOR_G4_OPERATOR_IMPORT_RUNBOOK_2026-06-01.md`.

## References

- `packages/services/src/campaigns/tulana-import.schema.ts` —
  `structuredDraftVariantSchema`, `normalizeDraftVariant`
- `packages/services/src/campaigns/campaign-draft-variant.service.ts` —
  persistence with `format: 'structured' | 'legacy_string'`
- `packages/db/src/schema/campaign-draft-variants.ts` — audit-trail columns
