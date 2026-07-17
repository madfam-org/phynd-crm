# PhyndCRM to Tulana Commercial GA evidence producer

Status: producer contract
Date: 2026-06-01
Source system: PhyndCRM
Target system: Tulana

## Gate owned by PhyndCRM

PhyndCRM owns the `G4` CRM consent/send gate: it confirms that campaign
audience, consent, suppression, and human approval checks passed for a given
SKU before a paid campaign can go out.

## Implementation

The write-back is implemented in
`packages/services/src/campaigns/tulana-commercial-ga-evidence.ts` and reads
its target endpoint, auth token, and environment/period context from
`process.env` at runtime. It is a no-op whenever the evidence token is unset.

## Non-negotiables

- Do not write `G4` for scraped, purchased, or legally ambiguous audiences.
- Do not write `G4` unless suppression checks and human approval are both
  complete.
- Do not send paid outbound campaigns unless upstream readiness gates have
  passed for the same SKU, environment, and period.

Endpoint, payload schema, and secret provisioning for this integration are
operational detail, not public source; see the private
`madfam-org/internal-devops` runbook or the ops team.
