# Phynd production activation runbook

Date: 2026-05-14

## Current superseding verification — 2026-05-27

This runbook preserves the 2026-05-14 activation trail. The current production
status is now superseded by
[`CODEBASE_AND_PROD_EVIDENCE_2026-05-27.md`](CODEBASE_AND_PROD_EVIDENCE_2026-05-27.md).

Summary of the latest evidence:

- `https://phynd.app/`, `https://www.phynd.app/`, and
  `https://phynd.app/api/health` return HTTP 200 through Cloudflare.
- `https://phynd.app/demo` redirects to `https://phynd.app/overview`; following
  the demo cookie renders the dashboard with seeded demo data.
- `https://crm.madfam.io/` redirects to `/login`, and the login page renders
  `MADFAM CRM` with MADFAM Janua SSO copy.
- `https://crm.phynd.app/` redirects to `/login`, and the login page renders
  generic Phynd Janua SSO copy.
- Enclii reports `phynd-crm-web` and `phynd-crm-worker` healthy with one ready
  pod each.
- Remaining gap: `/api/auth/providers` still exposes an internal pod hostname
  in Janua `signinUrl` and `callbackUrl`; direct Janua signin probing returns
  HTTP 400.

## Objective

Bring `https://phynd.app` online as the canonical production Phynd CRM domain, with Janua-powered login for `admin@madfam.io`, while keeping all infrastructure changes Enclii-first.

## Latest verified status — 2026-05-14 historical

This runbook is chronological. Older sections preserve the starting condition
and remediation trail. This section was the source of truth on 2026-05-14; the
2026-05-27 section above now supersedes it.

- `https://phynd.app/` returns HTTP 200 through the Cloudflare edge when pinned to the Cloudflare A record `104.21.14.180`.
- `https://phynd.app/api/health` returns HTTP 200 through the same Cloudflare edge path.
- `https://crm.madfam.io/` returns HTTP 200.
- `https://crm.madfam.io/api/health` returns HTTP 200.
- `https://phynd.app/api/auth/signin/janua?callbackUrl=https%3A%2F%2Fphynd.app%2Fdashboard` currently returns HTTP 400 and sets the Auth.js callback-url cookie to `https://crm.madfam.io`, which proves the live runtime is still carrying a CRM canonical URL for Auth.js.
- Source now contains host-aware marketing/metadata branding so `phynd.app` serves generic Phynd positioning and `crm.madfam.io` serves the MADFAM-labelled PhyndCRM tenant shell after the patched web image is promoted.
- Source now contains CI/deploy unblockers for the worker Biome formatting issue, the Next.js GraphQL route-handler signature, services lint formatting/import issues, and web lint formatting/import issues.
- Source now contains live-demo canonical-origin remediation: `GET /demo` resolves redirects from trusted Enclii/Cloudflare external host headers and falls back to `https://phynd.app`, so public redirects cannot leak upstream pod hostnames.
- Source now enables Auth.js trusted-host behavior for Janua behind Enclii/Cloudflare and declares `AUTH_TRUST_HOST=true` in the Enclii service spec.
- Source now includes demo-dashboard degradation handling so a demo seed/data-read failure does not crash the dashboard shell; visitors see an explicit warming-up message instead.
- Source now includes a documented tRPC client compatibility bridge for the current tRPC v11 RC Docker build behavior, where the workspace router type widens and blocks typed client property access during `next build`; runtime routing still uses `AppRouter`.
- Regression coverage was added for trusted external-origin resolution and Auth.js trusted-host config.
- Root lint passes locally with warning-level technical debt still present.
- Local root typecheck remains blocked by local workspace installation state: this checkout currently lacks `node_modules/@phynd` workspace symlinks, so packages cannot resolve `@phynd/types` locally. CI should be used as the source of truth after a clean dependency install.

Remaining production blockers:

