import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import nextConfig from '../../next.config'

// Guards the Next.js image-optimizer posture (GHSA-2xp9-vwfh-vxw4 defence in
// depth). Nothing in apps/web uses next/image, so the optimizer is off and
// /_next/image answers 404. The middleware matcher skips /_next/image, so an
// enabled optimizer would be reachable without a session. Widening the
// allow-list is a security decision: change it here, in next.config.ts and in
// AGENTS.md together.

const srcRoot = fileURLToPath(new URL('..', import.meta.url))

function filesImportingNextImage(dir: string): string[] {
  const offenders: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') offenders.push(...filesImportingNextImage(full))
    } else if (
      /\.(t|j)sx?$/.test(entry.name) &&
      /from\s+['"]next\/(legacy\/)?image['"]/.test(readFileSync(full, 'utf8'))
    ) {
      offenders.push(path.relative(srcRoot, full))
    }
  }
  return offenders
}

describe('next.config images posture', () => {
  it('disables the built-in image optimizer', () => {
    expect(nextConfig.images?.unoptimized).toBe(true)
  })

  it('keeps remotePatterns an exact, empty allow-list with no legacy domains', () => {
    expect(nextConfig.images?.remotePatterns).toEqual([])
    expect(nextConfig.images?.domains).toBeUndefined()
  })

  it('has no source file importing next/image', () => {
    expect(
      filesImportingNextImage(srcRoot),
      'next/image was imported; revisit images.unoptimized before shipping',
    ).toEqual([])
  })
})
