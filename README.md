# Phynd CRM

A phygital CRM platform -- "Synthetic Single Pane of Glass" -- that federates real-time data from six MADFAM ecosystem platforms without duplicating it. Open-source core with a commercial SaaS tier.

Current codebase and production observations are tracked in
[`docs/CODEBASE_AND_PROD_EVIDENCE_2026-05-27.md`](docs/CODEBASE_AND_PROD_EVIDENCE_2026-05-27.md).

**Roadmap and remediation:** canonical sequencing lives in
[`docs/ROADMAP.md`](docs/ROADMAP.md) and the executable plan in
[`docs/MADFAM_TRUTH_LAYER_REMEDIATION.md`](docs/MADFAM_TRUTH_LAYER_REMEDIATION.md).

## Overview

Phynd owns CRM-native entities (contacts, leads, opportunities, pipelines) and virtualizes identity, billing, custom orders, fabrication status, and 3D asset data from external systems. Rather than copying data through ETL pipelines, Phynd queries each upstream platform on demand through a federation layer that handles caching, circuit breaking, retry logic, and partial failure tolerance.

## Role in the MADFAM monetization engine

Phynd CRM is the **consent and attribution** end of MADFAM's commercial pipeline. Other platforms in the ecosystem
discover demand, price it, take payment, and grant access. Phynd owns the two questions that bracket all of that:
*are we permitted to contact this person at all?* and *which outreach produced this paying customer?*

- **Consent** — system of record for marketing consent under Mexico's LFPDPPP, scoped per identifier and channel,
  with an audit trail on every transition.
- **Double opt-in** — a captured address is not a contactable address until the holder confirms it.
- **Suppression** — a cross-product suppression list that outranks any consent record. Suppression always wins.
- **One-click unsubscribe** — RFC-8058 unsubscribe support on outbound email.
- **Authorization** — outbound campaigns pass an explicit authorization step before any send.
- **Attribution** — a completed purchase is recorded back against the outreach and consent basis it came from,
  which is what makes acquisition measurable for the rest of the ecosystem.

Commercially this makes Phynd both a brake and a meter: it is the component entitled to say *no* to a send, and the
place where revenue is tied back to the outreach that caused it.

API-level detail for the consent and suppression surfaces lives in [`docs/CONSENT_API.md`](docs/CONSENT_API.md).

> **Boundary note.** This is a deliberately sanitized summary of the repository's *designed* role. It is not a
> statement about the live state of any deployment. The canonical end-to-end description of the monetization
> pipeline is private and lives in the `internal-devops` repository at `docs/monetization-engine.md`. Deployment
> topology, credential names, environment configuration, and incident detail are not reproduced here and should
> not be added to this repository.

_Last Updated: 2026-07-26_

## Architecture

```
                         +------------------+
                         |   apps/web       |
                         |  (Next.js 15)    |
                         +--------+---------+
                                  |
                          tRPC / API Routes
                                  |
                     +------------+------------+
                     |  packages/services      |
                     |  (business logic)       |
                     +------------+------------+
                                  |
              +-------------------+-------------------+
              |                                       |
   +----------+----------+             +--------------+--------------+
   |   packages/db       |             |   packages/federation       |
   |   (Drizzle + PG)    |             |   (data virtualization)     |
   +---------------------+             +--+-----+------+-------+--+-+
                                          |     |      |       |  |
                                       Janua  Janua   Dhanam Cotiza Pravara Forj
                                              Telemetry
```

All federation calls use `Promise.allSettled()` so that a failure in one provider does not block the rest of the page. The service layer is transport-agnostic: tRPC is the main application transport, and GraphQL Yoga at `/api/graphql` shares the same `FEDERATION_API_TOKEN` service-auth path for Selva agents.

## Tech Stack

| Layer          | Technology                                     |
| -------------- | ---------------------------------------------- |
| Monorepo       | Turborepo + pnpm workspaces                    |
| Frontend       | Next.js 15 (App Router), React 19, Tailwind 4  |
| UI Components  | shadcn/ui                                       |
| API            | tRPC v11, GraphQL Yoga endpoint                |
| ORM            | Drizzle ORM                                     |
| Database       | PostgreSQL 16                                   |
| Cache / Queue  | Redis 7 (ioredis) + BullMQ                     |
| Auth           | Auth.js v5 with Janua as OIDC provider; the session user id is the Janua `sub` ([`docs/IDENTITY.md`](docs/IDENTITY.md)) |
| Lint / Format  | Biome                                           |
| Testing        | Vitest (unit), Playwright (E2E)                 |
| Language       | TypeScript 5.7                                  |