- Promote the patched web image and verify Janua initiation on both `phynd.app` and `crm.madfam.io`.
- Promote the patched web image and verify `https://phynd.app/demo` redirects to `https://phynd.app/overview`, never an internal `phynd-crm-web-*.svc` or pod hostname.
- Verify demo-cookie `https://phynd.app/overview` renders dashboard content without a React server-component digest.
- Remove or replace the hard-coded runtime `AUTH_URL=https://crm.madfam.io` and `NEXTAUTH_URL=https://crm.madfam.io` values so Auth.js can trust the active host for both canonical Phynd and the MADFAM slice.
- Keep production dispatch degraded until Pravara is repaired and a real Pravara API key is issued.
- Reconcile the break-glass runtime secret and DB bootstrap back into Enclii/Vault once the Enclii-managed secret and Postgres addon paths are repaired.

## Historical verified state — 2026-05-14 starting condition

- At this starting point, `https://phynd.app` was not serving Phynd and TLS
  handshakes failed.
- `http://phynd.app` serves a generic Porkbun/openresty placeholder, not the Phynd CRM app.
- `https://www.phynd.app` has the same TLS failure pattern.
- `https://crm.madfam.io` is behind Cloudflare but currently returns `502`.
- Enclii Cloudflare provider has no `phynd.app` zone.
- Enclii Porkbun provider is present as a command surface but the adapter is not configured.
- The active Cloudflare tunnel routes `crm.madfam.io` to `phynd-crm-web.phynd-crm.svc.cluster.local`, not `phynd-crm-web.phynd-crm.svc.cluster.local`.
- Enclii project inventory includes `phynd-crm` with project id `c72121bb-5952-417e-a3a9-57c7d2bc76c2`.
- `enclii onboard --repo madfam-org/phynd-crm --project phynd-crm --manifest-path infra/k8s/production --skip-postgres --skip-r2 --skip-secrets` initially stopped at the image gate because the base production Deployment manifests used `:latest`; those manifests are now digest-pinned directly.
- A second onboarding attempt still returned the same image-gate error because `enclii onboard` validates the GitHub repository state, not uncommitted local edits. Commit and push the digest-pinned manifests before re-running onboarding.
- After commit `0561285`, Enclii onboarding completed and created namespace `phynd-crm`, ArgoCD app `phynd-crm-services`, and Enclii auto-commit `b22f63bd8178a4acac2abc71e56b55de8b22039a`.
- `enclii services-sync --dir enclii/services --project phynd-crm` registered `phynd-crm-web` (`55d2ba51-d6b3-481c-ae56-e5410c3b5a6d`) and `phynd-crm-worker` (`5e1a20e4-2302-4aa0-a37e-fa7dc9fa87ea`).
- Enclii junctions now exist for `phynd.app`, `www.phynd.app`, and `crm.madfam.io`.
- Active Cloudflare tunnel inventory now includes `phynd.app` and `www.phynd.app` routed to `http://phynd-crm-web.phynd-crm.svc.cluster.local:80`.
- `crm.madfam.io` still resolves to the legacy `phynd-crm-web.phynd-crm.svc.cluster.local` route in active Cloudflare tunnel config; the newly-added Enclii junction does not override the existing legacy route.
- `phynd-crm-production` has been retired through Enclii with orphan propagation.
- ArgoCD shows `phynd-crm-services` as `Synced`, but still `Degraded` because `phynd-crm-secrets` is not materialized.
- `phynd-crm-services` has successfully synced commit `e5c51bab9ace0ee0194677e26a84f51d4337faef`, including the production ExternalSecret, but shared-resource warnings remain for the web/worker Deployments, ExternalSecret, namespace, network policies, quota, limits, service, and PDB.
- Enclii secret inspection now sees `ExternalSecret/phynd-crm-secrets`, but it is `Ready=False` with `SecretSyncedError` because Vault/provider data is not yet available.
- Pod logs cannot start because web and worker containers are still waiting on `CreateContainerConfigError` while `phynd-crm-secrets` is not materialized.
- Local `.env.local` is development/example material and must not be used for production; it points several services to `*.example.com` and `NEXT_PUBLIC_APP_URL` to localhost.
- `infra/k8s/production/external-secret.yaml` now declares `phynd-crm-secrets` backed by `ClusterSecretStore/vault-store` at Vault key `secret/phynd-crm`.
- The production kustomization now includes the ExternalSecret manifest, so Argo can materialize `phynd-crm-secrets` once real Vault values are written.
- Live Enclii API capabilities now advertise `ops.apps.retire`, and the legacy app retirement was completed through that path.
- Enclii RBAC now grants `switchyard-api` the narrowly-scoped Application delete verb and ExternalSecret patch verb needed for audited retire/refresh operations.
- `ops.secrets.refresh` successfully patches `phynd-crm-secrets`, but the provider still reports `could not get secret data from provider`.
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

