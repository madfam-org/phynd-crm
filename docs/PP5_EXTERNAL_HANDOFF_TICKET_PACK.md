# PP-5 External Handoff Ticket Pack (2026-05-13)

## Ticket 1 — Enable staging branch protection checks
- **Title:** PP-5: Configure branch protection required status checks on `main`
- **Owner:** Platform Security / Repo Admin
- **Priority:** P0 (required for stability gate)
- **Scope:** 
  - Run `pnpm pp5:branch-protection-check`
  - Ensure required checks are set exactly to:
    - `CI / PP5 Guardrails`
    - `CI / NetworkPolicy port consistency`
    - `CI / Lint & Typecheck`
    - `CI / Unit Tests`
    - `CI / Build`
    - `CI / E2E Tests`
- **Acceptance Evidence:**
  - PASS output from `pnpm pp5:branch-protection-check`
  - Screenshot/JSON of branch protection config showing required checks + settings

## Ticket 2 — Create staging namespace and secrets
- **Title:** PP-5: Provision staging namespace/secrets baseline
- **Owner:** Platform / Enclii
- **Priority:** P0
- **Scope:**
  - `kubectl apply -f infra/k8s/overlays/staging/namespace.yaml`
  - Ensure `ghcr-credentials` exists in `phynd-crm-staging`
  - Install `phynd-crm-staging-secrets`
- **Acceptance Evidence:**
  - `kubectl get ns phynd-crm-staging`
  - `kubectl -n phynd-crm-staging get secret ghcr-credentials`
  - `kubectl -n phynd-crm-staging get secret phynd-crm-staging-secrets`

## Ticket 3 — Stage ArgoCD app and rollout workloads
- **Title:** PP-5: Install and sync staging ArgoCD application
- **Owner:** Platform / Enclii
- **Priority:** P0
- **Scope:**
  - `kubectl apply -f infra/argocd/phynd-crm-staging-application.yaml`
  - Confirm app shows `Synced`
  - Confirm `phynd-crm-web` and `phynd-crm-worker` deployments reach `Available`
- **Acceptance Evidence:**
  - `kubectl -n argocd get application phynd-crm-staging`
  - `kubectl -n argocd wait --for=jsonpath={.status.sync.status}=Synced application/phynd-crm-staging --timeout=30s`
  - `kubectl -n phynd-crm-staging rollout status deployment/phynd-crm-web`
  - `kubectl -n phynd-crm-staging rollout status deployment/phynd-crm-worker`

## Ticket 4 — Configure staging ingress/DNS and health
- **Title:** PP-5: Add `staging-phynd.app` ingress route and HTTPS health
- **Owner:** Platform / Enclii
- **Priority:** P0
- **Scope:**
  - Add DNS/tunnel route `staging-phynd.app -> phynd-crm-web.phynd-crm-staging.svc.cluster.local:80`
  - Verify TLS and health endpoint reachability
- **Acceptance Evidence:**
  - `curl -fsS https://staging-phynd.app/api/health` returns HTTP 200 and expected payload
  - DNS resolution succeeds

## Ticket 5 — Execute PP-5 read/closure checks
- **Title:** PP-5: Run platform-dependent validation bundle and complete closeout
- **Owner:** PhyndCRM + Platform
- **Priority:** P1
- **Scope:**
  - `node scripts/pp5-staging-audit.mjs`
  - `node scripts/pp5-wave0-check.mjs`
  - `pnpm pp5:readiness --include-wave0`
  - Provider probes: Batches A/B/C/D
- **Acceptance Evidence:**
  - `pp5:readiness --include-wave0` PASS output
  - Provider lane logs and production-isolation artifacts
  - Full checklist tick-off in `docs/PP_5_FULL_REMEDIATION_PLAN.md`

## Current evidence from this session
- `pnpm pp5:readiness --include-wave0` last result: `pp5:branch-protection-check` and `pp5:wave0-check` blocked
- `pp5:wave0-check` blockers: staging secret missing, ArgoCD app missing, rollout failures, DNS unresolved
- See [docs/SESSION_WRAPUP_2026_05_13.md](/Users/aldoruizluna/labspace/phynd-crm/docs/SESSION_WRAPUP_2026_05_13.md)
- See [docs/PP5_CLOSEOUT_ACTIONS.md](/Users/aldoruizluna/labspace/phynd-crm/docs/PP5_CLOSEOUT_ACTIONS.md)
- See [docs/PP5_EXTERNAL_EXECUTION_RUNPACK.md](/Users/aldoruizluna/labspace/phynd-crm/docs/PP5_EXTERNAL_EXECUTION_RUNPACK.md)
