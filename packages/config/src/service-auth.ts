/** Default Phynd CRM service principal for Selva / office agents (not human SSO). */
export const DEFAULT_FEDERATION_SERVICE_USER_ID = 'service:selva'

/** Janua machine principal id — distinct from staff users such as admin@madfam.io. */
export function resolveFederationServiceUserId(): string {
  const configured = process.env.FEDERATION_SERVICE_USER_ID?.trim()
  return configured || DEFAULT_FEDERATION_SERVICE_USER_ID
}
