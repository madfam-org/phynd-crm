'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { endSession, switchAccount } from '@/lib/auth/client-session'
import { ChevronDown, LogOut, Repeat } from 'lucide-react'
import { usePathname } from 'next/navigation'

interface AccountMenuProps {
  name?: string | null
  email?: string | null
}

/**
 * Who is signed in, «Switch account» (Janua's account chooser) and «Sign out»
 * (the CRM and the Janua session). Shown in the header for staff sessions.
 */
export function AccountMenu({ name, email }: AccountMenuProps) {
  const pathname = usePathname()
  const label = email || name || 'Account'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="max-w-[16rem] gap-1" aria-label={`Account: ${label}`}>
          <span className="truncate">{label}</span>
          <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <span className="block text-xs text-muted-foreground">Signed in as</span>
          {name ? <span className="block truncate font-medium">{name}</span> : null}
          {email ? <span className="block truncate text-sm">{email}</span> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="items-start"
          onSelect={() => void switchAccount(pathname || '/leads')}
        >
          <Repeat className="mr-2 mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="block">Switch account</span>
            <span className="block text-xs text-muted-foreground">
              Pick another MADFAM account in Janua
            </span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem className="items-start" onSelect={() => void endSession()}>
          <LogOut className="mr-2 mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="block">Sign out</span>
            <span className="block text-xs text-muted-foreground">
              Also ends your Janua sign-in on this browser
            </span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
