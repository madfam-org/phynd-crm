import { getFederationConfig } from '@phynd/config/federation'
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
} from '@phynd/federation'
import type {
  CotizaManufacturing,
  DhanamBilling,
  FederationProviderName,
  ForjAssets,
  JanuaIdentity,
  JanuaTelemetry,
  PravaraFabrication,
} from '@phynd/types/federation'
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
let sharedCircuitBreakers: Record<FederationProviderName, CircuitBreaker> | null = null

function getBaseUrls() {
  return {
    janua: process.env.JANUA_API_URL ?? 'http://localhost:4001',
    dhanam: process.env.DHANAM_API_URL ?? 'http://localhost:4002',
    cotiza: process.env.COTIZA_API_URL ?? 'http://localhost:4003',
    pravara: process.env.PRAVARA_BASE_URL ?? 'http://localhost:4004',
    forj: process.env.FORJ_API_URL ?? 'http://localhost:4005',
    tezca: process.env.TEZCA_API_URL ?? 'http://tezca:8000',
    'janua-telemetry': process.env.JANUA_TELEMETRY_API_URL ?? 'http://localhost:4001',
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

function getCircuitBreakers(): Record<FederationProviderName, CircuitBreaker> {
  if (sharedCircuitBreakers) return sharedCircuitBreakers
  const configs = getFederationConfig(getBaseUrls())
  sharedCircuitBreakers = {
    janua: new CircuitBreaker(configs.janua.circuitBreaker),
    dhanam: new CircuitBreaker(configs.dhanam.circuitBreaker),
    cotiza: new CircuitBreaker(configs.cotiza.circuitBreaker),
    pravara: new CircuitBreaker(configs.pravara.circuitBreaker),
    forj: new CircuitBreaker(configs.forj.circuitBreaker),
    tezca: new CircuitBreaker(configs.tezca.circuitBreaker),
    'janua-telemetry': new CircuitBreaker(configs['janua-telemetry'].circuitBreaker),
  }
  return sharedCircuitBreakers
}

function buildClients() {
  const cache = getCacheManager()
  const configs = getFederationConfig(getBaseUrls())
  const cbs = getCircuitBreakers()

  return {
    januaClient: new FederationClient(
      new JanuaProvider(configs.janua.baseUrl),
      cache,
      configs.janua,
      cbs.janua,
    ),
    dhanamClient: new FederationClient(
      new DhanamProvider(configs.dhanam.baseUrl),
      cache,
      configs.dhanam,
      cbs.dhanam,
    ),
    cotizaClient: new FederationClient(
      new CotizaProvider(configs.cotiza.baseUrl),
      cache,
      configs.cotiza,
      cbs.cotiza,
    ),
    pravaraClient: new FederationClient(
      new PravaraProvider(configs.pravara.baseUrl),
      cache,
      configs.pravara,
      cbs.pravara,
    ),
    forjClient: new FederationClient(
      new ForjProvider(configs.forj.baseUrl),
      cache,
      configs.forj,
      cbs.forj,
    ),
    januaTelemetryClient: new FederationClient(
      new JanuaTelemetryProvider(configs['janua-telemetry'].baseUrl),
      cache,
      configs['janua-telemetry'],
      cbs['janua-telemetry'],
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
    tezca: clients.januaClient, // Tezca uses direct REST calls, not a federation client — placeholder to satisfy type
    'janua-telemetry': clients.januaTelemetryClient,
  }
  return map[provider]
}

export function getHealthChecker(): ProviderHealthChecker {
  if (healthChecker) return healthChecker
  const cbs = getCircuitBreakers()
  const urls = getBaseUrls()

  healthChecker = new ProviderHealthChecker([
    { provider: 'janua', baseUrl: urls.janua, circuitBreaker: cbs.janua },
    { provider: 'dhanam', baseUrl: urls.dhanam, circuitBreaker: cbs.dhanam },
    { provider: 'cotiza', baseUrl: urls.cotiza, circuitBreaker: cbs.cotiza },
    { provider: 'pravara', baseUrl: urls.pravara, circuitBreaker: cbs.pravara },
    { provider: 'forj', baseUrl: urls.forj, circuitBreaker: cbs.forj },
    { provider: 'tezca', baseUrl: urls.tezca, circuitBreaker: cbs.tezca },
    {
      provider: 'janua-telemetry',
      baseUrl: urls['janua-telemetry'],
      circuitBreaker: cbs['janua-telemetry'],
    },
  ])
  return healthChecker
}
