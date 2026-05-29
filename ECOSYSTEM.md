# phynd-crm — Ecosystem Context

> [!IMPORTANT]
> MADFAM-ENCLII-FIRST-LEGACY-RAW v1: This document contains legacy raw infrastructure command examples.
> Routine production operations must use Enclii web, API, or CLI. Treat raw
> `kubectl`, `helm`, SSH, provider CLI/API, `docker exec`, and direct container
> access as platform bootstrap or documented break-glass only, and record any
> missing Enclii adapter gap.


> **Federated "single pane of glass" CRM — virtualizes data from 6 MADFAM platforms without ETL.**

Latest repository and production evidence is recorded in
[`docs/CODEBASE_AND_PROD_EVIDENCE_2026-05-27.md`](docs/CODEBASE_AND_PROD_EVIDENCE_2026-05-27.md).

**Roadmap:** [`docs/ROADMAP.md`](docs/ROADMAP.md) · **Remediation plan:**
[`docs/MADFAM_TRUTH_LAYER_REMEDIATION.md`](docs/MADFAM_TRUTH_LAYER_REMEDIATION.md)

This file is self-contained: a Claude session on a fresh machine can operate
this service by reading only this one document. No external links are
load-bearing — the MADFAM ecosystem map and the full enclii CLI reference are
embedded below.

---

## 1. What this repo is

Phynd is the client-facing deliverables portal: per-client (possibly branded) dashboards showing a complete history with MADFAM — quotes, signed proposals, active projects, deliverables, invoices. Owns CRM-native entities (contacts, leads, opportunities, pipelines) and *virtualizes* everything else (identity from Janua, billing from Dhanam, custom orders from Cotiza, fab status from Pravara, 3D assets) through a federation layer with caching, circuit breaking, and partial-failure tolerance. **Project execution tracking lives here**, not in the upstream platforms.

**Pillar**: Financial / CRM (client portal)
**Type**: service
**Status**: production

### Deployed services

| Service | Public domain | Container port |
|---|---|---|
| `phynd-crm-web` | `phynd.app`, `www.phynd.app`, `crm.madfam.io`; generic app host currently responds at `crm.phynd.app` | 3000 |
| `phynd-crm-worker` | background jobs and health endpoint | 3001 |

**Kubernetes namespace**: `phynd-crm`
**Cluster**: bare-metal k3s on Hetzner (see topology section below).

### Upstream dependencies (this repo consumes)

- janua (identity federation)
- dhanam (billing federation)
- digifab-quoting / cotiza (quote + order federation)
- karafiel (contract document federation)
- pravara-mes (fab job status federation)
- autoswarm-office / selva (digital-project execution updates)
- postgres (CRM-native entities)

### Downstream consumers (this repo is consumed by)

- external clients (single pane of glass, per-client portal)
- MADFAM account managers / ops team

### Key environment variables

- `DATABASE_URL` — Postgres
- `REDIS_URL` — Redis/BullMQ/rate limiting
- `AUTH_JANUA_ISSUER`, `AUTH_JANUA_CLIENT_ID`, `AUTH_JANUA_CLIENT_SECRET` — Janua OIDC
- `JANUA_API_URL`, `JANUA_TELEMETRY_API_URL`, `DHANAM_API_URL`, `COTIZA_API_URL`, `PRAVARA_BASE_URL`, `SELVA_API_URL`, `FORJ_API_URL` — upstream federation/dispatch APIs
- `*_WEBHOOK_SECRET`, `PHYND_CRM_EVENTS_SECRET`, `PHYND_ENGAGEMENT_EVENTS_SECRET` — signed inbound ecosystem events
- `FEDERATION_API_TOKEN` — optional service-to-service tRPC read token
- `WORKER_HEALTH_PORT` — worker health endpoint, default `3001`

---

## MADFAM Ecosystem Map

MADFAM runs ~40 services on sovereign bare-metal infrastructure. Everything
below is embedded here so this document stands alone.

### The platforms every repo should know about

