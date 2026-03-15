'use client'

import { cn } from '@/lib/utils'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { navigation } from './navigation'

interface SidebarProps {
  isDemo?: boolean
}

export function Sidebar({ isDemo }: SidebarProps) {
  const pathname = usePathname()

  return (
    <aside className="hidden w-64 flex-shrink-0 border-r bg-sidebar lg:block">
      <div className="flex h-16 items-center gap-2 border-b px-6">
        <Link href="/overview" className="text-xl font-bold">
          Phyne
        </Link>
        {isDemo && (
          <span className="rounded-full bg-accent-violet/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-violet">
            Demo
          </span>
        )}
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
              <item.icon className="h-4 w-4" aria-hidden="true" />
              {item.name}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
