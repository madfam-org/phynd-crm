# Payment evidence storage (R2)

Payment receipts (photos, screenshots or PDFs of a transfer) are kept privately in a Cloudflare R2 bucket. PhyndCRM stores structured data in `payment_evidence` (migration `0017`). Viewers never get a public URL; they get a presigned GET that expires after 120 seconds:

- staff through `paymentEvidence.evidenceUrl`;
- client portal viewers through `/portal/<engagement>/payments/<payment>/file`, after the portal session check, `resolvePortalAccess` and `canViewEvidence`.

## What the app expects

| Item | Value |
|---|---|
| Bucket | `phynd-crm-payment-evidence` (production) |
| Kubernetes Secret | `phynd-crm-credentials` in namespace `phynd-crm`, the `enclii buckets create` default `<project>-credentials` |
| Keys read by the web pod | `R2_BUCKET_NAME`, `R2_ENDPOINT_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` |
| Mounted by | `infra/k8s/production/web-deployment.yaml`, as an `optional: true` envFrom |
| Object keys | `payment-evidence/<sha256>.<ext>`, content-addressed; the same file is stored once |
| Accepted files | JPEG, PNG, WebP, HEIC, PDF; type sniffed from the bytes; 10 MB max |

Without the Secret, nothing breaks:

- uploads answer `503 Evidence storage is not configured`;
- staff can still record a payment by hand, without a file;
- the portal shows payments without a receipt link.

## Operator steps (owner-run; not done by agents)

1. Create the bucket and its scoped token. The credentials are written to the Secret and are never printed:

   ```bash
   enclii buckets create phynd-crm-payment-evidence --project phynd-crm
   enclii buckets ls --project phynd-crm
   ```

2. Restart the web pods so they pick up the new Secret. `envFrom` is read at start:

   ```bash
   kubectl -n phynd-crm rollout restart deploy/phynd-crm-web
   ```

   This is the break-glass path under AGENTS.md. The next promotion also restarts them.

3. Check that the keys are present, by NAME only:

   ```bash
   kubectl -n phynd-crm get secret phynd-crm-credentials \
     -o go-template='{{range $k,$v := .data}}{{$k}}{{"\n"}}{{end}}'
   ```

4. Smoke test in the CRM: open an engagement → **Pagos** → **Registrar pago**, and upload the synthetic receipt `packages/services/src/__tests__/fixtures/bbva-comprobante-sintetico.pdf`. The fields fill in. Cancel without saving, or record it on a test engagement and void it.

Staging has no bucket. To try it there, create `phynd-crm-staging-payment-evidence` for the staging project and mount its Secret in the staging overlay.

## Rules

- The bucket must stay private: no public access, no custom public domain, and no `r2.dev` URL.
- Objects are not deleted when a payment is voided. Payments are voided, never deleted, and the evidence is part of the record.
- Account numbers never go beyond their last 4 digits in `payment_evidence`, enforced by the service and by CHECK constraints. The receipt file itself is kept as the bank issued it, which is why it is private.
- A file uploaded and then abandoned before "Registrar pago" stays in the bucket under its hash. It has no row and nobody can reach it.

## Reading a real receipt locally (never commit it)

To check the BBVA extractor against a real "Comprobante de la operación" PDF without uploading or storing anything:

```bash
pnpm --filter @phynd/db exec tsx ../services/src/payment-evidence/extract-cli.ts ~/Downloads/comprobante.pdf
pnpm --filter @phynd/db exec tsx ../services/src/payment-evidence/extract-cli.ts ~/Downloads/comprobante.pdf --text
```

- The first command prints the extracted fields, with account digits as last-4 only.
- `--text` also prints the PDF text, with long digit runs masked. Use it to adjust labels in `extractors.ts` when a layout is not read.
- Keep real receipts out of the repository and out of test fixtures. Fixtures are synthetic, see `packages/services/src/__tests__/fixtures/synthetic-receipt-pdf.ts`.
