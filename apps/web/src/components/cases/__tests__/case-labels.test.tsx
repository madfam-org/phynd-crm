import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  CASE_STATUS_LABELS,
  CASE_TYPE_LABELS,
  CaseOverdueBadge,
  CaseStatusBadge,
  caseTypeLabel,
  formatCaseDate,
} from '../case-labels'

const NOW = new Date('2026-11-20T00:00:00.000Z')

describe('case labels', () => {
  it('names every type and status in Spanish', () => {
    expect(CASE_TYPE_LABELS).toEqual({
      support: 'Soporte',
      refund: 'Reembolso',
      data_rights: 'Derechos ARCO',
      invoice_correction: 'Corrección de factura',
    })
    expect(CASE_STATUS_LABELS).toEqual({
      open: 'Abierto',
      in_progress: 'En curso',
      resolved: 'Resuelto',
    })
    expect(caseTypeLabel('unknown')).toBe('unknown')
    expect(renderToStaticMarkup(<CaseStatusBadge status="in_progress" />)).toContain('En curso')
  })

  it('flags an unresolved case past its due date as Vencido, and nothing else', () => {
    const past = '2026-11-19T00:00:00.000Z'
    expect(
      renderToStaticMarkup(<CaseOverdueBadge row={{ status: 'open', dueAt: past }} now={NOW} />),
    ).toContain('Vencido')
    expect(
      renderToStaticMarkup(
        <CaseOverdueBadge row={{ status: 'resolved', dueAt: past }} now={NOW} />,
      ),
    ).toBe('')
    expect(
      renderToStaticMarkup(
        <CaseOverdueBadge row={{ status: 'open', dueAt: '2026-11-21T00:00:00.000Z' }} now={NOW} />,
      ),
    ).toBe('')
  })

  it('shows dates in Mexico City time', () => {
    expect(formatCaseDate(null)).toBe('—')
    expect(formatCaseDate('2026-11-18T05:59:59.999Z')).toContain('23:59')
  })
})
