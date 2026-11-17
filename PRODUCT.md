# Product
<!-- impeccable:product-schema 1 -->

> Written 2026-11-17 for the `/leads` redesign. Facts marked *(inferred)* came from the
> repository and the owner's brief, not from an interview; correct them here when they are wrong.
> This file holds product truth only. Visual decisions live in `DESIGN.md`.

## Platform
web

## Users
- **MADFAM staff who follow up on leads.** These are the operator, managers and sales reps,
  the CRM `users.role` values `admin`, `manager` and `sales_rep`. A `viewer` reads only. Staff
  sign in through Janua, and access comes from the CRM user (`docs/IDENTITY.md`).
- **Their situation** *(inferred)*: mostly at a desk between calls, sometimes on a phone
  between meetings. They come to the CRM several times a day to decide whom to contact next,
  contact that person, record what happened, and pass a lead on to a colleague.
- **Agents** (Selva, MCP clients) read the same data through masked, read-only surfaces, never
  through these pages.

## Product Purpose
PhyndCRM is MADFAM's own CRM. It federates the ecosystem's platforms (Janua, Dhanam, Cotiza,
PravaraMES, Forj, Janua Telemetry) and records the leads, contacts, deals and engagements of
MADFAM's businesses. For leads, success means that **no tier-A lead waits more than one
business day for a first contact**, and that every lead has an owner and a next step.

## Positioning
Leads arrive already qualified with first-party context: the sender's message, the EC
standard, the intent and the page they came from (Avala, Kalya, the MADFAM site, Cotiza, Nauta).
Each lead also gets a rule-based tier and an owner on intake. A generic CRM sees a name and an
address. This one knows what the person asked for and how urgent it is.

## Operating Context
- **Feeds:** signed webhooks create leads (Avala, Nauta, lead-intake for Kalya/site/Cotiza,
  ceq, tezca). Each new lead gets an owner (the contact's owner, else the configured default
  owner) and a "First contact" task due the next business day, Mexico City.
- **Scoring:** rules editable in Settings › Scoring cover intent, company-domain fit, interests,
  recency, phone present and repeat submissions. Tier A ≥ 7, B 4–6, C ≤ 3. A waitlist lead is
  always C and is followed up as "notify when available", never as a sale.
- **Staff time zone:** America/Mexico_City. Business days are Monday to Friday; holidays are
  not skipped.
- **Copy:** the CRM has no i18n framework. Recent staff surfaces (Casos, lead tasks, lead
  emails) are in Spanish, and `/leads` follows them. Older pages remain in English until their
  own redesign.

## Capabilities and Constraints
- Next.js 15 App Router, React 19, Tailwind CSS 4 (`@theme` tokens in
  `apps/web/src/app/globals.css`), shadcn/ui primitives in `apps/web/src/components/ui`, tRPC
  v11, Drizzle and PostgreSQL 16.
- **Public repository:** no real client, lead or person data in code, fixtures, screenshots or
  commits.
- **Masking:** personal fields are masked for agent principals (`shouldMaskPiiForAgent`). A
  masked value must read as deliberately withheld, not broken.
- **Consent:** suppression always wins over consent. The UI shows consent and unsubscribe
  status and never sends anything on its own. Contact actions only open the user's own mail,
  phone or WhatsApp client.
- **No third-party trackers.**
- **Source files under 800 lines** (pre-commit hook).
- **Company enrichment (E3)** is designed but not built. Surfaces show an honest placeholder
  until it exists.

## Brand Commitments
- **MADFAM ecosystem identity.** Brand colours are green `#2c8136`, purple `#58326f` and yellow
  `#eebc15` (madfam-site brand guide). The typeface is Inter, already loaded through
  `next/font`.
- **Dhanam's tri-material palette is Dhanam-only** and is never used here.

## Evidence on Hand
- **Real data** lives only in production and never leaves it. Local and staging screenshots use
  obviously fake data.
- **Absences that must not be faked:** company descriptions (E3), the EC catalogue titles (E2),
  and call outcomes beyond what activities record.

## Product Principles
1. **Urgency first.** The next person to contact is always at the top, and why is visible
   (overdue first contact, tier, score parts).
2. **Context in one glance.** The prospect's own words, where they came from and what they asked
   for come before any field grid.
3. **Hand-offs are one action.** Reassigning moves the lead, its open first-contact task and the
   timeline together.
4. **Honest data.** Show what is known, mark what is masked or missing, and never fabricate.
5. **Never act on a lead's behalf without a person.** No automatic email or message.

## Accessibility & Inclusion
WCAG 2.2 AA: contrast ≥ 4.5:1 for body text, visible focus rings, labelled controls, and full
keyboard paths (the queue supports j/k, Enter and `a` to assign). Layouts must work at 360 px.
