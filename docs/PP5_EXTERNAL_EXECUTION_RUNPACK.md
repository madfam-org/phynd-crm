# PP-5 External Execution Runpack (2026-05-13)

> [!IMPORTANT]
> MADFAM-ENCLII-FIRST-LEGACY-RAW v1: This document contains legacy raw infrastructure command examples.
> Routine production operations must use Enclii web, API, or CLI. Treat raw
> `kubectl`, `helm`, SSH, provider CLI/API, `docker exec`, and direct container
> access as platform bootstrap or documented break-glass only, and record any
> missing Enclii adapter gap.

Use this runpack when team members have direct cluster/GitHub/network access.
All internal repo-level blockers have been addressed; remaining work is runtime or
platform dependent.

## Trackers to update continuously

- [docs/SESSION_WRAPUP_2026_05_13.md](/Users/aldoruizluna/labspace/phynd-crm/docs/SESSION_WRAPUP_2026_05_13.md)
- [docs/PP5_CLOSEOUT_ACTIONS.md](/Users/aldoruizluna/labspace/phynd-crm/docs/PP5_CLOSEOUT_ACTIONS.md)
- [docs/PP_5_FULL_REMEDIATION_PLAN.md](/Users/aldoruizluna/labspace/phynd-crm/docs/PP_5_FULL_REMEDIATION_PLAN.md)

## Phase A — Governance (run as soon as GitHub API is reachable)

### Owners
- Platform security / branch-protection admin

### Commands
- `pnpm pp5:branch-protection-check`
- If mismatch: `pnpm pp5:branch-protection-check --mode apply --confirm --required-checks-from-ci`

### Evidence to attach
- Branch-protection command output
- Screenshot/log from GitHub Branch Protection UI or API GET output

## Phase B — Cluster bootstrap (run in parallel across tasks where safe)

### B1. Core staging foundation
- Owner: Platform / Enclii
- Commands:
  - `kubectl apply -f infra/k8s/overlays/staging/namespace.yaml`
  - `kubectl get ns phynd-crm-staging`
  - `kubectl -n phynd-crm-staging get secret ghcr-credentials`
  - `kubectl -n phynd-crm-staging get secret phynd-crm-staging-secrets`
  - `kubectl -n argocd get application phynd-crm-staging`
- Evidence:
  - `kubectl` command logs with PASS/ERR lines

### B2. Workload rollout
- Owner: Platform / Enclii
- Commands (post Argo install and sync):
  - `kubectl -n argocd wait --for=jsonpath={.status.sync.status}=Synced application/phynd-crm-staging --timeout=30s`
  - `kubectl -n phynd-crm-staging rollout status deployment/phynd-crm-web --timeout=30s`
  - `kubectl -n phynd-crm-staging rollout status deployment/phynd-crm-worker --timeout=30s`
  - `curl -fsS https://staging-phynd.app/api/health`
- Evidence:
  - Rollout status + health JSON body

## Phase C — Readiness and gate closure

Owner: PhyndCRM + Platform

Commands:
- `node scripts/pp5-staging-audit.mjs`
- `node scripts/pp5-wave0-check.mjs`
- `pnpm pp5:readiness --include-wave0`
- `pnpm test:pp5`

Evidence:
- Last-run output from each command
- `wave0-check` and `readiness` logs archived as artifacts

## Phase D — Provider split execution (parallelizable)

Owners: Provider teams + PhyndCRM

Commands:
- Batch A: `pnpm pp5:probe-batch A`
- Batch B: `pnpm pp5:probe-batch B`
- Batch C: `pnpm pp5:probe-batch C`
- Batch D: `pnpm pp5:probe-batch D`

For each batch, capture per-lane evidence:
- 200 on signed staging call
- 401/403 on bad signature
- Side-effect verification in staging systems
- No production writes confirmation

## Phase E — Final close

Owner: PhyndCRM

- Update checklist status in [docs/PP_5_FULL_REMEDIATION_PLAN.md].
- Mark all active lanes completed or explicitly deferred in matrix.
- Run and archive:
  - `pnpm pp5:readiness --include-wave0`
  - `pnpm pp5:staging-reset` (if required by policy)
  - Promotion/rollback rehearsal workflow logs

## Definition of done

PP-5 considered done when all following are true:
- `pnpm pp5:readiness --include-wave0` passes
- All active lane evidence attached
- Production isolation for staging probes is proven
- Staging smoke + promotion path validated
- Docs updated with final completion status

