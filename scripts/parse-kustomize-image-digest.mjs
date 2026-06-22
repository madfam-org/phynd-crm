#!/usr/bin/env node
/**
 * Parse a cosign-pinned image digest from a Kustomize `images:` block.
 * Handles both field orders emitted by `kustomize edit set image`:
 *   - digest: sha256:… / name: …
 *   - name: … / digest: sha256:…
 *
 * Usage:
 *   node scripts/parse-kustomize-image-digest.mjs infra/k8s/overlays/staging/kustomization.yaml ghcr.io/madfam-org/phynd-crm/web
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIGEST_RE = /digest:\s*(sha256:[a-f0-9]+)/i
const NAME_RE = /name:\s*(.+)\s*$/

/**
 * @param {string} content
 * @param {string} imageName
 */
export function parseKustomizeImageDigest(content, imageName) {
  const blocks = extractImageBlocks(content)
  for (const block of blocks) {
    const digest = readField(block, DIGEST_RE)
    const name = readField(block, NAME_RE)
    if (name === imageName && digest) return digest
  }
  return null
}

/** @param {string} content */
function extractImageBlocks(content) {
  const lines = content.split('\n')
  const blocks = []
  let inImages = false
  let current = []

  for (const line of lines) {
    if (/^images:\s*$/.test(line)) {
      inImages = true
      continue
    }

    if (inImages && /^[^\s-]/.test(line)) break

    if (!inImages) continue

    if (/^\s*-\s/.test(line)) {
      if (current.length > 0) blocks.push(current)
      current = [line]
      continue
    }

    if (current.length > 0 && /^\s+\S/.test(line)) {
      current.push(line)
    }
  }

  if (current.length > 0) blocks.push(current)
  return blocks
}

/** @param {string[]} block @param {RegExp} pattern */
function readField(block, pattern) {
  for (const line of block) {
    const match = line.match(pattern)
    if (match) return match[1].trim()
  }
  return null
}

function main() {
  const [filePath, imageName] = process.argv.slice(2)
  if (!filePath || !imageName) {
    console.error('Usage: node scripts/parse-kustomize-image-digest.mjs <kustomization.yaml> <image-name>')
    process.exit(1)
  }

  const digest = parseKustomizeImageDigest(readFileSync(filePath, 'utf8'), imageName)
  if (!digest) {
    console.error(`Digest not found for ${imageName} in ${filePath}`)
    process.exit(1)
  }
  process.stdout.write(`${digest}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main()
}
