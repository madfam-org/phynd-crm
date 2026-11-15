# Native MCP (read-only sales pipeline)

Status: **shipped, off by default** (`/mcp` answers 404 until the owner turns it on).

PhyndCRM's native [Model Context Protocol](https://modelcontextprotocol.io) endpoint:
agents and agent fleets read contacts, leads, open tasks and deals through typed
tools that run the SAME service layer as the staff UI and the tRPC API. No second
read path. This first slice is **read-only**.

`POST /mcp` on the web app (outside `/api`; the middleware lets exactly `/mcp`
through without a staff session, and it is never redirected).

Code: `apps/web/src/app/mcp/route.ts`, `apps/web/src/lib/mcp/`.

## Switch (off by default)

`PHYND_CRM_MCP_ENABLED` must be exactly `true`; anything else (unset, `false`,
`TRUE`, `1`) and every method on `/mcp` answers **404** before any header, token
or rate limiter is touched. Read per request. The owner turns it on; agents
never do.

The switch also needs Janua machine tokens configured (`AUTH_JANUA_ISSUER`,
`PHYND_CRM_MACHINE_TENANT_ID`, `PHYND_CRM_MACHINE_JANUA_ORG_ID`, see
[MACHINE_AUTH.md](./MACHINE_AUTH.md)). Switched on without them, `/mcp` stays 404
and the web log carries `web:mcp` event `mcp_not_configured`.

## Transport

Streamable HTTP, stateless, JSON responses only (no SSE stream, no sessions),
JSON-RPC 2.0, one message per POST. Hand-written on the model of the ecosystem's
other native servers (Nauta, Dhanam): four methods, no MCP SDK dependency.

| Request | Answer |
| --- | --- |
| `initialize` | the requested protocol if spoken (`2025-11-25`, `2025-06-18`, `2025-03-26`), else `2025-11-25`; `capabilities.tools`; `serverInfo` `phynd-crm`; instructions |
| `ping` | `{}` |
| `tools/list` | the six tools with input and output schemas, all `readOnlyHint` |
| `tools/call` | `structuredContent` + the same JSON as text; `isError: true` for `invalid_arguments` and `not_found` |
| a notification / a client response | 202, no body |
| a batch (JSON array), not JSON-RPC, unknown `MCP-Protocol-Version` header | 400 |
| not `application/json` / a body over 64 KiB | 415 / 413 |
| an unknown method | JSON-RPC `-32601` |
| an unknown tool | JSON-RPC `-32602` |
| `GET`, `DELETE`, `PUT`, `PATCH`, `OPTIONS` | 405 (404 while off) |

## Auth

A Janua `client_credentials` token in `Authorization: Bearer …` (never a query
string, never a shared static secret). Authentication is the app's existing
machine verifier (`verifyMachineIdentity`, `apps/web/src/lib/trpc/machine-auth.ts`):
RS256 against `<AUTH_JANUA_ISSUER>/.well-known/jwks.json`, issuer, audience
`PHYND_CRM_MACHINE_AUDIENCE` (default `phynd-crm`), `token_use: client_credentials`,
`actor_type: service_account`, `sub = service-account:<client_id>`, lifetime ≤ 1 h.

Authorization is the MCP's own (`apps/web/src/lib/mcp/auth.ts`), and all three hold:

| Check | Rule | Refusal |
| --- | --- | --- |
| Organization | token `org_id` = `PHYND_CRM_MACHINE_JANUA_ORG_ID` | 403 `foreign_organization` |
| Scope | the `scope` claim holds `phynd-crm-pipeline:read`, matched exactly (space-separated tokens, never a prefix) | 403 `insufficient_scope` |
| Readers list | the client id is bound to that organization in `PHYND_CRM_MCP_READ_CLIENTS` | 403 `client_not_allowed` |

`PHYND_CRM_MCP_READ_CLIENTS` = `client-id@org-id,client-id@org-id` (identifiers,
not secrets). Blank = no readers; one malformed or duplicated entry = no readers
at all (fail closed). Consumer clients are provisioned one per consumer, once
the owner names the consumers; who may read the CRM over MCP is the owner's
decision, and none is decided by this code.

