# Tulana SKU campaign inputs

Date: 2026-05-29

Status: proposed implementation contract — **import**, **review UI**, **consent send gates**, and **buyer-signal export** shipped 2026-05-28. Run `pnpm db:migrate` for `0008_orange_sandman` + `0009_lazy_wrecker` before pilot.

## Direct surfaces

| Surface | URL |
| --- | --- |
| Public Phynd surface | `https://phynd.app` |
| MADFAM CRM tenant | `https://crm.madfam.io` |
| Generic CRM app host | `https://crm.phynd.app` |
| Tulana app | `https://tulana-app.madfam.io` |
| Selva office | `https://selva.town` |

## Role boundary

Phynd CRM is the campaign system of record. It should receive campaign-ready
SKU material from Tulana directly or through Selva, stage/review/send campaigns,
and record engagement outcomes.

Phynd CRM must not decide whether an SKU is commercially GA-ready. That decision
comes from Tulana readiness evidence. Phynd CRM can record buyer responses that
later improve Tulana WTP/PMF evidence.

## Required input from Tulana/Selva

Minimum campaign payload:

```json
{
  "idempotency_key": "tulana-avala__issuer-20260529-v1",
  "source": "tulana",
  "orchestrator": "selva",
  "sku_key": "avala__issuer",
  "platform": "avala",
  "audience": "credential issuers",
  "ga_readiness": "near_ready",
  "campaign_type": "text",
  "value_prop": "Evidence-backed positioning text",
  "proof_points": [
    {
      "label": "Required adjacent comparator",
      "value": "Canvas Credentials",
      "source_url": "https://www.instructure.com/canvas/credentials"
    }
  ],
  "guardrails": {
    "do_not_claim": ["external legal approval", "GA if readiness is not ready"],
    "policy_state": "waived_by_operator",
    "last_verified_at": "2026-05-29T00:00:00Z"
  },
  "drafts": [
    {
      "channel": "sms",
      "locale": "en-US",
      "body": "Short draft text"
    }
  ],
  "draft_variants": [
    "Legacy plain-string variant (still accepted)",
    {
      "variant_id": "9c1f6c3e-6f0f-4e88-9a3f-1c2d3e4f5a6b",
      "language": "es-MX",
      "subject": "Asunto del correo",
      "preheader": "Texto de vista previa (opcional)",
      "body": "Cuerpo del correo",
      "cta": "Agenda una demo",
      "claim_keys_used": ["issuer_verified_badges"]
    }
  ]
}
```

### `draft_variants` (additive, 2026-07)

`draft_variants` accepts either legacy plain strings (Selva
`CrmCampaignHandoffRequest.draft_variants: list[str]` stays wire-compatible)
or structured variants matching Selva's generate-copy output
(`{variant_id, language, subject, preheader?, body, cta?, claim_keys_used[]}`).
Each variant is persisted to `campaign_draft_variants` so the
`claim_keys_used` audit trail survives the draft → `needs_review` →
`approved` flow; reviewers see subjects, preheaders, CTAs, and claim keys in
the campaign review dialog (`campaigns.listDraftVariants`). The existing
`drafts` field is unchanged. Requires migration `0012_yellow_proemial_gods`.

## Audience and consent requirements

Before a campaign can send:

- contact records must have a lawful/approved outreach basis;
- unsubscribe and suppression state must be checked;
- channel preference must be respected;
- campaign copy must fit the selected channel;
- all generated claims must be traceable to Tulana proof points;
- waived or near-ready SKUs must not be described as fully GA.

## Campaign states

Recommended states for Tulana-driven campaigns:

| State | Meaning |
| --- | --- |
| `draft_imported` | Payload accepted from Tulana/Selva |
| `needs_review` | Human review required before send |
| `approved` | Approved for send |
| `scheduled` | Send window selected |
| `sent` | Message dispatched |
| `suppressed` | Contact/channel blocked by consent or suppression |
| `rejected` | Human rejected campaign or copy |
| `completed` | Campaign closed and outcomes summarized |

## Feedback to Tulana

Phynd CRM should emit buyer-signal events back to Tulana through a governed
endpoint or export. Minimum event fields:

| Field | Description |
| --- | --- |
| `sku_key` | Tulana SKU |
| `campaign_id` | Phynd campaign identifier |
| `contact_segment` | Audience label, not raw private data |
| `event_type` | Delivered, replied, interested, rejected, unsubscribed, booked, converted |
| `occurred_at` | Timestamp |
| `signal_strength` | Low, medium, high |
| `notes_redacted` | Optional non-sensitive operator notes |

Raw contact PII should stay in Phynd CRM. Tulana needs aggregated or
pseudonymized buyer-signal evidence for pricing and GA readiness.

## Direct implementation work

- Import: `POST /api/v1/campaigns/import` (HMAC, `PHYND_CAMPAIGN_IMPORT_SECRET`).
- Review: `/campaigns` UI + `campaigns.reviewTulanaImport` tRPC.
- Send: `POST /api/v1/campaigns/send` with `{ campaign_id, contact_id }` — runs consent/suppression gates.
- Export: `POST /api/v1/campaigns/buyer-signals` with optional `{ sku_key, since, limit }` — returns PII-free events.
- Staff UI: **Dispatch to contact** on approved Tulana campaigns (`campaigns.attemptTulanaSend`).

## Tests

- Schema validation for Tulana campaign payloads.
- Idempotent import test.
- Guardrail test that non-GA copy cannot be approved as GA.
- Consent/suppression send-block test.
- Feedback event export test with PII redaction.

## Commercial GA hard gate addendum - 2026-06-01

Paid revenue campaigns must now also satisfy [Commercial GA campaign SKU gates](./COMMERCIAL_GA_CAMPAIGN_SKU_GATES_2026-06-01.md). PhyndCRM must not send or approve paid-GA copy for a SKU unless `commercial_ga_status=ga_ready` and gates G0-G9 have evidence references. `candidate` SKUs are limited to discovery, waitlist, or manually controlled warm-pilot workflows.

Initial first-pesos campaign candidates are `karafiel__contador` and `coforma__startup`; both remain campaign candidates until checkout, ledger, entitlement, BBVA payout, and Converge revenue evidence are proven.
