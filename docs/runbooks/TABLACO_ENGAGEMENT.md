# Tablaco client-engagement runbook

End-to-end staff workflow for onboarding an external client (tablaco being the first) through MADFAM's cross-platform engagement flow: Cotiza (quoting) → PhyneCRM (engagement + portal) → Janua (magic link) → Pravara (fab dispatch, optional) → Dhanam (billing).

This runbook exists because there is **no staff UI yet** for engagement management. All operations go through tRPC (from a script / CLI) or direct SQL until the dashboard work lands.

## Prerequisites

One-time per tenant (MADFAM internal org, tenant `code='madfam'`):

1. **Cotiza services-mode flag** — enable services-mode quoting:

   ```sql
   UPDATE "Tenant"
   SET "features" = jsonb_set(coalesce("features", '{}'::jsonb), '{servicesQuotes}', 'true')
   WHERE "code" = 'madfam';
   ```

2. **PhyneCRM env vars** (prod + staging):

   | Var | Value |
   |---|---|
   | `PHYNE_ENGAGEMENT_EVENTS_SECRET` | HMAC-SHA256 32-byte secret; shared with Cotiza's `PHYNECRM_ENGAGEMENT_SECRET` |
   | `PORTAL_BASE_URL` | `https://phyne-crm.madfam.io` (prod) |
   | `JANUA_API_URL` | `https://auth.madfam.io` |

