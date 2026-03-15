import { DemoBanner } from '@/components/demo/demo-banner'
import { Header } from '@/components/layout/header'
import { Sidebar } from '@/components/layout/sidebar'
import { auth } from '@/lib/auth'
import { createDemoUser, isDemoSession } from '@/lib/demo'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

const DEV_BYPASS = process.env.NODE_ENV === 'development' && process.env.AUTH_BYPASS === 'true'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  const cookieStore = await cookies()
  const demoSessionId = isDemoSession(cookieStore)

  if (!session && !DEV_BYPASS && !demoSessionId) redirect('/login')

  const isDemo = !!demoSessionId && !session
  const user =
    session?.user ??
    (DEV_BYPASS ? { name: 'Dev Admin', email: 'dev@madfam.com' } : undefined) ??
    (isDemo && demoSessionId ? createDemoUser(demoSessionId) : undefined)

  return (
    <div className="flex h-screen">
      <Sidebar isDemo={isDemo} />
      <div className="flex flex-1 flex-col overflow-hidden">
        {isDemo && <DemoBanner />}
        <Header user={user} isDemo={isDemo} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  )
}
