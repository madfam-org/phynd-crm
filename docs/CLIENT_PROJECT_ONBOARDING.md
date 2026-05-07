# Client Project Onboarding

> Last updated: 2026-05-07

This document describes the first in-product path for onboarding a client and
project into PhyneCRM as a quote-ready engagement.

## What Exists Now

PhyneCRM can now create a linked onboarding skeleton in one protected action:

- `contact`, created or reused from an existing active client profile
- `opportunity`
- `engagement`
- `quote`
- optional `order`
- `client_project_intake` conversion
- quote artifact on the engagement
- system timeline events on the engagement

The service entry point is:

```ts
new ClientProjectOnboardingService(ctx).create(input)
```

The tRPC entry point is:

```ts
engagements.onboardClientProject
```

The CRM quote acceptance entry point is:

```ts
quotes.accept
```

The CRM UI entry point is:

```text
/engagements -> Onboard Client Project
```

## Supported Project Kinds

| Kind | Intended use |
|---|---|
| `digital` | Digital services, digital experience, software/handoff work. |
| `physical` | Fabrication, fulfillment, physical delivery. |
| `phygital` | Physical build plus digital twin, kiosk, or digital experience. |

Supported delivery tracks:

- `digital_experience`
- `digital_twin`
- `fabrication`
- `fulfillment`
- `kiosk`

## Created Records

The onboarding mutation writes all records inside one database transaction.

| Record | Purpose |
|---|---|
| Contact | Client identity and CRM owner. |
| Opportunity | Sales pipeline placement and commercial value. |
| Conversion | Analytics marker: `type=client_project_intake`. |
| Engagement | Client-facing project aggregate for portal timelines. |
| Quote | Initial quote, default status `draft`. |
| Engagement artifact | Quote link with `type=quote`, `entityType=quote`. |
| Order | Optional production order, default status `pending`. |
| Engagement events | `system:intake_created` and, when an order is created, `system:production_order_created`. |

## Contact Resolution

The onboarding service avoids duplicate client records before creating the rest
of the project chain. It first looks for an active contact by `externalJanuaId`,
then by case-insensitive normalized email. When it finds an existing contact,
it reuses that contact and only fills missing profile fields such as email,
phone, company, external Janua ID, or owner.

## Input Contract

Minimum required input:

```ts
{
  client: { name: 'Client Name' },
  project: {
    name: 'Project Name',
    kind: 'phygital'
  },
  commercial: {
    pipelineId: 'pipeline-id',
    stageId: 'stage-id'
  }
}
```

Common full input:

```ts
{
  client: {
    name: 'Selva Office Client',
    email: 'client@example.com',
    phone: '+52...',
    company: 'Client Company'
  },
  project: {
    name: 'Retail Kiosk + Digital Twin',
    description: 'Physical kiosk, digital twin, and launch support.',
    kind: 'phygital',
    deliveryTracks: ['fabrication', 'digital_twin', 'kiosk']
  },
  commercial: {
    pipelineId: 'pipeline-id',
    stageId: 'stage-id',
    amount: '42000.00',
    currency: 'MXN',
    quoteNumber: 'Q-2026-0007',
    createProductionOrder: true,
    orderNumber: 'ORD-2026-0007',
    estimatedCompletion: new Date('2026-06-30')
  },
  intakeSource: 'crm'
}
```

If `quoteNumber` or `orderNumber` is omitted, the service generates a
date/project-based number.

## Quote Acceptance

The CRM can now accept a quote through the dedicated `quotes.accept` mutation.
This is the PhyneCRM-owned approval action for operator-led or Selva-office
flows. The client portal also exposes a quote payment action for portal-authenticated
clients once a quote is `sent` or already `accepted`.

When a quote is accepted, the mutation runs in one transaction:

- sets the quote status to `accepted`
- creates a confirmed order from the quote if no active order exists
- confirms an existing pending order linked to the quote
- marks the linked opportunity `won`
- records `opportunity_to_won` and `quote_accepted` conversions
- writes a `system:quote_approved` engagement milestone when the quote is tied
  to an engagement

This gives operators a controlled path from quote-ready intake to production
order readiness before provider payment and manufacturing automation are live.

## Client Checkout

The Dhanam checkout entry point is:

```ts
new DhanamCheckoutService(ctx).createForQuote(input)
```

The portal route is:

```text
POST /portal/:engagementId/checkout
```

The portal route verifies the Janua-backed portal cookie, checks that the quote
belongs to the engagement's contact or opportunity, accepts the quote
idempotently, creates or confirms the linked order, then creates or reuses a
Dhanam checkout session.

When a checkout session is created, PhyneCRM:

- posts a signed `quote.checkout.requested` payload to Dhanam
- stores a Dhanam `checkout_session` external reference on the quote
- adds an `invoice` engagement artifact pointing at the checkout URL
- writes `system:checkout_created` on the engagement timeline

Checkout creation is idempotent at the quote level: if an open Dhanam checkout
reference with a stored checkout URL already exists, PhyneCRM reuses it instead
of creating a duplicate session.

## Payment Reconciliation

Dhanam paid webhooks now reconcile payment events onto the CRM order lifecycle
when the event can be matched to an existing active order by explicit
`order_id`, `quote_id`, `engagement_id`, or the active contact/order chain.

When a paid Dhanam event is matched, PhyneCRM:

- updates the linked order `paymentStatus`, `paidAmount`, `paidAt`,
  `paymentProvider`, and `externalPaymentId`
- confirms a still-pending order
- writes an `external_references` row for the Dhanam payment
- writes a `system:payment_reconciled` engagement milestone

Reconciliation is idempotent by webhook event ID and by Dhanam payment reference
so multiple paid event envelopes for the same payment do not double-count paid
amounts.

When payment is received for a known engagement but no order can be matched,
PhyneCRM writes `system:payment_unmatched` with `blocked` status so an operator
can recover the lifecycle without database access.

## Current Limits

This is a quote-to-production flow with CRM-owned quote acceptance, not the full
autonomous lifecycle yet.

Still required for 100% production flow:

- Cotiza-originated quote approval webhook automation beyond the CRM action.
- Full refund/dispute/payment reversal handling.
- Pravara/Selva execution dispatch from the accepted order.
- Client portal approval affordances beyond quote acceptance/payment, including
  delivery review and final signoff.
- Staging deployment and provider webhook split from PP.5 Wave 0-3.

## Validation

Current coverage:

```bash
pnpm --filter @phyne/services test -- client-project-onboarding.service.test.ts
pnpm --filter @phyne/services test -- dhanam-checkout.service.test.ts
pnpm --filter @phyne/services test -- payment-reconciliation.service.test.ts
pnpm --filter @phyne/api test -- engagements.router.test.ts
pnpm --filter @phyne/web test -- src/app/api/webhooks/dhanam/__tests__/route.test.ts
pnpm --filter @phyne/web test -- 'src/app/portal/[engagementId]/checkout/__tests__/route.test.ts'
pnpm --filter @phyne/web typecheck
pnpm --filter @phyne/web exec biome check src/components/engagements/create-client-project-dialog.tsx src/components/engagements/engagements-data-table.tsx
```

Broader package validation:

```bash
pnpm --filter @phyne/services test
pnpm --filter @phyne/api test
pnpm --filter @phyne/web test
pnpm --filter @phyne/web lint
```
