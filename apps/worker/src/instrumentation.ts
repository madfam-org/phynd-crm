/**
 * OpenTelemetry instrumentation for phynd-worker.
 *
 * Call `initInstrumentation()` at the top of the worker entry point
 * (src/index.ts) before any other imports that should be instrumented:
 *
 *   import { initInstrumentation } from './instrumentation'
 *   await initInstrumentation()
 */
import { isFeatureEnabled } from '@phynd/config/features'

export async function initInstrumentation(): Promise<void> {
  if (!isFeatureEnabled('observability')) {
    console.log('[instrumentation] Observability flag is disabled, skipping OTel setup')
    return
  }

  // Dynamic imports to avoid loading OTel SDK when feature is disabled
  const { NodeSDK } = await import('@opentelemetry/sdk-node')
  const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node')
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http')

  const exporter = new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces',
  })

  const sdk = new NodeSDK({
    serviceName: 'phynd-worker',
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable fs instrumentation to reduce noise
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  })

  sdk.start()

  const shutdown = async () => {
    try {
      await sdk.shutdown()
    } catch (err) {
      console.error('[instrumentation] Error shutting down OTel SDK:', err)
    }
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  console.log('[instrumentation] OpenTelemetry initialized for phynd-worker')
}
