# Phynd production activation runbook

Date: 2026-05-14

## Objective

Bring `https://phynd.app` online as the canonical production Phynd CRM domain, with Janua-powered login for `admin@madfam.io`, while keeping all infrastructure changes Enclii-first.

## Current verified state

- `https://phynd.app` is not serving Phynd. TLS handshakes fail.
- `http://phynd.app` serves a generic Porkbun/openresty placeholder, not the Phynd CRM app.
- `https://www.phynd.app` has the same TLS failure pattern.
- `https://crm.madfam.io` is behind Cloudflare but currently returns `502`.
- Enclii Cloudflare provider has no `phynd.app` zone.
- Enclii Porkbun provider is present as a command surface but the adapter is not configured.
- The active Cloudflare tunnel routes `crm.madfam.io` to `phyne-crm-web.phyne-crm.svc.cluster.local`, not `phynd-crm-web.phynd-crm.svc.cluster.local`.
- Enclii project inventory does not currently include `phynd-crm`.
- `enclii projects create --name "Phynd CRM" --slug phynd-crm` currently returns `402 tier_limit_exceeded`; Enclii API tier middleware must allow trusted MADFAM `admin`/`superadmin` operators to create self-hosted internal projects.
- `enclii onboard --repo madfam-org/phynd-crm --project phynd-crm --manifest-path infra/k8s/production --skip-postgres --skip-r2 --skip-secrets` initially stopped at the image gate because the base production Deployment manifests used `:latest`; those manifests are now digest-pinned directly.
- A second onboarding attempt still returned the same image-gate error because `enclii onboard` validates the GitHub repository state, not uncommitted local edits. Commit and push the digest-pinned manifests before re-running onboarding.
- After commit `0561285`, Enclii onboarding completed and created namespace `phynd-crm`, ArgoCD app `phynd-crm-services`, and Enclii auto-commit `b22f63bd8178a4acac2abc71e56b55de8b22039a`.
- `enclii services-sync --dir enclii/services --project phynd-crm` registered `phynd-crm-web` (`55d2ba51-d6b3-481c-ae56-e5410c3b5a6d`) and `phynd-crm-worker` (`5e1a20e4-2302-4aa0-a37e-fa7dc9fa87ea`).
- Enclii junctions now exist for `phynd.app`, `www.phynd.app`, and `crm.madfam.io`.
- Active Cloudflare tunnel inventory now includes `phynd.app` and `www.phynd.app` routed to `http://phynd-crm-web.phynd-crm.svc.cluster.local:80`.
- `crm.madfam.io` still resolves to the legacy `phyne-crm-web.phyne-crm.svc.cluster.local` route in active Cloudflare tunnel config; the newly-added Enclii junction does not override the existing legacy route.
- ArgoCD shows `phynd-crm-services` as Degraded/OutOfSync because legacy app `phyne-crm-production` still owns shared resources in the same namespace.
- Enclii secret inspection reports zero ExternalSecrets in namespace `phynd-crm`.
- Pod logs cannot start because web and worker containers are waiting on `CreateContainerConfigError`.
- Local `.env.local` is development/example material and must not be used for production; it points several services to `*.example.com` and `NEXT_PUBLIC_APP_URL` to localhost.
- `infra/k8s/production/external-secret.yaml` now declares `phynd-crm-secrets` backed by `ClusterSecretStore/vault-store` at Vault key `secret/phynd-crm`.
- The production kustomization now includes the ExternalSecret manifest, so Argo can materialize `phynd-crm-secrets` once real Vault values are written.
- Installed Enclii `services-sync` must not be pointed at the repository root for this repo because it can treat Kubernetes manifests as service specs. Use `enclii/services/` only.

## Deployment contract added in repo

- `.enclii.yml` now describes the production web service.
- `enclii/services/phynd-crm-web.yaml` defines the web service from `docker/Dockerfile.web`.
- `enclii/services/phynd-crm-worker.yaml` defines the worker service from `docker/Dockerfile.worker`.
- Both service specs point at `https://github.com/madfam-org/phynd-crm`, branch `main`.
- Required production domains are declared as `phynd.app`, `www.phynd.app`, and temporary MADFAM slice route `crm.madfam.io`.

## Required Enclii-first remediation sequence

1. Configure Enclii ownership of `phynd.app`.
   - Preferred path: delegate or transfer `phynd.app` DNS to the MADFAM Cloudflare account managed by Enclii.
   - Alternate path: configure the Enclii Porkbun provider adapter so Enclii can manage records at Porkbun.
   - Direct registrar or DNS console edits are break-glass only.

2. Remove legacy ArgoCD ownership.
   - Retire or delete `phyne-crm-production` through Enclii/GitOps.
   - Confirm `phynd-crm-services` is the only application managing namespace `phynd-crm`.
   - Re-sync `phynd-crm-services` and verify health is no longer Degraded/OutOfSync.

3. Restore or create production secrets through Enclii.
   - Vault key: `secret/phynd-crm`
   - `AUTH_SECRET`
   - `AUTH_JANUA_CLIENT_ID`
   - `AUTH_JANUA_CLIENT_SECRET`
   - `DATABASE_URL`
   - `REDIS_URL`
   - `JANUA_API_URL`
   - `DHANAM_API_URL`
   - `COTIZA_API_URL`
   - `PRAVARA_BASE_URL`
   - `FORJ_API_URL`
   - `PRAVARA_API_KEY`
   - `NEXT_PUBLIC_APP_URL=https://phynd.app`
   - `NODE_ENV=production`

4. Configure Janua OIDC for Phynd.
   - Issuer: `https://auth.madfam.io`
   - Production callback: `https://phynd.app/api/auth/callback/janua`
   - Temporary MADFAM slice callback: `https://crm.madfam.io/api/auth/callback/janua`
   - Confirm `admin@madfam.io` has tenant/admin claims accepted by Phynd.

5. Reconcile Cloudflare tunnel routes through Enclii.
   - `phynd.app` -> `http://phynd-crm-web.phynd-crm.svc.cluster.local:80` is present.
   - `www.phynd.app` -> `http://phynd-crm-web.phynd-crm.svc.cluster.local:80` is present.
   - `api.phynd.app` -> `http://phynd-crm-api.phynd-crm.svc.cluster.local:80` if the API service is split later.
   - `crm.madfam.io` -> `http://phynd-crm-web.phynd-crm.svc.cluster.local:80` remains blocked by the existing legacy `phyne-crm` tunnel route.

6. Run production smoke checks.
   - `https://phynd.app/api/health` returns healthy.
   - `https://phynd.app/login` renders the Janua login action.
   - Janua redirects back to `/overview` after admin login.
   - Admin session exposes the expected tenant and role.

## Break-glass boundary

Direct `kubectl`, direct Cloudflare dashboard edits, direct registrar edits, and direct container shell access are only allowed when Enclii is unavailable and production recovery cannot wait. Any such action must be documented afterward and reconciled back into Enclii.