## Project Structure

```
phynd-crm/
  apps/
    web/              Next.js frontend and API routes
    worker/           BullMQ background job processors
  packages/
    api/              tRPC routers
    config/           Zod env validation and feature flags
    db/               Drizzle schema and migrations
    federation/       Data virtualization layer (providers, cache, retry, circuit breaker)
    logging/          Structured logging (pino)
    services/         Transport-agnostic business logic
    types/            Shared TypeScript types
    ui/               Shared UI primitives
  tooling/            Shared tsconfig and Biome config
  docker/             Docker Compose for local Postgres and Redis
```

## Getting Started

### Prerequisites

- Node.js >= 22
- pnpm >= 9
- Docker (for PostgreSQL and Redis)

### Setup

```bash
git clone https://github.com/madfam-org/phynd-crm.git
cd phynd-crm
pnpm install

# Start infrastructure
docker compose -f docker/docker-compose.yml up -d

# Configure environment
cp .env.example .env
# Edit .env with your Janua OIDC credentials and any other values

# Database setup
pnpm db:generate
pnpm db:migrate
pnpm db:seed

# Start development
pnpm dev
```

The app will be available at `http://localhost:3000`.

### Development Commands

| Command            | Description                                 |
| ------------------ | ------------------------------------------- |
| `pnpm dev`         | Start all apps in development mode          |
| `pnpm build`       | Build all packages                          |
| `pnpm typecheck`   | Run TypeScript checks across the monorepo   |
| `pnpm lint`        | Run Biome linter                            |
| `pnpm format`      | Run Biome formatter                         |
| `pnpm test`        | Run Vitest unit tests                       |
| `pnpm test:e2e`    | Run Playwright end-to-end tests             |
| `pnpm db:generate` | Generate Drizzle migrations                 |
| `pnpm db:migrate`  | Apply database migrations                   |
| `pnpm db:seed`     | Seed the database with sample data          |
| `pnpm db:studio`   | Open Drizzle Studio for database inspection |
| `pnpm clean`       | Remove build artifacts                      |
| `pnpm verify:prod-auth` | Verify production OIDC URLs (no pod leaks; callback host matches base) |
| `pnpm verify:post-deploy` | Live deploy smoke: `/api/health` with retries (`--retries`, `--retry-delay-ms`); optional `--with-prod-auth`, `--with-selva-agent` |
| `pnpm verify:migrations` | Verify migration artifacts through `0010` |
| `pnpm db:migrate:tier` | Apply tier migrations when `DATABASE_URL` is set (`--check-only` for artifacts only) |
| `pnpm verify:pilot-readiness` | Bundle: prod auth + migrations + PP5 webhook lanes + Selva probe |
| `pnpm verify:pilot-go-live` | Full pre-flight before staging/prod pilot (see `docs/runbooks/PILOT_GO_LIVE.md`) |
| `pnpm pp5:pilot-ops` | Operator checklist: automated gates + manual Enclii steps (`--live` with `CRM_BASE_URL`) |
| `pnpm verify:janua-oidc` | Janua OIDC redirect URI checklist for Phase 0 Janua admin |
| `pnpm verify:selva-agent` | Selva service-token integration smoke test |

## Identity and access

The full model is in [`docs/IDENTITY.md`](docs/IDENTITY.md). In short:

- **The acting user id is the Janua `sub`.** Staff sign in through Auth.js v5
  with Janua as the OIDC provider (JWT sessions, no adapter). The `jwt`
  callback sets `session.user.id` to the Janua OIDC `sub` at sign-in and refuses
  a sign-in whose `sub` is missing or differs from `account.providerAccountId`.
  Auth.js's own `token.sub` is a fresh random UUID at every sign-in and is never
  used as an id. Sessions minted before 2026-09-30 carry no `januaSub` and are
  dropped once, so the user signs in again.
