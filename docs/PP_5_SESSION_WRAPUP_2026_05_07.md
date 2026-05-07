# PP.5 Session Wrap-Up - 2026-05-07

> Scope: PhyneCRM PP.5 staging remediation, provider handoff planning, and Wave 0 bootstrap.
> Canonical plan: [`docs/PP_5_FULL_REMEDIATION_PLAN.md`](./PP_5_FULL_REMEDIATION_PLAN.md)

## Executive Summary

This session advanced PP.5 from audit/remediation planning into executable
handoff and bootstrap artifacts.

Repo-owned PP.5 guardrails are now in place:

- Staging environment shape is documented.
- Provider handoff lanes are documented.
- Signed webhook probes can be generated for every active inbound lane.
- A staging env file can be generated with fresh random staging-only secrets
  plus explicit `REPLACE_ME_*` markers for operator-owned values.
- Wave 0 readiness can be checked with one command.

Cluster-side progress:

- Namespace `phyne-crm-staging` was created successfully.

Remaining Wave 0 blockers:

- Secret `phyne-crm-staging-secrets` is not installed.
- ArgoCD Application `phyne-crm-staging` is not installed.
- DNS/tunnel route for `staging-crm.madfam.io` is not installed or not resolving.

Do not apply the ArgoCD app until the staging secret and DNS/tunnel route are
ready. Doing so would create a broken rollout with placeholder credentials.

## Files Added

| File | Purpose |
|---|---|
| [`docs/PP_5_FULL_REMEDIATION_PLAN.md`](./PP_5_FULL_REMEDIATION_PLAN.md) | Canonical full PP.5 remediation plan: critical path, workstreams, RACI, acceptance checklist. |
| [`docs/PP_5_PROVIDER_HANDOFF_MATRIX.md`](./PP_5_PROVIDER_HANDOFF_MATRIX.md) | Provider-by-provider handoff matrix for inbound, outbound, and read-split lanes. |
| [`docs/PP_5_HANDOFF_EXECUTION_RUNBOOK.md`](./PP_5_HANDOFF_EXECUTION_RUNBOOK.md) | Wave 0-3 execution runbook with concrete commands. |
| [`scripts/pp5-staging-audit.mjs`](../scripts/pp5-staging-audit.mjs) | Validates staging secret template coverage for split-sensitive env keys and observed webhook/event secrets. |
| [`scripts/pp5-generate-staging-env.mjs`](../scripts/pp5-generate-staging-env.mjs) | Generates a staging env file scaffold with random split-sensitive secrets and `REPLACE_ME_*` operator values. |
| [`scripts/pp5-webhook-probe.mjs`](../scripts/pp5-webhook-probe.mjs) | Generates signed `curl` probes or sends signed staging webhook probes for all active inbound lanes. |
| [`scripts/pp5-wave0-check.mjs`](../scripts/pp5-wave0-check.mjs) | Consolidated Wave 0 readiness check for secret coverage, namespace, secret, ArgoCD app, and staging health. |

## Files Updated

| File | Update |
|---|---|
| [`docs/PP_5_STAGING_AUDIT.md`](./PP_5_STAGING_AUDIT.md) | Updated PP.5 state, linked full remediation plan, matrix, and runbook; corrected Karafiel inbound note. |
| [`docs/PP_5_FULL_REMEDIATION_PLAN.md`](./PP_5_FULL_REMEDIATION_PLAN.md) | Marked namespace as complete and Wave 0 checker/env generator as ready. |
| [`docs/PP_5_PROVIDER_HANDOFF_MATRIX.md`](./PP_5_PROVIDER_HANDOFF_MATRIX.md) | Added current Wave 0 status and linked canonical remediation plan. |
| [`docs/PP_5_HANDOFF_EXECUTION_RUNBOOK.md`](./PP_5_HANDOFF_EXECUTION_RUNBOOK.md) | Added env generator and consolidated Wave 0 checker. |

Other modified files already existed in the working tree from earlier PP.5
work and adjacent changes. Do not revert them blindly.

## Cluster Actions Performed

Command run:

```bash
kubectl apply -f infra/k8s/overlays/staging/namespace.yaml
```

Result:

```text
namespace/phyne-crm-staging created
```

Follow-up check:

```bash
kubectl get ns phyne-crm-staging
```

Observed result:

```text
phyne-crm-staging   Active
```

No secret was installed. No ArgoCD Application was applied. No DNS/tunnel route
was changed.

## Validation Results

Passing:

```bash
node --check scripts/pp5-generate-staging-env.mjs
node --check scripts/pp5-staging-audit.mjs
node --check scripts/pp5-wave0-check.mjs
node --check scripts/pp5-webhook-probe.mjs
node scripts/pp5-staging-audit.mjs
node scripts/pp5-webhook-probe.mjs list
git diff --check
```

Expected blocked check:

```bash
node scripts/pp5-wave0-check.mjs
```

Current output summary:

```text
PASS secret template coverage
PASS webhook probe coverage
PASS staging namespace
BLOCKED staging secret
BLOCKED staging ArgoCD app
BLOCKED staging health DNS/HTTP
Wave 0 blocked: 3 check(s) failed
```

