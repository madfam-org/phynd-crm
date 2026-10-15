/**
 * Local check of the receipt extractors against a file on YOUR machine:
 *
 *   pnpm --filter @phynd/db exec tsx ../services/src/payment-evidence/extract-cli.ts <file> [--text]
 *
 * Prints the detected type and the extracted fields (last-4 account digits
 * only). `--text` also prints the PDF text with long digit runs masked, to
 * debug a layout. Nothing is uploaded or stored. Never commit real receipts.
 */
import { readFileSync } from 'node:fs'
import { maskLongDigitRuns } from './account-guard'
import { checkEvidenceFile } from './evidence-file'
import { extractPaymentEvidence } from './extractors'
import { extractPdfText } from './pdf-text'

const [path, flag] = process.argv.slice(2)
if (!path) {
  process.stderr.write('usage: extract-cli.ts <file> [--text]\n')
  process.exit(2)
}
const bytes = new Uint8Array(readFileSync(path))
const checked = checkEvidenceFile(bytes)
if (!checked.ok) {
  process.stderr.write(`refused: ${checked.reason}\n`)
  process.exit(3)
}
if (flag === '--text' && checked.mime === 'application/pdf') {
  process.stdout.write(
    `--- text (long digit runs masked) ---\n${maskLongDigitRuns(extractPdfText(bytes))}\n---\n`,
  )
}
const result = await extractPaymentEvidence({ bytes, mime: checked.mime })
process.stdout.write(
  `${JSON.stringify({ mime: checked.mime, size: checked.size, result }, null, 2)}\n`,
)
