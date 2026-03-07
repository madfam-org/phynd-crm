import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Phyne — The CRM Built for Physical + Digital',
  description:
    'Phyne federates real-time data from your entire ecosystem into one unified CRM. No data duplication. No vendor lock-in. No per-seat pricing.',
  openGraph: {
    title: 'Phyne — The CRM Built for Physical + Digital',
    description: 'Federate real-time data from your entire ecosystem into one unified CRM.',
    type: 'website',
    url: 'https://phyne.io',
    images: [{ url: '/og-image.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Phyne — The CRM Built for Physical + Digital',
    description: 'Federate real-time data from your entire ecosystem into one unified CRM.',
    images: ['/og-image.png'],
  },
}

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
