'use client'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

interface MobileNavProps {
  links: { label: string; href: string }[]
}

export function MobileNav({ links }: MobileNavProps) {
  const [open, setOpen] = useState(false)

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="relative z-50 flex h-9 w-9 items-center justify-center"
        aria-label={open ? 'Close menu' : 'Open menu'}
      >
        <svg
          aria-hidden="true"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <line
            x1="3"
            y1="6"
            x2="21"
            y2="6"
            className={cn(
              'origin-center transition-all duration-300',
              open && 'translate-y-[6px] rotate-45',
            )}
          />
          <line
            x1="3"
            y1="12"
            x2="21"
            y2="12"
            className={cn('transition-all duration-300', open && 'scale-x-0 opacity-0')}
          />
          <line
            x1="3"
            y1="18"
            x2="21"
            y2="18"
            className={cn(
              'origin-center transition-all duration-300',
              open && '-translate-y-[6px] -rotate-45',
            )}
          />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-40 bg-background/95 backdrop-blur-sm">
          <nav className="flex h-full flex-col items-center justify-center gap-8">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={close}
                className="text-lg font-medium text-foreground transition-colors hover:text-muted-foreground"
              >
                {link.label}
              </a>
            ))}
            <div className="flex flex-col gap-3 pt-4">
              <Button variant="outline" asChild>
                <Link href="/login" onClick={close}>
                  Sign In
                </Link>
              </Button>
              <Button asChild>
                <Link href="/login" onClick={close}>
                  Get Started
                </Link>
              </Button>
            </div>
          </nav>
        </div>
      )}
    </div>
  )
}
