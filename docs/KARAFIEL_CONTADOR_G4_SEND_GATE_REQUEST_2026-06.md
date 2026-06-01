# Karafiel contador G4 send-gate request

Status: pending PhyndCRM approval
Date: 2026-06-01
SKU: `karafiel__contador`
Tulana gate: `G4`
Campaign proof pack: `selva-proof-karafiel-contador-first-pesos-2026-06`

## Required PhyndCRM evidence before `G4` can pass

PhyndCRM must produce or confirm:

- Campaign ID.
- Audience ID.
- Consent basis for every recipient.
- Suppression list check result.
- Human send approval.
- Final outbound copy hash or immutable snapshot.
- Link to the Selva `G3` proof pack.

## Gate decision

Current decision: `pending`

Reason:

- Selva campaign proof pack exists.
- PhyndCRM audience, consent, suppression, and human approval evidence are not
  attached yet.

## No-go rules

- Do not send to purchased, scraped, or legally ambiguous lists.
- Do not send if suppression checks fail.
- Do not send if the message implies tax/legal/compliance guarantees.
- Do not send if the CTA bypasses Dhanam payment tracking.
- Do not mark Tulana `G4` passed without a stable Campaign ID and Audience ID.

## Tulana pending evidence locator

`repo://phynd-crm/docs/KARAFIEL_CONTADOR_G4_SEND_GATE_REQUEST_2026-06.md`
