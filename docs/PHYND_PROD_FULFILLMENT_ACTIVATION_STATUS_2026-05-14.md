# Phynd production fulfillment activation status - 2026-05-14

## Current superseding verification - 2026-05-27

This file is a historical activation status note. Current production evidence is
recorded in
[`CODEBASE_AND_PROD_EVIDENCE_2026-05-27.md`](CODEBASE_AND_PROD_EVIDENCE_2026-05-27.md).

The latest verification shows Phynd is live at `https://phynd.app`,
`/api/health` returns healthy, `/demo` renders the seeded dashboard after its
redirect, `crm.madfam.io` and `crm.phynd.app` reach their expected login
surfaces, and Enclii reports healthy web and worker services. The remaining
production gap is Auth.js origin metadata: `/api/auth/providers` still emits an
internal pod hostname for Janua signin/callback URLs, and direct Janua signin
probing returns HTTP 400.

## Historical production evidence - 2026-05-14

At the time this note was written, Phynd was not production-live at
`https://phynd.app` yet. This section is retained as historical activation
evidence.

Observed public state:

```text
http://phynd.app -> Porkbun/Pixie default surface, not Phynd
https://phynd.app -> TLS handshake failure
https://crm.madfam.io -> Cloudflare 502
```

Observed Enclii/Kubernetes state:

```text
phynd-crm-services -> Degraded / OutOfSync
phynd-crm-production -> still shares Phynd resources
phynd-crm-secrets -> Ready=False, SecretSyncedError, could not get secret data from provider
phynd-crm-web pods -> Pending / unready
phynd-crm-worker pods -> Pending / unready
```

## Required order of operations

1. Wait for Switchyard API to deploy the build that exposes `apps.retire` and the `secrets.refresh` adapter.
2. Retire the legacy Argo application through Enclii, not kubectl:

```text
enclii ops apps retire phynd-crm-production --apply --reason "retire legacy Phynd CRM app after Phynd CRM successor onboarding" --idempotency-key retire-phynd-crm-production-20260514
```

3. Populate/fix the backing provider path consumed by `phynd-crm-secrets`.
4. Refresh the ExternalSecret through Enclii:

```text
enclii ops secrets refresh phynd-crm-secrets --namespace phynd-crm --apply --reason "retry Phynd ExternalSecret reconciliation before production activation" --idempotency-key refresh-phynd-crm-secrets-20260514
```

5. Confirm `phynd-crm-secrets` reports `Ready=True`.
6. Confirm Phynd web and worker pods become Ready.
7. Move `phynd.app` DNS from Porkbun/Pixie into an Enclii-managed route or configure the Enclii Porkbun adapter.
8. Keep `crm.madfam.io` on hold until `phynd.app` is healthy; then point it to the MADFAM tenant slice of Phynd.

## Secret keys expected by the production ExternalSecret

```text
DATABASE_URL
REDIS_URL
AUTH_SECRET
AUTH_JANUA_ISSUER
AUTH_JANUA_CLIENT_ID
AUTH_JANUA_CLIENT_SECRET
JANUA_API_URL
DHANAM_API_URL
COTIZA_API_URL
PRAVARA_BASE_URL
FORJ_API_URL
PRAVARA_API_KEY
NEXT_PUBLIC_APP_URL
NODE_ENV
```

## Acceptance gates

```text
https://phynd.app/api/health -> HTTP 200 healthy
https://phynd.app/login -> Janua-powered login visible
admin@madfam.io -> can access admin workspace
phynd-crm-services -> Healthy / Synced
https://crm.madfam.io -> MADFAM tenant slice after phynd.app is stable
```

## 2026-05-14 Enclii deployment dependency

Phynd production activation remains blocked on Enclii control-plane publication plus secret-provider reconciliation.

Current evidence:

- `phynd-crm-secrets` remains `Ready=False` with `SecretSyncedError` and `could not get secret data from provider`.
- `phynd-crm-production` is still present and causing shared-resource warnings against `phynd-crm-services`.
- The live Enclii API advertises `apps.retire` and `secrets.refresh`, but dry-runs still report the generic adapter-not-wired warning.

Next required step: publish and deploy the Enclii Switchyard API adapter changes, then retire `phynd-crm-production` and refresh `phynd-crm-secrets` exclusively through Enclii operations.

## 2026-05-14 secret source-of-truth findings

Additional Enclii/Selva evidence gathered after the initial status entry:

- `enclii secrets list --file .enclii.yml --json` returned an empty list for Phynd.
- `enclii secrets list --file .enclii.yml --env production --json` failed because project `phynd-crm` does not currently have an Enclii environment named `production`.
- `enclii ops secrets vault --namespace phynd-crm --json` returned zero Vault pods/resources in the Phynd namespace.
- Selva RFC 0005 already allows `phynd-crm` and `phynd-crm-staging`, so Phynd is not blocked on the Selva namespace allow-list. It is blocked on approved source values and Enclii production environment alignment.

Operational implication: Phynd production cannot become truthful until its environment model and required secret values are established through Enclii/Selva, then `phynd-crm-secrets` is refreshed and the legacy `phynd-crm-production` Argo app is retired through Enclii.
