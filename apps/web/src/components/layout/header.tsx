import { SignOutButton } from './sign-out-button'

interface HeaderProps {
  user?: {
    name?: string | null
    email?: string | null
    image?: string | null
  }
}

export function Header({ user }: HeaderProps) {
  return (
    <header className="flex h-16 items-center justify-between border-b px-6">
      <div className="flex items-center gap-4">
        <h2 className="text-sm font-medium text-muted-foreground">MADFAM Ecosystem</h2>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-sm">
          <span className="font-medium">{user?.name ?? 'User'}</span>
          <span className="ml-2 text-muted-foreground">{user?.email}</span>
        </div>
        <SignOutButton />
      </div>
    </header>
  )
}
