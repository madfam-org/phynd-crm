import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import {
  dispatchPendingProductionDispatches,
  dispatchProductionDispatchReference,
} from '@phynd/services'
import type { Job } from 'bullmq'

const logger = createLogger('worker:production-dispatch')

export interface ProductionDispatchData {
  limit?: number
  referenceId?: string
}

export async function processProductionDispatch(job: Job<ProductionDispatchData>): Promise<void> {
  const db = getDb()
  const limit = job.data.limit ?? productionDispatchScanLimit()

  if (job.data.referenceId) {
    const result = await dispatchProductionDispatchReference(db, job.data.referenceId)
    logger.info(
      {
        jobId: job.id,
        provider: result.provider,
        referenceId: result.referenceId,
        status: result.status,
      },
      'Production dispatch reference processed',
    )
    return
  }

  const summary = await dispatchPendingProductionDispatches(db, { limit })
  logger.info({ jobId: job.id, ...summary }, 'Production dispatch scan completed')
}

function productionDispatchScanLimit() {
  const parsed = Number.parseInt(process.env.PRODUCTION_DISPATCH_SCAN_LIMIT ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 25
}
