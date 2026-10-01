# Identity: who the acting user is

This page defines the user id that Phynd CRM records as "who did this", and how it
relates to the CRM `users` table.

## The session user id is the Janua subject

A staff user signs in through Auth.js v5 with Janua as the OIDC provider
(`apps/web/src/lib/auth/config.ts`). Sessions use the JWT strategy, with no
database adapter.

- `session.user.id` is the Janua OIDC **`sub`** claim, the Janua user id. It is
  the same for a user across sign-ins, devices and browsers.
- The `jwt` callback sets it at sign-in from `profile.sub`, after checking that
  it equals `account.providerAccountId`. A sign-in without a `sub`, or with a
  mismatch, is refused. No session is created with an unstable id.
- The callback stores the subject in the session token as `token.sub` and
  `token.januaSub`. Later calls (session reads, middleware) leave it unchanged.
- `resolveAuthContext()` (`apps/web/src/lib/trpc/request-context.ts`) passes it
  on as `AuthContext.userId` and `AuthContext.januaSub`, and resolves the linked
  CRM user (below).

Why the callback has to do this: in its OAuth callback, Auth.js v5 deliberately
replaces the provider's user id with `crypto.randomUUID()`. It keeps the provider
id only as `account.providerAccountId`. Without an adapter, the default
`token.sub` is therefore a new random value at every sign-in. Before the fix,
`session.user.id` was that random value, so each login acted as a different
user. `apps/web/src/lib/auth/__tests__/janua-sign-in.test.ts` drives the full
sign-in flow against a stub Janua issuer and pins the stable id.

**Sessions minted before the fix** carry no `januaSub`. The `jwt` callback drops
them, so the user is sent to `/login` once and comes back with the stable id.

### Non-human principals

Some actors are not Janua users. They keep their own fixed ids, which never
collide with a Janua `sub`:

| Principal | `userId` | Where |
| --- | --- | --- |
| Selva / service token | `service:selva` (`FEDERATION_SERVICE_USER_ID`, must stay `service:*`) | `createServiceAuth()` — see [SELVA_CRM_AGENT_TOOLS.md](./SELVA_CRM_AGENT_TOOLS.md) |
| Worker jobs | `system`, `service:email-drip` | `apps/worker/src/processors/*` |
| Local dev bypass | `dev-user` (development only) | `DEV_AUTH` |
| Demo visitors | `demo-{sessionId}` | `createDemoAuth()` — see [ADR 007](./adr/007-demo-mode-strategy.md) |

## How Janua subjects map to CRM `users` rows

The `users` table is keyed by a CRM-generated id (`users.id`, a UUID). The
column `users.external_janua_id` (unique index `users_external_janua_id_uniq`)
links a CRM user row to a Janua subject. Contacts and leads carry their own
`external_janua_id` for customers who are also Janua users.

CRM users are deliberate: **signing in never creates a CRM user.** An admin
creates the user and links it to the person's Janua subject.

### Resolution per request

`resolveAuthContext()` (`apps/web/src/lib/trpc/request-context.ts`) looks up
`users.id WHERE external_janua_id = <Janua sub>` once per request, through
`crmUserResolver` (`packages/services/src/identity/crm-user-resolver.ts`). The
result, including "not linked", is cached per tenant and subject for 30 seconds
(bounded, oldest entries evicted). `users.linkJanua`, `users.unlinkJanua`,
`users.create` and `users.delete` invalidate the entry in the process that ran
them; other web replicas pick the change up when their entry expires. A
database error is not cached and fails the request.

`AuthContext` then carries:

| Field | Value |
| --- | --- |
| `userId` | the Janua `sub` (unchanged; used by auth checks and service-actor detection) |
| `januaSub` | the Janua `sub`; present only for Janua sessions |
| `crmUserId` | the linked `users.id`, or `null` when the identity is not linked; absent for non-Janua principals |

### Foreign keys and per-user reads use `crmUserId`

