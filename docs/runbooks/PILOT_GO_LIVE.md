# Pilot go-live — `crm.madfam.io` + Selva agents

Date: 2026-05-28  
Audience: Enclii operators, Janua admins, MADFAM platform  
North star: truthful `madfam` tenant for `admin@madfam.io` and Selva sales agents.

> **Enclii-first:** provisioning, deploy, secrets, domains, and rollback via Enclii web/API/CLI.
> Raw `kubectl` / Vault steps below are break-glass references only.

## Pre-flight (code + repo)

From a clean `main` checkout:

```bash
pnpm verify:pilot-go-live
```

This bundles migration artifacts, PP.5 stability guards, auth URL checks, webhook probe
lanes, and the Selva agent integration script (dry-run without `FEDERATION_API_TOKEN`).

## Wave 1 — Deploy + database

| Step | Action | Verify |
| --- | --- | --- |
| 1 | Promote or confirm web + worker digests on target tier (staging first) | ArgoCD sync healthy; `/api/health` → `{ status: "ok" }` |
| 2 | Run migrations through **`0010_lyrical_shooting_star`** | `pnpm verify:migrations` |
| 3 | Apply secrets from template (never commit values) | Staging: `node scripts/pp5-validate-staging-env.mjs <env-file>` |

Tenant DB strategy: [`TENANT_DATABASE_STRATEGY.md`](../TENANT_DATABASE_STRATEGY.md)

Required migrations for pilot features:

- `0008_orange_sandman` — SKU catalog
- `0009_lazy_wrecker` — campaign imports + buyer signals
- `0010_lyrical_shooting_star` — AI Kanban HITL suggestions

## Wave 2 — Staging secrets (PP.5 split)

Generate a draft env file (randomizes webhook secrets; operator fills URLs/OAuth):

```bash
node scripts/pp5-generate-staging-env.mjs --output /secure/phynd-crm-staging.env
```

**Must be distinct from production** (validator enforces):

| Key | Purpose |
| --- | --- |
| `PHYND_DEPLOYMENT_TIER` | `staging` — blocks outbound calls to prod MADFAM hosts |
| `SELVA_WEBHOOK_SECRET` | `POST /api/webhooks/selva` |
| `PHYND_CAMPAIGN_IMPORT_SECRET` | Tulana import/send/buyer-signals APIs |
| `PHYND_ENGAGEMENT_EVENTS_SECRET` | Engagement events + artifacts |
| `FEDERATION_API_TOKEN` | Selva service tRPC reads (≥48 chars) |
| `FEDERATION_SERVICE_USER_ID` | `service:selva` (machine principal) |
| `EMAIL_ALLOWLIST_DOMAINS` | `@madfam.io,@staging.madfam.io` — drip hardening |

Template: [`infra/k8s/staging-secrets-template.yaml`](../../infra/k8s/staging-secrets-template.yaml)

## Wave 3 — Provider webhook registration

Each provider registers a **second** staging destination (never repoint prod URLs wholesale).

| Provider | Staging inbound URL | Secret env |
| --- | --- | --- |
| Selva | `https://staging-phynd.app/api/webhooks/selva` | `SELVA_WEBHOOK_SECRET` |
| Tulana | `https://staging-phynd.app/api/v1/campaigns/import` | `PHYND_CAMPAIGN_IMPORT_SECRET` |
| Fortuna | `https://staging-phynd.app/api/webhooks/fortuna` | `FORTUNA_WEBHOOK_SECRET` |
| Janua Telemetry | `https://staging-phynd.app/api/webhooks/janua-telemetry` | `JANUA_TELEMETRY_WEBHOOK_SECRET` |
| RouteCraft | `https://staging-phynd.app/api/webhooks/routecraft` | `PHYND_CRM_EVENTS_SECRET` |

Probe lanes (HMAC dry-run or live):

```bash
node scripts/pp5-webhook-probe.mjs list
SELVA_WEBHOOK_SECRET=... node scripts/pp5-webhook-probe.mjs send selva --engagement-id <id>
PHYND_CAMPAIGN_IMPORT_SECRET=... node scripts/pp5-webhook-probe.mjs send tulana-import
```

Full matrix: [`PP_5_STAGING_AUDIT.md`](../PP_5_STAGING_AUDIT.md) § PhyndCRM-specific staging constraints.

## Wave 4 — Human staff access (Phase 0)

| Step | Owner | Action |
| --- | --- | --- |
| 1 | Janua | OIDC client redirect URIs for `crm.madfam.io`, `phynd.app` |
| 2 | Janua | `admin@madfam.io` has admin role/claims accepted by Phynd |
| 3 | Enclii | Junctions match `.enclii.yml` declared domains |
| 4 | Operator | `pnpm verify:prod-auth` — no internal pod hosts in provider URLs |

Manual: `admin@madfam.io` → `https://crm.madfam.io/overview` (no `CallbackRouteError`).

## Wave 5 — Selva agent access (Phase 5)

| Step | Action |
| --- | --- |
| 1 | Set `FEDERATION_API_TOKEN` on web (share with Selva staging only) |
| 2 | Register Janua machine principal `service:selva` (not human SSO token) |
| 3 | Optional flags: `FEATURE_AI_KANBAN=true`, `FEATURE_PII_MASKING=true` for agent workflows |
| 4 | Run integration script against live CRM |

```bash
FEDERATION_API_TOKEN=... CRM_BASE_URL=https://staging-phynd.app pnpm verify:selva-agent
FEDERATION_API_TOKEN=... CRM_BASE_URL=https://crm.madfam.io pnpm verify:selva-agent -- --json
```

Tool manifest: [`SELVA_CRM_AGENT_TOOLS.md`](../SELVA_CRM_AGENT_TOOLS.md)

## Wave 6 — Production promotion

Phynd CRM uses **manual promotion** (30m soak + staging smoke):

1. Confirm staging smoke passed in `promote-to-prod.yml` prerequisites.
2. Run `.github/workflows/promote-to-prod.yml` via GitHub Actions.
3. Run `pnpm db:migrate` against production database.
4. Re-run `pnpm verify:prod-auth` and spot-check Tablaco contact federation tabs (live or explicit `unavailable` — never silent mocks in prod).

Emergency rollback: `.github/workflows/rollback-prod.yml`

## Feature flag rollout (post-migrate)

| Flag | Env | When to enable |
| --- | --- | --- |
| `FEATURE_TREASURY_HUNTER` | `true` | Fortuna + Karafiel staging split verified |
| `FEATURE_OBSERVABILITY` | `true` | OTel collector + Sentry DSN ready (worker first) |
| `FEATURE_AI_KANBAN` | `true` | Selva HITL pilot on `/pipeline` |
| `FEATURE_PII_MASKING` | `true` | Selva agent context export |

## Exit criteria

- [ ] `admin@madfam.io` SSO on `crm.madfam.io` without callback error
- [ ] Migrations `0008`–`0010` applied on target DB
- [ ] Staging webhook probes return 2xx for Selva + Tulana lanes
- [ ] `pnpm verify:selva-agent` passes against staging (then prod)
- [ ] Unified profile shows live data or explicit `unavailable` per provider (no prod mocks)
- [ ] `PHYND_DEPLOYMENT_TIER=staging` on staging; outbound guard blocks prod Karafiel/Cotiza URLs

## Related

- [`MADFAM_TRUTH_LAYER_REMEDIATION.md`](../MADFAM_TRUTH_LAYER_REMEDIATION.md)
- [`ROADMAP.md`](../ROADMAP.md)
- [`TABLACO_ENGAGEMENT.md`](./TABLACO_ENGAGEMENT.md)
