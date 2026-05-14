'use client'

import { Button } from '@/components/ui/button'
import type { TenantBrand } from '@/lib/branding/tenant-brand'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { MobileNav } from './mobile-nav'

const navLinks = [
  { label: 'Features', href: '#features' },
  { label: 'Ecosystem', href: '#ecosystem' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Demo', href: '/demo' },
]

export function Navbar({ brand }: { brand?: TenantBrand }) {
  const [scrolled, setScrolled] = useState(false)
  const navName = brand?.navName ?? 'Phynd'

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={cn(
        'fixed top-0 z-50 w-full transition-all duration-300',
        scrolled ? 'border-b border-border/50 bg-background/80 backdrop-blur-lg' : 'bg-transparent',
      )}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 lg:px-8">
        <Link href="/" className="text-xl font-bold tracking-tight">
          {navName}
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/login">Sign In</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/demo">Try Demo</Link>
          </Button>
        </div>

        <MobileNav links={navLinks} />
      </nav>
    </header>
  )
}
