import type { Metadata } from 'next'

// metadataBase resolves all relative URLs in metadata (og:image, twitter:image,
// canonical, etc.) to absolute URLs at build time. Without it, Next.js falls
// back to localhost defaults at the moment metadata is serialized — which is
// what produced the "og:image points at localhost:3000" leak that PR #28
// caught downstream.
//
// NEXT_PUBLIC_APP_URL is threaded through `docker/Dockerfile.web` as a build-arg.
// The literal fallback covers local dev + any context where the build-arg isn't
// set (e.g. preview environments).
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://crm.madfam.io'),
  title: 'Phyne — The CRM Built for Physical + Digital',
  description:
    'Phyne federates real-time data from your entire ecosystem into one unified CRM. No data duplication. No vendor lock-in. No per-seat pricing.',
  openGraph: {
    title: 'Phyne — The CRM Built for Physical + Digital',
    description: 'Federate real-time data from your entire ecosystem into one unified CRM.',
    type: 'website',
    url: 'https://crm.madfam.io',
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
