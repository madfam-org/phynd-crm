import { portalCopy } from '@/lib/portal/copy'
import { groupPortalItems } from '@/lib/portal/items'
import type { ClientEngagementItem, ClientTimelineEntry } from '@phynd/services'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PortalActivity } from '../portal-commerce'
import { PortalItems } from '../portal-items'

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

const items = [
  item({
    id: 'm',
    kind: 'milestone',
    title: 'Arranque',
    status: 'done',
    completedAt: new Date('2026-09-01T18:00:00Z'),
  }),
  item({ id: 'a1', kind: 'actionable', side: 'madfam', title: 'Configurar entorno' }),
  item({ id: 'a2', kind: 'actionable', side: 'client', title: 'Enviar logotipo' }),
  item({
    id: 'q1',
    kind: 'decision',
    side: 'client',
    status: 'awaiting_client',
    title: 'Elegir paleta',
    dueAt: new Date('2020-01-01T18:00:00Z'),
  }),
]

describe('portal item sections', () => {
  it('splits actionables into MADFAM and the reader, in tú', () => {
    const html = renderToStaticMarkup(
      <PortalItems copy={portalCopy('tu')} groups={groupPortalItems(items)} />,
    )
    expect(html).toContain('MADFAM')
    expect(html).toContain('>Tú<')
    expect(html).toContain('Decisiones que esperan tu respuesta')
    expect(html).toContain('Espera tu respuesta')
    expect(html).toContain('Fecha sugerida:')
    expect(html).not.toMatch(/venc|atrasad|retras|overdue/i)
  })

  it('uses usted when the reader has not chosen tú', () => {
    const html = renderToStaticMarkup(
      <PortalItems copy={portalCopy('usted')} groups={groupPortalItems(items)} />,
    )
    expect(html).toContain('>Usted<')
    expect(html).toContain('Decisiones que esperan su respuesta')
    expect(html).not.toMatch(/\btu respuesta\b/)
  })

  it('labels PhyndCRM system events in Spanish and shows staff-written messages', () => {
    const timeline: ClientTimelineEntry[] = [
      {
        id: 'e1',
        createdAt: new Date('2026-10-01T18:00:00Z'),
        eventType: 'dhanam:payment_succeeded',
        status: 'milestone',
        message: 'Payment received: MXN 100.00',
      },
      {
        id: 'e2',
        createdAt: new Date('2026-10-02T18:00:00Z'),
        eventType: 'system:kickoff_held',
        status: 'completed',
        message: 'Arrancamos el proyecto.',
      },
    ]
    const html = renderToStaticMarkup(
      <PortalActivity copy={portalCopy('usted')} timeline={timeline} />,
    )
    expect(html).toContain('Pago recibido')
    expect(html).not.toContain('Payment received')
    expect(html).toContain('Arrancamos el proyecto.')
  })
})
