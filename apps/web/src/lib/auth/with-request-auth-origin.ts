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

  // Unsetting an env key requires `delete`: assigning `undefined` coerces to
  // the STRING "undefined", which is truthy to Auth.js — createActionURL then
  // does new URL("undefined") and every later auth() in the process throws
  // Invalid URL (2026-08-12 incident: one auth round-trip poisoned the pod and
  // all post-SSO pages rendered the error boundary).
  process.env.AUTH_URL = origin
  // biome-ignore lint/performance/noDelete: the rule's replacement (= undefined) IS the bug for process.env — it stores the string "undefined"
  delete process.env.NEXTAUTH_URL

  try {
    return await handler(normalized)
  } finally {
    if (savedAuthUrl === undefined) {
      // biome-ignore lint/performance/noDelete: see above — delete is the only way to unset an env key
      delete process.env.AUTH_URL
    } else {
      process.env.AUTH_URL = savedAuthUrl
    }

    if (savedNextAuthUrl === undefined) {
      // biome-ignore lint/performance/noDelete: see above — delete is the only way to unset an env key
      delete process.env.NEXTAUTH_URL
    } else {
      process.env.NEXTAUTH_URL = savedNextAuthUrl
    }
  }
}
