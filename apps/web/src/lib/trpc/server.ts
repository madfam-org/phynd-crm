import 'server-only'

import { createDemoAuth, isDemoSession } from '@/lib/demo'
import { createAppContext, createCaller, resolveAuthContext } from '@/lib/trpc/request-context'
import { cookies, headers } from 'next/headers'

function assertAuthBypassNotEnabled() {
  if (process.env.NODE_ENV === 'production' && process.env.AUTH_BYPASS === 'true') {
    throw new Error('AUTH_BYPASS must not be enabled in production')
  }
}

export async function getServerCaller() {
  assertAuthBypassNotEnabled()

  const headerStore = await headers()
  const cookieStore = await cookies()
  const demoSessionId = isDemoSession(cookieStore)
  const authCtx = await resolveAuthContext(headerStore, { demoSessionId })

  return createCaller(createAppContext(authCtx))
}

export { createCaller }
