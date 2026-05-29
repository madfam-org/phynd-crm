/**
 * Next.js instrumentation hook — OpenTelemetry when `observability` flag is on.
 */
import { isFeatureEnabled } from '@phynd/config/features'

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (!isFeatureEnabled('observability')) return

  const { NodeSDK } = await import('@opentelemetry/sdk-node')
  const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node')
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http')

  const exporter = new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces',
  })

  const sdk = new NodeSDK({
    serviceName: 'phynd-web',
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
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
}
