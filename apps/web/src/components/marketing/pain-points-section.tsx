import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SectionWrapper } from './section-wrapper'

const painPoints = [
  {
    title: 'Data Silos',
    description:
      'Manufacturing, billing, and digital assets live in separate systems with no unified view of your customer.',
    icon: (
      <svg
        aria-hidden="true"
        className="h-8 w-8 text-accent-rose"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5V19A9 3 0 0 0 21 19V5" />
        <path d="M3 12A9 3 0 0 0 21 12" />
      </svg>
    ),
  },
  {
    title: 'Per-Seat Pricing',
    description:
      'Costs grow exponentially with team size. Enterprise CRMs punish you for onboarding more people.',
    icon: (
      <svg
        aria-hidden="true"
        className="h-8 w-8 text-accent-amber"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="12" x2="12" y1="2" y2="22" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
  {
    title: 'ETL Fragility',
    description:
      'Data duplication creates stale records and sync failures. Every copy is a liability waiting to diverge.',
    icon: (
      <svg
        aria-hidden="true"
        className="h-8 w-8 text-accent-violet"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m19 5 3-3" />
        <path d="m2 22 3-3" />
        <path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z" />
        <path d="M7.5 13.5 10 11" />
        <path d="M10.5 16.5 13 14" />
        <path d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z" />
      </svg>
    ),
  },
]

export function PainPointsSection() {
  return (
    <SectionWrapper stagger>
      <div className="reveal mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
          The Problem with Today&apos;s CRMs
        </h2>
        <p className="mt-4 text-lg text-muted-foreground">
          Traditional CRMs weren&apos;t built for businesses that span physical and digital worlds.
        </p>
      </div>
      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {painPoints.map((point) => (
          <Card key={point.title} className="reveal border-none bg-muted/50">
            <CardHeader>
              <div className="mb-2">{point.icon}</div>
              <CardTitle>{point.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{point.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </SectionWrapper>
  )
}
