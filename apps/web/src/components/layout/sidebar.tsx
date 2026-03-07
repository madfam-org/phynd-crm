'use client'

import { cn } from '@/lib/utils'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navigation = [
  { name: 'Dashboard', href: '/overview', icon: 'LayoutDashboard' },
  { name: 'Clients', href: '/clients', icon: 'Users' },
  { name: 'Contacts', href: '/contacts', icon: 'Contact' },
  { name: 'Leads', href: '/leads', icon: 'Target' },
  { name: 'Opportunities', href: '/opportunities', icon: 'TrendingUp' },
  { name: 'Pipeline', href: '/pipeline', icon: 'Kanban' },
  { name: 'Activities', href: '/activities', icon: 'Activity' },
  { name: 'Visitors', href: '/visitors', icon: 'Eye' },
  { name: 'Offers', href: '/offers', icon: 'Gift' },
  { name: 'Funnel', href: '/funnel', icon: 'Filter' },
  { name: 'Analytics', href: '/analytics', icon: 'BarChart3' },
  { name: 'Settings', href: '/settings', icon: 'Settings' },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="hidden w-64 flex-shrink-0 border-r bg-sidebar lg:block">
      <div className="flex h-16 items-center border-b px-6">
        <Link href="/overview" className="text-xl font-bold">
          Phyne
        </Link>
      </div>
      <nav className="space-y-1 p-4">
        {navigation.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent/50',
              )}
            >
              {item.name}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
