# Karafiel Contador G4 One-Shot Execution Runbook

Date: 2026-06-01

Scope: `karafiel__contador`

Owner: PhyndCRM

## Purpose

Execute the minimum viable campaign-send proof required to advance the first-pesos SKU from `G4 pending` to `G4 passed` in Tulana Commercial GA readiness.

This runbook does not approve mass marketing. It is a controlled, consent-backed send path for one commercial pilot contact.

## Prerequisites

- Import payload reviewed: `docs/KARAFIEL_CONTADOR_G4_CAMPAIGN_IMPORT_PAYLOAD_2026-06.json`
- Human approver has confirmed the controlled-pilot send.
- Target contact has consent for the selected channel.
- `PHYND_CAMPAIGN_IMPORT_SECRET` is available to the operator but is not printed or stored.
- PhyndCRM runtime has `TULANA_COMMERCIAL_GA_EVIDENCE_TOKEN` configured so successful send writes G4 evidence back to Tulana.

## Required environment

```sh
export PHYND_CAMPAIGN_IMPORT_SECRET=...
export PHYND_G4_APPROVAL_CONFIRMATION=approved
```

Optional:

```sh
export PHYND_CAMPAIGN_IMPORT_URL=https://crm.madfam.io/api/v1/campaigns/import
export PHYND_CAMPAIGN_REVIEW_URL=https://crm.madfam.io/api/v1/campaigns/review
export PHYND_CAMPAIGN_SEND_URL=https://crm.madfam.io/api/v1/campaigns/send
export PHYND_WEBHOOK_HOST=crm.madfam.io
```

## Command

```sh
node scripts/run-karafiel-contador-g4-campaign.mjs docs/KARAFIEL_CONTADOR_G4_CAMPAIGN_IMPORT_PAYLOAD_2026-06.json <consented_contact_id>
```

If import succeeds but the API response does not include a campaign id, set the campaign id explicitly and use the existing review/send scripts:

```sh
export PHYND_G4_CAMPAIGN_ID=<campaign_id>
node scripts/review-tulana-campaign.mjs "$PHYND_G4_CAMPAIGN_ID" approved
node scripts/send-tulana-campaign.mjs "$PHYND_G4_CAMPAIGN_ID" <consented_contact_id>
```

## Expected Tulana effect

After successful send, PhyndCRM should write:

- `sku=karafiel__contador`
- `gate_id=G4`
- `status=passed`
- `source_system=phynd-crm`
- `evidence_type=phynd_campaign_send`

## Controls

- The script refuses to run unless `PHYND_G4_APPROVAL_CONFIRMATION=approved`.
- The script never prints the import secret.
- The contact id must belong to a consented lead or customer.
- Failed import, review, or send stops execution immediately.
- Do not use seed contacts, fake consent, sample campaigns, or synthetic delivery telemetry for commercial GA.

## Readiness implication

When G4 passes, `karafiel__contador` can proceed to:

- `G5`: real Dhanam checkout session for `karafiel_contador`.
- `G6`: provider success plus Dhanam billing ledger evidence.

Until G4 passes, the SKU remains a `candidate`, not campaign-GA-ready or cash-GA-ready.
