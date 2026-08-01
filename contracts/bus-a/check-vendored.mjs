#!/usr/bin/env node
/**
 * Verify a vendored copy of the Bus A contract fixtures is intact.
 *
 * Vendored into each product repo alongside `fixtures.json`. Run in CI.
 *
 * This is the SECOND line of defence, not the first. Drift is primarily
 * prevented by the producer asserting its own serialised output against
 * `raw_body` byte-for-byte: change the envelope in Dhanam and Dhanam's own
 * contract test fails, which forces a regenerate-and-re-vendor.
 *
 * What this catches is the other case — a vendored copy that has been
 * hand-edited or truncated, which would otherwise let one repo quietly assert
 * against a contract nobody else holds. Editing the fixture to make a failing
 * test pass is exactly the instinct this exists to stop.
 *
 * Usage: node check-vendored.mjs [dir containing fixtures.json + fixtures.sha256]
 * Exit:  0 intact, 1 drifted or missing.
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2] || dirname(fileURLToPath(import.meta.url));
const fixtures = join(dir, 'fixtures.json');
const digestFile = join(dir, 'fixtures.sha256');

for (const [label, path] of [
  ['fixtures.json', fixtures],
  ['fixtures.sha256', digestFile],
]) {
  if (!existsSync(path)) {
    console.error(`FAIL: ${label} missing at ${path}`);
    console.error('Re-vendor from internal-devops/contracts/bus-a/.');
    process.exit(1);
  }
}

const raw = readFileSync(fixtures, 'utf8');
const actual = createHash('sha256').update(raw).digest('hex');
const expected = readFileSync(digestFile, 'utf8').trim();

if (actual !== expected) {
  console.error('FAIL: vendored Bus A fixtures do not match their recorded digest.');
  console.error(`  expected ${expected}`);
  console.error(`  actual   ${actual}`);
  console.error('');
  console.error('fixtures.json is generated, not hand-written. If a contract test is');
  console.error('failing, the contract changed — fix the code, or change the contract');
  console.error('deliberately: edit generate-fixtures.mjs in internal-devops, regenerate,');
  console.error('and re-vendor into ALL consuming repos together.');
  process.exit(1);
}

// Cheap structural assertions, so a syntactically valid but gutted fixture
// (empty events array, missing signing block) cannot pass on digest alone —
// the digest would match a file someone regenerated from a broken generator.
const doc = JSON.parse(raw);
const problems = [];
if (!doc.contract_version) problems.push('missing contract_version');
if (!doc.signing?.secret) problems.push('missing signing.secret');
if (!Array.isArray(doc.events) || doc.events.length === 0) problems.push('no events');
for (const e of doc.events ?? []) {
  if (!e.raw_body) problems.push(`${e.event_type}: missing raw_body`);
  if (!e.signature_at_fixed_timestamp) problems.push(`${e.event_type}: missing signature`);
}
if (problems.length > 0) {
  console.error('FAIL: vendored Bus A fixtures are structurally incomplete:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  `PASS: Bus A fixtures intact — contract v${doc.contract_version}, ` +
    `${doc.events.length} events, sha256 ${actual.slice(0, 12)}…`
);