3. **Cotiza env vars**:

   | Var | Value |
   |---|---|
   | `PHYNECRM_API_URL` | `https://phyne-crm.madfam.io` |
   | `PHYNECRM_ENGAGEMENT_SECRET` | (same value as PhyneCRM's `PHYNE_ENGAGEMENT_EVENTS_SECRET`) |

4. **Contact exists in PhyneCRM** — tablaco's contact record must already exist. For tablaco specifically, `seed-tablaco.ts` provides the seed; in production, the contact comes through Janua, Tezca, or newsletter signup first.

## Workflow

### Step 1 — Create the engagement (PhyneCRM)

Ties the contact to a project family.

```ts
await trpc.engagements.create.mutate({
  contactId: '<tablaco-contact-id>',
  opportunityId: '<opportunity-id-if-any>',  // optional
  projectName: 'Tablaco pedagogic tool — prototype + learning platform',
  description: 'Phase 2A: additive manufacturing prototype. Phase 2B: bespoke truth-tables learning platform.',
  status: 'active',
})
```

Note the returned `id` — this is the `engagement_id` used everywhere downstream.

### Step 2 — Create the Cotiza services quote

Services-mode quote (hourly / fixed-fee / milestone lines). Tag with the engagement ID so Cotiza knows where to route the approval event + PDF.

```bash
# Create quote with quoteType=services and engagement link in metadata
POST /api/v1/quotes
{
  "currency": "MXN",
  "objective": { "cost": 0.5, "lead": 0.3, "green": 0.2 },
  "quoteType": "services",
  "metadata": {
    "phynecrmEngagementId": "<engagement_id from step 1>"
  }
}
```

Add items (one per services line):

```bash
POST /api/v1/quotes/{id}/items
{
  "name": "Truth-tables learning platform — design + frontend",
  "quantity": 1,
  "unitPrice": 180000,
  "servicesDetails": {
    "billableType": "milestone",
    "milestones": [
      {
        "id": "<uuid>",
        "name": "Design approved",
        "amount": 60000,
        "status": "pending",
        "dueDate": "2026-05-15T00:00:00Z",
        "deliverables": ["Design mockup", "Style guide"]
      },
      {
        "id": "<uuid>",
        "name": "Frontend MVP",
        "amount": 80000,
        "status": "pending",
        "dueDate": "2026-06-30T00:00:00Z"
      },
      {
        "id": "<uuid>",
        "name": "Acceptance + handoff",
        "amount": 40000,
        "status": "pending",
        "dueDate": "2026-07-30T00:00:00Z"
      }
    ]
  }
}
```

Then `POST /api/v1/quotes/{id}/calculate` — services-mode skips the pricing engine and sums `unitPrice × quantity` into totals.

### Step 3 — Approve the Cotiza quote

```bash
POST /api/v1/quotes/{id}/approve
```

This fires two fire-and-forget side effects to PhyneCRM:

1. **Engagement event** → logged in `engagement_events` as `source=cotiza, event_type=quote.approved, status=in_progress`, message "Services proposal approved", dedup key `cotiza:quote.approved:<id>`
2. **Signed-proposal artifact** → Cotiza calls `generatePdf()` (returns a 7-day presigned S3 URL or a queued-job placeholder), POSTs to `/api/v1/engagements/artifacts` with `type=signed_proposal`, `entity_type=quote`, `entity_id=<cotiza_quote_id>`, `url=<presigned>`, `title="Proposal Q-2026-04-nnnn"`

If either side-effect fails (PhyneCRM offline, S3 hiccup), the approve flow still succeeds. Staff can manually add the artifact via `engagements.addArtifact` if needed:

```ts
await trpc.engagements.addArtifact.mutate({
  engagementId: '<id>',
  type: 'signed_proposal',
  entityType: 'quote',
  entityId: '<cotiza_quote_id>',
  url: '<presigned_url>',
  title: 'Proposal Q-2026-04-0001',
})
```

### Step 4 — Send the portal link to the client

```ts
await trpc.engagements.sendPortalLink.mutate({
  engagementId: '<id>',
})
```

PhyneCRM looks up the engagement's contact email, calls Janua's `/api/v1/auth/magic-link` with `redirect_url=<PORTAL_BASE_URL>/portal/verify?engagement=<id>`. Janua sends the email (rate-limited 5/hour per address; token expires 15 minutes after issue). Response is a redacted email ack — the full address is never leaked back to the caller.

**Rate limit hit (429)?** You requested too many links in a short window. Wait, then retry.

### Step 5 — Client opens the portal

Client clicks the link in the email → lands on PhyneCRM's `/portal/verify` → token exchanged with Janua → `phyne-portal-session` httpOnly cookie sealed → redirect to `/portal/[engagementId]`.

Portal page shows:
- Project name + client name + status badge
- **Project files** — signed proposals, invoices, deliverables, NFT receipts
- **Activity** — merged stream of engagement_events + linked activities + stage_transitions (newest first, 50 entries)

Session cookie TTL is 14 minutes (Janua access token is 15). Expired? Send a fresh link via step 4.

Failure paths redirect to `/portal/expired?reason=...`:
- `no-session` — cookie expired or missing
- `missing-params` — email link malformed
- `email-mismatch` — Janua-verified email doesn't match engagement contact
- `JANUA_ERROR` — Janua rejected the token (usually expired)
- `AUTHZ_MISMATCH` — Janua verified for a different email than the engagement contact
- `invalid` — generic fallback

### Step 6 — Ongoing status updates

As fab jobs progress (Pravara), digital milestones complete (Selva, manual), or compliance events happen (Karafiel), each service posts to `POST /api/v1/engagements/events`. Portal timeline refreshes on next page load.

Pravara already wires this automatically (phyne-crm#10). Selva + Karafiel integrations pending.

Manual status update (staff):

```ts
await trpc.engagements.update.mutate({
  id: '<engagement_id>',
  status: 'completed', // or 'paused', 'cancelled'
})
```

## Smoke test with tablaco fixtures

`seed-tablaco.ts` creates Rodrigo Tablaco's contact with `externalJanuaId=janua-tablaco-001`. Run through the workflow end-to-end against this fixture in dev / staging:

```bash
pnpm db:seed                                         # seeds tablaco
# Then exercise steps 1-6 with contactId from the seed output
```

## Troubleshooting

| Symptom | Check | Fix |
|---|---|---|
| Cotiza `approve()` doesn't create PhyneCRM event | `PHYNECRM_API_URL` / `PHYNECRM_ENGAGEMENT_SECRET` set? Engagement ID in quote metadata? | Set env vars + re-approve (engagement event dedupes; harmless) |
| `approve()` fires event but no artifact | `generatePdf()` failed or returned placeholder | Manually call `engagements.addArtifact` with the S3 URL |
| Portal link email not received | Janua `ENABLE_MAGIC_LINKS=true`? `EMAIL_ENABLED=true`? `RESEND_API_KEY` valid? | Verify Janua config in `infra/secrets` |
| Portal shows "This link is no longer valid" | Token expired (>15 min) or already used | Send a new link via `sendPortalLink` |
| Pravara status not showing in portal | Contact has an active engagement? | Confirm `engagements.listByContactId` returns a row with `status='active'`. If not, create one via `engagements.create` |
| `AUTHZ_MISMATCH` when client clicks | Contact email in PhyneCRM differs from what Janua verified | Update the contact email OR send a fresh link to the correct address |

## Hardening backlog (non-blocking)

- ~~JWKS-based RS256 verification on every portal page render~~ — ✅ shipped in `apps/web/src/lib/portal/jwks.ts`. `readAndVerifyPortalSession()` validates the signature against Janua's published JWKS on every portal page render, enforces issuer + sub match, and rejects algorithm-confusion attacks (alg=HS256 payloads are rejected even when a matching kid is served from the JWKS).
- Refresh-token rotation when the 14-min cookie expires (today client gets a new magic link)
- Per-client branding / theming
- ~~Staff UI for all of the above (replace tRPC CLI calls)~~ — ✅ shipped (phyne-crm#12): `/engagements` list + detail pages, "Send portal link" button, "Add artifact" dialog, engagements section on `/clients/[id]`.
- ~~Cotiza → Karafiel compliance hook (CFDI/NOM-151) on ORDERED~~ — ✅ shipped (digifab#8): `KarafielComplianceService`.
- ~~Cotiza → Dhanam milestone invoice creation from `servicesDetails.milestones`~~ — ✅ shipped (digifab#8): `DhanamMilestoneService`.
- ~~Cotiza → Pravara dispatch for fab-line items on ORDERED~~ — ✅ shipped (digifab#8): `PravaraDispatchService`.
