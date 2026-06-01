# PhyndCRM to Tulana Commercial GA evidence producer

Status: producer contract
Date: 2026-06-01
Source system: PhyndCRM
Target system: Tulana

## Gate owned by PhyndCRM

| Gate | Evidence condition | Minimum payload |
| --- | --- | --- |
| `G4` CRM consent/send gate | Campaign audience, consent, suppression, and approval checks pass for the SKU. | campaign ID, audience ID, consent basis, suppression result, approver |

## Tulana write target

```http
POST /api/v1/madfam-skus/{product_slug}/{tier_slug}/commercial-ga-evidence/
```

## G4 example

```json
{
  "environment": "production",
  "period": "2026-06",
  "gate_id": "G4",
  "status": "passed",
  "confidence": "high",
  "evidence_type": "phynecrm_consent_send_gate",
  "evidence_url": "https://crm.madfam.io/evidence/campaigns/{campaign_id}/send-gate",
  "source_system": "phynd-crm",
  "source_record_id": "{campaign_id}",
  "metadata": {
    "sku_key": "karafiel__contador",
    "audience_id": "{audience_id}",
    "suppression_passed": true,
    "human_approval": true
  }
}
```

## Non-negotiables

- Do not write `G4` for scraped, purchased, or legally ambiguous audiences.
- Do not write `G4` unless suppression checks and human approval are both
  complete.
- Do not send paid outbound campaigns unless Tulana has `G3` and `G4` passed
  for the same SKU, environment, and period.
