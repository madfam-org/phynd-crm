# Cross-Product Consent & Suppression API

PhyndCRM is the system of record for **marketing consent** (LFPDPPP Art. 7)
and the **cross-product suppression list** across the MADFAM ecosystem.
Consent-capture components on dhanam / karafiel / tezca call the HMAC-signed
REST endpoints below. Staff and Selva-agent access goes through the tRPC
`consent` router instead.

> **Which article, and why it changed.** The LFPDPPP in force is the new law
> (**DOF 2025-03-20**), which abrogated the 2010 law and renumbered pervasively.
> Marketing consent is **Art. 7** (*consentimiento* — expreso o tácito), which is
> word-for-word what **Art. 8 of the 2010 law** used to say. These docs and the
> code comments previously cited "Art. 8"; under the law in force **Art. 8 is the
> SENSITIVE-data rule** (consentimiento *expreso y por escrito*, via firma
> autógrafa o electrónica). A marketing email address or phone number is not a
> *dato sensible*, so Art. 8 is the wrong — and much heavier — standard for this
> system. Double opt-in remains the right implementation; only the citation moved.
> Verified against the Cámara de Diputados vigente text, not against tezca (whose
> LFPDPPP corpus has an unfixed transitorio-collision that makes arts. 2, 8 and 9
> return transitorio text).

## Model

- **Consent records** are scoped per `(identifier, channel)`:
  - `identifier`: lowercase email (channel `email`) or E.164 phone
    (channels `sms`, `whatsapp`).
  - `status`: `granted` | `revoked` | `pending_double_opt_in`.
  - Every transition appends a `consent_audit` row (action, previous/new
    status, source, evidence, actor).
- **Suppression list** entries are per `(identifier, channel)` with
  `channel: all | email | sms | whatsapp`. **Suppression always wins over
  any consent status** — a granted consent never overrides a suppression
  entry, and the campaign send gate checks suppression first.
- **Send-gate precedence** (campaign-send-gate.ts):
  1. suppression entry (channel or `all`) → blocked (`suppressed`)
  2. channel consent record `granted` → allowed; `revoked` /
     `pending_double_opt_in` → blocked
  3. no consent record → legacy `contacts.marketingConsent` boolean fallback
  4. existing gates unchanged: contact deleted, lead unsubscribed,
     missing email/phone, Tulana GA-readiness (campaigns.service.ts)

## Authentication

All `/api/v1/consent/**` endpoints use the shared MADFAM webhook signing
scheme (same as `/api/v1/engagements/*`):

- Secret: `PHYND_CONSENT_EVENTS_SECRET` env var (per environment; staging
  and production secrets MUST differ). Endpoints return `503` when unset.
- Headers:
  - `x-webhook-signature`: HMAC-SHA256 hex digest of the raw JSON body,
    keyed with the shared secret (format per
    `@phynd/federation/webhooks#validateWebhookSignature`).
  - `x-webhook-timestamp` (optional but recommended): ISO timestamp;
    requests older than 5 minutes are rejected.
- Rate limit: 100 req/min/IP (fail-closed when Redis is down).

The double-opt-in confirmation endpoint (`GET /api/consent/confirm`) is
public — the token in the URL is the credential.

## Endpoints

### POST `/api/v1/consent/capture`

Records a consent transition. This is the endpoint the consent-capture
components on dhanam/karafiel/tezca call.

Request body:

```json
{
  "email": "persona@example.mx",          // required for channel=email
  "phone": "+525512345678",               // required for channel=sms|whatsapp
  "channel": "email",                     // email | sms | whatsapp
  "action": "request_double_opt_in",      // grant | revoke | request_double_opt_in
  "source": "dhanam_signup_form",          // required — capture surface
  "evidence": "Checkbox 'Acepto recibir…' checked at /signup; IP 203.0.113.7",
  "contact_id": "<phynd contact uuid>",   // optional
  "send_confirmation_email": true,         // optional, default true (email channel)
  "metadata": { "locale": "es-MX" }       // optional
}
```

Action semantics (state machine, invalid transitions → `422`):

| action | use when | resulting status |
|---|---|---|
| `request_double_opt_in` | default for web captures — user ticked a box but has not confirmed | `pending_double_opt_in` (token issued, 7-day expiry) |
| `grant` | capture carries its own affirmative evidence (signed form, checkout consent with stored snapshot) | `granted` |
| `revoke` | user opted out on your surface | `revoked` (also valid with no prior record — creates a durable opt-out tombstone) |

