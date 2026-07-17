# Commercial GA campaign SKU gates

Date: 2026-06-01
Status: required campaign gate for PhyndCRM-driven outbound.

## Purpose

PhyndCRM is the campaign system of record. It must not decide whether a SKU
is Commercial GA. It must enforce the readiness state supplied by
Tulana/Selva and block paid GA sends unless the SKU has passed the upstream
Commercial GA gates.

## Naming note

The repo and system name is `phynd-crm` / PhyndCRM. If an operator says
"PhyneCRM", treat it as PhyndCRM unless a separate system is explicitly
created.

## Commercial GA statuses

| Status | Meaning | PhyndCRM behavior |
| --- | --- | --- |
| `blocked` | Missing proof or dependency. | Reject paid campaign import; allow remediation task only. |
| `candidate` | Good SKU candidate but not all money-path proof is complete. | Allow discovery/waitlist campaign only. |
| `ga_ready` | Upstream gates complete and evidence references are present. | Allow paid revenue campaign after human approval. |
| `paused` | Previously ready but under incident/change freeze. | Block sends and require re-approval. |

## Send approval rules

Before any paid campaign send, PhyndCRM must verify:

- `commercial_ga_status` is `ga_ready`.
- All upstream gates report `passed`.
- Gate evidence contains durable references, not prose-only claims.
- Contact has lawful outreach basis.
- Unsubscribe and suppression state are clear.
- Channel preference allows the selected channel.
- Human reviewer approves copy and audience.
- Campaign copy does not violate the SKU's guardrails.
- Import idempotency key has not already been sent to the same contact/audience.

If the SKU is `candidate`, PhyndCRM may only send discovery/waitlist copy that
explicitly avoids paid availability, GA, and revenue claims.

## PhyndCRM test requirements

These tests must exist and pass before autonomous or semi-autonomous campaign
execution is trusted for paid GA campaigns:

- Import rejects `ga_ready` when required gate evidence is missing.
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
| `revenue_evidenced` | Upstream evidence confirms recognized revenue. |

## Related docs

- Existing input contract: `TULANA_SKU_CAMPAIGN_INPUTS_2026-05-29.md`
- Selva CRM agent tools: `SELVA_CRM_AGENT_TOOLS.md`

The current SKU slate, gate schema/version, pricing, and evidence payload
shape are product/operational detail, not public source; see the private
`madfam-org/internal-devops` runbook or the ops team.
