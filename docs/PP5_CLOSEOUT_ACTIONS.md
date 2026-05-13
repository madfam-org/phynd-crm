# PP-5 Closeout Actions (2026-05-13)

## Objective

Complete PP-5 stabilization and promotion readiness with remaining platform and governance gates.

## Current confirmed state (as of 2026-05-13)

Repo-side progress is complete and pushed:
- `d479cf5` — fixed `@phynd/*` import aliasing for `@phynd/web` tests (includes Karafiel route test support).
- `fbb9729` — hardened PP-5 readiness tooling (`verify-ci-gates` parser + `wave0-check` command timeouts).
- `377f8f6` — added session wrap-up documentation.

Observed blockers from latest checks:
- `pnpm pp5:readiness --include-wave0` fails at:
  - `pp5:branch-protection-check` (GitHub API connection blocked in environment: `error connecting to api.github.com`)
  - `pp5:wave0-check` cluster/DNS failures:
    - staging secret missing (`phynd-crm-staging-secrets`)
    - ArgoCD app missing (`phynd-crm-staging`)
    - web/worker rollout not ready
    - DNS health endpoint unresolved (`staging-phynd.app`)
- `node scripts/pp5-wave0-check.mjs` confirms these blocks with exact cluster/API and rollout traces.

## Closeout execution order (parallelizable where independent)

### 1) Governance gate (high priority, runs in parallel with platform)
Owner: Platform / Security

- Run: `pnpm pp5:branch-protection-check`
- If API unreachable, collect and attach this as environment dependency; rerun when reachable.
- Acceptance:
  - Required checks match repo script config:
    - `CI / PP5 Guardrails`
    - `CI / NetworkPolicy port consistency`
    - `CI / Lint & Typecheck`
    - `CI / Unit Tests`
    - `CI / Build`
    - `CI / E2E Tests`

### 2) Staging bootstrap (critical path)
Owner: Platform / Enclii

Run in this order (can parallelize sub-tasks once app install starts):

1. Verify namespace exists:
   - `kubectl apply -f infra/k8s/overlays/staging/namespace.yaml`
   - `kubectl get ns phynd-crm-staging`
2. Install/create staging image pull secret:
   - mirror production `ghcr-credentials` to staging namespace (or recreate from source secret)
3. Install staging runtime secret:
   - from secure env file using template `infra/k8s/staging-secrets-template.yaml`
4. Install ArgoCD application:
   - `kubectl apply -f infra/argocd/phynd-crm-staging-application.yaml`
5. Configure staging ingress route:
   - `staging-phynd.app -> phynd-crm-web.phynd-crm-staging.svc.cluster.local:80`

Acceptance:
- `node scripts/pp5-wave0-check.mjs` shows PASS on:
  - staging secret
  - ArgoCD app
  - ArgoCD sync
  - web rollout
  - worker rollout
- `curl -fsS https://staging-phynd.app/api/health` returns 200

### 3) Provider handoff continuation (after Step 2)
Owner: Provider teams + PhyndCRM

- Run per lane in PP5 provider matrix in parallel batches where possible:
  - `pnpm pp5:probe-batch A`
  - `pnpm pp5:probe-batch B`
  - `pnpm pp5:probe-batch C`
  - `pnpm pp5:probe-batch D`
- Evidence requirement per lane:
  - signed staging webhook/event accepted
  - wrong-secret rejection
  - staging-only side effect observed
  - production isolation check attached

### 4) Readiness reconfirmation and closeout
Owner: PhyndCRM

- Re-run:
  - `pnpm pp5:readiness --include-wave0`
  - `node scripts/pp5-staging-audit.mjs`
- Ensure `.github/workflows/ci.yml`/`verify-ci-gates` alignment remains green.
- Update checklist entries in:
  - `docs/PP_5_FULL_REMEDIATION_PLAN.md`
  - `docs/PP_5_SESSION_WRAPUP_2026_05_13.md`

## Final stop conditions

1. `pp5:readiness --include-wave0` passes.
2. All PP-5 acceptance checklist items in `docs/PP_5_FULL_REMEDIATION_PLAN.md` marked complete.
3. Provider lane evidence captured for all active Batches A/B/C/D and production-isolation proofs attached.
4. Staging health is stable and rollout state is healthy.
5. Promotion confidence path (soak + rollback) executed and documented.

