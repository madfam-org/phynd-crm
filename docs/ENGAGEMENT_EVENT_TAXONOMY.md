# Engagement event taxonomy

`engagement_events` is free-form per-row — any source can write any `event_type` string. That flexibility is deliberate (each platform owns its own vocabulary), but for portal queries to be useful across the ecosystem, we need a stable shared vocabulary for **milestone** events that clients experience as discrete "things happened to my engagement" moments.

## Event-type format

```
<source>:<event_name>
```

- **source** (20 chars max) is the writing platform: `cotiza`, `pravara`, `selva`, `karafiel`, `dhanam`, `nauta`, `system`, or any future producer.
- **event_name** is free-form per-source, but when the event is a **client-visible milestone**, prefer a canonical name from the table below so cross-source filters work.

## Milestone names (canonical)

These appear in portal timelines with prominent visual treatment and can be queried source-agnostically. Producers SHOULD emit a second event with the canonical name alongside any native event that represents the same milestone (separate `dedup_key` so idempotency holds independently).

| Canonical event_name | Semantic meaning | Who emits | Portal status |
|---|---|---|---|
| `quote_approved` | Client accepted a proposal | Cotiza / PhyndCRM CRM action | `milestone` |
| `payment_received` | Payment settled at Dhanam | Dhanam | `milestone` |
| `payment_reconciled` | Payment matched to a CRM order | PhyndCRM CRM action | `milestone` |
| `cfdi_stamped` | Karafiel stamped a CFDI 4.0 for an invoice | Karafiel | `milestone` |
| `fabrication_started` | Physical build started on the fab floor | Pravara | `milestone` |
| `prototype_shipped` | Physical prototype left the fab (in transit) | Pravara / external fab | `milestone` |
| `deliverable_received` | Physical deliverable confirmed received by client | Pravara / field install / manual | `completed` |
| `deliverable_ready` | Digital deliverable ready for review | Selva / ops | `milestone` |
| `digital_handoff` | Admin credentials / digital asset handed over | Selva / ops | `completed` |

## Non-milestone events

Everything else stays source-scoped and doesn't need a canonical alias. Examples:

- `cotiza:quote_sent`, `cotiza:quote_viewed`, `cotiza:quote_rejected`, `cotiza:quote_expired`, `cotiza:quote_ordered` — Cotiza quote lifecycle states (dedup key `cotiza:<cotiza_quote_id>:<state>`). The approval state `cotiza:quote_approved` is the milestone case: Cotiza also emits the canonical `quote_approved` alias with dedup key `cotiza:<cotiza_quote_id>:milestone:quote_approved`. Inbound handling reflects these states onto the local `quotes` row (`sent` / `accepted` / `declined` / `expired`); `quote_viewed` and `quote_ordered` are event-only.
- `pravara:queued`, `pravara:quality_check` — intermediate fab states
- `selva:agent_task_assigned`, `selva:pr_opened` — digital execution checkpoints
- `nauta:qbr_published`, `nauta:roadmap_updated`, `nauta:audit_completed` — fractional-CTO engagement checkpoints for retained (tier-3) clients. Nauta runs the engagement; PhyndCRM stays the system of record for the client relationship, so these are written back here rather than forking the timeline into a second history. Deliberately **not** milestones: they are cadence artefacts of an ongoing retainer, and promoting a recurring quarterly review to milestone treatment would crowd out the delivery milestones a client actually looks for. Dedup key `nauta:<workspace_id>:<artifact_id>` — the artifact is the stable identity, so republishing the same QBR is idempotent while a genuinely new one is not.
- `karafiel:nom151_stamped` — technical compliance checkpoints
- `system:contact_linked` — internal housekeeping
- `system:intake_created` — PhyndCRM created the client/project onboarding skeleton
- `system:production_order_created` — PhyndCRM created the optional production order during onboarding
- `system:quote_approved` — PhyndCRM CRM action accepted a quote and moved it to confirmed-order readiness
- `system:checkout_created` — PhyndCRM created or exposed a Dhanam checkout session for a quote
- `system:payment_reconciled` — Dhanam payment was matched to an order and the order payment state was updated
- `system:payment_unmatched` — Dhanam payment was received for a known engagement, but no active order could be matched
- `system:payment_failed` — Dhanam reported a failed payment attempt for a matched order
- `system:payment_refunded` — Dhanam reported a refund for a matched order
- `system:payment_disputed` — Dhanam reported a dispute or chargeback for a matched order
- `system:payment_cancelled` — Dhanam reported payment cancellation for a matched order
- `system:payment_<state>_unmatched` — Dhanam reported a lifecycle change for a known engagement, but no active order could be matched
- `system:production_dispatch_requested` — PhyndCRM recorded first-slice production dispatch intent for a paid order delivery track
- `system:production_dispatch_blocked` — PhyndCRM could not infer delivery tracks for a paid order and needs operator routing
- `system:production_dispatch_sent` — PhyndCRM sent the live Pravara/Selva production dispatch HTTP request
- `system:production_dispatch_failed` — PhyndCRM attempted live provider dispatch and left the intent retryable

## `status` field semantics

The `status` column in `engagement_events` drives UI badges:

| status | When to use |
|---|---|
| `pending` | Queued / scheduled / awaiting something upstream |
| `in_progress` | Actively happening |
| `milestone` | **Client-visible milestone — render prominently** |
| `completed` | Final terminal state for this event |
| `failed` | Something went wrong; portal shows error treatment |
| `blocked` | Paused on external input |

Note: `milestone` is **not** a terminal state. `prototype_shipped` is a milestone (client sees "shipped"); `deliverable_received` is `completed` (client confirms receipt and the physical track closes).

## Dedup key format

```
<source>:<external_id>:<state>
```

For milestone aliases, include a `:milestone:<canonical_name>` suffix so the alias is idempotent independent of the raw status event:

```
pravara:order_123:shipped                     // raw status event
pravara:order_123:milestone:prototype_shipped // canonical alias
```

## Example: Pravara shipping a prototype

On `status=shipped`, the webhook writes **two** rows:

```jsonc
// Row 1 — source-native
{
  "source": "pravara",
  "event_type": "pravara:shipped",
  "status": "milestone",
  "message": "Prototype shipped — in transit",
  "dedup_key": "pravara:order_123:shipped",
  "metadata": { "pravara_order_id": "order_123", "pravara_status": "shipped" }
}
// Row 2 — canonical alias
{
  "source": "pravara",
  "event_type": "pravara:prototype_shipped",
  "status": "milestone",
  "message": "Prototype shipped — in transit",
  "dedup_key": "pravara:order_123:milestone:prototype_shipped",
  "metadata": { "canonical_milestone": "prototype_shipped", "pravara_order_id": "order_123", "pravara_status": "shipped" }
}
```

Portal queries can now filter on `event_type LIKE '%:prototype_shipped'` across every producer without enumerating sources, while source-specific audit still works on `event_type = 'pravara:shipped'`.

## Adding a new milestone name

1. Open a PR editing this doc to add the row.
2. Pick producers who should emit the alias and update their webhook/writer code (emit both native + canonical).
3. If the portal needs a bespoke visual treatment (badge colour, icon), update `/portal/[engagementId]` UI accordingly.
4. Keep names snake_case + lowercase. No version suffixes — bump semantics inline when they change.
