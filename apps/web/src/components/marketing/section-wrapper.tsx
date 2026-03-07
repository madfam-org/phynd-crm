'use client'

import { cn } from '@/lib/utils'
import { useEffect, useRef } from 'react'

interface SectionWrapperProps {
  children: React.ReactNode
  className?: string
  id?: string
  stagger?: boolean
}

export function SectionWrapper({ children, className, id, stagger }: SectionWrapperProps) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const targets = el.querySelectorAll('.reveal')
            for (const target of targets) {
              target.classList.add('visible')
            }
            observer.unobserve(el)
          }
        }
      },
      { threshold: 0.15 },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <section
      ref={ref}
      id={id}
      className={cn('mx-auto max-w-7xl px-6 py-20 lg:px-8', stagger && 'reveal-stagger', className)}
    >
      {children}
    </section>
  )
}