| Platform | Repo | Role |
|---|---|---|
| **Enclii** | `madfam-org/enclii` | PaaS control plane — all deploys go through this |
| **Janua** | `madfam-org/janua` | OIDC/OAuth 2.0 provider — RS256 JWKS at `auth.madfam.io/.well-known/jwks.json` |
| **Dhanam** | `madfam-org/dhanam` | Billing + payment gateways (Stripe, Mercado Pago, SPEI, etc.) |
| **Selva** | `madfam-org/autoswarm-office` | LLM inference routing + agent orchestration |
| **Karafiel** | `madfam-org/karafiel` | Operational compliance — CFDI, NOM-151, e.firma, SAT-adjacent. Owns legal-ops / contract templates |
| **Tezca** | `madfam-org/tezca` | Mexican law oracle (informational only — feeds Karafiel) |
| **Cotiza** | `madfam-org/digifab-quoting` | MADFAM's quoting engine (fabrication + services) |
| **Forgesight** | `madfam-org/forgesight` | Digital fabrication industry intelligence (pricing/vendor feed to Cotiza) |
| **Pravara MES** | `madfam-org/pravara-mes` | Fabrication-node routing and dispatch (physical jobs) |
| **PhyndCRM** | `madfam-org/phynd-crm` | Client-facing deliverables portal (single pane of glass per engagement) |
| **Fortuna** | `madfam-org/fortuna` | Problem intelligence / zeitgeist analysis |
| **Avala** | `madfam-org/avala` | Learning verification platform |

### Cross-repo conventions

- **Auth**: every authenticated service verifies Janua JWTs via JWKS at
  `https://auth.madfam.io/.well-known/jwks.json`. RS256 only — HS256 is
  fail-closed after the 2026-04-23 audit (H3/H4).
- **Billing**: credit metering + entitlements flow through Dhanam. See
  `madfam-org/dhanam` for the meter/entitlement/invoice APIs.
- **Inference**: every LLM call should route through Selva
  (`autoswarm-office`) at `/v1` (OpenAI-compatible). Do not talk directly
  to OpenAI / Anthropic from service code.
- **CORS**: explicit allowlist per service. Wildcards are banned
  (audit 2026-04-23 H2/H5/H6).
- **Images**: `@sha256:`-pinned in every manifest. Kyverno fail-closes on
  `:latest` or mutable tags.
- **Onboarding**: `POST /v1/admin/onboard` on switchyard-api creates
  namespace, ArgoCD app, Cloudflare tunnel routes, Janua client, and
  NetworkPolicies in one shot. See `enclii/docs/guides/ONBOARDING_GUIDE.md`.

### Production topology

Bare-metal k3s (v1.33+) on Hetzner, 3 nodes:

- `foundry-cp` (Hetzner EX44, 14C/20T, 128 GB) — control-plane + primary workload
- `foundry-worker-01` (Hetzner AX41-NVMe, Ryzen 5 3600, 64 GB) — worker + Longhorn 2nd replica
- `foundry-builder-01` (Hetzner VPS, 2 vCPU, 4 GB, tainted `builder=true:NoSchedule`) — ARC runners only

**Ingress**: Cloudflare Tunnel → 2× cloudflared pods → K8s ClusterIP → container port.
Zero exposed node ports. TLS terminated at Cloudflare edge.

**Storage**: Longhorn CSI v1.7+ in 2-replica mode across dedicated nodes.
Object storage: Cloudflare R2 (zero egress).

**GitOps**: ArgoCD App-of-Apps (~28 apps across ~22 namespaces) with self-heal.
Push to `main` → CI builds → GHCR → `kustomize edit set image` commits digest →
ArgoCD syncs → Switchyard tracks lifecycle events.

**Operational access** (SSH, kubeconfigs, server IPs, cost ledger): private repo
`madfam-org/internal-devops`. Not in any public repo.

---

## Enclii CLI — DevOps Reference

**Strong preference: use `enclii` over `kubectl`** for all operational
tasks. The CLI routes through Switchyard API, which gives you audit
logging, lifecycle event tracking, and service-scoped context. Escape
to kubectl only for the gaps listed at the end of this section.

### Install

```bash
# macOS
brew install enclii/tap/enclii

# Linux
curl -sSL https://get.enclii.dev | bash

# From source (in the enclii repo)
make build-cli && ./bin/enclii --version
```

### Auth

```bash
enclii login                  # browser SSO (Janua)
enclii whoami                 # verify active session
enclii logout                 # clear local creds
```

