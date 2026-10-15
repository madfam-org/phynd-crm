import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Portal privacy guard. The client portal renders engagement events marked
// visibility='client' and nothing else (EngagementsService.getClientTimeline).
// The staff timeline (getTimeline) merges internal events, the contact's
// activities and stage transitions, so it must never be read from /portal.
// Widening what the portal reads is a privacy decision: change this test,
// the portal page and docs/ENGAGEMENT_EVENT_TAXONOMY.md § Visibility together.

const portalRoot = fileURLToPath(new URL('..', import.meta.url))
const srcRoot = fileURLToPath(new URL('../../..', import.meta.url))
// Everything the portal renders from: the route tree plus its components and helpers.
const PORTAL_DIRS = [
  portalRoot,
  path.join(srcRoot, 'components/portal'),
  path.join(srcRoot, 'lib/portal'),
]
const STAFF_ONLY_TABLES = [
  'activities',
  'notes',
  'stageTransitions',
  'taggables',
  'tags',
  // Items reach the portal only through EngagementItemsService.listForClient().
  'engagementItems',
]

function portalSources(dir: string): Array<{ file: string; source: string }> {
  const out: Array<{ file: string; source: string }> = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') out.push(...portalSources(full))
    } else if (/\.(t|j)sx?$/.test(entry.name)) {
      out.push({ file: path.relative(portalRoot, full), source: readFileSync(full, 'utf8') })
    }
  }
  return out
}

function schemaImports(source: string): string[] {
  const names: string[] = []
  for (const match of source.matchAll(
    /import\s*\{([^}]*)\}\s*from\s*['"]@phynd\/db\/schema['"]/g,
  )) {
    for (const raw of (match[1] ?? '').split(',')) {
      const name = raw.replace(/\btype\b/, '').trim()
      if (name) names.push(name)
    }
  }
  return names
}

describe('client portal privacy', () => {
  const sources = PORTAL_DIRS.flatMap((dir) => portalSources(dir))

  it('finds the portal sources', () => {
    expect(sources.map((s) => s.file)).toContain(path.join('[engagementId]', 'page.tsx'))
  })

  it('never reads the staff timeline', () => {
    const offenders = sources.filter((s) => /\.getTimeline\s*\(/.test(s.source)).map((s) => s.file)
    expect(offenders, 'portal code calls the staff getTimeline()').toEqual([])
  })

  it('never imports staff-only tables', () => {
    const offenders = sources.flatMap((s) =>
      schemaImports(s.source)
        .filter((name) => STAFF_ONLY_TABLES.includes(name))
        .map((name) => `${s.file}: ${name}`),
    )
    expect(offenders, 'portal code imports a staff-only table').toEqual([])
  })

  it('renders the feed from the client-only timeline and client-visible items', () => {
    const page = sources.find((s) => s.file === path.join('[engagementId]', 'page.tsx'))
    expect(page?.source).toMatch(/\.getClientTimeline\s*\(/)
    expect(page?.source).toMatch(/\.listForClient\s*\(/)
  })

  it('lists payments only through listForClient (client-visible, not voided, no folio)', () => {
    const page = sources.find((s) => s.file === path.join('[engagementId]', 'page.tsx'))
    expect(page?.source).toMatch(/PaymentEvidenceService\([^)]*\)\s*\.listForClient\s*\(/)
    const offenders = sources
      .filter((s) => /PaymentEvidenceService\([^)]*\)\s*\.(list|getById)\s*\(/.test(s.source))
      .map((s) => s.file)
    expect(offenders).toEqual([])
  })

  it('checks evidence access on the receipt route', () => {
    const route = sources.find(
      (s) => s.file === path.join('[engagementId]', 'payments', '[evidenceId]', 'file', 'route.ts'),
    )
    expect(route?.source).toMatch(/resolvePortalAccess\s*\(/)
    expect(route?.source).toMatch(/canViewEvidence\s*\(/)
  })

  it('never lists all engagement items', () => {
    const offenders = sources
      .filter((s) => /EngagementItemsService\([^)]*\)\s*\.list\s*\(/.test(s.source))
      .map((s) => s.file)
    expect(offenders).toEqual([])
  })

  it('gates every portal route on resolvePortalAccess', () => {
    for (const file of [
      path.join('[engagementId]', 'page.tsx'),
      path.join('[engagementId]', 'checkout', 'route.ts'),
      path.join('[engagementId]', 'signoff', 'route.ts'),
    ]) {
      const source = sources.find((s) => s.file === file)?.source ?? ''
      expect(source, file).toMatch(/resolvePortalAccess\s*\(/)
    }
  })
})
