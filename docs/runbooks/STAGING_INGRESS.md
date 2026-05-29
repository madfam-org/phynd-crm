# Staging ingress — `staging-phynd.app`

Date: 2026-05-29  
Audience: Enclii + Cloudflare operators  
Blocks: PP.5 row 12, live `pnpm verify:post-deploy`, cross-service staging smoke

> **Enclii-first:** provision tunnel, DNS, and TLS via Enclii web/API/CLI when the
> staging adapter exists. Steps below are break-glass references aligned with
> [`PP_5_STAGING_AUDIT.md`](../PP_5_STAGING_AUDIT.md).

## Goal

External HTTPS reachability:

```text
https://staging-phynd.app/api/health  →  { "status": "ok", "service": "phynd-crm" }
```

## Prerequisites

- ArgoCD sync healthy for `phynd-crm-staging` (web + worker)
- Staging secrets applied (`node scripts/pp5-validate-staging-env.mjs <env-file>`)
- In-cluster `Service` exposes web on port 80 → pod 3000 (see `infra/k8s/overlays/staging/`)

## Enclii / platform steps

1. Declare `staging-phynd.app` on the Phynd CRM Enclii service (`.enclii.yml` currently lists production domains only — reconcile per ROADMAP 0.5).
2. Point tunnel/ingress at the staging web `Service` in `phynd-crm-staging` namespace.
3. Issue TLS certificate for `staging-phynd.app`.
4. Confirm `NEXT_PUBLIC_APP_URL` and `NEXTAUTH_URL` in staging secrets are `https://staging-phynd.app`.

## Verification

```bash
# From operator network (not in-cluster)
CRM_BASE_URL=https://staging-phynd.app pnpm verify:post-deploy

# Full operator bundle
CRM_BASE_URL=https://staging-phynd.app pnpm pp5:pilot-ops -- --live

# Janua OIDC callback must be registered before staff SSO works on staging
node scripts/verify-janua-oidc-checklist.mjs
```

## Janua staging alignment

Register staging callback on the **staging** Janua OIDC client:

```text
https://staging-phynd.app/api/auth/callback/janua
```

See [`verify-janua-oidc-checklist.mjs`](../../scripts/verify-janua-oidc-checklist.mjs) for the full URI list.

## Related

- [`PILOT_GO_LIVE.md`](./PILOT_GO_LIVE.md)
- [`PP_5_STAGING_AUDIT.md`](../PP_5_STAGING_AUDIT.md) — row 12
- [`MADFAM_TRUTH_LAYER_REMEDIATION.md`](../MADFAM_TRUTH_LAYER_REMEDIATION.md) — WS2
