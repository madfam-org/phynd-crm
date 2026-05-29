# Tulana SKU campaign inputs

Date: 2026-05-29

Status: proposed implementation contract

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
  ]
}
```

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

- Add an import endpoint or job for Tulana/Selva campaign payloads.
- Enforce idempotency on `idempotency_key`.
- Add review UI filters for platform, SKU, readiness, and policy state.
- Persist `proof_points` and `do_not_claim` next to drafts.
- Block sends when consent/suppression checks fail.
- Emit outcome events for Tulana buyer-signal ingestion.

## Tests

- Schema validation for Tulana campaign payloads.
- Idempotent import test.
- Guardrail test that non-GA copy cannot be approved as GA.
- Consent/suppression send-block test.
- Feedback event export test with PII redaction.