2. Restore or create production secrets through Enclii.
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

3. Configure Janua OIDC for Phynd.
   - Issuer: `https://auth.madfam.io`
   - Production callback: `https://phynd.app/api/auth/callback/janua`
   - Temporary MADFAM slice callback: `https://crm.madfam.io/api/auth/callback/janua`
   - Confirm `admin@madfam.io` has tenant/admin claims accepted by Phynd.

4. Reconcile Cloudflare tunnel routes through Enclii.
   - `phynd.app` -> `http://phynd-crm-web.phynd-crm.svc.cluster.local:80` is present.
   - `www.phynd.app` -> `http://phynd-crm-web.phynd-crm.svc.cluster.local:80` is present.
   - `api.phynd.app` -> `http://phynd-crm-api.phynd-crm.svc.cluster.local:80` if the API service is split later.
   - `crm.madfam.io` -> `http://phynd-crm-web.phynd-crm.svc.cluster.local:80` remains blocked by the existing legacy `phynd-crm` tunnel route.

5. Run production smoke checks.
   - `https://phynd.app/api/health` returns healthy.
   - `https://phynd.app/login` renders the Janua login action.
   - Janua redirects back to `/overview` after admin login.
   - Admin session exposes the expected tenant and role.

## Break-glass boundary

Direct `kubectl`, direct Cloudflare dashboard edits, direct registrar edits, and direct container shell access are only allowed when Enclii is unavailable and production recovery cannot wait. Any such action must be documented afterward and reconciled back into Enclii.

## Continuation status — 2026-05-14

Verified through Enclii-first operations:

- Retired legacy Argo application `phynd-crm-production` through `enclii ops apps retire`.
- Recreated the `crm.madfam.io` junction through Enclii with id `15118c4b-aaf1-4c7a-bba7-27e58c688e96`.
- Active Cloudflare tunnel desired route now targets `http://phynd-crm-web.phynd-crm.svc.cluster.local:80` for `crm.madfam.io`, `phynd.app`, and `www.phynd.app`.
- Public DNS for `crm.madfam.io` resolves to Cloudflare A records, but HTTPS still returns Cloudflare `502` because the upstream Phynd pods are not yet runnable.
- At this continuation point, public DNS for `phynd.app` and `www.phynd.app`
  still resolved to Porkbun/Pixie infrastructure, so `https://phynd.app` failed
  TLS before it reached the Enclii tunnel.
- `phynd-crm-services` is `Synced` but `Degraded`.
- `ExternalSecret/phynd-crm-secrets` remains `Ready=False` with `SecretSyncedError: could not get secret data from provider`.

Current hard blocker:

- `phynd-crm-secrets` is not materialized. Enclii/Selva secret namespace lookup for `phynd-crm` returned `404`, and Vault status previously reported unreachable/uninitialized from the Enclii inspection path.

Minimum secret contract still required before pods can start:

- `DATABASE_URL`
- `REDIS_URL`
- `AUTH_SECRET`
- `AUTH_JANUA_ISSUER`
- `AUTH_JANUA_CLIENT_ID`
- `AUTH_JANUA_CLIENT_SECRET`
- `JANUA_API_URL`
- `DHANAM_API_URL`
- `COTIZA_API_URL`
- `PRAVARA_BASE_URL`
- `FORJ_API_URL`
- `PRAVARA_API_KEY`

