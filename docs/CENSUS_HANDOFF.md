# Creator-census hand-off

Agencies curate creators in the creator census; the deals that follow live in
the CRM. When an agency hands a curated pick to its CRM, the census publishes
`census.pick.handed_off` on the ecosystem bus, and the worker turns it into a
contact and a lead in that agency's CRM tenant.

**Status:** the consumer is built and **off by default**. The census does not
publish `census.pick.handed_off` yet, and the event is not yet in the
ecosystem registry (`internal-devops` `ecosystem/event-schemas.yaml`); both are
needed before it is turned on.

## Consumer

| | |
| --- | --- |
| Code | `packages/services/src/census/` (`census-event-consumer.ts`, `census-event-schema.ts`, `census-handoff.ts`, `census-tenant-store.ts`, `census-config.ts`); started from `apps/worker/src/census-events.ts` |
| Stream | `madfam:census-events` (Redis Streams) |
| Consumer group | `phynd-crm-consumers` (one group per consuming service, created from `0` with `MKSTREAM`) |
| Events handled | `census.pick.handed_off`, `census.optout.completed`; other census events are acknowledged and ignored |
| Retries | a failed event stays pending and is reclaimed with `XAUTOCLAIM` after 60 s idle (checked every 30 s while running and at start) |
| Dead letters | `madfam:census-events-dlq`: after 3 failed deliveries, or at once for an invalid event. A dead letter holds the stream id, event type, event id and the reason, never the payload |
| Idempotency | one `webhook_events` row per applied event (provider `creator-census`, the event id, list id, stage and time; never a channel id), checked under a transaction-scoped advisory lock on the event id |
| Logs | `worker:census-events`, one `census event` line per entry with its `outcome` (`created`, `updated`, `duplicate`, `opted_out`, `skipped_unmapped`, `ignored`, `rejected`, `retry_pending`, `dead_lettered`) and a running count. Stream ids, event ids and tenant ids only, never an organization id or a channel id |

The bus convention (group, DLQ name, 3 attempts) is the one
`packages/services/src/events/billing-event-consumer.ts` follows. That older
consumer is not started anywhere and only checks the retry count when a
message first fails; this one reclaims while it runs, so the third delivery
really happens.

## Configuration

| Variable | Meaning | Default |
| --- | --- | --- |
| `PHYND_CRM_CENSUS_CONSUMER_ENABLED` | The consumer runs only when this is exactly `true` | unset (off) |
| `PHYND_CRM_CENSUS_ORG_TENANTS` | The allowlist: `<janua_org_id>=<tenant_id>` pairs, comma-separated | empty |
| `DATABASE_URL_<TENANT>` | The database of each tenant in the allowlist (required, and must differ from `DATABASE_URL`) | none |
| `PHYND_CRM_CENSUS_REDIS_URL` | The bus Redis, when it is not the worker's `REDIS_URL` | `REDIS_URL` |
| `PHYND_CRM_DEFAULT_TASK_OWNER_ID` | Owner of the follow-up task (the worker needs it too; see System task owner in AGENTS.md) | empty |

A malformed value refuses the configuration: the worker logs
`census event consumer NOT started: configuration refused` with the reason (the
variable and entry number, never the organization id) and the other workers
keep running.

## Tenancy: the allowlist

The census sends the agency's Janua organization id (`org_id`). The CRM keeps
no tenant column: a tenant is its own database (`getDb(tenantId)` reads
`DATABASE_URL_<TENANT>`). So:

- An organization becomes a CRM tenant **only** through
  `PHYND_CRM_CENSUS_ORG_TENANTS`. There is no lookup, no default and no host
  rule.
- A hand-off from an organization that is not listed is acknowledged and
  counted as `skipped_unmapped`. Nothing is written to any tenant.
- The default tenant (`DEFAULT_TENANT_ID`, and the built-in `madfam`) can never
  be listed, and every listed tenant must have its own `DATABASE_URL_<TENANT>`
  different from `DATABASE_URL`. Without this check, `getDb()` would fall back
  to the default database when a tenant's URL is missing, and an agency's picks
  would land in the house CRM.
- Whether an agency's CRM workspace is part of what it buys is an owner
  decision. The allowlist makes it explicit either way: a workspace is turned
  on by adding one entry.

Organization ids identify customers, so production sets the allowlist from a
secret, never as plain env in this public repository.

## `census.pick.handed_off`

Published by creator-census through its transactional outbox when an agency
hands a curated pick to its CRM. Envelope as registered for census entries
(`event_type`, `source` = `creator-census`, `correlation_id`, `event_id`,
`schema_version` = `1`, `timestamp`, `payload`). Payload, identifiers only (the
CRM keeps what it receives longer than the platform's 30-day window, so no
title, handle or statistic is sent):

