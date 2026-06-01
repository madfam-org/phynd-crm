# Karafiel contador G4 operator import runbook

Status: ready for controlled-pilot import
Date: 2026-06-01
SKU: `karafiel__contador`
Gate: `G4`

## Purpose

Import the Karafiel contador controlled-pilot campaign payload into PhyndCRM so
an operator can review, approve, and send to a consented contact. A successful
send triggers the Tulana `G4` write-back path.

## Payload

```text
phynd-crm/docs/KARAFIEL_CONTADOR_G4_CAMPAIGN_IMPORT_PAYLOAD_2026-06.json
```

## Import command

```bash
cd /Users/aldoruizluna/labspace/phynd-crm
PHYND_CAMPAIGN_IMPORT_SECRET=... \
node scripts/import-tulana-campaign.mjs \
  docs/KARAFIEL_CONTADOR_G4_CAMPAIGN_IMPORT_PAYLOAD_2026-06.json
```

Optional overrides:

```bash
PHYND_CAMPAIGN_IMPORT_URL=https://phynecrm.madfam.io/api/v1/campaigns/import
PHYND_WEBHOOK_HOST=crm.madfam.io
```

Do not print or store `PHYND_CAMPAIGN_IMPORT_SECRET`.

## After import

1. Review the created campaign in PhyndCRM.
2. Confirm `campaign_type=controlled_pilot`.
3. Confirm `commercial_ga_status=candidate`.
4. Confirm audience ID and consent basis are present.
5. Approve only if copy matches the Selva proof pack.
6. Send only to a contact with marketing consent and no unsubscribe/suppression.

Signed approval helper:

```bash
cd /Users/aldoruizluna/labspace/phynd-crm
PHYND_CAMPAIGN_IMPORT_SECRET=... \
node scripts/review-tulana-campaign.mjs CAMPAIGN_ID approved
```

Signed send helper:

```bash
cd /Users/aldoruizluna/labspace/phynd-crm
PHYND_CAMPAIGN_IMPORT_SECRET=... \
node scripts/send-tulana-campaign.mjs CAMPAIGN_ID CONTACT_ID
```

## Tulana G4 pass condition

PhyndCRM writes `G4` as `passed` only after a successful send with:

- campaign ID;
- contact ID;
- audience ID;
- consent basis;
- suppression pass;
- human approval.

If audience ID or consent basis is missing, write-back records `pending`
instead of falsely passing the gate.
