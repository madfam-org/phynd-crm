---
name: verify
description: Boot PhyndCRM locally (no Docker daemon needed) and drive its HTTP surfaces to verify changes end-to-end.
---

# Verify PhyndCRM changes at the HTTP surface

## Boot infra (no Docker daemon required)

Postgres 16 + Redis are usually installed as system packages:

```bash
# Postgres must not run as root — use the postgres system user + a /tmp datadir
PGDIR=/tmp/pgv; mkdir -p $PGDIR && chown postgres:postgres $PGDIR && chmod 700 $PGDIR
su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/initdb -D $PGDIR/data -U phynd --auth=trust -E UTF8 > $PGDIR/initdb.log 2>&1 \
  && /usr/lib/postgresql/16/bin/pg_ctl -D $PGDIR/data -l $PGDIR/pg.log -o '-p 5432 -k /tmp' start"
psql -h 127.0.0.1 -U phynd -d postgres -c "create database phynd_crm;"
redis-server --daemonize yes --port 6379
```

## Migrate + run web

```bash
cd packages/db && DATABASE_URL="postgresql://phynd@127.0.0.1:5432/phynd_crm" pnpm db:migrate
```

`getEnv()` (packages/config/src/env.ts) requires: DATABASE_URL, REDIS_URL,
AUTH_SECRET (>=16 chars), AUTH_JANUA_ISSUER/CLIENT_ID/CLIENT_SECRET, and the
six federation URLs (JANUA_API_URL, JANUA_TELEMETRY_API_URL, DHANAM_API_URL,
COTIZA_API_URL, PRAVARA_BASE_URL, FORJ_API_URL) — placeholder https URLs are
fine. Add feature secrets your change needs (e.g.
PHYND_CONSENT_EVENTS_SECRET, PHYND_CAMPAIGN_IMPORT_SECRET,
RESEND_WEBHOOK_SECRET). Then:

```bash
cd apps/web && pnpm dev   # ~2s ready; GET /api/health → {"status":"ok"}
```

Middleware allows all `/api/*` unauthenticated — API routes are drivable
without an OIDC session.

## Driving signed endpoints

- **MADFAM HMAC routes** (`/api/v1/**`, `/api/webhooks/*` except resend):
  headers `x-webhook-signature: hex(hmac-sha256(secret, rawBody))` and
  `x-webhook-timestamp: <ISO now>` (5-min replay window).
- **Resend webhook** (`/api/webhooks/resend`): Svix scheme — headers
  `svix-id`, `svix-timestamp` (unix seconds), `svix-signature:
  v1,base64(hmac-sha256(base64decode(whsec key), "{id}.{ts}.{body}"))`.
- Seed contacts/campaigns with plain SQL (`psql -h 127.0.0.1 -U phynd
  phynd_crm`); table ids are text, so readable ids like `contact-e2e-1`
  work everywhere the route doesn't zod-check `.uuid()` (tRPC does,
  webhook routes don't).

## Flows worth driving

- Consent: capture (double opt-in) → GET confirm_url → check → send gate
  (`POST /api/v1/campaigns/send`) → suppression add → send gate again
  (expect suppressed). Check `campaign_buyer_signals`, `consent_audit`,
  `suppression_entries` rows after.
- Tracking: svix-signed `email.opened/clicked/bounced/complained` →
  `campaign_email_events` (+ buyer signals when the campaign has a
  `sku_key`; + suppression on bounce/complaint). Replay the same svix-id to
  confirm dedup.

## Gotchas

- Rate limiting is fail-closed: Redis must be up or every webhook 429s.
- No RESEND_API_KEY → emails skip gracefully (`confirmation_email_sent:
  false`) — fine for verification.
- `attemptTulanaSend` flips campaign status to sent/suppressed; reuse a
  fresh campaign row per send-gate scenario.
