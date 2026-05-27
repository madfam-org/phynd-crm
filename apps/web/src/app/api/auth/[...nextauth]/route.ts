import { handlers } from '@/lib/auth'
import { normalizeAuthRequest } from '@/lib/auth/request'
import type { NextRequest } from 'next/server'

export function GET(request: NextRequest) {
  return handlers.GET(normalizeAuthRequest(request))
}

export function POST(request: NextRequest) {
  return handlers.POST(normalizeAuthRequest(request))
}
