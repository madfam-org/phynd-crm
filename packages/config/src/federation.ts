import type { FederationProviderName, ProviderConfig } from '@phyne/types/federation'

export function getFederationConfig(baseUrls: {
  janua: string
  dhanam: string
  cotiza: string
  pravara: string
  forj: string
  tezca?: string
  'janua-telemetry'?: string
}): Record<FederationProviderName, ProviderConfig> {
  return {
    janua: {
      name: 'janua',
      baseUrl: baseUrls.janua,
      timeout: 5000,
      cache: {
        ttlSeconds: 3600,
        keyPrefix: 'fed:janua',
      },
      retry: {
        maxRetries: 3,
        baseDelayMs: 500,
        maxDelayMs: 30000,
        jitterFactor: 0.5,
      },
      circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 30000,
        halfOpenSuccessThreshold: 3,
      },
    },
    dhanam: {
      name: 'dhanam',
      baseUrl: baseUrls.dhanam,
      timeout: 5000,
      cache: {
        ttlSeconds: 300,
        keyPrefix: 'fed:dhanam',
      },
      retry: {
        maxRetries: 3,
        baseDelayMs: 500,
        maxDelayMs: 30000,
        jitterFactor: 0.5,
      },
      circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 30000,
        halfOpenSuccessThreshold: 3,
      },
    },
    cotiza: {
      name: 'cotiza',
      baseUrl: baseUrls.cotiza,
      timeout: 10000,
      cache: {
        ttlSeconds: 60,
        keyPrefix: 'fed:cotiza',
      },
      retry: {
        maxRetries: 3,
        baseDelayMs: 500,
        maxDelayMs: 30000,
        jitterFactor: 0.5,
      },
      circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 30000,
        halfOpenSuccessThreshold: 3,
      },
    },
    pravara: {
      name: 'pravara',
      baseUrl: baseUrls.pravara,
      timeout: 10000,
      cache: {
        ttlSeconds: 45,
        keyPrefix: 'fed:pravara',
      },
      retry: {
        maxRetries: 3,
        baseDelayMs: 500,
        maxDelayMs: 30000,
        jitterFactor: 0.5,
      },
      circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 30000,
        halfOpenSuccessThreshold: 3,
      },
    },
    forj: {
      name: 'forj',
      baseUrl: baseUrls.forj,
      timeout: 8000,
      cache: {
        ttlSeconds: 3600,
        keyPrefix: 'fed:forj',
      },
      retry: {
        maxRetries: 3,
        baseDelayMs: 500,
        maxDelayMs: 30000,
        jitterFactor: 0.5,
      },
      circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 30000,
        halfOpenSuccessThreshold: 3,
      },
    },
    tezca: {
      name: 'tezca',
      baseUrl: baseUrls.tezca ?? 'http://tezca:8000',
      timeout: 8000,
      cache: {
        ttlSeconds: 3600,
        keyPrefix: 'fed:tezca',
      },
      retry: {
        maxRetries: 2,
        baseDelayMs: 500,
        maxDelayMs: 15000,
        jitterFactor: 0.5,
      },
      circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 30000,
        halfOpenSuccessThreshold: 3,
      },
    },
    'janua-telemetry': {
      name: 'janua-telemetry',
      baseUrl: baseUrls['janua-telemetry'] ?? baseUrls.janua,
      timeout: 5000,
      cache: {
        ttlSeconds: 60,
        keyPrefix: 'fed:janua-telemetry',
      },
      retry: {
        maxRetries: 2,
        baseDelayMs: 500,
        maxDelayMs: 15000,
        jitterFactor: 0.5,
      },
      circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 30000,
        halfOpenSuccessThreshold: 3,
      },
    },
  }
}
