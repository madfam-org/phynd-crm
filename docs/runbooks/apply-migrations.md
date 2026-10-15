# Apply database migrations (staging / production)

**Normal path: nothing to do by hand.** Every Argo CD sync of `infra/k8s/production` first runs the PreSync hook Job `phynd-crm-db-migrate` (`infra/k8s/production/db-migrate-job.yaml`). The Job uses the pinned worker image and runs `node scripts/db-migrate.mjs --apply`, which applies only pending migrations, in one transaction, under an advisory lock. If the hook fails, the sync stops and the new digests do not roll out. A worker image built before `scripts/db-migrate.mjs` existed has no script, so the hook logs a skip and applies nothing.

Use this runbook to check a database by hand, to apply before the next promotion, or when the hook failed.

> Raw `kubectl exec` is break-glass under AGENTS.md: Enclii has no adapter for one-off database jobs yet (gap recorded here). Record each run in the ops log.

## Why production fell behind (2026-10)

Until this runbook, nothing ran migrations on deploy: no init container, no Job, no Argo hook, and the images do not include drizzle-kit. The only path was `DATABASE_URL=<prod> pnpm db:migrate:tier` from a workstation. That needs network access to the CNPG cluster in `project-c72121bb`, and `PILOT_GO_LIVE.md` only asked for migrations "through `0010`". Migrations `0011`–`0014` (July 2026) shipped with no matching step. `verify:migrations` only checks that the files exist in the repo, so it kept passing.

## 1. Check (read-only)

From a checkout of this repo, with the cluster context selected:

```bash
kubectl -n phynd-crm get deploy phynd-crm-worker \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'

kubectl -n phynd-crm exec -i deploy/phynd-crm-worker -- \
  node --input-type=module - < scripts/db-migrate.mjs
```

The script reads the migrations **shipped in the running worker image**, not the ones in your checkout. It applies exactly what the running code expects. It runs in a `READ ONLY` transaction and prints:

- `applied N (last: <tag>)` and `pending: <tags>`;
- `BLOCKER …` lines, if any. **Stop here when you see one** (§ Blockers).

Add `--json` for a machine-readable report. Add `--fail-on-pending` to exit `4` when anything is pending.

## 2. Before applying

1. Read the SQL of each pending tag (`packages/db/src/migrations/<tag>.sql`) at the image's commit. The migrations pending in production on 2026-10-14 (`0011`–`0014`, plus `0015` once the portal-visibility change ships) only add tables, columns, indexes and constraints.
2. Take a schema snapshot for the record (no client data):

   ```bash
   kubectl -n project-c72121bb exec pg-phynd-crm-postgres2-a9d984cc-1 -c postgres -- \
     pg_dump --schema-only -d app > phynd-crm-schema-before-$(date +%F).sql
   ```

3. The CNPG cluster has **no `Backup` or `ScheduledBackup`** (checked 2026-10-14). A migration that rewrites or drops data needs a data backup first, through the platform DR process. Never store client data in a repo or a laptop folder.

## 3. Apply

```bash
kubectl -n phynd-crm exec -i deploy/phynd-crm-worker -- \
  node --input-type=module - --apply < scripts/db-migrate.mjs
```

- It runs all-or-nothing in one transaction, after `pg_advisory_xact_lock`, so it never races the hook.
- `lock_timeout` is 10 s. If a table stays busy, the transaction aborts, nothing is applied, and you re-run later. Override with `--lock-timeout 30s`.
- It refuses (exit `3`, `REFUSED`) when blockers exist.

## 4. Verify

```bash
kubectl -n phynd-crm exec -i deploy/phynd-crm-worker -- \
  node --input-type=module - --fail-on-pending < scripts/db-migrate.mjs; echo "exit $?"
CRM_BASE_URL=https://crm.madfam.io pnpm verify:post-deploy
```

The first command must exit `0` with `pending: 0`.

For the hook, read the last Job's logs:

```bash
kubectl -n phynd-crm logs job/phynd-crm-db-migrate
```

## Blockers

| Blocker | Meaning | Action |
|---|---|---|
| `schema_drift` | A pending migration creates an object that already exists, because it was partly applied by hand | Compare the object with the migration SQL. Remove or complete it in a reviewed change, then re-check. Never insert the migration row by hand to skip it. |
| `applied_file_changed` | An applied migration's file changed after it ran | Restore the file from git. Migrations are append-only. |
| `applied_unknown_to_journal` | The database recorded a migration the image does not know: the image is older than the database | Promote the newer image, or roll the database forward. Do not delete the row. |
| `skipped_by_newer_applied` | An older journal entry was never applied, but a newer one was | Apply that migration's SQL in a reviewed change, then record its row. Escalate first. |

## Staging

Same commands, with `-n phynd-crm-staging`. The staging overlay runs the same PreSync hook (`infra/k8s/overlays/staging/db-migrate-job.yaml`, secret `phynd-crm-staging-secrets`). Staging gets each new worker digest on push to `main`, so pending migrations run there before a production promotion.

## Local / CI

```bash
DATABASE_URL=postgresql://phynd:phynd@localhost:5432/phynd_crm node scripts/db-migrate.mjs [--apply]
pnpm db:migrate   # drizzle-kit; same bookkeeping table, either tool can follow the other
```
