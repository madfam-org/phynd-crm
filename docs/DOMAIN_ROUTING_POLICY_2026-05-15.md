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
