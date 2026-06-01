# PhyndCRM Public Repo Sanitization Owner Decision

Date: 2026-06-01
Current status: blocked, not sanitized

## Evidence summary

- Current-tree exact credential-signature paths: 0
- Git-history matched paths: 5
- GitHub Actions artifacts reported: 259
- Releases page count: 0

## Required owner decisions

- Choose `history_rewrite` or `risk_acceptance_plus_revocation` for history matches.
- Choose `artifact_body_review`, `artifact_retention_cleanup`, or `artifact_risk_acceptance` for public artifacts.
- Confirm public production domains are only `phynd.app` and `crm.madfam.io`.
- Confirm no OAuth refresh token, CRM import secret, webhook secret, customer lead data, campaign payload, or internal tenant identifier exists in public source/history/artifacts.
- Approve or reject whether PhyndCRM can produce `PUBLIC_GITHUB_REPO_SANITIZED` Tulana evidence.

## Recommended decision

Keep status blocked until history and artifact disposition are complete. Do not use this repo as campaign GA proof until domain truth and artifact/history evidence pass.

## Artifact retention evidence update

Current-tree workflow audit found zero checked workflows using `actions/upload-artifact`, so no current workflow retention edit was applied in this pass. Existing GitHub artifact volume remains launch-blocking.

Owner still needs to choose artifact body review, artifact retention cleanup, or explicit time-bounded artifact risk acceptance.

## Full artifact metadata update

- Total artifacts: 259
- Active artifacts: 259
- Expired artifacts: 0
- Total artifact bytes: 9,662,369
- Risk-name artifacts: 0
- Active risk-name artifacts: 0
- Risk-name artifact bytes: 0

Owner review should still disposition artifact exposure, but PhyndCRM has no risk-name hits under this metadata pattern. History matches and production-domain truth remain the primary public-repo blockers.
