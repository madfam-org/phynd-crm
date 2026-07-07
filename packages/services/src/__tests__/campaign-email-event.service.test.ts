import { describe, expect, it } from 'vitest'
import {
  CampaignEmailEventService,
  type ResendWebhookEvent,
} from '../campaigns/campaign-email-event.service'
import { type MockDatabase, createTestContext } from './helpers'

function sequenceResults(db: MockDatabase, results: unknown[]) {
  let call = 0
  db._qb.then.mockImplementation((resolve: (v: unknown) => void) => {
    const result = call < results.length ? results[call] : []
    call += 1
    return Promise.resolve(result).then(resolve)
  })
}

function makeEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-001',
    emailId: 're_123',
    recipient: 'persona@example.mx',
    eventType: 'opened',
    campaignId: null,
    contactId: null,
    leadId: null,
    url: null,
    dedupKey: 'msg_abc',
    metadata: {},
    occurredAt: new Date('2026-07-06T00:00:00Z'),
    createdAt: new Date('2026-07-06T00:00:00Z'),
    ...overrides,
  }
}

function openedEvent(overrides: Partial<ResendWebhookEvent['data']> = {}): ResendWebhookEvent {
  return {
    type: 'email.opened',
    created_at: '2026-07-06T12:00:00.000Z',
    data: {
      email_id: 're_123',
      to: ['Persona@Example.MX'],
      subject: 'Hola',
      tags: { campaign_id: 'campaign-001', contact_id: 'contact-001' },
      ...overrides,
    },
  }
}

describe('CampaignEmailEventService.record', () => {
  it('persists an event row with a lowercase recipient', async () => {
    const ctx = createTestContext()
    sequenceResults(ctx.mockDb, [[], [makeEventRow()]])

    const service = new CampaignEmailEventService(ctx)
    const result = await service.record({
      eventType: 'sent',
      recipient: 'Persona@Example.MX',
      emailId: 're_123',
      dedupKey: 'sent:re_123',
    })

    expect(result.deduplicated).toBe(false)
    const values = ctx.mockDb._qb.values.mock.calls[0]?.[0]
    expect(values.recipient).toBe('persona@example.mx')
    expect(values.eventType).toBe('sent')
  })

  it('deduplicates by dedupKey (idempotent webhook redelivery)', async () => {
    const ctx = createTestContext()
    sequenceResults(ctx.mockDb, [[{ id: 'event-001' }]])

    const service = new CampaignEmailEventService(ctx)
    const result = await service.record({
      eventType: 'opened',
      recipient: 'persona@example.mx',
      dedupKey: 'msg_abc',
    })

    expect(result.deduplicated).toBe(true)
    expect(ctx.mockDb.insert).not.toHaveBeenCalled()
  })
})

