import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPreheaderHtml, injectPreheader } from '../email/preheader'
import { campaignVariantEmail } from '../email/templates/campaign-variant'
import { lastChanceEmail } from '../email/templates/last-chance'
import { legalTipEmail } from '../email/templates/legal-tip'
import { trialInviteEmail } from '../email/templates/trial-invite'
import { welcomeEmail } from '../email/templates/welcome'

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
}))

vi.mock('resend', () => ({
  Resend: vi.fn(() => ({ emails: { send: sendMock } })),
}))

describe('injectPreheader', () => {
  const html = '<!DOCTYPE html><html><head></head><body style="margin:0;"><p>Hola</p></body></html>'

  it('inserts a hidden preheader div right after the opening body tag', () => {
    const result = injectPreheader(html, 'Vista previa del correo')

    const bodyIndex = result.indexOf('<body style="margin:0;">')
    const divIndex = result.indexOf('<div class="preheader"')
    expect(divIndex).toBe(bodyIndex + '<body style="margin:0;">'.length)
    expect(result).toContain('Vista previa del correo')
    // Hidden via the standard pattern
    expect(result).toContain('display:none')
    expect(result).toContain('max-height:0')
    expect(result).toContain('mso-hide:all')
    // Padding keeps body copy out of the inbox preview
    expect(result).toContain('&nbsp;&zwnj;')
    // Original content is untouched
    expect(result).toContain('<p>Hola</p>')
  })

  it('returns the html unchanged when preheader is absent or blank', () => {
    expect(injectPreheader(html)).toBe(html)
    expect(injectPreheader(html, undefined)).toBe(html)
    expect(injectPreheader(html, null)).toBe(html)
    expect(injectPreheader(html, '   ')).toBe(html)
  })

  it('escapes html in the preheader text', () => {
    const result = injectPreheader(html, '<script>alert("x")</script> & more')
    expect(result).not.toContain('<script>')
    expect(result).toContain('&lt;script&gt;')
    expect(result).toContain('&amp; more')
  })

  it('prepends the div when the html has no body tag', () => {
    const fragment = '<p>Fragment</p>'
    const result = injectPreheader(fragment, 'Preview')
    expect(result.startsWith('<div class="preheader"')).toBe(true)
    expect(result.endsWith(fragment)).toBe(true)
  })

  it('buildPreheaderHtml renders the hidden div', () => {
    const div = buildPreheaderHtml('Texto')
    expect(div).toContain('Texto')
    expect(div).toContain('display:none')
  })
})

describe('drip templates expose preheaders', () => {
  it.each([
    ['welcome', () => welcomeEmail({ domain: 'labor' })],
    ['legal-tip', () => legalTipEmail({ domain: 'labor' })],
    ['trial-invite', () => trialInviteEmail()],
    ['last-chance', () => lastChanceEmail()],
  ])('%s returns a non-empty preheader', (_name, build) => {
    const email = build()
    expect(email.preheader).toBeTruthy()
    expect((email.preheader ?? '').length).toBeLessThanOrEqual(150)
    // Preheader is injected at send time, not baked into the template html
    expect(email.html).not.toContain('class="preheader"')
  })
})

describe('campaignVariantEmail', () => {
  it('renders a structured variant with preheader, cta link and unsubscribe', () => {
    const email = campaignVariantEmail({
      subject: 'Asunto del variant',
      preheader: 'Vista previa generada',
      body: 'Cuerpo con claims.\nSegunda línea.',
      cta: 'Agenda una demo',
      ctaUrl: 'https://example.com/demo',
      unsubscribeUrl: 'https://example.com/unsub',
    })

    expect(email.subject).toBe('Asunto del variant')
    expect(email.preheader).toBe('Vista previa generada')
    expect(email.html).toContain('Cuerpo con claims.')
    expect(email.html).toContain('href="https://example.com/demo"')
    expect(email.html).toContain('Agenda una demo')
    expect(email.html).toContain('https://example.com/unsub')
  })

  it('omits the preheader key and cta cleanly when not provided', () => {
    const email = campaignVariantEmail({ subject: 'S', body: 'B' })
    expect(email.preheader).toBeUndefined()
    expect(email.html).not.toContain('<a href')
  })

  it('escapes html in variant content', () => {
    const email = campaignVariantEmail({ subject: 'S', body: '<img src=x onerror=alert(1)>' })
    expect(email.html).not.toContain('<img')
    expect(email.html).toContain('&lt;img')
  })
})

describe('EmailService preheader plumbing', () => {
  beforeEach(() => {
    sendMock.mockReset()
    sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null })
    process.env.RESEND_API_KEY = 'test-key'
  })

  it('injects the hidden preheader into the outgoing html', async () => {
    const { EmailService } = await import('../email/email.service')
    const service = new EmailService()

    await service.send({
      to: 'user@example.com',
      subject: 'Subject',
      html: '<body><p>Body</p></body>',
      preheader: 'Preview text',
    })

    expect(sendMock).toHaveBeenCalledTimes(1)
    const payload = sendMock.mock.calls[0]?.[0] as { html: string }
    expect(payload.html).toContain('class="preheader"')
    expect(payload.html).toContain('Preview text')
    expect(payload.html.indexOf('Preview text')).toBeLessThan(payload.html.indexOf('<p>Body</p>'))
  })

  it('sends html untouched when no preheader is provided', async () => {
    const { EmailService } = await import('../email/email.service')
    const service = new EmailService()

    await service.send({
      to: 'user@example.com',
      subject: 'Subject',
      html: '<body><p>Body</p></body>',
    })

    const payload = sendMock.mock.calls[0]?.[0] as { html: string }
    expect(payload.html).toBe('<body><p>Body</p></body>')
  })
})
