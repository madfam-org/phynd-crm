# Tulana Commercial GA G4 write-back

Status: implemented source contract
Date: 2026-06-01
Source system: PhyndCRM
Target system: Tulana

## Purpose

When PhyndCRM successfully sends a Tulana/Selva campaign after human approval
and consent/suppression checks, it writes `G4` evidence back to Tulana.

## Configuration

The write-back target endpoint, auth token, and environment/period context
are read from `process.env` at runtime by
`packages/services/src/campaigns/tulana-commercial-ga-evidence.ts` and no-op
when unset. The variable names, values, and secret-store mounts for this
integration live in the private `madfam-org/internal-devops` runbook; see the
ops team. Do not print or store the evidence token.

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

## No-go rules

- Do not mark `G4` passed for purchased or scraped audiences.
- Do not mark `G4` passed without a stable PhyndCRM campaign ID.
- Do not mark `G4` passed if suppression checks fail.
- Do not use the Tulana token in logs or docs.
