import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@phyne/api',
    '@phyne/db',
    '@phyne/services',
    '@phyne/federation',
    '@phyne/config',
    '@phyne/types',
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
}

export default nextConfig
