# PP.5 Handoff Execution Runbook

> Last Updated: 2026-05-07
> Full remediation plan: [`docs/PP_5_FULL_REMEDIATION_PLAN.md`](./PP_5_FULL_REMEDIATION_PLAN.md)
> Matrix: [`docs/PP_5_PROVIDER_HANDOFF_MATRIX.md`](./PP_5_PROVIDER_HANDOFF_MATRIX.md)
> Session wrap-up: [`docs/PP_5_SESSION_WRAPUP_2026_05_07.md`](./PP_5_SESSION_WRAPUP_2026_05_07.md)

## Wave 0 - Platform Bootstrap

Run these before provider teams send synthetic events.

```bash
node scripts/pp5-staging-audit.mjs
node scripts/pp5-generate-staging-env.mjs --output /secure/path/phyne-crm-staging.env
node scripts/pp5-wave0-check.mjs
curl -fsS https://staging-crm.madfam.io/api/health
kubectl -n phyne-crm-staging get secret phyne-crm-staging-secrets
```

Required outcome:

- The audit script passes.
- Generated env values have every `REPLACE_ME_*` value replaced by the secrets owner.
- `staging-crm.madfam.io` resolves to the staging PhyneCRM web service.
- `phyne-crm-staging-secrets` exists and contains staging-only values.
- ArgoCD app `phyne-crm-staging` is synced and healthy.

Observed from this workspace on 2026-05-07:

- `node scripts/pp5-staging-audit.mjs`: passed.
- `node scripts/pp5-generate-staging-env.mjs`: available for staging-only env generation; operator-owned values still required.
- `node scripts/pp5-wave0-check.mjs`: reports 3 blockers: staging secret, ArgoCD app, DNS/HTTP health.
- `curl -fsS https://staging-crm.madfam.io/api/health`: failed; DNS does not resolve `staging-crm.madfam.io`.
- `kubectl get ns phyne-crm-staging`: passed after namespace creation.
- `kubectl -n phyne-crm-staging get secret phyne-crm-staging-secrets`: failed; secret not present.
- `kubectl -n argocd get application phyne-crm-staging`: failed; ArgoCD Application not installed.

## Wave 1 - Low-Mutation Webhook Probes

These validate signature, routing, and cache-invalidation paths first.

```bash
node scripts/pp5-webhook-probe.mjs list
COTIZA_WEBHOOK_SECRET=... node scripts/pp5-webhook-probe.mjs curl cotiza
FORJ_WEBHOOK_SECRET=... node scripts/pp5-webhook-probe.mjs curl forj
JANUA_TELEMETRY_WEBHOOK_SECRET=... node scripts/pp5-webhook-probe.mjs curl janua-telemetry
```

Use `send` instead of `curl` when the platform route is live and the provider
team is ready to record evidence:

```bash
COTIZA_WEBHOOK_SECRET=... node scripts/pp5-webhook-probe.mjs send cotiza
```

Required outcome:

- Signed staging request returns `200`.
- Same payload with the wrong secret returns `401`.
- Production PhyneCRM receives no staging probe rows or cache effects.

## Wave 2 - Mutating Webhook Probes

Run these by provider, in parallel, after the staging DB is seeded enough for
the target flow.

```bash
JANUA_WEBHOOK_SECRET=... node scripts/pp5-webhook-probe.mjs send janua
TEZCA_WEBHOOK_SECRET=... node scripts/pp5-webhook-probe.mjs send tezca-interest
TEZCA_WEBHOOK_SECRET=... node scripts/pp5-webhook-probe.mjs send tezca-newsletter
DHANAM_WEBHOOK_SECRET=... node scripts/pp5-webhook-probe.mjs send dhanam
FORTUNA_WEBHOOK_SECRET=... node scripts/pp5-webhook-probe.mjs send fortuna
PRAVARA_WEBHOOK_SECRET=... node scripts/pp5-webhook-probe.mjs send pravara
PHYNE_CRM_EVENTS_SECRET=... node scripts/pp5-webhook-probe.mjs send routecraft
CEQ_WEBHOOK_SECRET=... node scripts/pp5-webhook-probe.mjs send ceq
COFORMA_WEBHOOK_SECRET=... node scripts/pp5-webhook-probe.mjs send coforma
```

Engagement probes need a real staging engagement ID:

```bash
PHYNE_ENGAGEMENT_EVENTS_SECRET=... node scripts/pp5-webhook-probe.mjs send engagement-event --engagement-id <staging-engagement-id>
PHYNE_ENGAGEMENT_EVENTS_SECRET=... node scripts/pp5-webhook-probe.mjs send engagement-artifact --engagement-id <staging-engagement-id>
```

Required outcome:

- Expected staging rows/jobs/audit entries exist.
- Drip email sends only to allowed test domains.
- No production records, payments, emails, grants, artifacts, or provider rows
  are created.

## Wave 3 - Outbound Integrations

Run after receiver teams confirm their staging endpoints and secrets.

| Lane | Trigger | Evidence |
|---|---|---|
| Karafiel grant award | Move a staging grant application to awarded. | Karafiel staging receives `grant.awarded`; prod Karafiel stays unchanged. |
| Karafiel compliance reads | Send Fortuna staging `grant.discovered`. | Worker reads staging Karafiel compliance API with `KARAFIEL_API_KEY`. |
| Cotiza engagement projection | Create/update/archive a staging engagement. | Cotiza staging receives `/api/v1/webhooks/phynecrm/engagements`. |
| Dhanam referral reward | Convert a staging referral. | Dhanam staging receives `/v1/referral/reward`; no real reward is applied. |

## Signoff Evidence

Each provider ticket must attach:

- Probe command or producer event ID.
- PhyneCRM staging response status/body.
- Staging DB/audit evidence.
- Provider staging evidence.
- Explicit production isolation check.
- Rollback plan for the provider registration.
