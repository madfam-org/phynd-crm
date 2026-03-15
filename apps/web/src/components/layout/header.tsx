import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { NotificationBell } from '../notifications/notification-bell'
import { GlobalSearch } from './global-search'
import { MobileSidebar } from './mobile-sidebar'
import { SignOutButton } from './sign-out-button'
import { ThemeToggle } from './theme-toggle'

interface HeaderProps {
  user?: {
    name?: string | null
    email?: string | null
    image?: string | null
  }
  isDemo?: boolean
}

export function Header({ user, isDemo }: HeaderProps) {
  return (
    <header className="flex h-16 items-center justify-between border-b px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <MobileSidebar />
        <h2 className="text-sm font-medium text-muted-foreground">MADFAM Ecosystem</h2>
      </div>
      <div className="hidden flex-1 justify-center px-4 md:flex">
        <GlobalSearch />
      </div>
      <div className="flex items-center gap-4">
        <NotificationBell />
        <div className="hidden text-sm sm:block">
          <span className="font-medium">{user?.name ?? 'User'}</span>
          {!isDemo && <span className="ml-2 text-muted-foreground">{user?.email}</span>}
        </div>
        <ThemeToggle />
        {isDemo ? (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/demo/exit">Exit Demo</Link>
          </Button>
        ) : (
          <SignOutButton />
        )}
      </div>
    </header>
  )
}
