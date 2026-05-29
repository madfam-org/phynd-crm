import { DEFAULT_TENANT_ID } from '@phynd/config/constants'
import type { Database } from '@phynd/db'
import { EngagementsService } from '@phynd/services'
import type { ServiceContext } from '@phynd/services/context'

export function resolveTenantIdForWebhook(req: Request): string {
  const host =
    req.headers.get('x-forwarded-host') ??
    req.headers.get('x-original-host') ??
    req.headers.get('host')
  if (!host) return DEFAULT_TENANT_ID
  const normalized = host.split(',')[0]?.trim().toLowerCase().replace(/:\d+$/, '') ?? ''
  if (normalized === 'crm.madfam.io') return 'madfam'
  if (
    normalized === 'crm.phynd.app' ||
    normalized === 'phynd.app' ||
    normalized === 'www.phynd.app'
  ) {
    return 'phynd'
  }
  return DEFAULT_TENANT_ID
}

export function createWebhookEngagementsService(
  db: Database,
  source: string,
  tenantId: string = DEFAULT_TENANT_ID,
): EngagementsService {
  const ctx = {
    db,
    cache: {} as ServiceContext['cache'],
    auth: {
      userId: `service:${source}`,
      tenantId,
      roles: ['service'],
      scopes: ['engagements:write'],
      accessToken: '',
    },
    tenantId,
  } satisfies ServiceContext

  return new EngagementsService(ctx)
}
