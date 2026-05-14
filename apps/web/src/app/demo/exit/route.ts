import { DEMO_COOKIE_NAME } from '@/lib/demo'
import { cookies } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const cookieStore = await cookies()
  cookieStore.delete(DEMO_COOKIE_NAME)

  return NextResponse.redirect(new URL('/', request.url))
}
