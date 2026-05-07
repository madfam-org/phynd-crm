# Client Project Onboarding

> Last updated: 2026-05-07

This document describes the first in-product path for onboarding a client and
project into PhyneCRM as a quote-ready engagement.

## What Exists Now

PhyneCRM can now create a linked onboarding skeleton in one protected action:

- `contact`
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

## Current Limits

This is a quote-to-production skeleton, not the full autonomous lifecycle yet.

Still required for 100% production flow:

- Quote approval from Cotiza or a CRM approval action.
- Payment-to-quote/order reconciliation beyond the existing Dhanam engagement
  timeline event.
- Pravara/Selva execution dispatch from the accepted order.
- Client portal review/approval affordances for quotes, invoices, and delivery.
- Staging deployment and provider webhook split from PP.5 Wave 0-3.

## Validation

Current coverage:

```bash
pnpm --filter @phyne/services test -- client-project-onboarding.service.test.ts
pnpm --filter @phyne/api test -- engagements.router.test.ts
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
