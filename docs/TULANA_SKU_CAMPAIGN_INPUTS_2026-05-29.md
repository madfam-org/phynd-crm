# Tulana SKU campaign inputs

Date: 2026-05-29

Status: implemented — import, review UI, consent send gates, and buyer-signal
export shipped 2026-05-28.

## Role boundary

Phynd CRM is the campaign system of record. It receives campaign-ready SKU
material from Tulana directly or through Selva, stages/reviews/sends
campaigns, and records engagement outcomes.

Phynd CRM must not decide whether a SKU is commercially GA-ready — that
decision comes from Tulana readiness evidence. Phynd CRM can record buyer
responses that later feed back into Tulana's own readiness evidence.

## Campaign import shape

Campaign payloads carry a SKU key, audience label, readiness/status flags,
guardrails (claims the copy must not make), and one or more draft variants —
either a plain string or a structured
`{variant_id, language, subject, preheader?, body, cta?, claim_keys_used[]}`
object. Structured variants persist to `campaign_draft_variants` so the
`claim_keys_used` audit trail survives the draft → `needs_review` →
`approved` flow; reviewers see subjects, preheaders, CTAs, and claim keys in
the campaign review dialog (`campaigns.listDraftVariants`).

See `packages/services/src/campaigns/tulana-import.schema.ts` for the exact
schema and `packages/services/src/campaigns/tulana-import.service.ts` for the
importer.

## Audience and consent requirements

Before a campaign can send:

- contact records must have a lawful/approved outreach basis;
- unsubscribe and suppression state must be checked;
- channel preference must be respected;
- campaign copy must fit the selected channel;
- all generated claims must be traceable to Tulana proof points;
- waived or near-ready SKUs must not be described as fully GA.

## Campaign states

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

Phynd CRM emits aggregated, PII-free buyer-signal events so campaign outcomes
can fold into Tulana's own readiness evidence. Raw contact PII stays in
Phynd CRM; only the SKU key, campaign id, an audience label (not raw private
data), event type, timestamp, signal strength, and optional non-sensitive
notes leave the system.

## PhyndCRM API surface

- Import: `POST /api/v1/campaigns/import` (HMAC-authenticated).
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

## Commercial GA hard gate addendum

Paid revenue campaigns must also satisfy [Commercial GA campaign SKU
gates](./COMMERCIAL_GA_CAMPAIGN_SKU_GATES_2026-06-01.md). PhyndCRM must not
send or approve paid-GA copy for a SKU unless Tulana reports the SKU as GA
ready and gate evidence references are present. `candidate` SKUs are limited
to discovery, waitlist, or manually controlled warm-pilot workflows.

The current SKU candidate slate, pricing, and gate status are product/
operational detail tracked outside this public repo; see the private
`madfam-org/internal-devops` runbook or the ops team.
