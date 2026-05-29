# Tenant database strategy (WS1.7)

Phynd CRM uses a **single PostgreSQL database** per deployment tier today.
Host-derived `tenantId` (`crm.madfam.io` → `madfam`, `crm.phynd.app` → `phynd`)
selects branding and service context but does **not** isolate rows until
commercial multi-tenant hardening ships.

## Resolution order (`getDb(tenantId)`)

1. `DATABASE_URL` — default connection (all tenants in one DB for pilot).
2. `DATABASE_URL_<TENANT>` — optional override when set (e.g. `DATABASE_URL_MADFAM`,
   `DATABASE_URL_PHYND`). Uppercase tenant slug from `tenantId`.

When a tenant-specific URL is unset, `getDb()` logs a warning and falls back to
`DATABASE_URL`. This is intentional for the current pilot: one schema, logical
tenant id on rows.

## Pilot (`crm.madfam.io`)

| Setting | Value |
| --- | --- |
| `tenantId` | `madfam` (from host) |
| Connection | `DATABASE_URL` (production secret) |
| `DATABASE_URL_MADFAM` | Optional future split — not required for Phase 0–5 |

## Staging

| Setting | Value |
| --- | --- |
| Database name | `phynd_crm_staging` |
| Role | `phynd_staging` |
| Validator | `node scripts/pp5-validate-staging-env.mjs` |

## Future (Phase 4.7+)

- Commercial `phynd` tenant slice via `DATABASE_URL_PHYND` when row-level isolation
  is insufficient.
- Row-level `tenant_id` column enforcement across CRM tables (flag: `multiTenancy`).

See [`docs/runbooks/PILOT_GO_LIVE.md`](./runbooks/PILOT_GO_LIVE.md) for migrate + secret steps.
