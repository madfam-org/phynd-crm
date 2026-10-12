import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'

import { sitemapForHost } from '@/lib/http/crawl-files'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const h = await headers()
  return sitemapForHost(h.get('x-forwarded-host') ?? h.get('host'))
}
