/**
 * Next.js instrumentation hook.
 *
 * OpenTelemetry via NodeSDK is wired on the worker (`apps/worker/src/instrumentation.ts`)
 * because `@opentelemetry/sdk-node` pulls gRPC into the Next.js webpack graph and breaks
 * `next build`. Enable tracing with `FEATURE_OBSERVABILITY=true` on the worker deployment.
 */
export async function register() {
  // Web OTel deferred — see worker instrumentation.
}