- **CRM users are linked, never auto-created.** A CRM `users` row has its own id
  (`users.id`) and links to a Janua subject through the unique column
  `users.external_janua_id`. Each request resolves the subject to the linked
  `users.id` once (`crmUserId`, cached 30 s per tenant and subject).
- **Admins link and unlink.** Settings → Users shows each user's link state with
  **Link Janua identity** / **Unlink Janua identity**. The admin-only tRPC
  procedures are `users.linkJanua({ id, januaSub })` and
  `users.unlinkJanua({ id })`; `users.create` also accepts `externalJanuaId`.
  Conflicts (user already linked, subject taken) return `CONFLICT`, reserved
  principal ids are refused, and every change writes an audit log line.
  `users.me` returns `{ januaSub, crmUserId, linked }` to any signed-in user.
- **Unlinked users get a typed 412.** Owner foreign-key writes and per-user reads
  (`listMine`, notifications, `activities.create`, `contacts.bulkCreate`) need a
  linked CRM user. For an unlinked Janua identity they fail with tRPC
  `PRECONDITION_FAILED` (HTTP 412) and `data.appCode = 'CRM_USER_NOT_LINKED'`;
  the web client shows the Spanish «no vinculada» message once and does not
  retry. Shared reads (lists, detail pages, search, analytics) keep working.
- Service, system, demo and dev principals (`service:selva`, `system`,
  `service:email-drip`, `demo-{sessionId}`, `dev-user`) keep their fixed ids.

### Operator scripts (dry-run first)

Both scripts are owner-run, print counts and short ids only, and resolve the
`postgres` driver from the repo root or from the worker image. Run them locally
against a port-forward, or piped into the worker pod under the break-glass rules
in [`AGENTS.md`](AGENTS.md). Pass `--database-env DATABASE_URL_<TENANT>` for a
per-tenant database and `--json` for machine-readable output.

| Script | What it does | Writes? |
| --- | --- | --- |
| `scripts/audit-session-user-ids.mjs` | Per actor column, counts values that match no known Janua subject, CRM user, service principal or demo id (the per-login random ids written before 2026-09-30), with distinct counts and date ranges | Never: one `BEGIN READ ONLY` transaction, rolled back |
| `scripts/link-janua-users.mjs` | Lists CRM users with no `external_janua_id`; validates a `{ "<users.id>": "<janua sub>" }` mapping | Only with `--apply`, all-or-nothing |

```bash
# 1. Read-only damage assessment
DATABASE_URL=postgresql://... node scripts/audit-session-user-ids.mjs

# 2. Dry-run: list unlinked users, then validate a mapping (no writes)
DATABASE_URL=postgresql://... node scripts/link-janua-users.mjs
DATABASE_URL=postgresql://... node scripts/link-janua-users.mjs --links links.json

# 3. Apply only after the dry-run reports every link as valid
DATABASE_URL=postgresql://... node scripts/link-janua-users.mjs --links links.json --apply

# In-cluster variant (piped from a checkout; read the dry-run before any --apply)
kubectl -n phynd-crm exec -i deploy/phynd-crm-worker -- \
  node --input-type=module - --links-json '{"<users.id>":"<janua sub>"}' \
  < scripts/link-janua-users.mjs
```

