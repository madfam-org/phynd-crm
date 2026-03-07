'use client'

import { cn } from '@/lib/utils'
import { useEffect, useRef, useState } from 'react'
import { SectionWrapper } from './section-wrapper'

const providers = [
  {
    name: 'Janua',
    domain: 'Identity & Access',
    color: 'border-accent-blue bg-accent-blue/10 text-accent-blue',
    icon: (
      <svg
        aria-hidden="true"
        className="h-6 w-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M15.75 5a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
        <path d="M2 17.6c0-1.68 0-2.52.327-3.162a3 3 0 0 1 1.311-1.311C4.28 12.8 5.12 12.8 6.8 12.8h10.4c1.68 0 2.52 0 3.162.327a3 3 0 0 1 1.311 1.311C22 15.08 22 15.92 22 17.6" />
      </svg>
    ),
  },
  {
    name: 'Dhanam',
    domain: 'Billing & Monetization',
    color: 'border-accent-emerald bg-accent-emerald/10 text-accent-emerald',
    icon: (
      <svg
        aria-hidden="true"
        className="h-6 w-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect width="20" height="14" x="2" y="5" rx="2" />
        <line x1="2" x2="22" y1="10" y2="10" />
      </svg>
    ),
  },
  {
    name: 'Cotiza',
    domain: 'Custom Orders & Quotes',
    color: 'border-accent-amber bg-accent-amber/10 text-accent-amber',
    icon: (
      <svg
        aria-hidden="true"
        className="h-6 w-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
      </svg>
    ),
  },
  {
    name: 'PravaraMES',
    domain: 'Fabrication & Manufacturing',
    color: 'border-accent-violet bg-accent-violet/10 text-accent-violet',
    icon: (
      <svg
        aria-hidden="true"
        className="h-6 w-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 6V2H8" />
        <path d="m8 18-4 4V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2Z" />
        <path d="M2 12h2" />
        <path d="M9 11v2" />
        <path d="M15 11v2" />
        <path d="M20 12h2" />
      </svg>
    ),
  },
  {
    name: 'Forj',
    domain: '3D Digital Assets',
    color: 'border-accent-rose bg-accent-rose/10 text-accent-rose',
    icon: (
      <svg
        aria-hidden="true"
        className="h-6 w-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
        <path d="m3.3 7 8.7 5 8.7-5" />
        <path d="M12 22V12" />
      </svg>
    ),
  },
]

export function EcosystemDiagram() {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true)
          observer.unobserve(el)
        }
      },
      { threshold: 0.2 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <SectionWrapper id="ecosystem">
      <div className="reveal mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
          One CRM. Five Platforms. Zero Copies.
        </h2>
        <p className="mt-4 text-lg text-muted-foreground">
          Phyne sits at the center of the MADFAM ecosystem, federating data in real time.
        </p>
      </div>

      <div ref={ref} className="relative mt-16">
        <div className="mx-auto flex max-w-xs flex-col items-center">
          <div className="rounded-xl border-2 border-foreground bg-background px-6 py-3 text-center font-bold shadow-lg">
            Phyne CRM
          </div>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {providers.map((p, i) => (
            <div
              key={p.name}
              className={cn(
                'rounded-lg border-2 p-4 text-center transition-all duration-500',
                p.color,
                visible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0',
              )}
              style={{ transitionDelay: visible ? `${i * 100}ms` : '0ms' }}
            >
              <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center">
                {p.icon}
              </div>
              <div className="font-semibold">{p.name}</div>
              <div className="mt-1 text-xs opacity-75">{p.domain}</div>
            </div>
          ))}
        </div>

        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 hidden h-full w-full lg:block"
        >
          <line
            x1="50%"
            y1="48"
            x2="50%"
            y2="140"
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="4 4"
            className="text-muted-foreground/40"
          />
        </svg>
      </div>
    </SectionWrapper>
  )
}