The scope is separate from the tRPC machine path in both directions:
`phynd-crm-pipeline:read` is not in `MACHINE_SCOPE_GRANTS` (it opens no tRPC
procedure), and `phynd-crm-engagements:read` opens no MCP tool.

**Tenant.** The caller never chooses it. Every call runs as
`service:<client_id>` in `PHYND_CRM_MACHINE_TENANT_ID`; the Host header, any
other header and every argument are ignored for tenancy (no tool has a tenant
argument). Isolation between tenants is the deployment's database split
([TENANT_DATABASE_STRATEGY.md](./TENANT_DATABASE_STRATEGY.md)).

Answers before JSON-RPC, in order:

1. the source address over 300 requests/minute → **429** (before any token is verified);
2. a browser `Origin` header → **403** `origin_not_allowed` (machine edge, DNS-rebinding defense);
3. no or invalid token (bad signature, expired, wrong claims, no matching key)
   → **401** `WWW-Authenticate: Bearer realm="phynd-crm-mcp", error="invalid_token"`;
   Janua's key set unreachable (network error, timeout, a non-200 or unreadable
   answer) → **503** `verifier_unavailable` with `Retry-After: 30`: an outage is
   not reported as the caller's fault;
4. a valid machine token that fails a check above → **403** (with
   `error="insufficient_scope", scope="phynd-crm-pipeline:read"` for the scope);
5. the client over **60 requests/minute** → **429** with `Retry-After` = the
   seconds left in its window.

Both limits use the app's Redis limiter (`checkApiRateLimit`), shared across
pods, each in a key namespace of its own (`mcp-address`, `mcp-client`) that no
other route's address-keyed limit can reach. Count and expiry are one atomic
Lua call, and a key found without an expiry gets one, so no bucket can stay
closed forever. The limiter **fails closed**: with Redis unreachable, `/mcp`
answers **503** `rate_limiter_unavailable` with `Retry-After: 30`, not 429.

The source address is `CF-Connecting-IP`, else the LAST `X-Forwarded-For`
entry (the one the proxy in front of the app appended), and only when it
parses as an IPv4 or IPv6 address; anything else shares one fixed bucket. The
first `X-Forwarded-For` entry is whatever the caller wrote and is never used.

## Tools

| Tool (wire name) | Catalog name | Runs | Input |
| --- | --- | --- | --- |
| `contacts_search` | `contacts.search` | `ContactsService.list` | `query?` (1–100 chars: name, email or company, literal), `owner_id?`, `cursor?`, `limit?` |
| `contacts_get` | `contacts.get` | `ContactsService.getById` + `ActivitiesService.listRecentForEntity` | `contact_id`, `activity_limit?` |
| `leads_list` | `leads.list` | `LeadsService.list` | `status?`, `source?` (exact), `owner_id?`, `cursor?`, `limit?` |
| `tasks_list_open` | `tasks.list_open` | `ActivitiesService.listRecent` (type `task`, status `pending`, `excludeDeletedParents`) | `owner_id?`, `due_from?`, `due_before?`, `cursor?`, `limit?` |
| `deals_list` | `deals.list` | `OpportunitiesService.list` | `stage_id?`, `pipeline_id?`, `status?`, `owner_id?`, `cursor?`, `limit?` |
| `pipelines_list` | `pipelines.list` | `PipelinesService.list` + `getStages` | none |

Wire names use underscores (Anthropic tool names match `^[a-zA-Z0-9_-]{1,64}$`);
each tool's `title` carries the dotted catalog name.

**Paging.** Cursor-based (`next_cursor` → `cursor`, same filters). The
cursor is always the id of the last row of the previous page. Contacts, leads
and deals are ordered by id; `tasks_list_open` is newest first, by creation
time and then id, so tasks created at the same instant are neither skipped nor
repeated across a page boundary.
A page is 25 rows by default and **at most 50**; a larger `limit` is refused
(`invalid_arguments`), not clamped. `contacts_get` returns at most 50 activities.