Notes:
- `request_double_opt_in` on an already-`granted` identifier is rejected
  (`422`) — never downgrade a grant.
- `confirm_double_opt_in` is not accepted here; confirmation happens via
  the emailed link only.

Response `200`:

```json
{
  "consent": { "identifier": "persona@example.mx", "channel": "email", "status": "pending_double_opt_in" },
  "double_opt_in": {
    "expires_at": "2026-07-13T00:00:00.000Z",
    "confirmation_email_sent": true,
    "confirm_url": "https://phynd.app/api/consent/confirm?token=…"
  }
}
```

- By default PhyndCRM sends the double-opt-in confirmation email (Resend).
  Set `"send_confirmation_email": false` to send your own branded email —
  embed `double_opt_in.confirm_url` in it and treat the URL as a secret.
- Errors: `400` malformed payload, `401` bad signature, `422` invalid
  transition, `429` rate limited, `503` secret unconfigured.

### GET `/api/consent/confirm?token=…`

Public double-opt-in confirmation landing (linked from the confirmation
email). Transitions `pending_double_opt_in → granted`, appends an audit row,
and renders a Spanish confirmation page. Idempotent: re-clicking a confirmed
link shows "already confirmed". Expired/invalid tokens render an error page
telling the subject to re-request.

### POST `/api/v1/consent/check`

```json
{ "identifier": "persona@example.mx", "channel": "email" }
```

Response:

```json
{
  "identifier": "persona@example.mx",
  "channel": "email",
  "consent_status": "granted",          // or revoked | pending_double_opt_in | null
  "suppressed": false,
  "suppression_reasons": [],
  "permitted": true                       // granted AND not suppressed
}
```

Gate your own outbound marketing on `permitted`, not on `consent_status`.

### POST `/api/v1/consent/suppression/add`

Idempotent add to the shared suppression list.

```json
{
  "identifier": "persona@example.mx",
  "channel": "all",                        // all | email | sms | whatsapp (default all)
  "reason": "unsubscribe",                 // complaint | hard_bounce | unsubscribe | manual | legal_request
  "source": "karafiel",
  "evidence": "User clicked unsubscribe in settings on 2026-07-06"
}
```

Response: `{ "entry": { "id", "identifier", "channel", "reason" }, "created": true|false }`
(`created: false` = entry already existed).

### POST `/api/v1/consent/suppression/check`

```json
{ "identifier": "persona@example.mx", "channel": "email" }
```

Response: `{ "suppressed": true, "entries": [{ "channel": "all", "reason": "complaint", "source": "resend_webhook", "created_at": "…" }] }`

A `channel: all` entry suppresses every channel.

### POST `/api/v1/consent/suppression/list`

Cursor-paginated export (mirror the list into your product if you need
local filtering):

```json
{ "cursor": "<last id>", "limit": 200, "channel": "email" }
```

Response: `{ "entries": [...], "next_cursor": "…", "has_more": true }`

## Automatic suppression

The Resend event webhook (`POST /api/webhooks/resend`, secret
`RESEND_WEBHOOK_SECRET`) auto-adds email suppression entries on
`email.bounced` (`hard_bounce`) and `email.complained` (`complaint`), so a
bounced/complaining address is blocked ecosystem-wide without any manual
step.

## Import path for existing consent data

Bulk-import historical consent (e.g. karafiel's existing LFPDPPP consents)
by replaying rows through `POST /api/v1/consent/capture` with
`action: "grant"`, a `source` like `karafiel_import_2026_07`, and
`evidence` referencing the original capture (timestamp + surface). Rate
limit is 100 req/min/IP — batch accordingly or run from multiple senders.

## Env vars (PhyndCRM side)

| Var | Purpose |
|---|---|
| `PHYND_CONSENT_EVENTS_SECRET` | HMAC secret for `/api/v1/consent/**` (share with dhanam/karafiel/tezca per env) |
| `RESEND_WEBHOOK_SECRET` | Svix `whsec_…` signing secret for `/api/webhooks/resend` |
| `NEXT_PUBLIC_APP_URL` | Base for `confirm_url` links |
