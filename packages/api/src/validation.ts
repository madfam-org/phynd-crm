import { z } from 'zod'

/**
 * Pipeline and stage ids are NOT UUIDs: the production seed creates
 * `pipeline_default_sales` / `stage_default_new`, and the demo seeder mints
 * `demo-<uuid>-pipeline` ids at runtime. Validating them with
 * `z.string().uuid()` made every pipeline/stage-parameterized procedure
 * reject the app's own data — the lead detail page 500'd on the seeded
 * default pipeline (2026-08-12). Shape carries no authorization: tenancy is
 * enforced by the service context, so the contract is "non-empty, sane
 * length", nothing more.
 *
 * Lead / contact / user ids ARE generated UUIDs — keep `z.string().uuid()`
 * for those.
 */
export const entityId = z.string().min(1).max(255)