**Arguments** are checked against the published input schema before any query
runs; an unknown argument is refused (counted, never echoed).

**Open tasks.** An open task is an activity of type `task` whose status is
`pending`. Status alone is not enough: `pending` is the column default and
nothing completes a note, a logged call or a fabrication update, so those stay
`pending` forever and are never listed as tasks.

**Deleted rows.** Soft-deleted contacts, leads and deals never leave: the tools
call the same `list` / `getById` the UI calls, which filter `deleted_at`. A
deleted contact is `not_found`, and its activities are not read.
`tasks_list_open` leaves out every task whose parent record (contact, lead,
deal, quote or order, all soft-deletable) is soft-deleted, in SQL (one
`NOT EXISTS` per parent table); the staff Activities page still lists them.
What can still leave: a lead or deal keeps the `contact_id` of a contact that
was deleted after it (`contacts_get` answers `not_found` for it).

### Data boundary

Returned: what an operator sees in the lists and on the contact page (names,
emails, phones, companies, lead source/status/score, task title/description/due
date, deal name/value/stage, pipeline and stage names, owner ids).

Never returned, by construction (each record is projected field by field in
`records.ts`, and the output schemas forbid undeclared fields):

- consent state: `marketing_consent`, `consented_at`, `unsubscribed`, the consent
  ledger and its audit trail, the suppression list;
- raw webhook payloads (`webhook_events`), tokens, secrets, session data;
- cross-system identifiers (`external_janua_id`, Coforma ids);
- notes, tags, quotes, orders, payment evidence, campaigns, visitor tracking,
  staff names (rows carry `owner_id` only).

**Masked by default.** Every MCP client reads personal fields masked, whatever
the global `piiMasking` flag says: contact names (`Ana ***`), emails
(`a***@example.com`), phones (`***1234`), preferred names, and the free text of
task titles and descriptions and deal names (`[redacted]`, or the first 12
characters then `…[redacted]`), and companies and lead sources as a whole
(`[redacted]`: nothing of the value is kept, not its first letters nor its
length; an absent value stays `null`). Pipeline and stage names, ids,
statuses, amounts and dates are not masked.

Filtering by a masked field still works. `leads_list` with `source` matches the
stored value exactly, and each returned lead whose stored source equals the
named one carries it as named (the caller already knows it); the projection
checks that equality itself, so no other source is ever returned in clear.
`contacts_search` still matches `query` against the stored company, name and
email; the rows come back masked. The server instructions and the tool
descriptions say what a masked value looks like, so an agent never takes a
masked email for an address. Why: an agent's conversation may leave the
company's infrastructure (a hosted model, a transcript), so full personal data
leaves only by a deliberate owner decision.

The owner grants an exception per client in `PHYND_CRM_MCP_UNMASKED_CLIENTS`
(same `client-id@org-id` format and parser as the readers list; default
empty). Fail safe: unset, empty, malformed, a duplicate, or any entry that is
not also on `PHYND_CRM_MCP_READ_CLIENTS` → nobody is unmasked, and the web log
carries one `mcp_unmasked_clients_ignored` warning for that value. The audit
record of every call carries `masked`.

**Untrusted text.** Names, titles, descriptions, sources and stage names were
typed by people or arrived from outside systems (web forms, webhooks). The
server instructions and every tool description say so: a client must treat them
as data, never as instructions.

## Coverage contract and drift guard

`apps/web/src/lib/mcp/coverage.ts` lists every tRPC procedure of `appRouter` as
COVERED (by which tool, through which service method) or EXEMPT (why).
`__tests__/coverage.guard.test.ts` walks the real router and fails when a
procedure has no entry, an entry names no procedure, a tool covers nothing, or a
mutation is marked covered. Exempt in this slice by decision: every write,
campaign sending and its authorization, and consent/suppression (reads included).

## Audit

One structured log record per request, logger `web:mcp`, event `mcp_call`
(`info`; refusals and failures at `warn`):

