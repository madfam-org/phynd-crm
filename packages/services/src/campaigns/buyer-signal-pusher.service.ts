import type { ServiceContext } from '../context'
import {
  CampaignBuyerSignalService,
  type TulanaBuyerSignalExport,
} from './campaign-buyer-signal.service'

type EnvMap = Record<string, string | undefined>

/**
 * PhyndCRM → Selva buyer-signal pusher (RFC 0031 loop).
 *
 * PhyndCRM records buyer signals locally (Resend opens/clicks/bounces via the
 * event webhook, plus delivered/suppressed from the send path), but nothing
 * pushed them back to Selva — so PhyndCRM-origin outcomes never reached
 * Tulana's ledger. This closes that leg: it aggregates recent signals per SKU
 * into Selva's `/campaigns/tulana-feedback` shape and POSTs them; Selva's
 * already-wired `push_tulana_buyer_signal` forwards them to Tulana.
 *
 * Inert until configured: with no SELVA_API_URL / SELVA_API_KEY the pusher is a
 * no-op that returns { pushed: 0, skipped: true }, so a dry run never fails.
 * Intended to run on a schedule (a worker processor) with a rolling `since`
 * high-water mark.
 */

export interface BuyerSignalPushResult {
  pushed: number
  skus: number
  skipped?: boolean
  reason?: string
}

interface SelvaConfig {
  base: string
  apiKey: string
}

function resolveSelvaConfig(env: EnvMap): SelvaConfig | null {
  const base = (env.SELVA_API_URL ?? env.SELVA_BASE_URL)?.replace(/\/$/, '')
  const apiKey = env.SELVA_API_KEY ?? env.WORKER_API_TOKEN
  if (!base || !apiKey) return null
  return { base, apiKey }
}

/**
 * Whether Selva credentials are present, i.e. whether `pushBuyerSignalsToSelva`
 * would do real work instead of returning `{ skipped: true }`. The worker uses
 * this to decide whether to schedule the repeatable push job at startup (one
 * log line, no per-tick noise) — keep it the single source of truth so the
 * scheduling guard and the service no-op can never diverge.
 */
export function isBuyerSignalPushConfigured(env: EnvMap = process.env): boolean {
  return resolveSelvaConfig(env) !== null
}

/**
 * Aggregate one SKU's signals into a Selva TulanaFeedbackRequest. Outcomes are
 * per-event-type counts (PII-free) plus the signal-strength mix, which is the
 * shape Tulana's SelvaBuyerSignalEvent ledger expects.
 */
function aggregateSkuFeedback(skuKey: string, rows: TulanaBuyerSignalExport[]) {
  const byEvent = new Map<string, number>()
  for (const row of rows) {
    byEvent.set(row.event_type, (byEvent.get(row.event_type) ?? 0) + 1)
  }
  const outcomes = [...byEvent.entries()].map(([metric, value]) => ({
    metric,
    value,
    source: 'phyndcrm_campaign',
  }))
  const campaignId = rows[0]?.campaign_id
  const total = rows.length
  return {
    sku_key: skuKey,
    summary: `${total} PhyndCRM campaign signal(s): ${outcomes
      .map((o) => `${o.metric}=${o.value}`)
      .join(', ')}`,
    outcomes,
    ...(campaignId ? { campaign_name: campaignId } : {}),
  }
}

async function postFeedback(
  config: SelvaConfig,
  payload: ReturnType<typeof aggregateSkuFeedback>,
  fetcher: typeof fetch,
): Promise<boolean> {
  try {
    const res = await fetcher(`${config.base}/api/v1/campaigns/tulana-feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    })
    return res.ok
  } catch {
    // A push failure must not fail the scheduled run; the next tick retries
    // from the same high-water mark.
    return false
  }
}

/**
 * Pull recent PhyndCRM buyer signals and push per-SKU aggregates to Selva.
 * `since` is the high-water mark the caller advances between runs.
 */
export async function pushBuyerSignalsToSelva(
  ctx: ServiceContext,
  options: { since?: Date; limit?: number; env?: EnvMap; fetcher?: typeof fetch } = {},
): Promise<BuyerSignalPushResult> {
  const config = resolveSelvaConfig(options.env ?? process.env)
  if (!config) {
    return { pushed: 0, skus: 0, skipped: true, reason: 'not_configured' }
  }

  const signalService = new CampaignBuyerSignalService(ctx)
  const rows = await signalService.listForTulanaExport({
    since: options.since,
    limit: options.limit ?? 500,
  })
  if (rows.length === 0) {
    return { pushed: 0, skus: 0 }
  }

  const bySku = new Map<string, TulanaBuyerSignalExport[]>()
  for (const row of rows) {
    const list = bySku.get(row.sku_key) ?? []
    list.push(row)
    bySku.set(row.sku_key, list)
  }

  const fetcher = options.fetcher ?? fetch
  let pushed = 0
  for (const [skuKey, skuRows] of bySku) {
    const ok = await postFeedback(config, aggregateSkuFeedback(skuKey, skuRows), fetcher)
    if (ok) pushed += 1
  }

  return { pushed, skus: bySku.size }
}
