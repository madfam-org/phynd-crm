# PP.5 Handoff Execution Runbook

> Last Updated: 2026-05-07 local / 2026-05-08 UTC
> Full remediation plan: [`docs/PP_5_FULL_REMEDIATION_PLAN.md`](./PP_5_FULL_REMEDIATION_PLAN.md)
> Matrix: [`docs/PP_5_PROVIDER_HANDOFF_MATRIX.md`](./PP_5_PROVIDER_HANDOFF_MATRIX.md)
> Session wrap-up: [`docs/PP_5_SESSION_WRAPUP_2026_05_07.md`](./PP_5_SESSION_WRAPUP_2026_05_07.md)

## Wave 0 - Platform Bootstrap

Run these before provider teams send synthetic events.

```bash
node scripts/pp5-staging-audit.mjs
node scripts/pp5-generate-staging-env.mjs --output /secure/path/phynd-crm-staging.env
node scripts/pp5-validate-staging-env.mjs /secure/path/phynd-crm-staging.env --print-apply-command
pnpm pp5:stability
node scripts/pp5-wave0-check.mjs
curl -fsS https://staging-phynd.app/api/health
kubectl -n phynd-crm-staging get secret ghcr-credentials
kubectl -n phynd-crm-staging get secret phynd-crm-staging-secrets
```

Required outcome:

- The audit script passes.
- Generated env values have every `REPLACE_ME_*` value replaced by the secrets owner, and the validator passes before any Kubernetes secret apply.
- `staging-phynd.app` resolves to the staging PhyndCRM web service.
- `ghcr-credentials` exists in `phynd-crm-staging` so private GHCR images can be pulled.
- `phynd-crm-staging-secrets` exists and contains staging-only values.
- ArgoCD app `phynd-crm-staging` is synced and healthy.
- Web and worker rollouts are ready.

Observed from this workspace on 2026-05-07 local / 2026-05-08 UTC:

- `node scripts/pp5-staging-audit.mjs`: passed.
- `node scripts/pp5-generate-staging-env.mjs`: available for staging-only env generation; operator-owned values still required.
- `node scripts/pp5-validate-staging-env.mjs /private/tmp/phynd-crm-staging.env`: correctly blocked the generated scaffold until all `REPLACE_ME_*` values are replaced.
- `pnpm pp5:stability`: verifies env-chain split gates and production-template parity before rollout.
- `node scripts/pp5-wave0-check.mjs`: now verifies the staging overlay render,
  namespace, GHCR pull secret, app secret, ArgoCD app/sync, web rollout,
  worker rollout, and DNS/HTTP health.
- `kubectl kustomize infra/k8s/overlays/staging`: passes after making the
  staging overlay self-contained for ArgoCD default load restrictions.
- `kubectl -n phynd-crm-staging get secret ghcr-credentials`: passed after
  mirroring the existing production GHCR pull secret into staging without
  printing secret data.
- `curl -fsS https://staging-phynd.app/api/health`: failed; DNS does not resolve `staging-phynd.app`.
- `kubectl get ns phynd-crm-staging`: passed after namespace creation.
- `kubectl -n phynd-crm-staging get secret phynd-crm-staging-secrets`: failed; secret not present.
- `kubectl -n argocd get application phynd-crm-staging`: passed after applying
  `infra/argocd/phynd-crm-staging-application.yaml`.
- `kubectl -n argocd wait --for=jsonpath={.status.sync.status}=Synced application/phynd-crm-staging --timeout=30s`: passed after the
  self-contained overlay fix.
- Current pod blocker is `secret "phynd-crm-staging-secrets" not found`; image
  pull is no longer the active blocker after `ghcr-credentials` was mirrored.

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
- Production PhyndCRM receives no staging probe rows or cache effects.

## Wave 1.5 - CRM Onboarding Dry Run

Run after Wave 0 passes and before provider teams perform mutating probes.

1. Open:

```text
https://staging-phynd.app/engagements
```

2. Use **Onboard Client Project** to create three synthetic engagements:

| Scenario | Project kind | Delivery tracks | Production order |
|---|---|---|---|
| Digital | `digital` | `digital_experience` | No |
| Physical | `physical` | `fabrication`, `fulfillment` | Yes |
| Phygital | `phygital` | `fabrication`, `digital_twin`, `kiosk` | Yes |

3. Verify for each engagement:

- Contact exists.
- Reusing the same synthetic client email does not create a duplicate contact;
  the active contact is reused and missing profile fields are filled.
