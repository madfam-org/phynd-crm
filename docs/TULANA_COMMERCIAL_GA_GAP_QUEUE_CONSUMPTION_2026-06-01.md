# Tulana Commercial GA gap queue consumption

Status: active owner queue contract
Date: 2026-06-01
Owner system: PhyndCRM

## Source

```http
GET https://tulana-api.madfam.io/api/v1/commercial-ga-gap-queue/?environment=production&period=2026-06&owner=phynd-crm&gate=G4
```

## PhyndCRM responsibility

For each returned row, PhyndCRM owns `G4` evidence:

- Campaign ID.
- Audience ID.
- Consent basis.
- Suppression result.
- Human send approval.
- Final copy snapshot or hash.

## ROI rule

Process rows in returned order. The first expected row is:

```text
karafiel__contador G4
```

Do not approve paid-GA sends unless Tulana reports `campaign_ga_ready`.
`candidate` SKUs may only use controlled pilot, warm pilot, discovery, or
waitlist motions.
