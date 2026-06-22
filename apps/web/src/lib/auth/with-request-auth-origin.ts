import type { NextRequest } from 'next/server'

import { normalizeAuthRequest } from './request'

/**
 * Auth.js v5 overrides the request URL when AUTH_URL / NEXTAUTH_URL are set.
 * For multi-host production (phynd.app marketing + crm.* staff CRM), bind
 * Auth.js to the normalized public origin for this request only.
 */
export async function withRequestAuthOrigin(
  request: NextRequest,
  handler: (normalized: NextRequest) => Response | Promise<Response>,
): Promise<Response> {
  const normalized = normalizeAuthRequest(request)
  const origin = new URL(normalized.url).origin

  const savedAuthUrl = process.env.AUTH_URL
  const savedNextAuthUrl = process.env.NEXTAUTH_URL

  process.env.AUTH_URL = origin
  process.env.NEXTAUTH_URL = undefined

  try {
    return await handler(normalized)
  } finally {
    if (savedAuthUrl === undefined) process.env.AUTH_URL = undefined
    else process.env.AUTH_URL = savedAuthUrl

    if (savedNextAuthUrl === undefined) process.env.NEXTAUTH_URL = undefined
    else process.env.NEXTAUTH_URL = savedNextAuthUrl
  }
}
