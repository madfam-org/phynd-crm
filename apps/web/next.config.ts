import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  typescript: {
    // Match CI's strict compile contract.
    ignoreBuildErrors: false,
  },
  transpilePackages: [
    '@phynd/api',
    '@phynd/db',
    '@phynd/services',
    '@phynd/federation',
    '@phynd/config',
    '@phynd/types',
  ],
  serverExternalPackages: ['pino', 'pino-pretty'],
  // GHSA-2xp9-vwfh-vxw4 defence in depth: nothing in this app uses
  // next/image, so the built-in optimizer is off and /_next/image answers 404.
  // The middleware matcher skips /_next/image, so an enabled optimizer would
  // be reachable without a session. The empty allow-list keeps re-enabling it
  // from turning the app into an open image proxy. Guarded by
  // src/__tests__/next-config-images.test.ts and scripts/verify-post-deploy.mjs.
  images: {
    unoptimized: true,
    remotePatterns: [],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Content-Security-Policy-Report-Only',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "worker-src 'self' blob:",
              "frame-src 'none'",
              "frame-ancestors 'self' https://selva.town https://*.selva.town https://*.madfam.io",
              "object-src 'none'",
              "base-uri 'self'",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

export default nextConfig
