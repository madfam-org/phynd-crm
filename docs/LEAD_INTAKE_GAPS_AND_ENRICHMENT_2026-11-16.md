# Lead intake: gaps, fixes and data enrichment (2026-11-16)

> **Boundary checkpoint (2026-11-16, phynd-crm):** public repository. This document names
> code, sources and fields only. It holds no lead, contact, company, client or volume data.
> Person-level qualification lives in the CRM itself.

A review on 2026-11-16 read every lead in production against the code that created it. It found that leads arrive reliably, but the CRM loses part of what the sender sends, hides where a contact came from, and nothing assigns or scores leads, so they wait unworked. This document lists each gap with the fix, then the data-enrichment design.

> **Status 2026-11-27:** G1 (with its backfill script, not yet run), the owner, task and
> notification part of G2, and G6 for Avala are built; see each section. Seeded scoring rules and
> tiers (G2 points 2 and 3), G3–G5, E2 and E3 are not.
>
> **Status 2026-11-26:** none of G1–G6, E2 or E3 has been built. The routes behave as §2 describes;
> two statements in G2 about what the code did were corrected on this date. The plan is tracked as a
> row in [`ROADMAP.md`](./ROADMAP.md) § Pending work.

## 1. Where leads come from (as of 2026-11-16)

| Feed | Route | Since | `leads.source` values |
|---|---|---|---|
| Avala (outbox, `avala.lead.captured`) | `apps/web/src/app/api/webhooks/avala/route.ts` | 2026-05 | `ec_waitlist`, `marketing_contact`, `explorer-floating-cta`, `explorer-layout`, `marketing-nav`, `marketing-hero`, `demo-home`, `demo-home-bottom`, `producto-comply`, `provisioning_smoke` (test) |
| Nauta landing contact form | `apps/web/src/app/api/webhooks/nauta/route.ts` | 2026-08 | `nauta` |
| Signed lead intake (Kalya, madfam.io forms, Cotiza) | `apps/web/src/app/api/webhooks/lead-intake/route.ts` | 2026-11 | `kalya`, site and Cotiza sources |
| Billing paid events (Dhanam) | `apps/web/src/app/api/webhooks/dhanam/route.ts` | 2026-11 | creates or advances the contact to customer; no lead |

## 2. Gaps and fixes

### G1 — Avala's `message` and `leadType` are dropped (HIGH: sales calls happen blind)

- **What happens now:** `handleLeadCaptured` keeps `ec_code`, `intent`, `availability_status` and `interests` on the `visitor_to_lead` conversion's `metadata`. `lead.message` and `lead.leadType` exist only in the raw `webhook_events.payload`. Nobody reads that from the UI.
- **Fix:**
  - Write `lead.message`, when present, as a **note** on the contact, authored by the system and labelled "Message from the Avala form", so it shows on the contact and the lead timeline.
  - Keep `leadType` (`INDIVIDUAL` | `COMPANY`) on the lead's `attribution`, or on a new contact field `kind` if other sources send it too.
  - Copy `ec_code`, `intent` and `interests` into `leads.attribution` as well, so the lead row carries its own context without a join.
- **Backfill:** a one-off, idempotent job reads `webhook_events` where `provider='avala'` and `event_type='avala.lead.captured'`, and applies the same writes to existing leads, matched by `avala_lead_id` in the conversion metadata. Run it as an Enclii job (operator step), with a dry run first.
- **Tests:** a webhook test with a message creates exactly one note; a redelivery creates none (idempotency on `event_id`); the backfill is a no-op on a second run.
- **Built (2026-11-27):** the note goes on the **lead**, not the contact (one note per submission, and an Avala deletion can remove it with the lead), authored by `service:avala`; `lead_type`, `landing_page` and the UTM parameters go to `leads.attribution`; EC code, intent and interests are lines of the note (they stay on the conversion metadata too). Backfill: `scripts/backfill-avala-lead-context.mjs`, dry-run by default, matched by the conversion's `event_id`, else `avala_lead_id`.

### G2 — Nobody owns or scores a new lead (HIGH: leads wait for weeks)

- **What happens now:** leads are created with `ownerId = null` and no score. Scoring does run when a lead is created (`LeadsService.create` calls the scorer while the `leadScoring` flag is on), but the review found no scoring rules configured in production, so no rule fires (corrected 2026-11-26). The default task owner (`PHYND_CRM_DEFAULT_TASK_OWNER_ID`, provisioned 2026-11-16) applies only to system-created tasks.
- **Fix:**
  1. **Assignment on intake:** every feed's create path sets `ownerId` to the configured default owner when no routing rule matches, and creates a "First contact" task due in 1 business day. That task already exists on the lead-intake route for all three of its sources (Kalya, site forms, Cotiza); extend it to the Avala and Nauta routes (corrected 2026-11-26).
  2. **Seeded scoring rules** (editable in Settings › Scoring). Each lead's score is the sum of four parts:
     - **intent:** `sales-request` +4; `request-access` +2 (+1 when the source is a demo or Comply page); `waitlist` +1;
     - **fit:** the email domain is not a free-mail provider +2; interests include `dc3` or `compliance` +1;
     - **recency:** decays after 30 days;
     - **reachability:** a phone number is present +1.

     Repeat submissions by the same contact within 7 days add +1 each, up to +2.
  3. **Tiers from score:** A ≥ 7 (call within 1 business day), B 4–6, C ≤ 3. A `waitlist` lead is always C and is flagged "notify when available", never "sell", because Avala marks those standards `capture_in_progress_not_for_sale`.
