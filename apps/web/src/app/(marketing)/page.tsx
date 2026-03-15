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

export const dynamic = 'force-static'

export default function MarketingPage() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <HeroSection />
      <PainPointsSection />
      <FeaturesSection />
      <EcosystemDiagram />
      <HowItWorksSection />
      <SocialProofSection />
      <ComparisonTable />
      <PricingSection />
      <CtaSection />
      <Footer />
    </div>
  )
}