| Key | Rule |
| --- | --- |
| `org_id` | required; the agency's Janua organization id |
| `list_id` | required |
| `list_name` | required, 1 to 120 characters, one line |
| `platform` | required; `youtube` |
| `external_id` | required; a YouTube channel id (`UC` + 22 characters) |
| `channel_url` | required; `https://www.youtube.com/channel/<external_id>` (or `youtube.com`), no query, fragment, port or credentials. A handle URL is refused |
| `stage` | required; `shortlisted`, `approached`, `in_talks`, `allied` or `passed` |
| `handed_off_by` | required; the Janua `sub` of the agency user. Checked, not stored on the lead |
| `note` | optional, at most 2000 characters; `null` or blank = no note |
| `occurred_at` | required; ISO 8601 date-time with a zone |
| `event_id` | required; a UUID equal to the envelope's `event_id` |

Any other key, or any value outside these rules, makes the event invalid: it
goes to the dead-letter stream and nothing of it is written.

### What a mapped hand-off writes

All in one transaction in the mapped tenant:

- a **contact** named `YouTube · <channel id>` (the census sends no title or
  handle; staff can rename it);
- a **lead** in the default pipeline's first stage, source `creator-census`,
  with `attribution.census`: organization, list id, list name, stage, platform,
  channel id, channel URL, the event id and `occurred_at` of the last hand-off
  applied. The lead page shows list, stage and channel in its Attribution card;
- the agency's **note**, as a note on the lead written by
  `service:creator-census` and headed «Nota de la agencia (lista «…» del censo
  de creadores)»;
- one **follow-up task** on the lead, due the next business day at 09:00 Mexico
  City, owned the way lead intake assigns it (the contact's owner, else
  `PHYND_CRM_DEFAULT_TASK_OWNER_ID`, else unassigned with
  `DEFAULT_TASK_OWNER_UNAVAILABLE`); best effort, in a savepoint;
- an `external_references` row (provider `creator-census`, type `census_pick`,
  external id `youtube:<channel id>`, metadata `{ org_id, list_id, contact_id }`)
  that finds the lead again.

A redelivery of the same `event_id` writes nothing. A second hand-off of the
same channel by the same organization updates that lead instead of creating
another: `attribution.census` takes the new stage and list, a finished
activity «Etapa en el censo: … → …» records a stage change, and a new note is
added when the agency wrote one. A hand-off older than the one already applied
(by `occurred_at`) never moves the stage back. The CRM pipeline stage and the
lead status are left to staff. If staff deleted the lead, the next hand-off
opens a new one on the same contact. A tenant without a default pipeline makes
the event fail, retry and then land in the dead-letter stream.

## `census.optout.completed`

When a creator opts out of the census, the census asks every consumer to stop
holding what it has about the channel. The CRM applies it in every tenant of
the allowlist (the event carries no organization). For each pick of the
channel:

- the lead's `attribution.census` loses `platform`, `external_id` and
  `channel_url` and gains `opted_out_at`; list, stage and event ids stay;
- the channel id and URL are replaced with «[retirado del censo]» in the notes
  the census consumer wrote;
- the contact's name is replaced with «YouTube · canal retirado del censo»
  while it is still the name derived from the channel id (a name staff chose is
  kept);
- the `external_references` link is deleted;
- a finished activity «Canal retirado del censo de creadores» records it.

Soft-deleted leads and contacts are purged too, since a soft delete keeps the
row. The lead itself, staff notes, tasks and deals stay: they are the agency's
own record of its work, not census data, and deleting the lead in this
repository is a soft delete that would keep the identifiers anyway. A repeated
opt-out finds no link and changes nothing. A Bluesky opt-out is accepted and
matches nothing.

## Turning it on (a separate change)

1. Register `census.pick.handed_off` in the ecosystem registry and add
   `phynd-crm` to the consumers of `madfam:census-events`.
2. The census publishes the event (its own pull request).
3. For each agency that buys a CRM workspace: a tenant database, migrations
   applied there (`docs/runbooks/apply-migrations.md`), a default pipeline.
4. Worker environment: `PHYND_CRM_CENSUS_CONSUMER_ENABLED=true`, the allowlist
   and each `DATABASE_URL_<TENANT>` from the secret store,
   `PHYND_CRM_DEFAULT_TASK_OWNER_ID` (today mounted on the web Deployment only),
   and egress from the worker to the bus Redis.