`link-janua-users.mjs` exits `3` when `--apply` was refused because a link was
invalid (nothing is written), `2` when the database URL is missing, and `1` on
any other error. Interpreting the audit output and the repair options (an owner
decision; no data fix ships with the code) are covered in
[`docs/IDENTITY.md`](docs/IDENTITY.md#damage-assessment-for-the-per-login-ids).

## Federation Layer

Phynd uses a data virtualization pattern rather than ETL. Each external platform is represented by a class that implements the `FederationProvider` interface, exposing a uniform API for querying upstream data.

### Cache Strategy

- Redis-backed with tenant-namespaced keys: `phynd:{tenantId}:fed:{provider}:{id}`
- Per-provider TTLs tuned to each platform's data volatility
- Webhook-driven cache invalidation for real-time consistency

### Circuit Breaker

The federation layer wraps each provider with a circuit breaker to prevent cascading failures:

| State     | Behavior                                                  |
| --------- | --------------------------------------------------------- |
| CLOSED    | Normal operation; requests pass through to the provider   |
| OPEN      | Triggered after 5 failures in 60 seconds; all calls fail fast |
| HALF_OPEN | After 30 seconds, allows probe requests through           |
| CLOSED    | Restored after 3 consecutive successes in HALF_OPEN state |

### Retry Policy

Failed requests are retried with exponential backoff and jitter to avoid thundering-herd effects.

### Partial Failure Tolerance

All SPOG (Single Pane of Glass) queries use `Promise.allSettled()`. If one provider is down or slow, the remaining providers still return data and the UI renders a partial view with a degradation indicator.

## External Systems

Phynd federates data from six active platforms in the MADFAM ecosystem:

| Platform             | Role                          | Status              | Integration              |
| -------------------- | ----------------------------- | ------------------- | ------------------------ |
| **Janua**            | Identity and access (OIDC)    | Active              | OIDC provider, REST API, webhook cache invalidation |
| **Janua Telemetry**  | Visitor sessions / page views | Active              | REST API (TTL=60s), UTM tracking |
| **Dhanam**           | Billing and monetization      | Active              | REST SDK with idempotency keys |
| **Cotiza Studio**    | Custom orders / quotes        | Active              | REST + WebSocket for real-time updates |
| **PravaraMES**       | Fabrication order status      | Active              | REST (+ WebSocket future) |
| **Forj**             | 3D digital assets / storefront | Active              | REST API, 3D asset interactions |

## Current Implementation Status

The original PRD is still useful as strategy, but the codebase has moved beyond
the first MVP slice. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for phased targets
and [`docs/MADFAM_TRUTH_LAYER_REMEDIATION.md`](docs/MADFAM_TRUTH_LAYER_REMEDIATION.md)
for the full gap-closure plan (MADFAM tenant truth layer, SKU loop, Selva
copilot).

**Snapshot (2026-07-09, two-axis):** capability built (code) **~80–85%**;
truthful-in-prod / pilot-ready **~30–55%** by dimension. The earlier single
figures ("~25–35%" here, "~55–62%" in the roadmap) measured *different axes* and
read as a contradiction — prefer the two-axis view. The remaining distance is
dominated by ops execution and prod verification, not missing code. Evidence:
[`docs/CODEBASE_AND_PROD_EVIDENCE_2026-07-09.md`](docs/CODEBASE_AND_PROD_EVIDENCE_2026-07-09.md).

Evidence from `packages/config/src/features.ts`, `packages/api/src/router.ts`,
and the route inventory:

- 25 tRPC routers are exposed, including engagements and referrals.
- `/api/graphql` is implemented with GraphQL Yoga.
- Six federation providers are present and covered by contract tests: Janua,
  Janua Telemetry, Dhanam, Cotiza, Pravara, and Forj.
- Feature flags now total 14. Enabled by default: `bidirectionalSync`,
  `leadScoring`, `multiTenancy`, `forjEnabled`, `visitorTracking`,
  `funnelManagement`, `analytics`, and `referralManagement`.
- Tenant resolution accepts an explicit tenant ID, then `auth.tenantId`, then
  `DEFAULT_TENANT_ID`, which defaults to `madfam`. Host-derived tenant wiring
  for `crm.madfam.io` is planned in Phase 1 of the roadmap.

## Testing

Run unit tests across the monorepo:

```bash
pnpm test
```

Run Playwright end-to-end tests (requires the dev server and infrastructure to be running):

```bash
pnpm test:e2e
```

Run the operator-script regression tests (`node:test`, no database needed;
run `pnpm install` first, because the `postgres` resolution tests load the
driver from the repo root). CI runs them in the **Unit Tests** job:

```bash
pnpm test:pp5   # node --test scripts/__tests__/*.test.mjs
```

Identity coverage lives in
`apps/web/src/lib/auth/__tests__/janua-sign-in.test.ts` (full Auth.js sign-in
against a stub Janua issuer), `apps/web/src/lib/trpc/__tests__/`
(`crm-user-resolution`, `errors`), `packages/api/src/__tests__/crm-user-link.router.test.ts`,
`packages/services/src/__tests__/identity.test.ts` and `users.service.test.ts`,
and `scripts/__tests__/` (`audit-session-user-ids`, `link-janua-users`,
`resolve-postgres`).

Skipped E2E cases are deliberate: the redirect checks skip when
`AUTH_BYPASS=true`, the dashboard fixtures skip without it, and
`pipeline.test.ts` › "shows fallback when no default pipeline is configured"
always skips because the seeded E2E database always has a default pipeline.

## Environment Variables

Copy `.env.example` to `.env` and fill in the required values. The key groups are:

| Group                  | Variables                                            |
| ---------------------- | ---------------------------------------------------- |
| Database               | `DATABASE_URL`                                       |
| Redis                  | `REDIS_URL`                                          |
| Auth (Janua OIDC)      | `AUTH_SECRET`, `AUTH_JANUA_ISSUER`, `AUTH_JANUA_CLIENT_ID`, `AUTH_JANUA_CLIENT_SECRET`, `AUTH_BYPASS`, `AUTH_TRUST_HOST` |
| App / tenant           | `NEXT_PUBLIC_APP_URL`, `NEXTAUTH_URL`, `PORTAL_BASE_URL`, `NODE_ENV`, `DEFAULT_TENANT_ID` |
| Federation URLs        | `JANUA_API_URL`, `JANUA_TELEMETRY_API_URL`, `DHANAM_API_URL`, `COTIZA_API_URL`, `PRAVARA_BASE_URL`, `SELVA_API_URL`, `FORJ_API_URL` |
| Federation API Keys    | `PRAVARA_API_KEY`, `SELVA_API_KEY`, `FEDERATION_API_TOKEN` |
| Production dispatch    | `PRAVARA_DISPATCH_URL`, `SELVA_DISPATCH_URL`, `PRAVARA_DISPATCH_SECRET`, `SELVA_DISPATCH_SECRET`, `PRODUCTION_DISPATCH_SCAN_LIMIT`, `PRODUCTION_DISPATCH_TIMEOUT_MS` |
| Webhook secrets        | `JANUA_WEBHOOK_SECRET`, `JANUA_TELEMETRY_WEBHOOK_SECRET`, `DHANAM_WEBHOOK_SECRET`, `COTIZA_WEBHOOK_SECRET`, `PRAVARA_WEBHOOK_SECRET`, `FORJ_WEBHOOK_SECRET`, `TEZCA_WEBHOOK_SECRET`, `FORTUNA_WEBHOOK_SECRET`, `CEQ_WEBHOOK_SECRET`, `COFORMA_WEBHOOK_SECRET`, `PHYND_CRM_EVENTS_SECRET`, `PHYND_ENGAGEMENT_EVENTS_SECRET` |
| Payments / engagement  | `PHYNDCRM_OUTBOUND_SECRET`, `COTIZA_WEBHOOK_TIMEOUT`, `KARAFIEL_API_URL`, `KARAFIEL_API_KEY`, `KARAFIEL_WEBHOOK_SECRET` |
| Email / campaigns      | `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_ALLOWLIST_DOMAINS`, `UNSUBSCRIBE_SECRET`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `INTERNAL_TEZCA_KEY`, `TEZCA_API_URL`, `TEZCA_PUBLIC_URL`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_REFRESH_TOKEN`, `REDDIT_USERNAME`, `REDDIT_PASSWORD`, `REDDIT_USER_AGENT`, `REDDIT_TARGET_SUBREDDITS` |
| Observability          | `LOG_LEVEL`, `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `WORKER_HEALTH_PORT` |

Core runtime variables are validated with Zod in `packages/config`; additional
worker, webhook, and campaign variables are read directly by their owning
modules and listed in `.env.example`.

## Fortuna AI Pipeline Integration

Phynd CRM is the campaign orchestration layer for the autonomous legal scouting pipeline:

```
fortuna-jobs  ──► madfam-crawler  ──► fortuna-nlp
                                           │ (confidence ≥ 0.85)
                                    POST /api/campaigns/trigger
                                           │
                                     RedditBotService
                                           ├── Tezca oracle query
                                           ├── LLM draft via OpenAI-compatible endpoint
                                           └── Campaign saved as status="draft"
                                           │
                                  /campaigns/drafts  (review UI)
                                           │
                               [Approve] → postRedditComment()
                                           │
                                  u/madfam-bot posts reply ✓
```

For Tulana-driven SKU launch campaigns, use
`docs/TULANA_SKU_CAMPAIGN_INPUTS_2026-05-29.md`. That contract keeps SKU
readiness in Tulana, orchestration in Selva, and campaign/contact state in
Phynd CRM.

### Key Files

| File | Purpose |
|---|---|
| `apps/web/src/app/api/campaigns/trigger/route.ts` | Inbound webhook — receives high-confidence signals from Fortuna |
| `packages/services/src/campaigns/reddit-bot.ts` | Orchestrates Tezca query + OpenAI draft + CRM staging |
| `packages/services/src/campaigns/reddit-poster.ts` | Reddit OAuth2 client — posts approved replies as `u/madfam-bot` |
| `apps/web/src/app/(dashboard)/campaigns/drafts/page.tsx` | Human-in-the-loop review UI |
| `apps/web/src/app/api/campaigns/drafts/action/route.ts` | Approve/Reject handler that triggers Reddit posting |

### Reddit Bot Setup

See the [walkthrough artifact](https://github.com/madfam-org/phynd-crm) for the one-time Reddit OAuth refresh token setup required to activate live posting.

## License

This project is licensed under the GNU Affero General Public License v3.0
(AGPL-3.0-only), per the MADFAM public-repo licensing policy (RFC 0024 P1.4).
See [LICENSE](./LICENSE) for the full text.

Copyright (c) 2026 Innovaciones MADFAM SAS de C.V.

Note: the marketing UI still contains legacy "MIT Licensed" copy that should be
updated to reflect the AGPL-3.0 core.


## Avala webhook receiver

PhyndCRM receives Avala visitor, lead, user, tenant, subscription, and payment lifecycle events at `POST /api/webhooks/avala`.

The receiver:

- verifies `x-madfam-signature` with `PHYND_CRM_EVENTS_SECRET`;
- rate-limits inbound requests;
- deduplicates by Avala `event_id` in `webhook_events`;
- maps `avala.lead.captured` into contacts, leads, visitor sessions, and `visitor_to_lead` conversions;
- maps Avala search/page/conversion/user/tenant/billing events into CRM activity and conversion records.

Avala producers must send the shared event envelope documented in Avala's `docs/architecture/PHYNDCRM_AVALA_INTEGRATION.md`.

## Production domain truth

The only valid production domains for PhyndCRM are `https://phynd.app` for the product surface and `https://crm.madfam.io` for the MADFAM tenant slice. Any local, demo, staging, or preview URL in this repository is non-production and must not be used in campaign traffic.

Public repo sanitization and campaign-readiness requirements are tracked in `docs/PUBLIC_DOMAIN_AND_REPO_SANITIZATION_2026-06-01.md`.

## Related repositories / contracts

| Contract | Defined in | Phynd side |
| --- | --- | --- |
| Janua OIDC sign-in and token validation (issuer, JWKS, `kid`, audience) | [janua `docs/guides/ECOSYSTEM_INTEGRATION.md`](https://github.com/madfam-org/janua/blob/main/docs/guides/ECOSYSTEM_INTEGRATION.md) | `apps/web/src/lib/auth/config.ts`; [`docs/IDENTITY.md`](docs/IDENTITY.md) |
| Janua `sub` as the stable user id, linked to CRM users | this repo | [`docs/IDENTITY.md`](docs/IDENTITY.md) |
| Selva service-token read tools | this repo | [`docs/SELVA_CRM_AGENT_TOOLS.md`](docs/SELVA_CRM_AGENT_TOOLS.md) |
| Marketing consent API | this repo | [`docs/CONSENT_API.md`](docs/CONSENT_API.md) |
| Avala lifecycle events → `POST /api/webhooks/avala` | Avala's `docs/architecture/PHYNDCRM_AVALA_INTEGRATION.md` (shared event envelope) | [§ Avala webhook receiver](#avala-webhook-receiver) |
| dev → staging → prod promotion | [internal-devops RFC 0001](https://github.com/madfam-org/internal-devops/blob/main/rfcs/0001-dev-staging-prod-pipeline.md) | [`AGENTS.md`](AGENTS.md) § Deployment Pipeline |
