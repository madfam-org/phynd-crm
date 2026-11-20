import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSend = vi.fn()
const mockGetById = vi.fn()
vi.mock('@phynd/services', () => ({
  EmailService: vi.fn().mockImplementation(() => ({ send: mockSend })),
  LeadsService: vi.fn().mockImplementation(() => ({ getById: mockGetById })),
}))

const mockLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('@phynd/logging', () => ({ createLogger: () => mockLogger }))

import {
  DEFAULT_LEADS_NOTIFY_EMAIL,
  type LeadAlert,
  leadAlertHtml,
  leadAlertRecipients,
  leadAlertSubject,
  leadAlertUrl,
  leadTierOf,
  sendLeadAlert,
} from '../lead-alert'

const alert = (overrides: Partial<LeadAlert> = {}): LeadAlert => ({
  feed: 'avala',
  sourceLabel: 'Avala · producto-comply',
  leadId: 'lead-1',
  contactId: 'contact-1',
  tier: 'A',
  isTest: false,
  ...overrides,
})

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV }
  delete process.env.LEADS_NOTIFY_EMAIL
  delete process.env.PHYND_DEPLOYMENT_TIER
  mockSend.mockReset().mockResolvedValue({ id: 'resend-1' })
  mockGetById.mockReset()
  mockLogger.error.mockReset()
})

describe('leadAlertRecipients', () => {
  it('defaults to hola@madfam.io (ruling V8)', () => {
    expect(DEFAULT_LEADS_NOTIFY_EMAIL).toBe('hola@madfam.io')
    expect(leadAlertRecipients({})).toEqual(['hola@madfam.io'])
    expect(leadAlertRecipients({ LEADS_NOTIFY_EMAIL: ' , ' })).toEqual(['hola@madfam.io'])
  })

  it('reads LEADS_NOTIFY_EMAIL as a comma-separated list', () => {
    expect(
      leadAlertRecipients({ LEADS_NOTIFY_EMAIL: ' a@example.test , b@example.test,, ' }),
    ).toEqual(['a@example.test', 'b@example.test'])
  })

  it('no longer falls back to the old nauta-only variable', () => {
    expect(leadAlertRecipients({ NAUTA_LEADS_NOTIFY_EMAIL: 'n@example.test' })).toEqual([
      'hola@madfam.io',
    ])
  })
})

describe('leadAlertSubject', () => {
  it('names the source and the tier only', () => {
    expect(leadAlertSubject(alert(), {})).toBe('Nuevo lead · Avala · producto-comply · Tier A')
    expect(leadAlertSubject(alert({ tier: null }), {})).toBe(
      'Nuevo lead · Avala · producto-comply · Tier sin calcular',
    )
  })

  it('marks staging', () => {
    expect(leadAlertSubject(alert(), { PHYND_DEPLOYMENT_TIER: 'staging' })).toMatch(
      /^\[staging\] Nuevo lead/,
    )
  })
})

describe('leadAlertHtml', () => {
  it('carries source, tier and the link to the lead, escaped', () => {
    const html = leadAlertHtml(alert({ sourceLabel: 'Avala · <b>x</b>' }))
    expect(html).toContain('https://crm.madfam.io/leads/lead-1')
    expect(html).toContain('Avala · &lt;b&gt;x&lt;/b&gt;')
    expect(html).toContain('>A<')
    expect(html).not.toContain('<b>x</b>')
  })

  it('links the list while there is no lead id', () => {
    expect(leadAlertUrl(null)).toBe('https://crm.madfam.io/leads')
  })
})

describe('sendLeadAlert', () => {
  it('sends one email to the default inbox with no personal data in subject or preview', async () => {
    const sent = await sendLeadAlert(alert({ detailsHtml: '<p>Nombre: Persona Ficticia</p>' }))
    expect(sent).toBe(true)
    expect(mockSend).toHaveBeenCalledTimes(1)
    const email = mockSend.mock.calls[0]?.[0] as {
      to: string
      subject: string
      preheader: string
      html: string
      tags: Array<{ name: string; value: string }>
    }
    expect(email.to).toBe('hola@madfam.io')
    expect(email.subject).not.toContain('Persona')
    expect(email.preheader).toBe('Tier A · Avala · producto-comply')
    expect(email.html).toContain('Persona Ficticia')
    expect(email.tags).toEqual([
      { name: 'source', value: 'avala' },
      { name: 'lead_id', value: 'lead-1' },
      { name: 'contact_id', value: 'contact-1' },
    ])
  })

  it('sends nothing for a test lead', async () => {
    expect(await sendLeadAlert(alert({ isTest: true }))).toBe(false)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('never throws on a provider error', async () => {
    mockSend.mockRejectedValueOnce(new Error('provider down'))
    expect(await sendLeadAlert(alert())).toBe(false)
    expect(mockLogger.error).toHaveBeenCalledTimes(1)
  })
})

describe('leadTierOf', () => {
  it('reads the scored tier, null when unscored, unknown or unreadable', async () => {
    const ctx = {} as never
    mockGetById.mockResolvedValueOnce({ tier: 'B' })
    expect(await leadTierOf(ctx, 'lead-1')).toBe('B')
    mockGetById.mockResolvedValueOnce({ tier: null })
    expect(await leadTierOf(ctx, 'lead-1')).toBeNull()
    mockGetById.mockResolvedValueOnce({ tier: 'Z' })
    expect(await leadTierOf(ctx, 'lead-1')).toBeNull()
    mockGetById.mockRejectedValueOnce(new Error('db down'))
    expect(await leadTierOf(ctx, 'lead-1')).toBeNull()
  })
})
