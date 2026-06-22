import { handlers } from '@/lib/auth'
import { withRequestAuthOrigin } from '@/lib/auth/with-request-auth-origin'
import type { NextRequest } from 'next/server'

export function GET(request: NextRequest) {
  return withRequestAuthOrigin(request, (normalized) => handlers.GET(normalized))
}

export function POST(request: NextRequest) {
  return withRequestAuthOrigin(request, (normalized) => handlers.POST(normalized))
}