- **Tests:** a scoring unit test per rule, and an intake test asserting owner, task and score.
- **Built (2026-11-27), point 1 only:** the Avala, Nauta and lead-intake routes set the lead's owner (contact owner, else `PHYND_CRM_DEFAULT_TASK_OWNER_ID`, else none with a warning), notify that owner in-app, and open a «Primer contacto» task due the next business day; Avala leads also get the notification email. No routing rules. Points 2 and 3 (seeded rules and tiers) are business values awaiting a ruling and are not built.

### G3 — The contact list hides the source (MEDIUM)

- **Fix:** add a "Source" column (the first lead's `source`, plus a count when there are several) and a source filter to `/contacts`. Show the Avala context (EC code, intent, interests) on the contact and lead detail pages. Fold this into the UI overhaul (group B1 in the CRM UI plan).

### G4 — Duplicates are not merged (MEDIUM)

- **What happens now:** `ensureContact` matches on exact email only. The same person arriving with a work and a personal address, or a client with two contacts, produces two contacts. Several leads by the same contact are expected (repeat intent) and are not a defect.
- **Fix:**
  - A "possible duplicates" view: same normalized phone, same name with a different email, or the same company domain plus a similar name.
  - A manual **merge** action (admin or manager) that re-points leads, notes, activities, conversions and visitor sessions to the surviving contact, records the merge in the audit log, and keeps the other email as a secondary address.
  - No automatic merging.

### G5 — Test data pollutes the pipeline (LOW)

- **Fix:** mark synthetic sources as test at intake: `provisioning_smoke`, `*.invalid` and `e2e-*` addresses, and the Nauta e2e probes. Use a lead `status` such as `test`, or an `is_test` flag, excluded from lists and metrics by default. Run a one-off sweep to tag the existing ones.

### G6 — Deletion does not propagate from the sender (LOW, privacy)

- A deletion request honoured in Avala leaves the CRM copy. Accept a sender event (for Avala: `avala.lead.deleted`) that soft-deletes the CRM lead, and suppresses the contact when it has no other source. The sender side is tracked in Avala's docs.
- **Built (2026-11-27):** `avala.lead.deleted` soft-deletes the lead, deletes its Avala note and pending first-contact task, soft-deletes the contact when nothing else keeps it, and strips the prospect's data from the stored capture record. No suppression entry is written (suppression is a marketing opt-out, not a deletion). Soft delete keeps the contact row's fields; a hard purge is not part of the CRM's deletion semantics today.

## 3. Data enrichment

**Goal:** give the person who calls a lead the context to qualify it in under a minute, using first-party data first and public company data second.

| Layer | Source | What it adds | Where it is stored |
|---|---|---|---|
| E1 First-party context | The sender's payload (G1) | Message, lead type, EC code, intent, interests, page | Note plus `leads.attribution` |
| E2 Standard title | Avala's RENEC catalogue (`ec_code` → title, sector) | The full name of the competency standard the lead wants | Resolved at display time through Avala's public explorer data, or cached in `attribution.ec_title` |
| E3 Company from email domain | The email domain, when it is not free-mail | Company name, website, one-line description and sector, read from the company's **public home page** (title and meta description) | `contacts.company` (only when empty) plus an `enrichment` JSON on the contact with `source_url` and `fetched_at` |
| E4 Engagement | The CRM's own visitor sessions and page views | Pages seen before converting, return visits | Already stored; surface it on the lead |

**Rules for enrichment:**

- **Company-level only.** Never search for or store information about a private individual beyond what they submitted. No social-profile scraping, no people-search sources.
- **The free-mail list is fixed in code** (gmail, hotmail, outlook, yahoo, icloud, proton…); those contacts get no E3.
- **Every enriched value records its source URL and fetch time**, is shown as "enriched" in the UI, and is never overwritten silently: a human edit wins.
- **Runs as a worker job,** rate-limited, with a timeout per domain. It respects `robots.txt` and fetches only the root page.
- **Masking:** enrichment fields follow the same agent masking as `company` (masked by default over MCP).
- **Retention:** enrichment is deleted with the contact.

**Done when:** a new Avala lead from a company domain shows, on its lead page, the message, the EC title, the company's one-line description, a score and tier, an owner and a "First contact" task. A free-mail lead shows everything except E3.

## 4. Order of work

Status 2026-11-26: no step below has started.

1. **G1 and its backfill.** Small, and it unblocks informed calls.
2. **G2: owner, task and scoring.**
3. **G5: tag test data.** Small; it makes the numbers honest.
4. **E2 and E3 enrichment.**
5. **G3:** with the UI overhaul.
6. **G4: duplicate view and merge.**
7. **G6:** with the sender's deletion event.

Every item merges only with green CI and an independent review, and reaches production through `promote-to-prod.yml` on the owner's word.
