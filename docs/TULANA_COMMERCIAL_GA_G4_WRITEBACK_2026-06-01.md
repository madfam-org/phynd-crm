# Tulana Commercial GA G4 write-back

Status: implemented source contract
Date: 2026-06-01
Source system: PhyndCRM
Target system: Tulana

## Purpose

When PhyndCRM successfully sends a Tulana/Selva campaign after human approval
and consent/suppression checks, it writes `G4` evidence back to Tulana.

This closes the highest-ROI current blocker for `karafiel__contador` once a
real campaign/contact send exists.

## Required environment

```bash
TULANA_API_BASE_URL=https://tulana-api.madfam.io/api/v1
TULANA_COMMERCIAL_GA_EVIDENCE_TOKEN=...
TULANA_COMMERCIAL_GA_ENVIRONMENT=production
TULANA_COMMERCIAL_GA_PERIOD=2026-06
PHYND_CRM_PUBLIC_URL=https://crm.madfam.io
```

Do not print or store the Tulana evidence token.

## Write trigger

The write-back runs from `CampaignsService.attemptTulanaSend` after:

- campaign exists;
- campaign is a Tulana SKU import;
- campaign status is `approved` or `scheduled`;
- Commercial GA campaign policy allows the campaign type;
- contact has marketing consent;
- related leads are not unsubscribed;
- the required channel address exists;
- buyer-signal delivery event is recorded;
- campaign status is updated to `sent`.

## G4 pass criteria

The Tulana write is `passed` only if the campaign metadata includes:

- `commercial_ga_period`
- `audience_id`
- `consent_basis`

If the send succeeds but `audience_id` or `consent_basis` is missing, PhyndCRM
writes partial `pending` evidence instead of falsely passing `G4`.

## Current golden payload

Use:

`phynd-crm/docs/KARAFIEL_CONTADOR_G4_CAMPAIGN_IMPORT_PAYLOAD_2026-06.json`

It includes:

- `commercial_ga_environment=production`
- `commercial_ga_period=2026-06`
- `audience_id=warm-accountants-mx-first-pesos-2026-06`
- `consent_basis=warm_relationship_or_explicit_opt_in_required_per_contact`

## No-go rules

- Do not mark `G4` passed for purchased or scraped audiences.
- Do not mark `G4` passed without a stable PhyndCRM campaign ID.
- Do not mark `G4` passed if suppression checks fail.
- Do not use the Tulana token in logs or docs.