describe('CampaignEmailEventService.ingestResendEvent', () => {
  it('records an opened event and a buyer signal for a SKU campaign', async () => {
    const ctx = createTestContext()
    sequenceResults(ctx.mockDb, [
      [], // dedup lookup (record)
      [makeEventRow({ campaignId: 'campaign-001', contactId: 'contact-001' })], // insert event
      [{ skuKey: 'sku-tezca-pro', orchestrator: null, tulanaMetadata: null }], // campaign lookup
      [], // buyer signal dedup lookup
      [{ id: 'signal-001' }], // buyer signal insert
    ])

    const service = new CampaignEmailEventService(ctx)
    const result = await service.ingestResendEvent(openedEvent(), 'msg_abc')

    expect(result.handled).toBe(true)
    expect(result.deduplicated).toBe(false)
    expect(result.eventType).toBe('opened')
    expect(result.campaignId).toBe('campaign-001')

    // Buyer signal insert carries the SKU + one-signal-per-event-type dedup
    const signalValues = ctx.mockDb._qb.values.mock.calls[1]?.[0]
    expect(signalValues.skuKey).toBe('sku-tezca-pro')
    expect(signalValues.eventType).toBe('opened')
    expect(signalValues.dedupKey).toBe('opened:campaign-001:contact-001')
  })

  it('captures the clicked link URL', async () => {
    const ctx = createTestContext()
    sequenceResults(ctx.mockDb, [
      [], // dedup lookup
      [makeEventRow({ eventType: 'clicked' })], // insert event
      [], // campaign lookup (no campaign row)
    ])

    const service = new CampaignEmailEventService(ctx)
    const event: ResendWebhookEvent = {
      ...openedEvent({ click: { link: 'https://karafiel.madfam.io/planes' } }),
      type: 'email.clicked',
    }
    const result = await service.ingestResendEvent(event, 'msg_click')

    expect(result.handled).toBe(true)
    const values = ctx.mockDb._qb.values.mock.calls[0]?.[0]
    expect(values.eventType).toBe('clicked')
    expect(values.url).toBe('https://karafiel.madfam.io/planes')
  })

  it('adds a suppression entry on complaint (suppression wins thereafter)', async () => {
    const ctx = createTestContext()
    sequenceResults(ctx.mockDb, [
      [], // dedup lookup
      [makeEventRow({ eventType: 'complained' })], // insert event
      [], // suppression existing lookup
      [{ id: 'sup-001', identifier: 'persona@example.mx', channel: 'email' }], // suppression insert
      [{ skuKey: 'sku-tezca-pro', orchestrator: null, tulanaMetadata: null }], // campaign lookup
      [], // buyer signal dedup
      [{ id: 'signal-002' }], // buyer signal insert
    ])

    const service = new CampaignEmailEventService(ctx)
    const event: ResendWebhookEvent = { ...openedEvent(), type: 'email.complained' }
    const result = await service.ingestResendEvent(event, 'msg_complaint')

    expect(result.suppressionAdded).toBe(true)
    const suppressionValues = ctx.mockDb._qb.values.mock.calls[1]?.[0]
    expect(suppressionValues.identifier).toBe('persona@example.mx')
    expect(suppressionValues.channel).toBe('email')
    expect(suppressionValues.reason).toBe('complaint')
    expect(suppressionValues.source).toBe('resend_webhook')
  })

  it('adds a hard_bounce suppression entry on bounce', async () => {
    const ctx = createTestContext()
    sequenceResults(ctx.mockDb, [
      [], // dedup lookup
      [makeEventRow({ eventType: 'bounced' })], // insert event
      [], // suppression existing lookup
      [{ id: 'sup-002' }], // suppression insert
      [], // campaign lookup — none
    ])

    const service = new CampaignEmailEventService(ctx)
    const event: ResendWebhookEvent = {
      ...openedEvent({ bounce: { type: 'Permanent', message: 'mailbox unavailable' } }),
      type: 'email.bounced',
    }
    const result = await service.ingestResendEvent(event, 'msg_bounce')

    expect(result.suppressionAdded).toBe(true)
    const suppressionValues = ctx.mockDb._qb.values.mock.calls[1]?.[0]
    expect(suppressionValues.reason).toBe('hard_bounce')
  })

  it('short-circuits on redelivered webhook messages', async () => {
    const ctx = createTestContext()
    sequenceResults(ctx.mockDb, [[{ id: 'event-001' }]])

    const service = new CampaignEmailEventService(ctx)
    const result = await service.ingestResendEvent(openedEvent(), 'msg_abc')

    expect(result.deduplicated).toBe(true)
    expect(ctx.mockDb.insert).not.toHaveBeenCalled()
  })

  it('ignores unknown event types', async () => {
    const ctx = createTestContext()
    const service = new CampaignEmailEventService(ctx)
    const result = await service.ingestResendEvent(
      { type: 'contact.updated', data: {} },
      'msg_other',
    )
    expect(result.handled).toBe(false)
    expect(ctx.mockDb.select).not.toHaveBeenCalled()
  })

  it('resolves the contact by email when no contact_id tag is present', async () => {
    const ctx = createTestContext()
    sequenceResults(ctx.mockDb, [
      [{ id: 'contact-777' }], // contact lookup by email
      [], // dedup lookup
      [makeEventRow({ contactId: 'contact-777' })], // insert event
      [], // campaign lookup — no campaign tag path still queries? (campaignId null → skip)
    ])

    const service = new CampaignEmailEventService(ctx)
    const event = openedEvent({ tags: { drip_step: '2', lead_id: 'lead-001' } })
    const result = await service.ingestResendEvent(event, 'msg_drip')

    expect(result.contactId).toBe('contact-777')
    const values = ctx.mockDb._qb.values.mock.calls[0]?.[0]
    expect(values.leadId).toBe('lead-001')
    expect(values.metadata.dripStep).toBe('2')
  })

  it('supports array-shaped tags (send API format)', async () => {
    const ctx = createTestContext()
    sequenceResults(ctx.mockDb, [
      [], // dedup lookup
      [makeEventRow()], // insert event
      [], // campaign lookup returns nothing
    ])

    const service = new CampaignEmailEventService(ctx)
    const event = openedEvent({
      tags: [
        { name: 'campaign_id', value: 'campaign-009' },
        { name: 'contact_id', value: 'contact-009' },
      ],
    })
    const result = await service.ingestResendEvent(event, 'msg_tags')
    expect(result.campaignId).toBe('campaign-009')
    expect(result.contactId).toBe('contact-009')
  })
})