- Opportunity is in the selected pipeline/stage.
- Engagement detail page opens.
- Quote artifact appears in the engagement artifact list.
- `system:intake_created` appears in the engagement timeline.
- If production order was requested, order exists and
  `system:production_order_created` appears in the timeline.

4. From `/quotes`, accept one synthetic quote with **Accept & Confirm**.

5. Verify:

- Quote status is `accepted`.
- A confirmed order exists for that quote, or the existing pending order was
  confirmed.
- The linked opportunity is `won`.
- `system:quote_approved` appears in the engagement timeline.

6. From the Janua-backed client portal, open the engagement and submit the
   quote payment action for one `sent` or `accepted` quote.

7. Verify:

- PhyndCRM redirects to a Dhanam sandbox checkout URL.
- A Dhanam `checkout_session` external reference exists for the quote.
- An `invoice` engagement artifact points at the checkout URL.
- `system:checkout_created` appears in the engagement timeline.

8. Send one staging-only Dhanam paid webhook for the accepted quote/order.

9. Verify:

- Order `paymentStatus` is `paid` or `partial`, depending on the synthetic
  amount.
- Order `paidAmount`, `paidAt`, `paymentProvider=dhanam`, and
  `externalPaymentId` are populated.
- A Dhanam payment `external_references` row exists for the order.
- `system:payment_reconciled` appears in the engagement timeline.
- If the payment cannot be matched, `system:payment_unmatched` appears with
  `blocked` status for operator recovery.
- When payment completes the order, `system:production_dispatch_requested`
  appears once per onboarding delivery track and order-level external
  references exist with `externalType=production_dispatch`.
- The worker `production-dispatch` queue sends live provider handoffs from
  those references. Verify the reference metadata moves to
  `dispatch_status=sent` and `system:production_dispatch_sent` appears. A
  provider error leaves `dispatch_status=retry` and emits
  `system:production_dispatch_failed`.
- If delivery tracks cannot be inferred, `system:production_dispatch_blocked`
  appears and the order requires operator routing before provider dispatch.

10. Send one staging-only Dhanam refund or failure lifecycle webhook for the
    same quote/order.

11. Verify:

- Order `paymentStatus` changes to the expected lifecycle state, such as
  `partial_refund`, `refunded`, `failed`, `disputed`, or `cancelled`.
- Refund events reduce `paidAmount` when a refund amount is present.
- A Dhanam lifecycle `external_references` row exists for the order.
- The matching `system:payment_<state>` timeline event appears.
- If the lifecycle event cannot be matched, `system:payment_<state>_unmatched`
  appears with `blocked` status for operator recovery.

12. Attach evidence to the PP.5 signoff packet:

- Engagement IDs.
- Quote IDs.
- Order IDs where applicable.
- Dhanam staging checkout session IDs.
- Dhanam staging event IDs.
- Dhanam staging lifecycle event IDs.
- Screenshot or exported row evidence from staging only.

Required outcome:

- The CRM can create quote-ready digital, physical, and phygital project
  skeletons and advance at least one accepted quote to confirmed-order
  readiness, then reconcile a paid Dhanam event onto that order without direct
  database writes.
- No production CRM or provider records are touched.

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
PHYND_CRM_EVENTS_SECRET=... node scripts/pp5-webhook-probe.mjs send routecraft
CEQ_WEBHOOK_SECRET=... node scripts/pp5-webhook-probe.mjs send ceq
COFORMA_WEBHOOK_SECRET=... node scripts/pp5-webhook-probe.mjs send coforma
```

Engagement probes need a real staging engagement ID:

```bash
PHYND_ENGAGEMENT_EVENTS_SECRET=... node scripts/pp5-webhook-probe.mjs send engagement-event --engagement-id <staging-engagement-id>
PHYND_ENGAGEMENT_EVENTS_SECRET=... node scripts/pp5-webhook-probe.mjs send engagement-artifact --engagement-id <staging-engagement-id>
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
| Cotiza engagement projection | Create/update/archive a staging engagement. | Cotiza staging receives `/api/v1/webhooks/phyndcrm/engagements`. |
| Dhanam referral reward | Convert a staging referral. | Dhanam staging receives `/v1/referral/reward`; no real reward is applied. |

## Signoff Evidence

Each provider ticket must attach:

- Probe command or producer event ID.
- PhyndCRM staging response status/body.
- Staging DB/audit evidence.
- Provider staging evidence.
- Explicit production isolation check.
- Rollback plan for the provider registration.
