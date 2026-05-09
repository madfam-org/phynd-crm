'use client'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { Menu } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useState } from 'react'
import { navigation } from './navigation'

export function MobileSidebar() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  const close = useCallback(() => setOpen(false), [])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </Button>
      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>
            <Link href="/overview" className="text-xl font-bold" onClick={close}>
              Phynd
            </Link>
          </SheetTitle>
        </SheetHeader>
        <nav className="space-y-1 p-4">
          {navigation.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={close}
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
      </SheetContent>
    </Sheet>
  )
}
