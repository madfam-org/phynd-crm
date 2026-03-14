/**
 * Next.js instrumentation hook.
 *
 * OpenTelemetry setup is available in the worker package (apps/worker/src/instrumentation.ts).
 * For the web app, OTel integration requires a custom server setup (not compatible with
 * Next.js standalone webpack bundling). Enable via OTEL_ENABLED=true with a custom server.
 */
export async function register() {
  // Placeholder for future OTel integration via custom Next.js server
}
