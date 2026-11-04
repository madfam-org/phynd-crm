# Convergence read API

Read-only feed of MADFAM's own CRM pipeline for the owner dashboard
(converge-dash, `dash.madfam.io`). converge-dash's `PhyndCrmClient`
(`packages/integrations/src/phynd-crm.ts`) calls both routes on every
ingestion run and validates every item; one invalid item fails the whole
endpoint. This document is the contract on the PhyndCRM side.

Code: `apps/web/src/app/api/v1/convergence/`, `apps/web/src/lib/convergence/`,
`packages/services/src/convergence/`.

## Routes

```
GET /api/v1/convergence/leads?period_start=<ISO>&period_end=<ISO>
GET /api/v1/convergence/opportunities?period_start=<ISO>&period_end=<ISO>
Authorization: Bearer <CONVERGENCE_API_TOKEN>
```

The body is a bare JSON array (`Cache-Control: no-store`). Errors are
`{ "error": "<message>" }`:

| Status | When |
| --- | --- |
| 401 | No `Bearer` header (`Missing or malformed Authorization header`), `CONVERGENCE_API_TOKEN` unset or empty (`Convergence authentication is not configured`), wrong token (`Invalid convergence token`) |
| 400 | `period_start` / `period_end` missing, not ISO-8601, or `period_start >= period_end` |
| 429 | More than 60 requests a minute from one IP (Redis; fails closed when Redis is down) |
| 500 | Malformed `CONVERGENCE_TENANT_IDS`, or the database read failed |

## Auth

A dedicated `CONVERGENCE_API_TOKEN`, not `FEDERATION_API_TOKEN`: this feed must
not share the credential that grants Selva's per-contact reads. The token is
compared in constant time (SHA-256 of both sides, then `timingSafeEqual`).
When it is unset the routes fail closed with 401, the same behaviour as
Dhanam's `ConvergenceAuthGuard`. The value must equal converge-dash's
`PHYND_CRM_API_TOKEN`.

Production: ExternalSecret `phynd-crm-convergence-secrets` maps Vault
`secret/phynd-crm` property `convergence_api_token`; the web Deployment reads it
as an optional `secretKeyRef`, so the pod starts without it.

## Tenant scope

The feed reads the tenants listed in `CONVERGENCE_TENANT_IDS` (comma-separated
ids, default `madfam`), never the tenant derived from the request host, so a
call through `phynd.app` still reads only MADFAM's own CRM. Tenants that resolve
to the same database (no `DATABASE_URL_<TENANT>` of their own) are read once.

Always excluded: soft-deleted rows, demo-session rows (`demo-%` ids) and the
synthetic revenue-loop probe lead (`source = 'synthetic-probe'`).

## Period

`period_start` is inclusive and `period_end` exclusive: `[period_start, period_end)`.
Both are ISO-8601: a date (`2026-11-01`, UTC midnight) or a date-time with a zone
(`2026-11-01T00:00:00.000Z`, `…-06:00`). A date-time without a zone is rejected.

- **Leads** are selected by capture time: `period_start <= leads.created_at < period_end`.
- **Opportunities** are those open during the period or closed within it:
  `created_at < period_end` and (still open, or closed at/after `period_start`).
  - An opportunity is open unless its status is `won` or `lost`.
  - Close time: the `opportunity_to_won` conversion's `converted_at` for a won
    opportunity. A lost opportunity, or one marked won by bulk update or import,
    has no recorded close time; its `updated_at` bounds it (the status change
    wrote the row), so it is included until a period starts after its last update.

## Leads mapping

| Field | Source |
| --- | --- |
| `lead_id` | `leads.id` |
| `status` | `leads.status` (`new`, `contacted`, `qualified`, `unqualified`, `converted`) |
| `contact_id` | `leads.contact_id`, when set |
| `customer_id` | the same contact id, only when that contact is a customer (below) |
| `captured_at` | `leads.created_at` |
| `source` | `leads.source`, when set |
| `score` | `leads.score` (the score shown in the CRM), when set |

## Opportunities mapping

| Field | Source |
| --- | --- |
| `opportunity_id` | `opportunities.id` |
| `stage` | `closed_won` / `closed_lost` when the status is won / lost; otherwise the pipeline stage name |
| `value` | `opportunities.value`, **MXN**. Opportunities have no currency column; the CRM records them in MXN (also the client-import manifest's rule) |
| `probability` | 0–1. Won = 1, lost = 0; open: `opportunities.probability / 100`, else the stage's default probability |
| `customer_id` | the opportunity's contact id, only when that contact is a customer |
| `business_line` | never sent: the CRM has no business-line field |
| `expected_close_at` | `opportunities.expected_close_date`, when set |
| `closed_at` | the recorded win time (above), when there is one |

Status, not the stage, decides open versus closed, as in the CRM's own
analytics. converge-dash leaves `closed_lost` out of pipeline value.

## Customers

converge-dash turns every `customer_id` into an active customer, so the feed
sends one only for a contact that is a customer: not deleted, and with a won
opportunity or an engagement that is not `cancelled`.

## Values are never invented

Optional fields the CRM lacks are omitted, never `null` (converge-dash rejects
`null`). An opportunity without a value, without any probability (its own or
its stage's), or without a stage name is left out of the feed; the route logs
how many were left out and why (`web:convergence`, `omitted`).
