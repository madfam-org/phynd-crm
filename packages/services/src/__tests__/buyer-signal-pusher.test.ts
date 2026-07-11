import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isBuyerSignalPushConfigured,
  pushBuyerSignalsToSelva,
} from '../campaigns/buyer-signal-pusher.service'
import * as buyerSignalModule from '../campaigns/campaign-buyer-signal.service'
import type { ServiceContext } from '../context'

const ctx = {} as ServiceContext

function mockExport(rows: unknown[]) {
  vi.spyOn(buyerSignalModule, 'CampaignBuyerSignalService').mockImplementation(
    () =>
      ({
        listForTulanaExport: vi.fn().mockResolvedValue(rows),
      }) as unknown as buyerSignalModule.CampaignBuyerSignalService,
  )
}

describe('pushBuyerSignalsToSelva', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('is skipped (no-op) when Selva is not configured', async () => {
    const result = await pushBuyerSignalsToSelva(ctx, { env: {} })
    expect(result).toEqual({ pushed: 0, skus: 0, skipped: true, reason: 'not_configured' })
  })

  it('returns zero when there are no signals', async () => {
    mockExport([])
    const result = await pushBuyerSignalsToSelva(ctx, {
      env: { SELVA_API_URL: 'https://selva.test', SELVA_API_KEY: 'tok' },
      fetcher: vi.fn(),
    })
    expect(result).toEqual({ pushed: 0, skus: 0 })
  })

  it('aggregates per SKU and POSTs bearer-authed feedback to Selva', async () => {
    mockExport([
      { sku_key: 'avala__issuer', campaign_id: 'c1', event_type: 'delivered' },
      { sku_key: 'avala__issuer', campaign_id: 'c1', event_type: 'delivered' },
      { sku_key: 'avala__issuer', campaign_id: 'c1', event_type: 'opened' },
      { sku_key: 'karafiel__cfdi', campaign_id: 'c2', event_type: 'clicked' },
    ])

    const fetcher = vi.fn().mockResolvedValue({ ok: true })
    const result = await pushBuyerSignalsToSelva(ctx, {
      env: { SELVA_API_URL: 'https://selva.test/', SELVA_API_KEY: 'worker-tok' },
      fetcher: fetcher as unknown as typeof fetch,
    })

    expect(result).toEqual({ pushed: 2, skus: 2 })
    expect(fetcher).toHaveBeenCalledTimes(2)

    const firstCall = fetcher.mock.calls.at(0)
    expect(firstCall?.[0]).toBe('https://selva.test/api/v1/campaigns/tulana-feedback')
    expect(firstCall?.[1].headers.Authorization).toBe('Bearer worker-tok')

    // The avala SKU aggregates 2 delivered + 1 opened into PII-free outcome counts.
    const avalaCall = fetcher.mock.calls.find((c) =>
      (c[1].body as string).includes('avala__issuer'),
    )
    expect(avalaCall).toBeDefined()
    const body = JSON.parse(avalaCall?.[1].body as string)
    expect(body.sku_key).toBe('avala__issuer')
    expect(body.outcomes).toEqual(
      expect.arrayContaining([
        { metric: 'delivered', value: 2, source: 'phyndcrm_campaign' },
        { metric: 'opened', value: 1, source: 'phyndcrm_campaign' },
      ]),
    )
  })

  it('counts only SKUs that POSTed successfully; a failed push does not throw', async () => {
    mockExport([
      { sku_key: 'a', campaign_id: 'c1', event_type: 'delivered' },
      { sku_key: 'b', campaign_id: 'c2', event_type: 'delivered' },
    ])
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error('selva down'))

    const result = await pushBuyerSignalsToSelva(ctx, {
      env: { SELVA_API_URL: 'https://selva.test', SELVA_API_KEY: 'tok' },
      fetcher: fetcher as unknown as typeof fetch,
    })
    expect(result.skus).toBe(2)
    expect(result.pushed).toBe(1)
  })
})

describe('isBuyerSignalPushConfigured', () => {
  it('is false when no Selva env is set', () => {
    expect(isBuyerSignalPushConfigured({})).toBe(false)
  })

  it('is false when only the URL half is set', () => {
    expect(isBuyerSignalPushConfigured({ SELVA_API_URL: 'https://selva.test' })).toBe(false)
  })

  it('is false when only the key half is set', () => {
    expect(isBuyerSignalPushConfigured({ SELVA_API_KEY: 'tok' })).toBe(false)
  })

  it('is true when SELVA_API_URL + SELVA_API_KEY are set', () => {
    expect(
      isBuyerSignalPushConfigured({ SELVA_API_URL: 'https://selva.test', SELVA_API_KEY: 'tok' }),
    ).toBe(true)
  })

  it('honors the SELVA_BASE_URL / WORKER_API_TOKEN fallbacks', () => {
    expect(
      isBuyerSignalPushConfigured({
        SELVA_BASE_URL: 'https://selva.test',
        WORKER_API_TOKEN: 'tok',
      }),
    ).toBe(true)
  })
})
