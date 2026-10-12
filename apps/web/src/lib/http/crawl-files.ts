import type { MetadataRoute } from 'next'

import { normalizeHost } from '@/lib/branding/tenant-brand'
import { MARKETING_AUTH_REDIRECT_HOSTS } from '@/lib/http/app-host'

/**
 * Crawler files. They must answer as real files on every host, never as the
 * staff login redirect: before this, `phynd.app/robots.txt` and friends were
 * 307'd to `/login?next=...` (and earlier served the HTML app shell), so
 * crawlers got no robots rules and a broken sitemap. `/llms.txt` has no
 * route, so it falls through to the app's 404.
 */
export const CRAWL_FILE_PATHS: readonly string[] = ['/robots.txt', '/sitemap.xml', '/llms.txt']

export const PUBLIC_MARKETING_ORIGIN = 'https://phynd.app'

export function isCrawlFilePath(pathname: string): boolean {
  return CRAWL_FILE_PATHS.includes(pathname)
}

function isMarketingHost(host: string | null | undefined): boolean {
  return MARKETING_AUTH_REDIRECT_HOSTS.has(normalizeHost(host))
}

/**
 * phynd.app (marketing) is indexable and points at its sitemap. Every other
 * host this app serves (crm.madfam.io, crm.phynd.app, staging) is the
 * signed-in CRM, so it asks crawlers to stay out entirely.
 */
export function robotsForHost(host: string | null | undefined): MetadataRoute.Robots {
  if (!isMarketingHost(host)) {
    return { rules: { userAgent: '*', disallow: '/' } }
  }
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/login', '/callback', '/portal/'],
    },
    sitemap: `${PUBLIC_MARKETING_ORIGIN}/sitemap.xml`,
  }
}

/** Public marketing pages only; the CRM hosts publish no URLs. */
export function sitemapForHost(host: string | null | undefined): MetadataRoute.Sitemap {
  if (!isMarketingHost(host)) return []
  return [{ url: `${PUBLIC_MARKETING_ORIGIN}/`, changeFrequency: 'monthly', priority: 1 }]
}
