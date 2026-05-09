import { visitorPageViews } from '../schema/visitor-page-views'
import { visitorSessions } from '../schema/visitor-sessions'
import type { Db, SeedIds } from './types'

export async function seedVisitorData(db: Db, ids: SeedIds) {
  const { contacts: c } = ids

  const sessionRows = await db
    .insert(visitorSessions)
    .values([
      {
        externalSessionId: 'sess-001',
        fingerprint: 'fp-abc123',
        contactId: c[0]?.id,
        identified: true,
        deviceType: 'desktop',
        browser: 'Chrome',
        os: 'macOS',
        ipCountry: 'US',
        ipCity: 'San Francisco',
        utmSource: 'google',
        utmMedium: 'cpc',
        pageViewCount: 5,
        startedAt: new Date('2025-02-10T14:30:00Z'),
      },
      {
        externalSessionId: 'sess-002',
        fingerprint: 'fp-def456',
        identified: false,
        deviceType: 'mobile',
        browser: 'Safari',
        os: 'iOS',
        ipCountry: 'UK',
        ipCity: 'London',
        utmSource: 'twitter',
        utmMedium: 'social',
        pageViewCount: 3,
        startedAt: new Date('2025-02-11T09:15:00Z'),
      },
      {
        externalSessionId: 'sess-003',
        fingerprint: 'fp-ghi789',
        contactId: c[3]?.id,
        identified: true,
        deviceType: 'desktop',
        browser: 'Firefox',
        os: 'Windows',
        ipCountry: 'US',
        ipCity: 'New York',
        utmSource: 'email',
        utmMedium: 'newsletter',
        utmCampaign: 'q1-launch-2025',
        pageViewCount: 8,
        startedAt: new Date('2025-02-12T11:00:00Z'),
      },
    ])
    .returning()

  await db.insert(visitorPageViews).values([
    {
      sessionId: sessionRows[0]?.id ?? '',
      url: 'https://phynd.io/',
      title: 'Phynd CRM - Home',
      duration: 12000,
      viewedAt: new Date('2025-02-10T14:30:00Z'),
    },
    {
      sessionId: sessionRows[0]?.id ?? '',
      url: 'https://phynd.io/pricing',
      title: 'Phynd CRM - Pricing',
      duration: 45000,
      viewedAt: new Date('2025-02-10T14:32:00Z'),
    },
    {
      sessionId: sessionRows[0]?.id ?? '',
      url: 'forj://asset/asset-001/3d_interact',
      title: '3D Asset Interaction',
      duration: 30000,
      viewedAt: new Date('2025-02-10T14:35:00Z'),
    },
    {
      sessionId: sessionRows[2]?.id ?? '',
      url: 'https://phynd.io/features',
      title: 'Phynd CRM - Features',
      duration: 60000,
      viewedAt: new Date('2025-02-12T11:02:00Z'),
    },
  ])
}
