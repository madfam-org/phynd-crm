import type { ClientEngagementItem } from '@phynd/services'
import { describe, expect, it } from 'vitest'
import { portalCopy } from '../copy'
import { groupPortalItems, itemDateLine, itemTone } from '../items'

function item(overrides: Partial<ClientEngagementItem>): ClientEngagementItem {
  return {
    id: overrides.id ?? 'i',
    kind: 'actionable',
    title: 'Elemento sintético',
    description: null,
    status: 'planned',
    side: 'madfam',
    dueAt: null,
    completedAt: null,
    artifactTitle: null,
    artifactUrl: null,
    ...overrides,
  }
}

const copy = portalCopy('usted')

describe('groupPortalItems', () => {
  it('splits progress, actionables by side, and decisions by side and state', () => {
    const groups = groupPortalItems([
      item({ id: 'm', kind: 'milestone' }),
      item({ id: 'd', kind: 'deliverable' }),
      item({ id: 'a1', kind: 'actionable', side: 'madfam' }),
      item({ id: 'a2', kind: 'actionable', side: 'client' }),
      item({ id: 'q1', kind: 'decision', side: 'client', status: 'awaiting_client' }),
      item({ id: 'q2', kind: 'decision', side: 'madfam' }),
      item({ id: 'q3', kind: 'decision', side: 'client', status: 'done' }),
    ])
    const ids = (list: ClientEngagementItem[]) => list.map((i) => i.id)
    expect(ids(groups.progress)).toEqual(['m', 'd'])
    expect(ids(groups.actionables.madfam)).toEqual(['a1'])
    expect(ids(groups.actionables.client)).toEqual(['a2'])
    expect(ids(groups.clientDecisions)).toEqual(['q1'])
    expect(ids(groups.madfamDecisions)).toEqual(['q2'])
    expect(ids(groups.decidedDecisions)).toEqual(['q3'])
  })
})

describe('item dates and tone', () => {
  const longAgo = new Date('2020-01-15T18:00:00Z')

  it('never presents a decision awaiting the client as overdue', () => {
    const decision = item({
      kind: 'decision',
      side: 'client',
      status: 'awaiting_client',
      dueAt: longAgo,
    })
    const line = itemDateLine(decision, copy) ?? ''
    expect(line.startsWith('Fecha sugerida:')).toBe(true)
    expect(line).not.toMatch(/venc|atras|retras|overdue|late/i)
    expect(itemTone(decision)).toBe('neutral')
  })

  it('shows target dates for other items, and when done items were done', () => {
    expect(itemDateLine(item({ kind: 'milestone', dueAt: longAgo }), copy)).toMatch(
      /^Fecha objetivo:/,
    )
    expect(
      itemDateLine(item({ kind: 'deliverable', status: 'done', completedAt: longAgo }), copy),
    ).toMatch(/^Listo el/)
    expect(itemDateLine(item({}), copy)).toBeNull()
  })

  it('has no warning tone at all', () => {
    for (const status of [
      'planned',
      'in_progress',
      'done',
      'blocked',
      'awaiting_client',
    ] as const) {
      expect(['done', 'active', 'neutral']).toContain(itemTone(item({ status })))
    }
  })
})
