// The resolver moved to `@phynd/services` so the worker's lead backfill uses
// the same rule as the intake webhooks. Re-exported here for the routes and
// tests that import it from this path.
export * from '@phynd/services/leads/default-owner'
