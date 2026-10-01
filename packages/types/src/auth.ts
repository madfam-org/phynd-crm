export interface Session {
  user: SessionUser
  accessToken: string
  expiresAt: Date
}

export interface SessionUser {
  id: string
  email: string
  name: string
  image: string | null
  roles: string[]
  scopes: string[]
}

export interface AuthContext {
  /**
   * The acting principal. For a signed-in staff user this is the Janua `sub`;
   * for non-human principals it is their fixed id (`service:selva`, `system`,
   * `demo-{sessionId}`, …). See docs/IDENTITY.md.
   */
  userId: string
  tenantId: string
  roles: string[]
  scopes: string[]
  accessToken: string
  /**
   * Janua OIDC subject of a signed-in staff user. Present only for Janua
   * sessions; absent for service, system, demo and dev principals.
   */
  januaSub?: string
  /**
   * `users.id` of the CRM user linked to `januaSub` through
   * `users.external_janua_id`, or `null` when the Janua identity is not linked
   * to any CRM user. Resolved once per request. Absent for non-Janua principals.
   */
  crmUserId?: string | null
}

/** Error code for a Janua identity that has no linked CRM user. */
export const CRM_USER_NOT_LINKED = 'CRM_USER_NOT_LINKED' as const

/** User-facing copy shown when the signed-in Janua identity is not linked. */
export const CRM_USER_NOT_LINKED_MESSAGE =
  'Tu cuenta MADFAM aún no está vinculada a un usuario del CRM. Pide a un administrador que la vincule.'

export type CrmRole =
  | 'admin'
  | 'sales_manager'
  | 'sales_rep'
  | 'manufacturing'
  | 'finance'
  | 'viewer'

export const CRM_ROLES = [
  'admin',
  'sales_manager',
  'sales_rep',
  'manufacturing',
  'finance',
  'viewer',
] as const