Env vars: `ENCLII_API_URL` (default `https://api.enclii.dev`),
`ENCLII_TOKEN` (alternative to interactive login),
`ENCLII_PROJECT`, `ENCLII_ENV`.

### Day-to-day for phynd-crm-api

The commands below default to `phynd-crm-api` — the primary service name for
this repo as registered in Switchyard. For any other service in the
ecosystem, swap the name.

```bash
# Status + where the pods are running
enclii ps --wide
enclii ps phynd-crm-api --env production

# Logs (tail, filter, history)
enclii logs phynd-crm-api -f                          # live tail
enclii logs phynd-crm-api --since 1h --level error    # last hour, errors only
enclii logs phynd-crm-api --env staging -f

# Deploy (preview, staging, production)
enclii deploy --env preview                       # from current branch
enclii deploy --env staging
enclii deploy --env production --strategy canary --canary-percent 10

# Rollback
enclii rollback phynd-crm-api                         # previous release
enclii rollback phynd-crm-api --to-revision 5

# Releases + history
enclii releases phynd-crm-api                          # list builds
enclii releases phynd-crm-api --latest --output json

# Secrets (routed through Lockbox → Vault → ESO → K8s)
enclii secrets list phynd-crm-api
enclii secrets set MY_KEY=value --service phynd-crm-api --secret
enclii secrets rm MY_KEY --service phynd-crm-api

# Domains, tunnel routes, DNS
enclii domains list phynd-crm-api
enclii domains add phynd-crm-api my.example.com       # auto-provisions tunnel route + DNS

# Scheduled jobs (cron + one-off)
enclii jobs list
enclii jobs run <job-name>                         # trigger one-off

# Routing (ingress + TLS)
enclii junctions list phynd-crm-api

# Serverless (scale-to-zero functions)
enclii functions list

# Local dev environment
enclii local up         # spin up dependent services (postgres, redis, …)
enclii local logs
enclii local down
```

### Full onboarding (only used when adding a brand-new service)

```bash
# One-shot: namespace + ArgoCD app + tunnel routes + Janua client + netpol
enclii onboard --repo madfam-org/<name> --db-name <db> --secrets-file .env
```

### Enclii-first production operations

Enclii is the required control plane for routine production operations.
Use the web UI, API, or CLI before reaching for raw infrastructure tools:

- ArgoCD sync / diff / rollback — `enclii ops apps ...`
- Pod logs, diagnosis, and safe restarts — `enclii ops pods ...`
- Longhorn / PVC / PV inspection and repair planning — `enclii ops storage ...`
- Kyverno violations and time-bound waivers — `enclii ops policy ...`
- ExternalSecrets and Vault readiness — `enclii ops secrets ...`
- ARC runner inspection and drain workflows — `enclii ops runners ...`
- DNS, tunnels, SaaS hostnames, providers, and repo automation — `enclii providers ...`
- Service lifecycle, domains, secrets, jobs, and observability — `enclii deploy`, `enclii rollback`, `enclii logs`, `enclii observe`, `enclii domains`, `enclii secrets`, `enclii jobs`

### Break-glass-only access

Raw `kubectl`, `helm`, SSH, provider CLIs/APIs, `docker exec`, and direct
container access are allowed only for platform bootstrap or documented
break-glass emergencies when Enclii is unavailable or lacks an implemented
adapter. Record the actor, reason, target service/environment, commands
executed, result, and follow-up Enclii adapter gap or incident link.

### Cluster access

kubeconfig + SSH keys live in `madfam-org/internal-devops` (private repo)
for bootstrap and break-glass use only. Routine production operations must
go through Enclii web, API, or CLI.

### Exit codes (scripting against the CLI)

| Code | Meaning |
|---|---|
| 0  | success |
| 10 | validation error |
| 20 | build failed |
| 30 | deploy failed |
| 40 | timeout |
| 50 | auth error |

---

## Document provenance

Generated 2026-04-23 as part of the "each repo stands alone" docs sweep. If the
ecosystem map or CLI reference drifts from reality, update the generator at
`madfam-org/enclii/docs/templates/ECOSYSTEM.md.template` and re-render — don't
edit per-repo copies in isolation.
