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
  on as `AuthContext.userId`. Services store `ctx.auth.userId` as the actor.

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
column `users.external_janua_id` (unique) links a CRM user row to a Janua
subject. Contacts and leads carry their own `external_janua_id` for customers
who are also Janua users.

Two kinds of columns hold an actor:

- **Foreign keys to `users.id`:** `activities.owner_id`, `notifications.user_id`,
  and `owner_id` on contacts, leads, opportunities, quotes, orders, engagements
  and grant applications. Owner pickers in the UI write `users.id` here.
  The database rejects a value that is not an existing `users.id`.
- **Free-text actor columns:** `notes.author_id`,
  `stage_transitions.transitioned_by`, `ai_kanban_suggestions.reviewed_by`,
  `campaign_authorizations.requested_by` / `decided_by`,
  `grant_applications.hitl_approved_by`, `grant_signal_audit.actor`,
  `consent_audit.actor`, `referral_codes.owner_janua_id`,
  `referrals.referrer_janua_id`, and the `published_by`, `configured_by`,
  `accepted_by` and `resolution.*_by` keys in `engagement_events.metadata`.
  These now hold the Janua subject of the acting user.

**Known gap.** Some code compares the session user id with the foreign-key
columns: `listMine`, `notifications.list` / `unreadCount` / `markAllAsRead`,
`ActivitiesService.create`, and `contacts.bulkCreate`. These only line up for a
user whose `users.id` equals their Janua `sub`. Nothing provisions such rows
today, and the admin `users.create` procedure does not set
`external_janua_id`. Resolving the Janua `sub` to `users.id` through
`external_janua_id` (or provisioning rows with `id = sub`) is a separate change,
because it decides who becomes a CRM user.

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