## Provider Probe Coverage

`node scripts/pp5-webhook-probe.mjs list` currently covers:

| Lane | Receiver | Secret env | Signature header |
|---|---|---|---|
| `cotiza` | `/api/webhooks/cotiza` | `COTIZA_WEBHOOK_SECRET` | `x-webhook-signature` |
| `forj` | `/api/webhooks/forj` | `FORJ_WEBHOOK_SECRET` | `x-webhook-signature` |
| `pravara` | `/api/webhooks/pravara` | `PRAVARA_WEBHOOK_SECRET` | `x-webhook-signature` |
| `janua-telemetry` | `/api/webhooks/janua-telemetry` | `JANUA_TELEMETRY_WEBHOOK_SECRET` | `x-webhook-signature` |
| `janua` | `/api/webhooks/janua` | `JANUA_WEBHOOK_SECRET` | `x-webhook-signature` |
| `dhanam` | `/api/webhooks/dhanam` | `DHANAM_WEBHOOK_SECRET` | `x-dhanam-signature` |
| `fortuna` | `/api/webhooks/fortuna` | `FORTUNA_WEBHOOK_SECRET` | `x-fortuna-signature` |
| `tezca-interest` | `/api/webhooks/tezca` | `TEZCA_WEBHOOK_SECRET` | `x-webhook-signature` |
| `tezca-newsletter` | `/api/webhooks/tezca` | `TEZCA_WEBHOOK_SECRET` | `x-webhook-signature` |
| `routecraft` | `/api/webhooks/routecraft` | `PHYNE_CRM_EVENTS_SECRET` | `x-madfam-signature` |
| `legacy-payment` | `/api/v1/events/payment.succeeded` | `PHYNE_CRM_EVENTS_SECRET` | `x-madfam-signature` |
| `ceq` | `/api/webhooks/ceq` | `CEQ_WEBHOOK_SECRET` | `x-webhook-signature` |
| `coforma` | `/api/webhooks/coforma` | `COFORMA_WEBHOOK_SECRET` | `x-madfam-signature` |
| `engagement-event` | `/api/v1/engagements/events` | `PHYNE_ENGAGEMENT_EVENTS_SECRET` | `x-webhook-signature` |
| `engagement-artifact` | `/api/v1/engagements/artifacts` | `PHYNE_ENGAGEMENT_EVENTS_SECRET` | `x-webhook-signature` |

## Immediate Next Actions

1. Secrets owner generates a secure staging env file:

```bash
node scripts/pp5-generate-staging-env.mjs --output /secure/path/phyne-crm-staging.env
```

2. Secrets owner replaces every `REPLACE_ME_*` value with real staging-only
   values.

Critical operator-owned values:

- `DATABASE_URL`
- `REDIS_URL`
- `AUTH_JANUA_ISSUER`
- `AUTH_JANUA_CLIENT_ID`
- `AUTH_JANUA_CLIENT_SECRET`
- provider API URLs
- `KARAFIEL_API_KEY`
- `RESEND_API_KEY`
- `EMAIL_ALLOWLIST_DOMAINS`

3. Install the staging secret:

```bash
kubectl -n phyne-crm-staging create secret generic phyne-crm-staging-secrets \
  --from-env-file=/secure/path/phyne-crm-staging.env \
  --dry-run=client -o yaml | kubectl apply -f -
```

4. Platform/Enclii installs the ArgoCD app:

```bash
kubectl apply -f infra/argocd/phyne-crm-staging-application.yaml
```

5. Platform/Enclii adds the DNS/tunnel route:

```text
staging-crm.madfam.io -> phyne-crm-web.phyne-crm-staging.svc.cluster.local:80
```

6. Re-run:

```bash
node scripts/pp5-wave0-check.mjs
```

7. Once Wave 0 passes, start provider probe batches from
[`docs/PP_5_FULL_REMEDIATION_PLAN.md`](./PP_5_FULL_REMEDIATION_PLAN.md).

## Explicit Non-Actions

- Did not install `phyne-crm-staging-secrets` with placeholder values.
- Did not apply `infra/argocd/phyne-crm-staging-application.yaml`.
- Did not create or modify DNS/tunnel resources.
- Did not run provider webhook probes against staging because DNS/Argo/secret
  are not ready.
- Did not implement masked restore automation; it remains Workstream 4.

## Known Risks

- Applying Argo before secret installation will produce failed pods.
- Pointing staging provider URLs at production write endpoints can create real
  CRM, billing, grant, email, or artifact side effects.
- `JANUA_TELEMETRY_WEBHOOK_SECRET` currently has fallback behavior to
  `JANUA_WEBHOOK_SECRET`; remove reliance on this fallback after telemetry is
  fully split.
- No `POST /api/webhooks/karafiel` inbound route exists in this repo. Karafiel
  PP.5 scope is outbound PhyneCRM to Karafiel unless a real inbound contract is
  added.

## Wrap-Up Status

Session can close with PP.5 in this state:

- Repo documentation and tooling are ready for Wave 0 continuation.
- Cluster namespace is created.
- Remaining blockers are external/secret/platform tasks and are documented with
  exact commands and acceptance criteria.
