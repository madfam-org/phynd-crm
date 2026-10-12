import { describe, expect, it } from 'vitest'

import { isCrawlFilePath, robotsForHost, sitemapForHost } from '../crawl-files'

describe('crawler files', () => {
  it('treats robots.txt, sitemap.xml and llms.txt as public paths', () => {
    expect(isCrawlFilePath('/robots.txt')).toBe(true)
    expect(isCrawlFilePath('/sitemap.xml')).toBe(true)
    expect(isCrawlFilePath('/llms.txt')).toBe(true)
    expect(isCrawlFilePath('/overview')).toBe(false)
    expect(isCrawlFilePath('/robots.txt/x')).toBe(false)
  })

  it('lets crawlers index phynd.app and points them at its sitemap', () => {
    for (const host of [
      'phynd.app',
      'www.phynd.app',
      'PHYND.APP:443',
      'phynd.app, proxy.internal',
    ]) {
      const robots = robotsForHost(host)
      expect(robots.sitemap).toBe('https://phynd.app/sitemap.xml')
      const rules = Array.isArray(robots.rules) ? robots.rules[0] : robots.rules
      expect(rules?.allow).toBe('/')
      expect(rules?.disallow).toEqual(expect.arrayContaining(['/api/', '/login']))
    }
  })

  it('keeps crawlers out of the signed-in CRM hosts', () => {
    for (const host of ['crm.madfam.io', 'crm.phynd.app', 'staging-crm.madfam.io', null]) {
      const robots = robotsForHost(host)
      expect(robots.sitemap).toBeUndefined()
      expect(robots.rules).toEqual({ userAgent: '*', disallow: '/' })
    }
  })

  it('publishes only the public landing in the sitemap, and nothing on CRM hosts', () => {
    expect(sitemapForHost('phynd.app').map((e) => e.url)).toEqual(['https://phynd.app/'])
    expect(sitemapForHost('crm.madfam.io')).toEqual([])
  })
})
