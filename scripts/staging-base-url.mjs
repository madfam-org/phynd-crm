/** Canonical live staging CRM base URL (Cloudflare tunnel → phynd-crm-staging). */
export const STAGING_CRM_BASE_URL = 'https://staging-crm.madfam.io'

/** Staging engagement used for Selva / engagement webhook probes. */
export const STAGING_PP5_ENGAGEMENT_ID = 'eng-staging-pp5-1780081216194'

/** Planned alias; tunnel not wired yet — use STAGING_CRM_BASE_URL for live ops. */
export const STAGING_PHYND_APP_URL = 'https://staging-phynd.app'

export function applyStagingWebhookDefaults(opts) {
  const base = opts.baseUrl?.replace(/\/$/, '')
  if (base !== STAGING_CRM_BASE_URL) return opts
  if (!opts.engagementId || opts.engagementId === 'REPLACE_WITH_STAGING_ENGAGEMENT_ID') {
    opts.engagementId = STAGING_PP5_ENGAGEMENT_ID
  }
  return opts
}
