/**
 * Drift guard for the MCP coverage contract: walks the REAL tRPC router, so a
 * procedure added tomorrow fails here until it is given a tool or a reason.
 */
import { appRouter } from '@phynd/api/router'
import { describe, expect, it } from 'vitest'

import { MCP_COVERAGE, type ProcedureCoverage, isCovered } from '../coverage'
import { MCP_TOOLS } from '../tools'

interface ProcedureDef {
  _def: { type?: string; query?: boolean; mutation?: boolean }
}

/** `<router>.<procedure>` → `query` | `mutation` | …, from the router itself. */
function procedures(): Map<string, string> {
  const flat = (appRouter as unknown as { _def: { procedures: Record<string, ProcedureDef> } })._def
    .procedures
  const result = new Map<string, string>()
  for (const [path, procedure] of Object.entries(flat)) {
    const def = procedure._def
    result.set(path, def.type ?? (def.mutation ? 'mutation' : def.query ? 'query' : 'unknown'))
  }
  return result
}

function entryFor(path: string): { key: string; entry: ProcedureCoverage } | null {
  const exact = MCP_COVERAGE[path]
  if (exact) return { key: path, entry: exact }
  const wildcard = `${path.split('.')[0]}.*`
  const whole = MCP_COVERAGE[wildcard]
  return whole ? { key: wildcard, entry: whole } : null
}

describe('MCP coverage contract', () => {
  const all = procedures()

  it('sees the real router', () => {
    expect(all.size).toBeGreaterThan(150)
    expect(all.get('contacts.list')).toBe('query')
    expect(all.get('contacts.delete')).toBe('mutation')
  })

  it('every tRPC procedure is covered by a tool or exempted with a reason', () => {
    const missing = [...all.keys()].filter((path) => entryFor(path) === null)
    expect(missing).toEqual([])
  })

  it('every entry names a procedure that exists', () => {
    const used = new Set([...all.keys()].map((path) => entryFor(path)?.key))
    const stale = Object.keys(MCP_COVERAGE).filter((key) => !used.has(key))
    expect(stale).toEqual([])
  })

  it('a router with a covered procedure lists every procedure exactly', () => {
    const coveredRouters = new Set(
      Object.entries(MCP_COVERAGE)
        .filter(([, entry]) => isCovered(entry))
        .map(([key]) => key.split('.')[0]),
    )
    for (const name of coveredRouters) {
      expect(MCP_COVERAGE[`${String(name)}.*`]).toBeUndefined()
    }
  })

  it('this slice is read-only: no mutation is covered', () => {
    const coveredMutations = [...all.entries()]
      .filter(([path, type]) => {
        const match = entryFor(path)
        return type !== 'query' && match !== null && isCovered(match.entry)
      })
      .map(([path]) => path)
    expect(coveredMutations).toEqual([])
  })

  it('writes, campaign sending and consent are exempt, reads included', () => {
    for (const [path, type] of all) {
      const router = path.split('.')[0]
      const exempt = !isCovered(entryFor(path)?.entry ?? { exempt: '' })
      if (type === 'mutation') expect(exempt, path).toBe(true)
      if (router === 'consent' || router === 'campaigns' || router === 'campaignAuthorizations') {
        expect(exempt, path).toBe(true)
      }
    }
  })

  it('every tool covers a procedure, and every covered tool exists', () => {
    const published = MCP_TOOLS.map((tool) => tool.name).sort()
    const covering = [
      ...new Set(
        Object.values(MCP_COVERAGE).flatMap((entry) => (isCovered(entry) ? entry.tools : [])),
      ),
    ].sort()
    expect(covering).toEqual(published)
  })

  it('every exemption states a reason', () => {
    for (const [key, entry] of Object.entries(MCP_COVERAGE)) {
      if (!isCovered(entry)) expect(entry.exempt.length, key).toBeGreaterThan(20)
      else expect(entry.service, key).toMatch(/^[A-Z]\w+Service\.\w+$/)
    }
  })
})
