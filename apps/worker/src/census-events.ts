import { DEFAULT_TENANT_ID } from '@phynd/config/constants'
import { getDb } from '@phynd/db'
import { createLogger } from '@phynd/logging'
import {
  CensusEventConsumer,
  type CensusStreamClient,
  applyCensusOptOut,
  applyCensusPickHandoff,
  createCensusTenantStore,
  readCensusConsumerSettings,
  tenantDatabaseEnv,
} from '@phynd/services/census'
import Redis from 'ioredis'
import { getCacheManager } from './lib/federation'

const logger = createLogger('worker:census-events')

/**
 * The creator-census consumer (`madfam:census-events` → contacts and leads),
 * started only when `PHYND_CRM_CENSUS_CONSUMER_ENABLED=true`. Returns null
 * when it is off or its configuration is refused; a refused configuration is
 * logged as an error and the other workers keep running. See
 * docs/CENSUS_HANDOFF.md.
 */
export function startCensusEventConsumer(redisUrl: string): CensusEventConsumer | null {
  let settings: ReturnType<typeof readCensusConsumerSettings>
  try {
    settings = readCensusConsumerSettings(process.env, DEFAULT_TENANT_ID)
  } catch (err) {
    logger.error({ err }, 'census event consumer NOT started: configuration refused')
    return null
  }
  if (!settings.enabled) {
    logger.info('census event consumer disabled (PHYND_CRM_CENSUS_CONSUMER_ENABLED is not true)')
    return null
  }

  const tenantStore = (tenantId: string) => {
    // Checked at start already; checked again so a tenant can never fall back
    // to the default database (`getDb` does that when its URL is missing).
    if (tenantId === DEFAULT_TENANT_ID || !process.env[tenantDatabaseEnv(tenantId)]?.trim()) {
      throw new Error(`census tenant ${tenantId} has no database of its own`)
    }
    return createCensusTenantStore({
      db: getDb(tenantId),
      cache: getCacheManager(),
      tenantId,
      logger,
    })
  }

  const client = new Redis(settings.redisUrl ?? redisUrl, {
    maxRetriesPerRequest: null, // required for blocking reads
    lazyConnect: true,
  }) as unknown as CensusStreamClient

  const consumer = new CensusEventConsumer({
    client,
    orgTenants: settings.orgTenants,
    logger,
    handlers: {
      pickHandedOff: (tenantId, event) => applyCensusPickHandoff(tenantStore(tenantId), event),
      optOutCompleted: (tenantId, event) => applyCensusOptOut(tenantStore(tenantId), event),
    },
  })
  consumer.start().catch((err) => {
    logger.error({ err }, 'census event consumer stopped on an error')
  })
  return consumer
}
