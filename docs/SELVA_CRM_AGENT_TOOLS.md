# Selva CRM agent tools

Date: 2026-05-28  
Status: **contract v1** — maps Selva office agents to Phynd CRM read APIs via service token auth.

## Purpose

Selva sales/office agents need a **truthful, scope-bounded** read surface on the
`madfam` tenant (`crm.madfam.io`) without human Janua SSO cookies. This document
is the tool manifest for `FEDERATION_API_TOKEN` / `Authorization: Bearer` access.

Phynd CRM is transport-agnostic: agents may call **tRPC** (`POST /api/trpc`) or
**GraphQL** (`POST /api/graphql`) with the same bearer token and host-derived
tenant. tRPC is the reference below because it matches the shipped service-auth scopes.

## Authentication

| Header | Value |
| --- | --- |
| `Authorization` | `Bearer <FEDERATION_API_TOKEN>` |
| `Host` | `crm.madfam.io` (resolves tenant `madfam`) |

When `FEDERATION_API_TOKEN` is unset, service auth is disabled. Rate limiting
still applies (200 req/min per IP).

### Service principal (WS6.3)

Phynd CRM maps the bearer token to a **machine principal**, not a human Janua user:

| Field | Value |
| --- | --- |
| Default `userId` | `service:selva` |
| Override | `FEDERATION_SERVICE_USER_ID` env (must stay `service:*`) |
| Human staff | `admin@madfam.io` via Auth.js OIDC — separate audit trail |

Successful service-token requests emit structured JSON audit logs
(`web:trpc:service-auth`, event `service_auth`) with `userId`, `tenantId`, and path.

**Janua ops:** register `service:selva` as a dedicated machine principal in Janua
with least-privilege CRM scopes. Do not reuse the staff user's refresh token or
personal OIDC session for Selva office agents.

### Scopes (v1)

| Scope | Purpose |
| --- | --- |
| `contacts:read` | Contact profile + related lists |
| `leads:read` | Lead pipeline context |
| `opportunities:read` | Deal value, stage, owner |
| `activities:read` | Tasks, calls, meetings |
| `engagements:read` | Client project timeline + artifacts |
| `unifiedProfile:read` | Federated Janua/Dhanam/Cotiza/Pravara/Forj/Tezca tabs |
| `search:read` | Global CRM search |
| `analytics:read` | Funnel + trend summaries |
| `aiKanban:write` | Stage-move suggestions (HITL — staff approves on `/pipeline`) |

**Not in v1:** `campaigns:write` (Tulana import only), mutations on leads/opps,
PII export without `piiMasking` flag (see WS6.5).

## Truth layer rules

1. **Production:** mock federation fallback is **disabled** — unavailable providers
   return `unavailable`, not synthetic Tablaco data.
2. **Demo tenants** (`demo-*`) may return seeded federation mocks — agents must
   not target demo hosts for pilot workflows.
3. **Unified profile** partial failures are expected; agents should summarize per-provider
   status from `federation-health` + tab payloads.

## Tool catalog

### `search_crm`

Find contacts, leads, or opportunities by free text.

- **tRPC:** `search.search` query, input `{ query: string, limit?: number }`
- **Scope:** `search:read`
- **Use when:** operator gives a name, email fragment, or company string.

### `get_contact`

Load a contact record and CRM-native fields.

- **tRPC:** `contacts.getById` query, input `{ id: uuid }`
- **Scope:** `contacts:read`
- **Returns:** contact row; use with `list_related` tools for pipeline context.

### `list_contact_leads` / `list_contact_opportunities`

- **tRPC:** `leads.listByContactId`, `opportunities.listByContactId`
- **Scopes:** `leads:read`, `opportunities:read`

### `get_lead` / `get_opportunity`

- **tRPC:** `leads.getById`, `opportunities.getById`
- **Scopes:** `leads:read`, `opportunities:read`

### `get_unified_profile`

Federated ecosystem view for a contact (billing, quotes, fabrication, assets, telemetry).

- **tRPC:** `unifiedProfile.getByContactId` query, input `{ contactId: uuid }`
- **Scope:** `unifiedProfile:read`
- **Agent guidance:** cite provider name + status; never invent data for `unavailable` tabs.

### `get_engagement_timeline`

Client engagement aggregate (Tablaco-style cross-platform projects).

- **tRPC:** `engagements.getTimeline` query, input `{ engagementId: uuid }`
- **Scope:** `engagements:read`
- **Related:** `engagements.getById`, `engagements.listArtifacts`

### `list_activities_for_entity`

Recent CRM activities on a contact, lead, or opportunity.

