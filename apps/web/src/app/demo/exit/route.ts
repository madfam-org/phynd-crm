import { DEMO_COOKIE_NAME } from '@/lib/demo'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET() {
  const cookieStore = await cookies()
  cookieStore.delete(DEMO_COOKIE_NAME)

  return NextResponse.redirect(new URL('/', process.env.NEXTAUTH_URL ?? 'http://localhost:3000'))
}
