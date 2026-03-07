import { getFederationConfig } from '@phyne/config/federation'
import {
  CacheManager,
  CircuitBreaker,
  CotizaProvider,
  DhanamProvider,
  FederationClient,
  ForjProvider,
  JanuaProvider,
  JanuaTelemetryProvider,
  PravaraProvider,
  ProviderHealthChecker,
} from '@phyne/federation'
import type {
  CotizaManufacturing,
  DhanamBilling,
  FederationProviderName,
  ForjAssets,
  JanuaIdentity,
  JanuaTelemetry,
  PravaraFabrication,
} from '@phyne/types/federation'
import Redis from 'ioredis'

interface WorkerFederationClients {
  januaClient: FederationClient<unknown, JanuaIdentity>
  dhanamClient: FederationClient<unknown, DhanamBilling>
  cotizaClient: FederationClient<unknown, CotizaManufacturing>
  pravaraClient: FederationClient<unknown, PravaraFabrication>
  forjClient: FederationClient<unknown, ForjAssets>
  januaTelemetryClient: FederationClient<unknown, JanuaTelemetry>
}

let redis: Redis | null = null
let cacheManager: CacheManager | null = null
let federationClients: WorkerFederationClients | null = null
let healthChecker: ProviderHealthChecker | null = null

function getBaseUrls() {
  return {
    janua: process.env.JANUA_API_URL ?? 'http://localhost:4001',
    dhanam: process.env.DHANAM_API_URL ?? 'http://localhost:4002',
    cotiza: process.env.COTIZA_API_URL ?? 'http://localhost:4003',
    pravara: process.env.PRAVARA_BASE_URL ?? 'http://localhost:4004',
    forj: process.env.FORJ_API_URL ?? 'http://localhost:4005',
    'janua-telemetry':
      process.env.JANUA_TELEMETRY_API_URL ?? process.env.JANUA_API_URL ?? 'http://localhost:4001',
  }
}

function getRedis(): Redis {
  if (redis) return redis
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379'
  redis = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: true })
  return redis
}

export function getCacheManager(): CacheManager {
  if (cacheManager) return cacheManager
  cacheManager = new CacheManager(getRedis())
  return cacheManager
}

function buildClients() {
  const cache = getCacheManager()
  const configs = getFederationConfig(getBaseUrls())

  return {
    januaClient: new FederationClient(
      new JanuaProvider(configs.janua.baseUrl),
      cache,
      configs.janua,
    ),
    dhanamClient: new FederationClient(
      new DhanamProvider(configs.dhanam.baseUrl),
      cache,
      configs.dhanam,
    ),
    cotizaClient: new FederationClient(
      new CotizaProvider(configs.cotiza.baseUrl),
      cache,
      configs.cotiza,
    ),
    pravaraClient: new FederationClient(
      new PravaraProvider(configs.pravara.baseUrl),
      cache,
      configs.pravara,
    ),
    forjClient: new FederationClient(new ForjProvider(configs.forj.baseUrl), cache, configs.forj),
    januaTelemetryClient: new FederationClient(
      new JanuaTelemetryProvider(configs['janua-telemetry'].baseUrl),
      cache,
      configs['janua-telemetry'],
    ),
  }
}

export function getFederationClients(): WorkerFederationClients {
  if (federationClients) return federationClients
  federationClients = buildClients()
  return federationClients
}

export function getFederationClient(
  provider: FederationProviderName,
): WorkerFederationClients[keyof WorkerFederationClients] {
  const clients = getFederationClients()
  const map: Record<
    FederationProviderName,
    WorkerFederationClients[keyof WorkerFederationClients]
  > = {
    janua: clients.januaClient,
    dhanam: clients.dhanamClient,
    cotiza: clients.cotizaClient,
    pravara: clients.pravaraClient,
    forj: clients.forjClient,
    'janua-telemetry': clients.januaTelemetryClient,
  }
  return map[provider]
}

export function getHealthChecker(): ProviderHealthChecker {
  if (healthChecker) return healthChecker
  const configs = getFederationConfig(getBaseUrls())

  healthChecker = new ProviderHealthChecker([
    {
      provider: 'janua',
      baseUrl: configs.janua.baseUrl,
      circuitBreaker: new CircuitBreaker(configs.janua.circuitBreaker),
    },
    {
      provider: 'dhanam',
      baseUrl: configs.dhanam.baseUrl,
      circuitBreaker: new CircuitBreaker(configs.dhanam.circuitBreaker),
    },
    {
      provider: 'cotiza',
      baseUrl: configs.cotiza.baseUrl,
      circuitBreaker: new CircuitBreaker(configs.cotiza.circuitBreaker),
    },
    {
      provider: 'pravara',
      baseUrl: configs.pravara.baseUrl,
      circuitBreaker: new CircuitBreaker(configs.pravara.circuitBreaker),
    },
    {
      provider: 'forj',
      baseUrl: configs.forj.baseUrl,
      circuitBreaker: new CircuitBreaker(configs.forj.circuitBreaker),
    },
    {
      provider: 'janua-telemetry',
      baseUrl: configs['janua-telemetry'].baseUrl,
      circuitBreaker: new CircuitBreaker(configs['janua-telemetry'].circuitBreaker),
    },
  ])
  return healthChecker
}
