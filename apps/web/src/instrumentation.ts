/**
 * Next.js instrumentation hook.
 *
 * Web OTel remains deferred: even with `serverExternalPackages` and a split
 * `instrumentation.node.ts`, Next.js still traces `@opentelemetry/sdk-node`
 * (gRPC) during `next build`. Worker OTel is enabled via
 * `apps/worker/src/instrumentation.ts` when `FEATURE_OBSERVABILITY=true`.
 */
export async function register() {
  // Web OTel deferred — see worker instrumentation.
}
