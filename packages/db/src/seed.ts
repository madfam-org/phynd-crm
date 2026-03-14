import { getDb } from './client'
import { activities } from './schema/activities'
import { campaigns } from './schema/campaigns'
import { contacts } from './schema/contacts'
import { conversions } from './schema/conversions'
import { externalReferences } from './schema/external-references'
import { leadScoringRules } from './schema/lead-scoring-rules'
import { leads } from './schema/leads'
import { notes } from './schema/notes'
import { notifications } from './schema/notifications'
import { offers } from './schema/offers'
import { opportunities } from './schema/opportunities'
import { pipelineStages, pipelines } from './schema/pipelines'
import { roleViewPreferences } from './schema/role-preferences'
import { stageTransitions } from './schema/stage-transitions'
import { taggables, tags } from './schema/tags'
import { users } from './schema/users'
import { visitorPageViews } from './schema/visitor-page-views'
import { visitorSessions } from './schema/visitor-sessions'

async function seed() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Seed script cannot run in production')
    process.exit(1)
  }

  const db = getDb()

  console.log('Seeding database...')

  // 1. Create system user (required for FK references)
  const [systemUser] = await db
    .insert(users)
    .values({
      id: 'system',
      email: 'system@phyne.io',
      name: 'System',
      role: 'admin',
    })
    .onConflictDoNothing()
    .returning()

  const [devAdmin] = await db
    .insert(users)
    .values({
      email: 'dev@madfam.com',
      name: 'Dev Admin',
      role: 'admin',
      externalJanuaId: 'janua-dev-001',
    })
    .onConflictDoNothing()
    .returning()

  const adminId = devAdmin?.id ?? systemUser?.id ?? 'system'

  // 2. Create default pipeline
  const [defaultPipeline] = await db
    .insert(pipelines)
    .values({ name: 'Default Sales Pipeline', isDefault: true })
    .returning()

  const pipelineId = defaultPipeline?.id
  if (!pipelineId) throw new Error('Failed to create default pipeline')

  // 3. Create pipeline stages
  const stageData = [
    { name: 'Prospecting', position: 0, probability: 10 },
    { name: 'Qualification', position: 1, probability: 20 },
    { name: 'Proposal', position: 2, probability: 50 },
    { name: 'Negotiation', position: 3, probability: 75 },
    { name: 'Closed Won', position: 4, probability: 100 },
    { name: 'Closed Lost', position: 5, probability: 0 },
  ]

  const stages = await db
    .insert(pipelineStages)
    .values(stageData.map((s) => ({ ...s, pipelineId })))
    .returning()

  // 4. Create sample contacts
  const sampleContacts = await db
    .insert(contacts)
    .values([
      {
        name: 'Alice Johnson',
        email: 'alice@techcorp.com',
        company: 'TechCorp',
        phone: '+1-555-0101',
        status: 'active',
        ownerId: adminId,
      },
      {
        name: 'Bob Smith',
        email: 'bob@designlab.com',
        company: 'DesignLab',
        phone: '+1-555-0102',
        status: 'active',
        ownerId: adminId,
      },
      {
        name: 'Carol White',
        email: 'carol@mfgworks.com',
        company: 'MfgWorks',
        phone: '+1-555-0103',
        status: 'active',
        ownerId: adminId,
      },
      {
        name: 'David Chen',
        email: 'david@innovatech.com',
        company: 'InnovaTech',
        phone: '+1-555-0104',
        status: 'active',
        ownerId: adminId,
      },
      {
        name: 'Emma Garcia',
        email: 'emma@retailplus.com',
        company: 'RetailPlus',
        status: 'inactive',
        ownerId: adminId,
      },
    ])
    .returning()

  // 5. Create sample leads
  const sampleLeads = await db
    .insert(leads)
    .values([
      {
        contactId: sampleContacts[0]?.id,
        source: 'website',
        status: 'qualified',
        score: 85,
        pipelineId,
        stageId: stages[2]?.id ?? stages[0]?.id ?? pipelineId,
        ownerId: adminId,
      },
      {
        contactId: sampleContacts[1]?.id,
        source: 'referral',
        status: 'new',
        score: 60,
        pipelineId,
        stageId: stages[0]?.id ?? pipelineId,
        ownerId: adminId,
      },
      {
        contactId: sampleContacts[3]?.id,
        source: 'trade_show',
        status: 'contacted',
        score: 72,
        pipelineId,
        stageId: stages[1]?.id ?? stages[0]?.id ?? pipelineId,
        ownerId: adminId,
      },
    ])
    .returning()

  // 6. Create sample opportunities
  const sampleOpps = await db
    .insert(opportunities)
    .values([
      {
        name: 'TechCorp Enterprise Deal',
        contactId: sampleContacts[0]?.id,
        pipelineId,
        stageId: stages[2]?.id ?? stages[0]?.id ?? pipelineId,
        value: '50000.00',
        probability: 50,
        status: 'open',
        ownerId: adminId,
      },
      {
        name: 'DesignLab Platform License',
        contactId: sampleContacts[1]?.id,
        pipelineId,
        stageId: stages[3]?.id ?? stages[0]?.id ?? pipelineId,
        value: '25000.00',
        probability: 75,
        status: 'open',
        ownerId: adminId,
      },
      {
        name: 'MfgWorks Custom Integration',
        contactId: sampleContacts[2]?.id,
        pipelineId,
        stageId: stages[4]?.id ?? stages[0]?.id ?? pipelineId,
        value: '80000.00',
        probability: 100,
        status: 'won',
        ownerId: adminId,
      },
    ])
    .returning()

  // 7. Create sample activities
  await db.insert(activities).values([
    {
      type: 'call',
      title: 'Discovery call with Alice',
      description: 'Initial discovery call to discuss TechCorp requirements',
      entityType: 'contact',
      entityId: sampleContacts[0]?.id ?? '',
      ownerId: adminId,
      status: 'completed',
      completedAt: new Date('2025-01-15'),
    },
    {
      type: 'email',
      title: 'Send proposal to Bob',
      description: 'Follow up with platform license proposal',
      entityType: 'lead',
      entityId: sampleLeads[1]?.id ?? '',
      ownerId: adminId,
      status: 'pending',
    },
    {
      type: 'meeting',
      title: 'Contract negotiation - DesignLab',
      entityType: 'opportunity',
      entityId: sampleOpps[1]?.id ?? '',
      ownerId: adminId,
      status: 'pending',
      dueAt: new Date(Date.now() + 3 * 86400000),
    },
    {
      type: 'task',
      title: 'Prepare demo environment',
      description: 'Set up sandbox for InnovaTech demo',
      entityType: 'lead',
      entityId: sampleLeads[2]?.id ?? '',
      ownerId: adminId,
      status: 'pending',
      dueAt: new Date(Date.now() + 7 * 86400000),
    },
  ])

  // 8. Create sample notes
  await db.insert(notes).values([
    {
      content:
        'Alice mentioned they are evaluating 3 competing platforms. Key differentiator is federation capability.',
      entityType: 'contact',
      entityId: sampleContacts[0]?.id ?? '',
      authorId: adminId,
    },
    {
      content: 'Budget approved for Q2. Decision expected by end of March.',
      entityType: 'opportunity',
      entityId: sampleOpps[0]?.id ?? '',
      authorId: adminId,
      isPinned: true,
    },
  ])

  // 9. Create sample offers
  const sampleOffers = await db
    .insert(offers)
    .values([
      {
        name: 'Early Adopter Discount',
        type: 'discount',
        description: '20% off first year subscription',
        value: '20.00',
        status: 'active',
        maxRedemptions: 50,
        currentRedemptions: 3,
        validFrom: new Date('2025-01-01'),
        validUntil: new Date('2025-12-31'),
      },
      {
        name: 'Free Trial - 30 Days',
        type: 'free_trial',
        description: 'Full platform access for 30 days',
        status: 'active',
        maxRedemptions: 100,
        currentRedemptions: 12,
      },
    ])
    .returning()

  // 10. Create sample campaigns
  const sampleCampaigns = await db
    .insert(campaigns)
    .values([
      {
        name: 'Q1 Product Launch',
        status: 'active',
        utmSource: 'email',
        utmMedium: 'newsletter',
        utmCampaign: 'q1-launch-2025',
        budget: '10000.00',
        spend: '4500.00',
        offerId: sampleOffers[0]?.id,
        startDate: new Date('2025-01-15'),
        endDate: new Date('2025-03-31'),
      },
      {
        name: 'Trade Show Follow-up',
        status: 'active',
        utmSource: 'tradeshow',
        utmMedium: 'email',
        utmCampaign: 'tradeshow-followup',
        budget: '5000.00',
        spend: '2200.00',
        startDate: new Date('2025-02-01'),
      },
    ])
    .returning()

  // 11. Create sample conversions
  await db.insert(conversions).values([
    {
      type: 'visitor_to_lead',
      contactId: sampleContacts[0]?.id,
      leadId: sampleLeads[0]?.id,
      campaignId: sampleCampaigns[0]?.id,
      value: '0',
    },
    {
      type: 'lead_to_opportunity',
      contactId: sampleContacts[0]?.id,
      leadId: sampleLeads[0]?.id,
      campaignId: sampleCampaigns[0]?.id,
      value: '50000.00',
    },
    { type: 'opportunity_to_won', contactId: sampleContacts[2]?.id, value: '80000.00' },
  ])

  // 12. Create sample visitor sessions
  const sessions = await db
    .insert(visitorSessions)
    .values([
      {
        externalSessionId: 'sess-001',
        fingerprint: 'fp-abc123',
        contactId: sampleContacts[0]?.id,
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
        contactId: sampleContacts[3]?.id,
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

  // 13. Create sample page views
  await db.insert(visitorPageViews).values([
    {
      sessionId: sessions[0]?.id ?? '',
      url: 'https://phyne.io/',
      title: 'Phyne CRM - Home',
      duration: 12000,
      viewedAt: new Date('2025-02-10T14:30:00Z'),
    },
    {
      sessionId: sessions[0]?.id ?? '',
      url: 'https://phyne.io/pricing',
      title: 'Phyne CRM - Pricing',
      duration: 45000,
      viewedAt: new Date('2025-02-10T14:32:00Z'),
    },
    {
      sessionId: sessions[0]?.id ?? '',
      url: 'forj://asset/asset-001/3d_interact',
      title: '3D Asset Interaction',
      duration: 30000,
      viewedAt: new Date('2025-02-10T14:35:00Z'),
    },
    {
      sessionId: sessions[2]?.id ?? '',
      url: 'https://phyne.io/features',
      title: 'Phyne CRM - Features',
      duration: 60000,
      viewedAt: new Date('2025-02-12T11:02:00Z'),
    },
  ])

  // 14. Create lead scoring rules
  await db.insert(leadScoringRules).values([
    {
      name: 'Website Source',
      category: 'demographic',
      condition: [{ field: 'source', operator: 'eq', value: 'website' }],
      points: 10,
      isActive: true,
    },
    {
      name: 'Referral Source',
      category: 'demographic',
      condition: [{ field: 'source', operator: 'eq', value: 'referral' }],
      points: 25,
      isActive: true,
    },
    {
      name: 'Qualified Status',
      category: 'demographic',
      condition: [{ field: 'status', operator: 'eq', value: 'qualified' }],
      points: 20,
      isActive: true,
    },
    {
      name: 'Multiple Sessions',
      category: 'behavior',
      condition: [{ field: 'session_count', operator: 'gte', value: '3' }],
      points: 15,
      isActive: true,
    },
    {
      name: 'High Page Views',
      category: 'behavior',
      condition: [{ field: 'page_view_count', operator: 'gte', value: '5' }],
      points: 10,
      isActive: true,
    },
    {
      name: 'Has Contact Info',
      category: 'engagement',
      condition: [{ field: 'has_contact', operator: 'eq', value: 'true' }],
      points: 15,
      isActive: true,
    },
    {
      name: 'Viewed Pricing',
      category: 'behavior',
      condition: [{ field: 'page_url', operator: 'contains', value: 'pricing' }],
      points: 20,
      isActive: true,
    },
    {
      name: '3D Asset Engagement',
      category: 'engagement',
      condition: [{ field: '3d_asset_views', operator: 'gte', value: '1' }],
      points: 15,
      isActive: true,
    },
  ])

  // 15. Create sample external references
  await db.insert(externalReferences).values([
    {
      entityType: 'contact',
      entityId: sampleContacts[0]?.id ?? '',
      provider: 'janua',
      externalId: 'janua-user-001',
      metadata: { roles: ['customer'] },
    },
    {
      entityType: 'contact',
      entityId: sampleContacts[0]?.id ?? '',
      provider: 'dhanam',
      externalId: 'dhanam-cust-001',
      metadata: { plan: 'enterprise' },
    },
    {
      entityType: 'contact',
      entityId: sampleContacts[2]?.id ?? '',
      provider: 'pravara',
      externalId: 'pravara-contact-001',
      metadata: { activeOrders: 2 },
    },
  ])

  // 16. Create sample stage transitions
  await db.insert(stageTransitions).values([
    {
      entityType: 'lead',
      entityId: sampleLeads[0]?.id ?? '',
      fromStageId: stages[0]?.id,
      toStageId: stages[1]?.id ?? '',
      transitionedAt: new Date('2025-01-20'),
    },
    {
      entityType: 'lead',
      entityId: sampleLeads[0]?.id ?? '',
      fromStageId: stages[1]?.id,
      toStageId: stages[2]?.id ?? '',
      transitionedAt: new Date('2025-02-05'),
    },
    {
      entityType: 'opportunity',
      entityId: sampleOpps[0]?.id ?? '',
      fromStageId: stages[0]?.id,
      toStageId: stages[2]?.id ?? '',
      transitionedAt: new Date('2025-01-25'),
    },
    {
      entityType: 'opportunity',
      entityId: sampleOpps[2]?.id ?? '',
      fromStageId: stages[2]?.id,
      toStageId: stages[4]?.id ?? '',
      transitionedAt: new Date('2025-02-15'),
    },
  ])

  // 17. Create default role view preferences
  await db.insert(roleViewPreferences).values([
    {
      role: 'sales_rep',
      panelOrder: ['identity', 'billing', 'manufacturing', 'fabrication', 'assets'],
      defaultTab: 'identity',
    },
    {
      role: 'manufacturing',
      panelOrder: ['manufacturing', 'fabrication', 'assets', 'identity', 'billing'],
      defaultTab: 'manufacturing',
    },
    {
      role: 'finance',
      panelOrder: ['billing', 'identity', 'manufacturing', 'fabrication', 'assets'],
      defaultTab: 'billing',
    },
    {
      role: 'admin',
      panelOrder: ['identity', 'billing', 'manufacturing', 'fabrication', 'assets'],
      defaultTab: 'identity',
    },
  ])

  // 18. Create sample tags
  const sampleTags = await db
    .insert(tags)
    .values([
      { name: 'VIP', color: '#8b5cf6' },
      { name: 'Enterprise', color: '#3b82f6' },
      { name: 'Hot Lead', color: '#ef4444' },
    ])
    .onConflictDoNothing()
    .returning()

  // 19. Create tag associations
  if (sampleTags.length > 0) {
    await db
      .insert(taggables)
      .values([
        {
          tagId: sampleTags[0]?.id ?? '',
          entityType: 'contact',
          entityId: sampleContacts[0]?.id ?? '',
        },
        {
          tagId: sampleTags[1]?.id ?? '',
          entityType: 'contact',
          entityId: sampleContacts[0]?.id ?? '',
        },
        {
          tagId: sampleTags[2]?.id ?? '',
          entityType: 'lead',
          entityId: sampleLeads[0]?.id ?? '',
        },
      ])
      .onConflictDoNothing()
  }

  // 20. Create sample notifications
  await db
    .insert(notifications)
    .values([
      {
        userId: adminId,
        type: 'owner_assignment',
        title: 'New lead assigned to you',
        message: 'You have been assigned lead: website',
        entityType: 'lead',
        entityId: sampleLeads[0]?.id ?? '',
        isRead: false,
      },
      {
        userId: adminId,
        type: 'owner_assignment',
        title: 'New opportunity assigned to you',
        message: 'You have been assigned opportunity: TechCorp Enterprise Deal',
        entityType: 'opportunity',
        entityId: sampleOpps[0]?.id ?? '',
        isRead: true,
        readAt: new Date(),
      },
    ])
    .onConflictDoNothing()

  console.log('Seed complete!')
  process.exit(0)
}

seed().catch((e) => {
  console.error('Seed failed:', e)
  process.exit(1)
})
