import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ host: 'phynd.app' }),
}))

import MarketingPage from '@/app/(marketing)/page'
import { CtaSection } from '../cta-section'
import { Footer } from '../footer'
import { HeroSection } from '../hero-section'
import { MobileNavMenu } from '../mobile-nav'
import { Navbar } from '../navbar'

const ORIGINAL = process.env.PHYND_DEMO_ENABLED

afterEach(() => {
  vi.unstubAllEnvs()
  if (ORIGINAL === undefined) delete process.env.PHYND_DEMO_ENABLED
  else process.env.PHYND_DEMO_ENABLED = ORIGINAL
})

type RenderedLink = { href: string; text: string }

/** Every link in the server-rendered markup, in document order. */
function renderLinks(element: ReactElement): RenderedLink[] {
  const html = renderToStaticMarkup(element)
  return Array.from(
    html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/gs),
    ([, attributes = '', content = '']) => ({
      href: attributes.match(/\bhref="([^"]*)"/)?.[1] ?? '',
      text: content.replace(/<[^>]*>/g, '').trim(),
    }),
  )
}

const labels = (links: RenderedLink[]) => links.map((link) => link.text)
const demoLabels = (links: RenderedLink[]) =>
  links.filter((link) => link.href === '/demo').map((link) => link.text)

const sectionLinks = [
  { label: 'Features', href: '#features' },
  { label: 'Pricing', href: '#pricing' },
]

describe('marketing page', () => {
  it('links nowhere to /demo where the demo is off', async () => {
    delete process.env.PHYND_DEMO_ENABLED

    const links = renderLinks(await MarketingPage())

    expect(demoLabels(links)).toEqual([])
    expect(labels(links)).toContain('Get Started Free')
  })

  it('shows every demo entry point where the demo is on', async () => {
    vi.stubEnv('PHYND_DEMO_ENABLED', 'true')

    const links = renderLinks(await MarketingPage())

    expect(demoLabels(links)).toEqual([
      'Demo',
      'Try Demo',
      'Try Live Demo',
      'Try Live Demo',
      'Live Demo',
    ])
  })
})

describe('demo entry points per component', () => {
  it.each([
    ['Navbar', () => <Navbar />],
    ['MobileNavMenu', () => <MobileNavMenu links={sectionLinks} onNavigate={vi.fn()} />],
    ['HeroSection', () => <HeroSection />],
    ['CtaSection', () => <CtaSection />],
    ['Footer', () => <Footer />],
  ])('%s hides them unless told the demo is enabled', (_name, render) => {
    expect(demoLabels(renderLinks(render()))).toEqual([])
  })

  it('navbar keeps the section links and Sign In where the demo is off', () => {
    expect(labels(renderLinks(<Navbar demoEnabled={false} />))).toEqual([
      'Phynd',
      'Features',
      'Ecosystem',
      'How It Works',
      'Pricing',
      'Sign In',
    ])
  })

  it('navbar adds the Demo link and the Try Demo button where the demo is on', () => {
    const links = renderLinks(<Navbar demoEnabled />)

    expect(labels(links)).toEqual([
      'Phynd',
      'Features',
      'Ecosystem',
      'How It Works',
      'Pricing',
      'Demo',
      'Sign In',
      'Try Demo',
    ])
    expect(demoLabels(links)).toEqual(['Demo', 'Try Demo'])
  })

  it('mobile menu offers Sign In alone where the demo is off', () => {
    const menu = <MobileNavMenu links={sectionLinks} demoEnabled={false} onNavigate={vi.fn()} />

    expect(labels(renderLinks(menu))).toEqual(['Features', 'Pricing', 'Sign In'])
  })

  it('mobile menu adds Try Demo above Sign In where the demo is on', () => {
    const links = renderLinks(
      <MobileNavMenu links={sectionLinks} demoEnabled onNavigate={vi.fn()} />,
    )

    expect(labels(links)).toEqual(['Features', 'Pricing', 'Try Demo', 'Sign In'])
    expect(demoLabels(links)).toEqual(['Try Demo'])
  })

  it('hero keeps its primary CTA and the GitHub link where the demo is off', () => {
    expect(labels(renderLinks(<HeroSection demoEnabled={false} />))).toEqual([
      'Get Started Free',
      'GitHub',
    ])
  })

  it('hero shows the secondary demo CTA where the demo is on', () => {
    const links = renderLinks(<HeroSection demoEnabled />)

    expect(labels(links)).toEqual(['Get Started Free', 'Try Live Demo', 'GitHub'])
    expect(demoLabels(links)).toEqual(['Try Live Demo'])
  })

  it('closing CTA keeps Get Started where the demo is off', () => {
    expect(labels(renderLinks(<CtaSection demoEnabled={false} />))).toEqual(['Get Started'])
  })

  it('closing CTA adds Try Live Demo where the demo is on', () => {
    const links = renderLinks(<CtaSection demoEnabled />)

    expect(labels(links)).toEqual(['Get Started', 'Try Live Demo'])
    expect(demoLabels(links)).toEqual(['Try Live Demo'])
  })

  it('footer drops Live Demo from the Product column where the demo is off', () => {
    const product = labels(renderLinks(<Footer demoEnabled={false} />)).slice(0, 5)

    expect(product).toEqual(['Features', 'Pricing', 'Ecosystem', 'Changelog', 'Documentation'])
  })

  it('footer lists Live Demo in the Product column where the demo is on', () => {
    const links = renderLinks(<Footer demoEnabled />)

    expect(labels(links).slice(0, 5)).toEqual([
      'Features',
      'Pricing',
      'Live Demo',
      'Ecosystem',
      'Changelog',
    ])
    expect(demoLabels(links)).toEqual(['Live Demo'])
  })
})
