# Machine access: Janua `client_credentials` tokens

Status: **shipped, off by default** (machine tokens are refused until configured).
Production turns it on in `infra/k8s/production/web-deployment.yaml` (see
[Production](#production)).

Phynd CRM accepts two kinds of machine caller on its tRPC surface:

| | Janua machine token (target) | Static bearer (legacy) |
| --- | --- | --- |
| Credential | RS256 access token from Janua's `client_credentials` grant, one client per calling service | `FEDERATION_API_TOKEN`, one shared string |
| Scopes | only what `MACHINE_SCOPE_GRANTS` maps the token's scope to | every `SERVICE_AUTH_SCOPES` scope, writes included |
| Principal | `service:<client_id>` (the Janua client) | `service:selva` (`FEDERATION_SERVICE_USER_ID`) |
| Tenant | `PHYND_CRM_MACHINE_TENANT_ID`, bound to the token's signed `org_id` | derived from the request Host |
| Surfaces | tRPC only | tRPC and GraphQL |
| Code | `apps/web/src/lib/trpc/machine-auth.ts` | `createServiceAuth()` in `request-context.ts` |

New machine callers get a Janua client. The static bearer is kept for Selva
only and is not handed to anyone else (see [Deprecation path](#deprecation-path)).

## What a machine token must carry

A token is accepted only when every check passes; any failure answers as a
signed-out request (`401` on protected procedures) and is logged as
`machine_auth_rejected` with a reason:

| Check | Rule | Refusal reason |
| --- | --- | --- |
| Signature | RS256, key from `<AUTH_JANUA_ISSUER>/.well-known/jwks.json` | `invalid_token` |
| `iss` | equals `AUTH_JANUA_ISSUER` (trailing `/` ignored) | `invalid_token` |
| `aud` | includes `PHYND_CRM_MACHINE_AUDIENCE` (default `phynd-crm`) | `invalid_token` |
| `exp`, `iat` | present, not expired (60 s clock tolerance) | `invalid_token` |
| Machine token | `token_use` = `client_credentials`, `actor_type` = `service_account`, `type` = `access` | `not_client_credentials` |
| Subject | `client_id` present, `sub` = `service-account:<client_id>` | `bad_subject` |
| Lifetime | `exp - iat` in (0, 3600] s, `iat` not in the future | `bad_lifetime` |
| Organization | `org_id` = `PHYND_CRM_MACHINE_JANUA_ORG_ID` | `org_mismatch` |
| Scope | space-separated `scope` claim, non-empty | `no_scope` |
| Mapping | at least one scope in `MACHINE_SCOPE_GRANTS` | `no_mapped_scope` |

The claim names are the ones Janua puts on every `client_credentials` token
(`client_id`, `scope`, `token_use`, `actor_type`, `org_id`). Janua does not emit
`azp` or `scp`, and they are not read.

## Scope mapping

Fixed and explicit (`MACHINE_SCOPE_GRANTS`). Unknown scopes grant nothing; no
entry grants `*`, a `<resource>:*` wildcard or the static bearer's scope set.

| Janua scope | Phynd scopes | Caller |
| --- | --- | --- |
| `phynd-crm-engagements:read` | `engagements:read`, `contacts:read` | Client-facing project portal |

Phynd scopes are checked per tRPC path by `enforceServiceScopes`
(`packages/api/src/trpc.ts`): `<router>.<procedure>` needs `<router>:read` for a
query and `<router>:write` for a mutation. So the entry above reaches every
`engagements.*` and `contacts.*` **query** and no mutation.

A new entry is a new reviewed machine edge: name the scope
`phynd-crm-<thing>:read` (one colon), have it reserved in Janua (audience and
scope) and deployed before any client carries it, then add the row here and in
the table above. A write grant is its own explicit entry, never folded into a
read scope.

## Tenant binding

A machine token never chooses its tenant. The request's Host header and any
other caller-supplied value are ignored; the tenant is
`PHYND_CRM_MACHINE_TENANT_ID`, and the token is accepted only when its
Janua-signed `org_id` equals `PHYND_CRM_MACHINE_JANUA_ORG_ID`. The client is
therefore org-bound in Janua to the organization that owns that CRM tenant.

One tenant per deployment is deliberate: phynd has no stored mapping from Janua
organizations to tenants yet, and an explicit single pair cannot be widened by
a caller. Supporting several tenants means replacing the pair with an explicit
`org_id → tenant` table, not trusting a header.

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `AUTH_JANUA_ISSUER` | Janua issuer; also locates the JWKS | already set for staff sign-in |
| `PHYND_CRM_MACHINE_TENANT_ID` | Phynd tenant every machine token acts in | unset: machine tokens off |
| `PHYND_CRM_MACHINE_JANUA_ORG_ID` | Janua organization (UUID) whose clients are trusted | unset: machine tokens off |
| `PHYND_CRM_MACHINE_AUDIENCE` | Required `aud` | `phynd-crm` |

None of these is a secret. While the tenant or the organization is unset, a
JWT-shaped bearer is handled exactly as before this feature (the session-cookie
path), and Janua's JWKS is never fetched.

### Production

Production env comes from the Argo-synced manifests in `infra/k8s/production`,
not from `.enclii.yml`. The web Deployment (`web-deployment.yaml`) declares
both switches as literal values: tenant `madfam` and the Janua organization the
machine clients are bound to. `PHYND_CRM_MACHINE_AUDIENCE` is left at its
default, `phynd-crm`, the audience Janua reserves for these clients. The issuer
is the `AUTH_JANUA_ISSUER` staff sign-in already uses. The worker does not need
them: machine tokens are verified only on the web tRPC route.

`apps/web/src/__tests__/production-machine-auth-env.test.ts` runs the declared
values through `machineAuthConfig()`, so a value the code would refuse fails CI
instead of leaving machine tokens silently off.

Merging a change to these values rolls the web pods at once (Argo auto-sync);
it does not need a production image promotion. Verifying tokens needs an image
that contains this feature, which does go through `promote-to-prod.yml`.
Before that image is live, the two variables are inert.

**Rollback:** delete the `PHYND_CRM_MACHINE_TENANT_ID` entry (either variable
unset turns machine tokens off), merge, and the web pods roll without it.

**Check (read-only):** an accepted call logs `machine_auth` with the caller's
`clientId` and its `grantedScopes`; a refused one logs `machine_auth_rejected`
with the reason from the table above.

## Request order

`createAppContextFromRequest()`:

1. `Authorization` equals `Bearer <FEDERATION_API_TOKEN>` exactly → legacy
   service context (unchanged).
2. A JWT-shaped bearer, with machine tokens configured → the machine-token
   path. A refused token is never retried as the static bearer or the session
   cookie. On the GraphQL surface it is always refused (GraphQL resolvers check
   only that a principal exists, not its scopes).
3. Otherwise → staff session cookie, demo session, or signed out.

## Calling it

tRPC queries are `GET` (`/api/trpc/<router>.<procedure>?input=<superjson JSON>`).
A `POST` to a query answers `405`; the route does not enable
`allowMethodOverride`. Mutations are `POST`.

```bash
# 1. Token from Janua (the client's id and secret come from the secret store).
curl -s -X POST "$AUTH_JANUA_ISSUER/api/v1/oauth/token" \
  -d grant_type=client_credentials -d scope=phynd-crm-engagements:read \
  --data-urlencode "client_id=$CLIENT_ID" --data-urlencode "client_secret=$CLIENT_SECRET"
# 2. A read.
curl -s "https://crm.example.test/api/trpc/engagements.getById?input=$(jq -rn \
  --arg id "$ENGAGEMENT_ID" '{json:{id:$id}}|@uri')" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Every accepted call logs `web:trpc:service-auth` event `machine_auth` with
`clientId`, `userId`, `tokenScopes`, `grantedScopes`, `tenantId`, `path` and
`surface`. The token itself is never logged and never forwarded downstream.

## Deprecation path

The static bearer stays until Selva has its own Janua client:

1. Define the Selva edge's scopes as explicit Janua scopes (reads first; the
   `aiKanban` and campaign-authorization writes each as their own reviewed
   entry), reserve them in Janua, add them to `MACHINE_SCOPE_GRANTS`.
2. Provision a Selva `client_credentials` client, org-bound like any other.
3. Move Selva to it; confirm in the logs that `service:selva` traffic is gone.
4. Unset `FEDERATION_API_TOKEN`, then remove the static path and
   `SERVICE_AUTH_SCOPES`.

Until then, `FEDERATION_API_TOKEN` is shared with Selva only.
