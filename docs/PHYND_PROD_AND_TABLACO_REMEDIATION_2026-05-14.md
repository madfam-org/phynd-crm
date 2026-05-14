# Phynd production and Tablaco fulfillment remediation roadmap

Last updated: 2026-05-14

## Scope

Phynd must first be fully operational at `https://phynd.app`, then expose MADFAM's tenant/slice at `https://crm.madfam.io`. Tablaco should only enter Phynd as a client-facing priced engagement after Cotiza/Yantra/ForgeSight return a truthful quote.

## Current evidence

- `http://phynd.app` serves Porkbun parking.
- `https://phynd.app` and `https://www.phynd.app` fail TLS handshake from `curl`.
- Enclii Cloudflare DNS lookup for `phynd.app` reports no Cloudflare zone.
- Enclii Porkbun adapter is unconfigured, so Enclii cannot yet inspect or modify Porkbun DNS.
- `crm.madfam.io` has a Cloudflare CNAME to the Enclii production tunnel.
- The Enclii tunnel routes `crm.madfam.io` to `http://phyne-crm-web.phyne-crm.svc.cluster.local:80`.
- The public `https://crm.madfam.io` endpoint returns Cloudflare 502.
- Enclii project inventory does not list `phynd` or `phyne-crm`.
- Local tests pass for onboarding, checkout, payment reconciliation, portal checkout/payment state, and worker production dispatch.
- Production-dispatch HTTP tests were blocked by workspace resolution for `@phynd/db/schema`; the services Vitest config now aliases the workspace DB package directly.

## Production gap

Phynd has substantial application-level implementation, but neither `phynd.app` nor `crm.madfam.io` is currently a healthy production surface.

## Remediation plan

1. Onboard or reconcile the Phynd/Phyne CRM service into Enclii project inventory.
2. Configure the Porkbun provider adapter or transfer `phynd.app` DNS authority into Cloudflare/Enclii.
3. Route `phynd.app` and `www.phynd.app` to the Phynd production web service.
4. Add and verify `https://phynd.app/api/health`.
5. Fix `crm.madfam.io` 502 by reconciling the target service, namespace, readiness, and tunnel route.
6. Keep `crm.madfam.io` as the MADFAM tenant slice only after `phynd.app` is healthy.
7. Replace hardcoded `madfam` assumptions with host-derived tenant resolution where needed, keeping local/dev fallback safe.
8. Verify Janua magic links, portal session cookies, Dhanam checkout, Dhanam webhooks, and production dispatch under both domains.
9. Link Tablaco quotes to Phynd only when Cotiza returns `client_ready=true`.

## Acceptance gates

- `https://phynd.app` serves Phynd over valid TLS.
- `https://phynd.app/api/health` returns healthy.
- `https://crm.madfam.io` serves the MADFAM tenant without 502.
- Portal magic links redirect to the correct host.
- Quote acceptance, Dhanam checkout, payment reconciliation, and production dispatch tests pass.
- Tablaco engagement pricing remains draft-only until the upstream strict quote is market verified.

## 2026-05-14 follow-up evidence

Current production-domain evidence:

- `https://phynd.app/` fails TLS handshake and is not serving Phynd production.
- `http://phynd.app/` returns HTTP 200 from a generic PHP/openresty parked-style surface, not the Phynd app.
- Enclii Cloudflare DNS read for `phynd.app` reports no Cloudflare zone found.
- Enclii Porkbun read for `phynd.app` reports `adapter_unconfigured`.
- `https://crm.madfam.io/` returns Cloudflare HTTP 502.
- Enclii Cloudflare tunnel maps `crm.madfam.io` to `http://phyne-crm-web.phyne-crm.svc.cluster.local:80`, so the route exists but the origin is not healthy/reachable publicly.

Current local service evidence:

```bash
pnpm --filter @phynd/services test -- client-project-onboarding.service.test.ts dhanam-checkout.service.test.ts payment-reconciliation.service.test.ts production-dispatch-http.service.test.ts
```

Result: 26 tests passed. The service-layer fulfillment path remains locally healthy, but production domain readiness is blocked on provider ownership and route/origin health.