These columns are foreign keys to `users.id`: `activities.owner_id`,
`notifications.user_id`, and `owner_id` on contacts, leads, opportunities,
quotes, orders, engagements and grant applications. Every write of the caller's
own id into them, and every per-user read, goes through `requireCrmUserId(auth)`
(`packages/services/src/identity/actor.ts`):

- `listMine` on contacts, leads, opportunities, quotes, orders and activities;
- `notifications.list`, `unreadCount`, `markAsRead` (now limited to the
  caller's own notifications) and `markAllAsRead`;
- `activities.create`, `contacts.bulkCreate`, and the default owner of
  `engagements.onboardClientProject`.

For an unlinked Janua identity these fail with `CrmUserNotLinkedError`
(`code: 'CRM_USER_NOT_LINKED'`). tRPC returns `PRECONDITION_FAILED` (HTTP 412)
with `data.appCode = 'CRM_USER_NOT_LINKED'` and the message the UI shows:

> Tu cuenta MADFAM aún no está vinculada a un usuario del CRM. Pide a un administrador que la vincule.

The web client shows it as one toast (`apps/web/src/lib/trpc/provider.tsx`),
does not retry those queries, and the notifications menu stops polling and
shows the message with the user's own Janua subject so they can send it to an
admin. Reads that need no CRM user (lists, detail pages, search, analytics)
work as before under the existing roles and scopes.

Non-Janua principals carry no `januaSub` and keep their fixed id in these
paths, as before: `service:selva`, `system`, `service:email-drip`,
`system:janua-webhook`, `dev-user`, `demo-{sessionId}` (demo tenants seed a
`users` row with that id).

### Free-text actor columns: one convention

`notes.author_id`, `stage_transitions.transitioned_by`,
`ai_kanban_suggestions.reviewed_by` (and `source`),
`campaign_authorizations.requested_by` / `decided_by`,
`grant_applications.hitl_approved_by`, `grant_signal_audit.actor`,
`consent_audit.actor`, and the `published_by`, `configured_by`, `accepted_by`
and `resolution.*_by` keys in `engagement_events.metadata` store
`actorIdOf(auth)`:

1. the linked `users.id` (`crmUserId`) when there is one;
2. otherwise the Janua `sub`;
3. otherwise the principal's own id (`service:selva`, `system`, …).

Recording an actor never blocks an action, so an unlinked user can still add a
note; the row then holds their Janua `sub`. Selva-relayed campaign decisions
keep `<operator> (via service:selva)`.

Exception: `referral_codes.owner_janua_id` and `referrals.referrer_janua_id`
are named and used as Janua ids (referral codes are shared outside the CRM), so
they keep the Janua `sub`.

Rows written between 2026-09-30 (`#96`) and this change hold the Janua `sub` in
the free-text columns. Both forms identify the same person: map a `sub` to its
CRM user through `users.external_janua_id`.

### Linking users (admins)

- **Settings → Users** shows each user's link state (`Linked · <first 8
  characters>` or `Not linked`) with **Link Janua identity** / **Unlink Janua
  identity** actions. The link dialog takes a Janua subject and offers the
  admin's own subject when the admin is unlinked.
- tRPC, admin-only: `users.create` accepts `externalJanuaId`;
  `users.linkJanua({ id, januaSub })` and `users.unlinkJanua({ id })`. Linking
  is idempotent for the same pair. A user already linked to another subject
  must be unlinked first, and a subject linked to another user is refused; both
  return `CONFLICT` with a message that says which. Reserved principal ids
  (`service:*`, `demo-*`, `system`, `dev-user`) are rejected as subjects.
- Every link change writes a structured audit log line
  (`services:users:janua-link`, `event: users.janua_link`, `action`, `actor`,
  `tenantId`, `userId`, `januaSub`).
- `users.me` (any signed-in user) returns `{ januaSub, crmUserId, linked }`.

Phynd has no safe Janua lookup by email (the Janua client reads one user by id
with the caller's token), so the input is the Janua subject itself.

### Backfill helper (owner-run)

`scripts/link-janua-users.mjs` lists CRM users with no `external_janua_id` and
validates links supplied as `{ "<users.id>": "<janua sub>" }`. It is a dry-run
in a `BEGIN READ ONLY` transaction unless `--apply` is passed; `--apply` writes
all valid links in one transaction and writes nothing if any requested link is
invalid. It prints counts and the first 8 characters of `users.id` only.

```bash
# dry-run: list unlinked users (local / port-forward)
DATABASE_URL=postgresql://... node scripts/link-janua-users.mjs

# in-cluster, piped from a checkout (break-glass rules apply)
kubectl -n phynd-crm exec -i deploy/phynd-crm-worker -- \
  node --input-type=module - < scripts/link-janua-users.mjs

# validate, then apply, explicit links
… - --links-json '{"<users.id>":"<janua sub>"}' [--apply] < scripts/link-janua-users.mjs
```

No migration is needed: the unique index on `users.external_janua_id` exists
since migration `0000`.

## Damage assessment for the per-login ids

`scripts/audit-session-user-ids.mjs` is read-only. For every actor column above,
it reports how many rows hold a value that matches no known Janua subject,
`users.id`, service principal or demo id. It also reports how many distinct
values there are and the date range. It prints counts and dates only.
Everything runs in one `BEGIN READ ONLY` transaction, which is rolled back.

```bash
# local / port-forward
DATABASE_URL=postgresql://... node scripts/audit-session-user-ids.mjs [--json]

# in-cluster, piped from a checkout (read-only diagnostic; break-glass rules apply)
kubectl -n phynd-crm exec -i deploy/phynd-crm-worker -- \
  node --input-type=module - < scripts/audit-session-user-ids.mjs
```

Both scripts find the `postgres` driver from the repo root, from anywhere by
path, and piped into the worker pod. In the worker image (`pnpm deploy`),
`node_modules/@phynd/db` is a symlink into `node_modules/.pnpm`, and `postgres`
sits next to the symlink's target; the scripts resolve from the real path
(`resolvePostgresPath`, tested in `scripts/__tests__/resolve-postgres.test.mjs`).
Before 2026-10-01 the audit resolved from the link path and failed in the pod
with «cannot resolve the `postgres` package».

Pass `--database-env DATABASE_URL_<TENANT>` to audit a per-tenant database
(see [TENANT_DATABASE_STRATEGY.md](./TENANT_DATABASE_STRATEGY.md)).

How to read the output:

- Foreign-key columns should show **0 unmatched** rows. A random id could never
  be inserted there. For those columns the effect was failed writes, not bad
  rows.
- In a free-text column, many distinct unmatched values with one or two rows
  each is the per-login pattern. Janua subjects and the random ids are both
  UUIDv4, so "unmatched" also includes real Janua users who have no linked
  `users` or `contacts` row.

### Repair options (owner decision; no data fix ships with the code)

- **Recoverable by attribution.** If only one staff user used the CRM during
  the window between `first_at` and `last_at`, every unmatched value in that
  window belongs to that user. A targeted `UPDATE … SET <column> = '<janua sub>'
  WHERE <column> IN (<unmatched values>)` restores ownership. Run it per
  column, in a transaction, after a backup.
- **Recoverable from a stored email.** `referral_codes` and `referrals` have
  `owner_email` and `referred_email` columns, and Selva-relayed
  `campaign_authorizations.decided_by` values carry the operator. The tRPC
  `generateCode` path stores `owner_email = null`, so most referral codes have
  no email.
- **Not recoverable from the database.** `notes.author_id`,
  `stage_transitions.transitioned_by`, `ai_kanban_suggestions.reviewed_by` and
  the `engagement_events` metadata keys store no email or session record. The
  random id was never logged next to the Janua subject. Unless attribution
  applies, leave these rows as an unknown actor before the fix date.
