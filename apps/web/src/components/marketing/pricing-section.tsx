'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { type FormEvent, useState } from 'react'
import { SectionWrapper } from './section-wrapper'

const communityFeatures = [
  'Self-hosted deployment',
  'Federation engine (5 providers)',
  'Contacts, leads, pipelines',
  'Circuit breaker resilience',
  'Full source access (MIT)',
]

const cloudFeatures = [
  'Everything in Community',
  'Managed cloud hosting',
  'Analytics dashboard',
  'Priority support',
  'Automatic updates',
]

export function PricingSection() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)

  function handleWaitlist(e: FormEvent) {
    e.preventDefault()
    if (email) setSubmitted(true)
  }

  return (
    <SectionWrapper id="pricing" stagger>
      <div className="reveal mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Simple, Honest Pricing</h2>
        <p className="mt-4 text-lg font-medium text-accent-emerald">No per-user pricing. Ever.</p>
      </div>

      <div className="reveal mt-12 grid gap-8 md:grid-cols-2 md:max-w-3xl md:mx-auto">
        <Card className="reveal flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              Community
              <Badge variant="secondary">Free</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1">
            <div className="text-4xl font-bold">$0</div>
            <div className="mt-1 text-sm text-muted-foreground">Forever. Unlimited users.</div>
            <ul className="mt-6 space-y-2">
              {communityFeatures.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <svg
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-4 shrink-0 text-accent-emerald"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter>
            <Button className="w-full" variant="outline" asChild>
              <a href="https://github.com/madfam/phyne" target="_blank" rel="noopener noreferrer">
                Deploy Now
              </a>
            </Button>
          </CardFooter>
        </Card>

        <Card className="reveal flex flex-col border-2 border-primary">
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              Cloud
              <Badge>Coming Soon</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1">
            <div className="text-4xl font-bold">Flat rate</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Per workspace. Unlimited users.
            </div>
            <ul className="mt-6 space-y-2">
              {cloudFeatures.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <svg
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-4 shrink-0 text-accent-emerald"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter>
            {submitted ? (
              <p className="w-full text-center text-sm text-accent-emerald">
                You&apos;re on the list! We&apos;ll be in touch.
              </p>
            ) : (
              <form onSubmit={handleWaitlist} className="flex w-full gap-2">
                <Input
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <Button type="submit">Join Waitlist</Button>
              </form>
            )}
          </CardFooter>
        </Card>
      </div>
    </SectionWrapper>
  )
}