Truthful next implementation step:

- Use the approved RFC 0005 Selva secret workflow or a Vault operator bootstrap to populate Vault key `secret/phynd-crm` with the real values above, then run `enclii ops secrets refresh phynd-crm-secrets --namespace phynd-crm --apply`.
- Do not fabricate placeholder values. A generated `AUTH_SECRET` and Janua OAuth client can be created, but `DATABASE_URL` and `PRAVARA_API_KEY` must come from their real source-of-truth owners or provider APIs.
- Move `phynd.app` DNS from Porkbun/Pixie to the Enclii-managed Cloudflare tunnel, or configure the Enclii Porkbun adapter so Enclii can own those DNS records.

## Continuation status — Janua login activation

Actions completed:

- Registered Janua OAuth client `Phynd CRM Production` with redirect URIs for `https://phynd.app`, `https://www.phynd.app`, and `https://crm.madfam.io`.
- Corrected Phynd Auth.js scope request from `openid profile email roles` to `openid profile email`; Janua rejects `roles` as an OAuth scope.
- Made `PRAVARA_API_KEY` optional so Phynd login/CRM boot is not blocked while Pravara production is unhealthy.
- Bootstrapped a dedicated shared Postgres database/user for Phynd and applied all Phynd DB migrations as a controlled break-glass action while the Enclii managed Postgres addon path is blocked.
- Materialized `phynd-crm-secrets` directly as a break-glass runtime secret because Vault/ExternalSecret provider data is still unavailable.
- Copied `ghcr-credentials` into `phynd-crm` so private GHCR images can pull.
- Added `AUTH_TRUST_HOST=true`, `AUTH_URL=https://crm.madfam.io`, and `NEXTAUTH_URL=https://crm.madfam.io` to the runtime secret so Auth.js trusts the Cloudflare tunnel host.

Verified:

- `https://crm.madfam.io` returns HTTP 200.
- `https://crm.madfam.io/api/health` returns `{"status":"ok","service":"phynd-crm","version":"0.1.0"}`.
- `https://crm.madfam.io/api/auth/providers` returns the Janua provider.
- `https://crm.madfam.io/api/auth/csrf` returns a CSRF token.
- Auth.js signin initiation redirects to Janua authorization.
- Cloudflare activation check for `phynd.app` now returns `Zone verified!` after Porkbun delegation to `chin.ns.cloudflare.com` and `woz.ns.cloudflare.com`.
- Source now contains host-aware branding so `phynd.app` resolves to generic Phynd positioning while `crm.madfam.io` resolves to the MADFAM-labelled PhyndCRM tenant shell.

Still blocked:

- `phynd.app` now serves Phynd over the Cloudflare edge, but Janua signin initiation on `phynd.app` still returns HTTP 400 while the runtime Auth.js callback-url cookie points at `https://crm.madfam.io`.
- `https://phynd.app/demo` was verified to return a 307 redirect to an internal upstream hostname before this remediation; the source fix is committed locally and requires image promotion before the live edge is truthful.
- With the demo cookie preserved manually, `https://phynd.app/overview` returned HTTP 200 and rendered the dashboard shell, but the overview page surfaced React server-component digest `692790429`; the source fix now degrades demo data failures instead of crashing the route.
- The patched Phynd web image still needs to be built, promoted, and smoke-tested before Janua login can be considered truthful on both `phynd.app` and `crm.madfam.io`.
- CI/deploy were blocked on Biome formatting/import issues and a Next.js route-handler type error; source fixes are committed locally and root lint passes.
- Worker Redis connectivity is still degraded against the shared Redis services.
- Pravara production is returning `503`, and its DB had no application tables during break-glass inspection; production dispatch must stay degraded until Pravara is repaired and a real Pravara API key is issued.
- Enclii managed Postgres addon provisioning remains blocked by CNPG init pods failing to reach the Kubernetes API service from the generated addon namespace.
