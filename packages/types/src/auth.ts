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
  userId: string
  tenantId: string
  roles: string[]
  scopes: string[]
  accessToken: string
}

export type CrmRole = 'admin' | 'sales_manager' | 'sales_rep' | 'manufacturing' | 'finance' | 'viewer'

export const CRM_ROLES = ['admin', 'sales_manager', 'sales_rep', 'manufacturing', 'finance', 'viewer'] as const
