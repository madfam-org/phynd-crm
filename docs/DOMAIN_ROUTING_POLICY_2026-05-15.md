# PhyndCRM domain routing policy

Date: 2026-05-15

## Canonical domains

- `https://phynd.app` is the public Phynd landing and demo surface.
- `https://crm.madfam.io` is the MADFAM-labelled tenant slice. It must not serve the generic Phynd landing page.
- `https://crm.phynd.app` is the generic authenticated PhyndCRM app host for non-MADFAM tenants.

## Required runtime behavior

- `phynd.app/` serves public marketing content.
- `phynd.app/demo` creates a demo session and redirects to `https://phynd.app/overview`.
- `crm.madfam.io/` redirects unauthenticated visitors to `/login`, where Janua SSO is the only entry point.
- `crm.madfam.io/` redirects authenticated visitors to `/overview`.
- `crm.phynd.app/` follows the same authenticated app-host behavior for non-MADFAM tenants.

## Implementation notes

- Host classification lives in `apps/web/src/lib/http/app-host.ts`.
- Middleware enforces app-host root redirects before public-path handling.
- Login copy is host-aware: MADFAM slice users see MADFAM Janua SSO language, while generic app users see generic Janua SSO language.
- Public GitHub links must point to `https://github.com/madfam-org/phynd-crm`.
- The marketing dashboard preview must use `phynd.app`, not the retired `phynd.io` copy.

## Status-page expectations

- `status.madfam.io` should treat `phynd.app` as the public landing.
- `status.madfam.io` should assert that `crm.madfam.io` reaches the MADFAM Janua SSO login surface, not a generic landing.
- `status.madfam.io` should track `crm.phynd.app` as the generic app host. Until DNS and Enclii routing exist, that entry should truthfully show outage rather than being hidden or represented by `app.phynd.app`.

## 2026-05-15 live verification note

- `https://phynd.app/` returns HTTP 200 and includes the canonical repository link `https://github.com/madfam-org/phynd-crm`.
- `https://crm.madfam.io/` redirects unauthenticated visitors to `/login` and renders `MADFAM CRM` with `Sign in with your MADFAM Janua SSO account`.
- `https://crm.phynd.app/` resolves publicly through Cloudflare and reaches the generic PhyndCRM app route.
- `https://status.madfam.io/` is still serving the older 60-service projection; the corrected PhyndCRM status entries need status-regeneration and production promotion before the public page reflects this policy.

## 2026-05-27 live verification note

See
[`CODEBASE_AND_PROD_EVIDENCE_2026-05-27.md`](CODEBASE_AND_PROD_EVIDENCE_2026-05-27.md)
for the full command evidence.

- `https://phynd.app/` and `https://www.phynd.app/` return HTTP 200 through
  Cloudflare.
- `https://phynd.app/api/health` returns
  `{"status":"ok","service":"phynd-crm","version":"0.1.0"}`.
- `https://phynd.app/demo` returns HTTP 307 to
  `https://phynd.app/overview` and the followed dashboard renders seeded demo
  metrics.
- `https://crm.madfam.io/` returns HTTP 307 to `/login`; `/login` renders
  `MADFAM CRM` and the MADFAM Janua SSO copy.
- `https://crm.phynd.app/` returns HTTP 307 to `/login`; `/login` renders
  generic Phynd Janua SSO copy.
- Enclii project junctions currently list `phynd.app`, `www.phynd.app`,
  `crm.madfam.io`, and `app.phyne.app`. They do not list `crm.phynd.app`, even
  though that public host responds. Reconcile the Enclii service-domain registry
  and project junction inventory before treating status-page projection as fully
  source-of-truth.
- `.enclii.yml` declares `app.phynd.app`, `admin.phynd.app`, and
  `api.phynd.app`, but these were not observed in the project junction list.
- Auth.js provider metadata remains a routing/auth gap:
  `/api/auth/providers` still reports Janua signin/callback URLs on an internal
  `phynd-crm-web-...:3000` pod hostname.

## Addendum 2026-08-12 — holding redirect on `crm.phynd.app`

Tenancy intent is unchanged: `crm.madfam.io` is the MADFAM-internal CRM;
`crm.phynd.app` is where external client tenants' CRM will live. But no
non-MADFAM tenant is live yet, and a host with no users kept catching real
sign-ins via stale bookmarks and old emails (see
`SSO_LEAD_FLOW_INCIDENT_2026-08-12.md`).

Until the first client tenant onboards:

- Browser traffic on `crm.phynd.app` (every non-`/api` path) is **301'd to
  `crm.madfam.io`**, path and query preserved. Implemented in app middleware
  (`getDormantClientHostRedirect` in `apps/web/src/lib/http/app-host.ts`),
  not at the Cloudflare edge, so it is versioned, tested, and reverted by
  deleting one function and its call.
- `/api/*` on `crm.phynd.app` keeps serving: webhook producers and OAuth
  machinery do not follow redirects, and a 301 downgrades POST to GET.
- The multi-tenant host architecture (host-derived tenantId, per-host auth
  origin, Janua redirect URIs) is intentionally untouched.

**Revert condition**: first non-MADFAM tenant goes live on `crm.phynd.app` —
delete `getDormantClientHostRedirect`, its middleware call, and its tests.

