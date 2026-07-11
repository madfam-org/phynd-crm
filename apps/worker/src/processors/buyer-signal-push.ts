import { DEFAULT_TENANT_ID } from '@phynd/config/constants'
import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import { type ServiceContext, pushBuyerSignalsToSelva } from '@phynd/services'
import type { Job } from 'bullmq'
import { getCacheManager } from '../lib/federation'

const logger = createLogger('worker:buyer-signal-push')

/**
 * Rolling high-water mark for the buyer-signal export window (RFC 0031 loop).
 *
 * Starts at worker boot so a restart never re-pushes aggregates a previous
 * instance already delivered (Selva → Tulana ledger counts are additive, so
 * re-pushing a window would double-count). Advances only when every SKU
 * aggregate POSTed successfully; per the service contract, a failed push is
 * retried from the same high-water mark on the next tick. Trade-off: signals
 * recorded while the worker was down are not exported retroactively.
 */
let highWaterMark = new Date()

/**
 * BullMQ processor: aggregate campaign buyer signals recorded since the last
 * successful run and push per-SKU feedback to Selva
 * `/api/v1/campaigns/tulana-feedback` (which forwards to Tulana's ledger).
 *
 * Runs as a repeatable job every 15 minutes. Scheduling is env-guarded at
 * startup in `index.ts` via `isBuyerSignalPushConfigured`; the service itself
 * is additionally a clean no-op (`{ skipped: true }`) when Selva credentials
 * are missing, so an unguarded run never errors.
 */
export async function processBuyerSignalPush(job: Job): Promise<void> {
  const db = getDb()
  const cache = getCacheManager()
  const ctx: ServiceContext = {
    db,
    cache,
    auth: {
      userId: 'system',
      tenantId: DEFAULT_TENANT_ID,
      roles: ['admin'],
      scopes: ['*'],
      accessToken: '',
    },
    tenantId: DEFAULT_TENANT_ID,
  }

  const since = highWaterMark
  // Capture the window end before the export query runs so signals recorded
  // mid-run fall into the next window instead of being skipped.
  const windowEnd = new Date()

  const result = await pushBuyerSignalsToSelva(ctx, { since })

  if (result.skipped) {
    logger.info(
      { jobId: job.id, reason: result.reason },
      'Buyer-signal push skipped — Selva not configured',
    )
    return
  }

  if (result.pushed === result.skus) {
    highWaterMark = windowEnd
  }

  logger.info(
    { jobId: job.id, since: since.toISOString(), ...result },
    `Buyer-signal push completed: ${result.pushed}/${result.skus} SKU aggregate(s) pushed`,
  )
}
