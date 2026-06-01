# PhyndCRM Public Domain and Repo Sanitization Contract

Date: 2026-06-01
Status: launch-blocking contract for Product/Offer GA public-repo readiness

## Production domain truth

The only valid production domains for PhyndCRM are:

- `https://phynd.app`: product production domain.
- `https://crm.madfam.io`: MADFAM tenant production slice.

No public README, docs page, campaign asset, Selva agent prompt, PhyneCRM campaign import, screenshot, release note, or GitHub repo metadata may present any other domain as production.

## Public repo launch gate

PhyndCRM cannot pass Product/Offer GA public-repo sanitization until Tulana has `PUBLIC_GITHUB_REPO_SANITIZED` evidence confirming:

- README and docs use only `phynd.app` and `crm.madfam.io` for production references.
- OAuth, Reddit, webhook, OpenAI, CRM import, and campaign setup instructions do not expose refresh tokens, secrets, internal tenant identifiers, or privileged operator-only procedures.
- Campaign automation claims match what production can actually fulfill.
- Demo/local/staging instructions are clearly marked as non-production.
- Owner approval links this repo to the relevant platform/SKU evidence in Tulana.

## Campaign no-go rules

Do not launch or scale campaigns from PhyneCRM/Selva using this repo as proof when:

- A campaign link points to any non-canonical production domain.
- Public docs imply live posting, lead import, or CRM fulfillment without the required production secret/evidence gates.
- OAuth refresh-token setup is described in a way that encourages public handling of credentials.
- Tulana lacks public-repo sanitization evidence for the linked SKU.

## Required evidence

Tulana Product/Offer GA evidence must include:

```json
{
  "evidence_type": "PUBLIC_GITHUB_REPO_SANITIZED",
  "repo_owner": "madfam-org",
  "repo_name": "phynd-crm",
  "repo_url": "https://github.com/madfam-org/phynd-crm",
  "risk_tier": "tier_0_revenue_critical",
  "linked_platforms": ["phynd-crm"],
  "launch_blocking": true,
  "checks": {
    "claims_review": "pass",
    "domain_review": "pass",
    "secret_scan": "pass",
    "sensitive_data_review": "pass",
    "ci_artifact_review": "pass",
    "license_security_contact_review": "pass"
  },
  "owner_decision": "pass"
}
```
