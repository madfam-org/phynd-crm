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
}

export function Header({ user }: HeaderProps) {
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
        <div className="hidden text-sm sm:block">
          <span className="font-medium">{user?.name ?? 'User'}</span>
          <span className="ml-2 text-muted-foreground">{user?.email}</span>
        </div>
        <ThemeToggle />
        <SignOutButton />
      </div>
    </header>
  )
}