- **tRPC:** `activities.listForEntity` query
- **Scope:** `activities:read`

### `get_pipeline_analytics`

Weighted pipeline, at-risk deals, conversion trends (date-bounded).

- **tRPC:** `analytics.weightedPipelineValue`, `analytics.atRiskDeals`, `analytics.paymentAttributionSummary`, trend queries, `analytics.skuCampaignFunnel`
- **Scope:** `analytics:read`
- **Feature flag:** `analytics` must be enabled (default on).

### `federation_health`

Provider availability for truthful disclaimers in agent copy.

- **tRPC:** `federationHealth.checkAll` query
- **Scope:** implicit with unified profile reads; no extra scope today.

### `propose_pipeline_move`

Suggest moving a lead or opportunity to a different pipeline stage (human must approve).

- **tRPC:** `aiKanban.createSuggestion` mutation
- **Scope:** `aiKanban:write`
- **Feature flag:** `aiKanban` must be enabled (`FEATURE_AI_KANBAN=true`)
- **Input:** `{ entityType, entityId, suggestionType: "move_stage", title, rationale?, proposedStageId }`

## Example tRPC batch (curl)

```bash
curl -sS 'https://crm.madfam.io/api/trpc/search.search,contacts.getById?batch=1' \
  -H 'Authorization: Bearer '"$FEDERATION_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-raw '{"0":{"json":{"query":"tablaco","limit":5}},"1":{"json":{"id":"CONTACT_UUID"}}}'
```

Replace `CONTACT_UUID` with a real contact id from search results.

## Staging validation

1. Set `FEDERATION_API_TOKEN` on staging web + share with Selva staging only.
2. Run scripted read workflow against `https://staging-phynd.app` with `Host` header
   or staging CRM host when wired.
3. Confirm unified profile returns live or explicit `unavailable` — never silent mocks.

PP.5 webhook probes for engagement + Tulana paths:

```bash
SELVA_WEBHOOK_SECRET=... node scripts/pp5-webhook-probe.mjs send selva --engagement-id <id>
PHYND_CAMPAIGN_IMPORT_SECRET=... node scripts/pp5-webhook-probe.mjs send tulana-import
```

### WS6.7 integration script

```bash
# Planned steps only (no HTTP)
pnpm verify:selva-agent -- --dry-run

# Against local dev (seed + FEDERATION_API_TOKEN in .env)
FEDERATION_API_TOKEN=... CRM_BASE_URL=http://localhost:3000 pnpm verify:selva-agent

# Staging when wired
FEDERATION_API_TOKEN=... CRM_BASE_URL=https://staging-phynd.app pnpm verify:selva-agent -- --json
```

Validates search → contact → opportunities → unified profile → federation health,
and confirms `leads.create` is **FORBIDDEN** for the service token.

## Selva Panopticon iframe embed

Selva office (`https://selva.town`) can embed Phynd dashboard routes in an iframe when:

```bash
PHYND_SELVA_EMBED_ALLOWED=true
```

Middleware sets enforcing `Content-Security-Policy: frame-ancestors 'self' https://selva.town https://*.selva.town https://*.madfam.io` on dashboard paths only. Public routes (`/login`, `/`, `/portal/*`) keep `X-Frame-Options: DENY`.

Report-only CSP in `next.config.ts` includes the same `frame-ancestors` allowlist for observability before promotion.

**Staging:** enable in `infra/k8s/staging-secrets-template.yaml`. **Production:** leave unset/`false` until Panopticon pilot is signed off.

## Roadmap (WS6)

| ID | Item | Status |
| --- | --- | --- |
| WS6.1 | Scope expansion | Shipped |
| WS6.2 | Per-router scope enforcement | **Shipped** — `enforceServiceScopes` |
| WS6.3 | Distinct Janua service principal for Selva | **Shipped** — `service:selva` + `FEDERATION_SERVICE_USER_ID` + audit log |
| WS6.4 | This manifest | **Shipped** |
| WS6.5 | `piiMasking` before agent context | **Shipped** — enable `piiMasking` flag for Selva service auth |
| WS6.6 | `aiKanban` HITL suggestions | **Shipped** — `aiKanban.createSuggestion` + `/pipeline` review panel |
| WS6.7 | Selva office integration test | **Shipped** — `scripts/verify-selva-agent-integration.mjs` |

## Related docs

- [MADFAM truth layer remediation](./MADFAM_TRUTH_LAYER_REMEDIATION.md) — WS6
- [Tulana SKU campaign inputs](./TULANA_SKU_CAMPAIGN_INPUTS_2026-05-29.md) — WS4
- [ROADMAP](./ROADMAP.md) — Phase 5
