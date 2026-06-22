# Janua portal magic-link redirect URIs

> Last updated: 2026-06-22  
> Related: [`verify-janua-oidc-checklist.mjs`](../../scripts/verify-janua-oidc-checklist.mjs), [`DOMAIN_ROUTING_POLICY_2026-05-15.md`](../DOMAIN_ROUTING_POLICY_2026-05-15.md)

## Why this matters

MADFAM staff use **`https://crm.madfam.io`** (Janua OIDC). External clients receive a **Janua magic-link email** when staff publish a quote or send a portal link.

PhyndCRM builds the Janua `redirect_url` as:

```text
{PORTAL_BASE_URL}/portal/verify?engagement={id}
```

Production **`PORTAL_BASE_URL` must be `https://crm.madfam.io`** so clients land on the MADFAM-branded host, not `phynd.app`.

## Janua admin checklist

### 1. Staff OIDC (already required)

Register on the Phynd CRM Janua OIDC client:

| Environment | Redirect URI |
|---|---|
| Production MADFAM | `https://crm.madfam.io/api/auth/callback/janua` |
| Production generic | `https://crm.phynd.app/api/auth/callback/janua` |
| Staging | `https://staging-crm.madfam.io/api/auth/callback/janua` |

Verify live:

```bash
pnpm verify:janua-oidc -- --verify-live
```

### 2. Client portal magic-link (new requirement)

Allow **`redirect_url`** prefixes on Janua's magic-link API (`POST /api/v1/auth/magic-link`):

| Environment | Portal verify origin (prefix) |
|---|---|
| Production MADFAM | `https://crm.madfam.io/portal/verify` |
| Staging | `https://staging-crm.madfam.io/portal/verify` |

Janua must accept query parameters `engagement` and `token` on that path.

**Do not** register `https://phynd.app/portal/verify` for production MADFAM clients unless you intentionally want Phynd-branded client URLs.

### 3. PhyndCRM env

| Var | Production value |
|---|---|
| `PORTAL_BASE_URL` | `https://crm.madfam.io` |
| `JANUA_API_URL` | `https://auth.madfam.io` |

Kubernetes: `phynd-crm-pilot-overlay` secret in namespace `phynd-crm`. Template: [`infra/k8s/production/pilot-overlay-template.yaml`](../../infra/k8s/production/pilot-overlay-template.yaml).

Verify:

```bash
node scripts/verify-client-lifecycle-env.mjs --from-k8s production
pnpm pp5:prod-lifecycle-handoff
```

After changing the secret, restart web + worker:

```bash
kubectl rollout restart deployment/phynd-crm-web deployment/phynd-crm-worker -n phynd-crm
```

## End-to-end flow

```mermaid
sequenceDiagram
  participant Staff as Staff crm.madfam.io
  participant Phynd as PhyndCRM
  participant Janua as Janua auth.madfam.io
  participant Client as Client browser

  Staff->>Phynd: publishQuoteToPortal / sendPortalLink
  Phynd->>Janua: POST /api/v1/auth/magic-link redirect_url=crm.madfam.io/portal/verify?engagement=…
  Janua->>Client: Email with magic link
  Client->>Phynd: GET crm.madfam.io/portal/verify?engagement=&token=
  Phynd->>Janua: POST /api/v1/auth/magic-link/verify
  Phynd->>Client: Set portal cookie → /portal/{engagementId}
```

## Acceptance

- [ ] `verify-client-lifecycle-env --from-k8s production` reports `PORTAL_BASE_URL` = `https://crm.madfam.io`
- [ ] Janua admin confirmed portal verify origin allowlist includes `crm.madfam.io`
- [ ] Test magic link from staging first (`staging-crm.madfam.io`)
- [ ] First prod client: publish quote → client email → portal timeline loads on `crm.madfam.io`
