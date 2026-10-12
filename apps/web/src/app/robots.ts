import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'

import { robotsForHost } from '@/lib/http/crawl-files'

export default async function robots(): Promise<MetadataRoute.Robots> {
  const h = await headers()
  return robotsForHost(h.get('x-forwarded-host') ?? h.get('host'))
}
