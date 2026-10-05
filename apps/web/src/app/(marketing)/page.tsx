import { ComparisonTable } from '@/components/marketing/comparison-table'
import { CtaSection } from '@/components/marketing/cta-section'
import { EcosystemDiagram } from '@/components/marketing/ecosystem-diagram'
import { FeaturesSection } from '@/components/marketing/features-section'
import { Footer } from '@/components/marketing/footer'
import { HeroSection } from '@/components/marketing/hero-section'
import { HowItWorksSection } from '@/components/marketing/how-it-works-section'
import { Navbar } from '@/components/marketing/navbar'
import { PainPointsSection } from '@/components/marketing/pain-points-section'
import { PricingSection } from '@/components/marketing/pricing-section'
import { SocialProofSection } from '@/components/marketing/social-proof-section'
import { getBrandForHost } from '@/lib/branding/tenant-brand'
import { isDemoEnabled } from '@/lib/demo'
import type { Metadata } from 'next'
import { headers } from 'next/headers'

export const dynamic = 'force-dynamic'

async function getRequestBrand() {
  const requestHeaders = await headers()
  return getBrandForHost(requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host'))
}

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getRequestBrand()

  return {
    title: brand.title,
    description: brand.description,
    openGraph: {
      title: brand.title,
      description: brand.description,
      url: brand.ogUrl,
      images: [`${brand.ogUrl}/og-image.png`],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: brand.title,
      description: brand.description,
      images: [`${brand.ogUrl}/og-image.png`],
    },
  }
}

export default async function MarketingPage() {
  const brand = await getRequestBrand()
  // The demo is opt-in per deployment, so link to it only where it runs.
  const demoEnabled = isDemoEnabled()

  return (
    <div className="min-h-screen">
      <Navbar brand={brand} demoEnabled={demoEnabled} />
      <HeroSection brand={brand} demoEnabled={demoEnabled} />
      <PainPointsSection />
      <FeaturesSection />
      <EcosystemDiagram />
      <HowItWorksSection />
      <SocialProofSection />
      <ComparisonTable />
      <PricingSection />
      <CtaSection demoEnabled={demoEnabled} />
      <Footer brand={brand} demoEnabled={demoEnabled} />
    </div>
  )
}
