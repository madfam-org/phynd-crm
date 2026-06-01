# Commercial GA campaign SKU gates

Date: 2026-06-01
Status: required campaign gate for PhyndCRM-driven outbound.

## Purpose

PhyndCRM is the campaign system of record. It must not decide whether a SKU is Commercial GA. It must enforce the readiness state supplied by Tulana/Selva and block paid GA sends unless the SKU has passed the Dhanam first-pesos Commercial GA gates.

This document upgrades the 2026-05-29 Tulana campaign input contract with a hard monetization gate.

## Naming note

The repo and system name is `phynd-crm` / PhyndCRM. If an operator says "PhyneCRM", treat it as PhyndCRM unless a separate system is explicitly created.

## Commercial GA statuses

| Status | Meaning | PhyndCRM behavior |
| --- | --- | --- |
| `blocked` | Missing proof or dependency. | Reject paid campaign import; allow remediation task only. |
| `candidate` | Good SKU candidate but not all money-path proof is complete. | Allow discovery/waitlist campaign only. |
| `ga_ready` | G0-G9 gates complete and evidence references are present. | Allow paid revenue campaign after human approval. |
| `paused` | Previously ready but under incident/change freeze. | Block sends and require re-approval. |

## Required campaign payload extension

Tulana/Selva imports must include the existing campaign fields plus the Commercial GA proof envelope below.

```json
{
  "sku_key": "karafiel__contador",
  "commercial_ga_status": "candidate",
  "commercial_ga_gate_version": "2026-06-01",
  "money_path": {
    "dhanam_product": "karafiel",
    "dhanam_tier": "contador",
    "currency": "MXN",
    "monthly_minor_units": 129900,
    "provider_path": "stripe_mx_or_conekta",
    "requires_bbva_payout_proof": true
  },
  "gate_evidence": [
    { "gate": "G0", "status": "passed", "evidence_ref": "dhanam_catalog:2026-06-01" },
    { "gate": "G1", "status": "passed", "evidence_ref": "tulana_pricing_evidence:82_of_82" },
    { "gate": "G8", "status": "pending", "evidence_ref": null },
    { "gate": "G9", "status": "pending", "evidence_ref": null }
  ],
  "do_not_claim": [
    "Do not claim paid GA until commercial_ga_status is ga_ready",
    "Do not claim pesos landed until BBVA payout evidence exists",
    "Do not claim recognized revenue until Converge revenue evidence rows are greater than zero"
  ]
}
```

## Send approval rules

Before any paid campaign send, PhyndCRM must verify:

- `commercial_ga_status` is `ga_ready`.
- All gates G0-G9 have `passed`.
- `gate_evidence` contains durable references, not prose-only claims.
- Contact has lawful outreach basis.
- Unsubscribe and suppression state are clear.
- Channel preference allows the selected channel.
- Human reviewer approves copy and audience.
- Campaign copy does not violate `do_not_claim`.
- Import idempotency key has not already been sent to the same contact/audience.

If the SKU is `candidate`, PhyndCRM may only send discovery/waitlist copy that explicitly avoids paid availability, GA, and revenue claims.

## Initial SKU campaign slate

| SKU | Status until G0-G9 proof | Allowed campaign now | Paid GA campaign condition |
| --- | --- | --- | --- |
| `karafiel__contador` | `candidate` | Discovery or manually approved warm-prospect checkout pilot. | Promote to `ga_ready` after live checkout, ledger, entitlement, BBVA payout, and Converge revenue evidence. |
| `coforma__startup` | `candidate` | Discovery or warm CAB/PMF pilot. | Promote to `ga_ready` after full money-path proof. |
| `tezca__pro` | `candidate` | Inbound/waitlist only. | Promote after legal-intelligence proof pack and money-path proof. |
| `dhanam__pro` | `plumbing_smoke_only` | Internal smoke only. | Do not use as primary first-pesos campaign SKU unless operator explicitly chooses low-ticket proof over business signal. |
| `pravara-mes__starter` | `candidate_enterprise` | Account-based discovery only. | Promote after sales/procurement path and money-path proof. |

## PhyndCRM test requirements

These tests must exist and pass before autonomous or semi-autonomous campaign execution is trusted for paid GA campaigns:

- Import rejects `ga_ready` when any G0-G9 evidence is missing.
- Import accepts `candidate` only for discovery/waitlist campaign types.
- Approval blocks copy that claims GA for `candidate`.
- Send blocks contacts with suppression/unsubscribe/channel mismatch.
- Idempotent import does not duplicate campaigns.
- Buyer-signal export redacts PII.
- Selva service principal cannot mutate contacts/opportunities outside approved campaign endpoints.
- Campaign outcome events can be exported back to Tulana as buyer-signal evidence.

## Required PhyndCRM campaign states

Add these states or enforce their equivalents in review logic:

| State | Meaning |
| --- | --- |
| `ga_evidence_missing` | Import is structurally valid but not paid-GA eligible. |
| `candidate_discovery_only` | Human can approve discovery/waitlist copy only. |
| `ga_ready_review` | Evidence complete; human review required. |
| `ga_ready_approved` | Evidence and copy approved; send scheduling allowed. |
| `sent` | Message dispatched with consent/suppression proof. |
| `converted` | Buyer completed checkout and payment proof is linked. |
| `revenue_evidenced` | Dhanam/Converge evidence confirms recognized revenue. |

## Related docs

- Existing input contract: `TULANA_SKU_CAMPAIGN_INPUTS_2026-05-29.md`
- Selva CRM agent tools: `SELVA_CRM_AGENT_TOOLS.md`
- Selva orchestration gate: `../../selva-office/docs/COMMERCIAL_GA_CAMPAIGN_ORCHESTRATION_GATES_2026-06-01.md`
- Dhanam first-pesos runbook: `../../dhanam/docs/FIRST_PESOS_COMMERCIAL_GA_MONETIZATION_2026-06-01.md`