```json
{"event":"mcp_call","clientId":"jnc_…","tenantId":"<tenant>","rpcMethod":"tools/call","tool":"contacts_search","outcome":"ok","httpStatus":200,"latencyMs":12.4,"resultCount":3,"args":{"has_query":true,"owner_id":"…","has_cursor":false,"limit":25},"detail":null,"masked":true}
```

`args` holds identifiers, enumerations, numbers and flags only. Search text and
every other free-text argument is recorded as present/absent, never its value,
and no argument hash is kept (a hash of a short search term can be reversed by
guessing). `contacts_get` records which contact was read. The token is never
logged. `detail` is a reason code or an error class name.

## Enabling it (owner steps; agents never do these)

Prerequisite: Janua machine tokens are already on for this deployment
(`PHYND_CRM_MACHINE_TENANT_ID` and `PHYND_CRM_MACHINE_JANUA_ORG_ID` set, see
[MACHINE_AUTH.md](./MACHINE_AUTH.md)).

1. **Reserve the scope in Janua.** Add `phynd-crm-pipeline:read` to Janua's
   reserved PhyndCRM scopes (audience `phynd-crm` is already reserved), merge
   and promote that Janua image. Until then Janua will not issue the scope.
2. **Name the consumers, then provision one client per consumer.** Which
   consumers may read the CRM over MCP is an open owner decision. For each one
   the owner names, declare a Janua client in the ecosystem OIDC provisioning
   registry with `audience: phynd-crm`, `grant_types: [client_credentials]`,
   `allowed_scopes: [phynd-crm-pipeline:read]`, org-bound to the organization
   of `PHYND_CRM_MACHINE_JANUA_ORG_ID`, and provision it (the first run creates
   the client and prints its `jnc_…` id; the secret goes to the consumer
   through intake, never to chat or git):

   ```bash
   enclii --profile admin secrets provision oidc --platform <consumer>-phynd-crm-pipeline --intake-profile default --json --reason "<consumer> reads the CRM pipeline over MCP"
   ```

3. **Promote this code** as usual (`promote-to-prod.yml`); the route ships off.
4. **Allowlist the client and turn the switch on.** Both values are plain
   configuration (identifiers, not secrets), declared like the deployment's
   other non-secret env: add them under `containers[web].env` in
   `infra/k8s/overlays/staging/web-deployment.patch.yaml` first and, once the
   staging smoke passes, in `infra/k8s/production/web-deployment.yaml`, each as
   its own reviewed change that Argo CD syncs. Use the `jnc_…` id from step 2
   and the organization UUID of `PHYND_CRM_MACHINE_JANUA_ORG_ID`:

   ```yaml
   - name: PHYND_CRM_MCP_READ_CLIENTS
     value: "<jnc_consumer_client_id>@<janua_org_uuid>"
   - name: PHYND_CRM_MCP_ENABLED
     value: "true"
   ```

   `PHYND_CRM_MCP_UNMASKED_CLIENTS` stays empty (every client masked) unless
   the owner grants a client an exception, as its own reviewed change.

5. **Smoke test** (replace the host; the token comes from the consumer's own
   client):

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<crm-host>/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'
   ```

   → `401`. Then with a token:

   ```bash
   curl -s -X POST https://<crm-host>/mcp -H "authorization: Bearer $ACCESS_TOKEN" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ```

   → the six tools. A `404` after the switch means the machine configuration is
   missing (log event `mcp_not_configured`); a `403 client_not_allowed` means the
   readers entry does not match the token's `client_id` and `org_id`.

To turn it off: set `PHYND_CRM_MCP_ENABLED` to anything but `true` (404 on the
next request). To remove one consumer: take its entry out of
`PHYND_CRM_MCP_READ_CLIENTS`.

## Not in this slice

- Writes of any kind (create/update/complete/move), campaign sending, consent
  and suppression changes: exempt in `coverage.ts`, each needs its own review and
  its own scope (`phynd-crm-…:write` is never folded into the read scope).
- People through Claude connectors (OAuth authorization-code with RFC 8707 /
  RFC 9728 metadata): this slice is machine clients only.
- Notes, tags, lead/deal by id, leads and deals by contact, analytics: listed
  as "not in the first slice" in `coverage.ts`.
