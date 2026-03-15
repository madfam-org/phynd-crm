const DAY_MS = 86400000

export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS)
}

export function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY_MS)
}

export function buildUserData(prefix: string) {
  return {
    id: prefix,
    email: 'demo@phyne.io',
    name: 'Demo Visitor',
    role: 'admin' as const,
  }
}

export function buildPipelineData(prefix: string) {
  return { id: `${prefix}-pipeline`, name: 'Sales Pipeline', isDefault: true }
}

export function buildStageData(prefix: string, pipelineId: string) {
  return [
    { id: `${prefix}-stage-0`, name: 'Prospecting', position: 0, probability: 10, pipelineId },
    { id: `${prefix}-stage-1`, name: 'Qualification', position: 1, probability: 25, pipelineId },
    { id: `${prefix}-stage-2`, name: 'Proposal', position: 2, probability: 50, pipelineId },
    { id: `${prefix}-stage-3`, name: 'Negotiation', position: 3, probability: 75, pipelineId },
    { id: `${prefix}-stage-4`, name: 'Closed Won', position: 4, probability: 100, pipelineId },
    { id: `${prefix}-stage-5`, name: 'Closed Lost', position: 5, probability: 0, pipelineId },
  ]
}

export function buildContactData(prefix: string, userId: string) {
  return [
    {
      id: `${prefix}-c1`,
      name: 'Sarah Chen',
      email: 'sarah@acmecorp.com',
      company: 'Acme Corp',
      phone: '+1-555-0201',
      status: 'active' as const,
      ownerId: userId,
    },
    {
      id: `${prefix}-c2`,
      name: 'Marcus Rivera',
      email: 'marcus@globex.com',
      company: 'Globex Industries',
      phone: '+1-555-0202',
      status: 'active' as const,
      ownerId: userId,
    },
    {
      id: `${prefix}-c3`,
      name: 'Aisha Patel',
      email: 'aisha@waynetech.com',
      company: 'Wayne Technologies',
      phone: '+1-555-0203',
      status: 'active' as const,
      ownerId: userId,
    },
    {
      id: `${prefix}-c4`,
      name: "James O'Brien",
      email: 'james@starklabs.com',
      company: 'Stark Labs',
      status: 'active' as const,
      ownerId: userId,
    },
  ]
}

export function buildLeadData(prefix: string, pipelineId: string, userId: string) {
  return [
    {
      id: `${prefix}-l1`,
      contactId: `${prefix}-c1`,
      source: 'website',
      status: 'qualified',
      score: 82,
      pipelineId,
      stageId: `${prefix}-stage-2`,
      ownerId: userId,
      createdAt: daysAgo(22),
    },
    {
      id: `${prefix}-l2`,
      contactId: `${prefix}-c2`,
      source: 'referral',
      status: 'new',
      score: 55,
      pipelineId,
      stageId: `${prefix}-stage-0`,
      ownerId: userId,
      createdAt: daysAgo(15),
    },
    {
      id: `${prefix}-l3`,
      contactId: `${prefix}-c4`,
      source: 'trade_show',
      status: 'contacted',
      score: 68,
      pipelineId,
      stageId: `${prefix}-stage-1`,
      ownerId: userId,
      createdAt: daysAgo(8),
    },
  ]
}

export function buildOpportunityData(prefix: string, pipelineId: string, userId: string) {
  return [
    {
      id: `${prefix}-o1`,
      name: 'Acme Enterprise Suite',
      contactId: `${prefix}-c1`,
      pipelineId,
      stageId: `${prefix}-stage-3`,
      value: '75000.00',
      probability: 75,
      status: 'open',
      ownerId: userId,
      createdAt: daysAgo(20),
    },
    {
      id: `${prefix}-o2`,
      name: 'Globex Platform License',
      contactId: `${prefix}-c2`,
      pipelineId,
      stageId: `${prefix}-stage-1`,
      value: '32000.00',
      probability: 25,
      status: 'open',
      ownerId: userId,
      createdAt: daysAgo(12),
    },
    {
      id: `${prefix}-o3`,
      name: 'Wayne Tech Integration',
      contactId: `${prefix}-c3`,
      pipelineId,
      stageId: `${prefix}-stage-4`,
      value: '120000.00',
      probability: 100,
      status: 'won',
      ownerId: userId,
      createdAt: daysAgo(5),
    },
  ]
}

export function buildQuoteData(prefix: string, userId: string) {
  return [
    {
      id: `${prefix}-q1`,
      quoteNumber: 'Q-DEMO-001',
      opportunityId: `${prefix}-o1`,
      contactId: `${prefix}-c1`,
      status: 'sent',
      totalAmount: '72000.00',
      currency: 'USD',
      validUntil: daysFromNow(30),
      ownerId: userId,
      createdAt: daysAgo(18),
    },
    {
      id: `${prefix}-q2`,
      quoteNumber: 'Q-DEMO-002',
      opportunityId: `${prefix}-o3`,
      contactId: `${prefix}-c3`,
      status: 'accepted',
      totalAmount: '120000.00',
      currency: 'USD',
      ownerId: userId,
      createdAt: daysAgo(4),
    },
  ]
}

export function buildOrderData(prefix: string, userId: string) {
  return [
    {
      id: `${prefix}-ord1`,
      orderNumber: 'ORD-DEMO-001',
      opportunityId: `${prefix}-o3`,
      quoteId: `${prefix}-q2`,
      contactId: `${prefix}-c3`,
      status: 'in_production',
      totalAmount: '120000.00',
      currency: 'USD',
      estimatedCompletion: daysFromNow(14),
      ownerId: userId,
      createdAt: daysAgo(3),
    },
    {
      id: `${prefix}-ord2`,
      orderNumber: 'ORD-DEMO-002',
      contactId: `${prefix}-c1`,
      status: 'confirmed',
      totalAmount: '18000.00',
      currency: 'USD',
      estimatedCompletion: daysFromNow(45),
      ownerId: userId,
      createdAt: daysAgo(1),
    },
  ]
}

export function buildOfferData(prefix: string) {
  return [
    {
      id: `${prefix}-offer1`,
      name: 'Early Adopter Discount',
      type: 'discount',
      description: '20% off first year',
      value: '20.00',
      status: 'active',
      maxRedemptions: 50,
      currentRedemptions: 5,
      validFrom: daysAgo(60),
      validUntil: daysFromNow(300),
    },
    {
      id: `${prefix}-offer2`,
      name: 'Free Trial \u2014 30 Days',
      type: 'free_trial',
      description: 'Full platform access',
      status: 'active',
      maxRedemptions: 100,
      currentRedemptions: 18,
    },
  ]
}

export function buildCampaignData(prefix: string) {
  return [
    {
      id: `${prefix}-camp1`,
      name: 'Q1 Product Launch',
      channel: 'email',
      status: 'active',
      utmSource: 'email',
      utmMedium: 'newsletter',
      utmCampaign: 'q1-launch',
      budget: '10000.00',
      spend: '4500.00',
      offerId: `${prefix}-offer1`,
      startDate: daysAgo(45),
      endDate: daysFromNow(15),
    },
    {
      id: `${prefix}-camp2`,
      name: 'Trade Show Follow-up',
      channel: 'social',
      status: 'active',
      utmSource: 'tradeshow',
      utmMedium: 'email',
      utmCampaign: 'tradeshow-followup',
      budget: '5000.00',
      spend: '2200.00',
      startDate: daysAgo(30),
    },
  ]
}

export function buildConversionData(prefix: string) {
  return [
    {
      id: `${prefix}-conv1`,
      type: 'visitor_to_lead',
      contactId: `${prefix}-c1`,
      leadId: `${prefix}-l1`,
      campaignId: `${prefix}-camp1`,
      value: '0',
      convertedAt: daysAgo(20),
    },
    {
      id: `${prefix}-conv2`,
      type: 'lead_to_opportunity',
      contactId: `${prefix}-c1`,
      leadId: `${prefix}-l1`,
      campaignId: `${prefix}-camp1`,
      value: '75000.00',
      convertedAt: daysAgo(18),
    },
    {
      id: `${prefix}-conv3`,
      type: 'visitor_to_lead',
      contactId: `${prefix}-c2`,
      leadId: `${prefix}-l2`,
      value: '0',
      convertedAt: daysAgo(14),
    },
    {
      id: `${prefix}-conv4`,
      type: 'opportunity_to_won',
      contactId: `${prefix}-c3`,
      value: '120000.00',
      convertedAt: daysAgo(4),
    },
  ]
}

export function buildVisitorSessionData(prefix: string) {
  return [
    {
      id: `${prefix}-vs1`,
      externalSessionId: `${prefix}-sess-001`,
      fingerprint: 'fp-demo-1',
      contactId: `${prefix}-c1`,
      identified: true,
      deviceType: 'desktop',
      browser: 'Chrome',
      os: 'macOS',
      ipCountry: 'US',
      ipCity: 'San Francisco',
      utmSource: 'google',
      utmMedium: 'cpc',
      pageViewCount: 5,
      startedAt: daysAgo(18),
      createdAt: daysAgo(18),
    },
    {
      id: `${prefix}-vs2`,
      externalSessionId: `${prefix}-sess-002`,
      fingerprint: 'fp-demo-2',
      identified: false,
      deviceType: 'mobile',
      browser: 'Safari',
      os: 'iOS',
      ipCountry: 'UK',
      ipCity: 'London',
      utmSource: 'twitter',
      utmMedium: 'social',
      pageViewCount: 3,
      startedAt: daysAgo(10),
      createdAt: daysAgo(10),
    },
    {
      id: `${prefix}-vs3`,
      externalSessionId: `${prefix}-sess-003`,
      fingerprint: 'fp-demo-3',
      contactId: `${prefix}-c4`,
      identified: true,
      deviceType: 'desktop',
      browser: 'Firefox',
      os: 'Windows',
      ipCountry: 'US',
      ipCity: 'New York',
      utmSource: 'email',
      utmMedium: 'newsletter',
      utmCampaign: 'q1-launch',
      pageViewCount: 8,
      startedAt: daysAgo(5),
      createdAt: daysAgo(5),
    },
  ]
}

export function buildPageViewData(prefix: string) {
  return [
    {
      id: `${prefix}-vpv1`,
      sessionId: `${prefix}-vs1`,
      url: 'https://phyne.io/',
      title: 'Phyne CRM \u2014 Home',
      duration: 12000,
      viewedAt: daysAgo(18),
    },
    {
      id: `${prefix}-vpv2`,
      sessionId: `${prefix}-vs1`,
      url: 'https://phyne.io/pricing',
      title: 'Pricing',
      duration: 45000,
      viewedAt: daysAgo(18),
    },
    {
      id: `${prefix}-vpv3`,
      sessionId: `${prefix}-vs2`,
      url: 'https://phyne.io/features',
      title: 'Features',
      duration: 30000,
      viewedAt: daysAgo(10),
    },
    {
      id: `${prefix}-vpv4`,
      sessionId: `${prefix}-vs3`,
      url: 'forj://asset/asset-001/3d_interact',
      title: '3D Asset Interaction',
      duration: 60000,
      viewedAt: daysAgo(5),
    },
  ]
}

export function buildScoringRuleData(prefix: string) {
  return [
    {
      id: `${prefix}-lsr1`,
      name: 'Website Source',
      category: 'demographic',
      condition: [{ field: 'source', operator: 'eq', value: 'website' }],
      points: 10,
      isActive: true,
    },
    {
      id: `${prefix}-lsr2`,
      name: 'Referral Source',
      category: 'demographic',
      condition: [{ field: 'source', operator: 'eq', value: 'referral' }],
      points: 25,
      isActive: true,
    },
    {
      id: `${prefix}-lsr3`,
      name: 'Qualified Status',
      category: 'demographic',
      condition: [{ field: 'status', operator: 'eq', value: 'qualified' }],
      points: 20,
      isActive: true,
    },
    {
      id: `${prefix}-lsr4`,
      name: 'Multiple Sessions',
      category: 'behavior',
      condition: [{ field: 'session_count', operator: 'gte', value: '3' }],
      points: 15,
      isActive: true,
    },
    {
      id: `${prefix}-lsr5`,
      name: 'Viewed Pricing',
      category: 'behavior',
      condition: [{ field: 'page_url', operator: 'contains', value: 'pricing' }],
      points: 20,
      isActive: true,
    },
  ]
}

export function buildExternalRefData(prefix: string) {
  return [
    {
      id: `${prefix}-ext1`,
      entityType: 'contact',
      entityId: `${prefix}-c1`,
      provider: 'janua',
      externalId: 'janua-demo-001',
      metadata: { roles: ['customer'] },
    },
    {
      id: `${prefix}-ext2`,
      entityType: 'contact',
      entityId: `${prefix}-c1`,
      provider: 'dhanam',
      externalId: 'dhanam-demo-001',
      metadata: { plan: 'enterprise' },
    },
    {
      id: `${prefix}-ext3`,
      entityType: 'contact',
      entityId: `${prefix}-c3`,
      provider: 'pravara',
      externalId: 'pravara-demo-001',
      metadata: { activeOrders: 2 },
    },
  ]
}

export function buildStageTransitionData(prefix: string) {
  return [
    {
      id: `${prefix}-st1`,
      entityType: 'lead',
      entityId: `${prefix}-l1`,
      fromStageId: `${prefix}-stage-0`,
      toStageId: `${prefix}-stage-1`,
      transitionedAt: daysAgo(20),
    },
    {
      id: `${prefix}-st2`,
      entityType: 'lead',
      entityId: `${prefix}-l1`,
      fromStageId: `${prefix}-stage-1`,
      toStageId: `${prefix}-stage-2`,
      transitionedAt: daysAgo(17),
    },
    {
      id: `${prefix}-st3`,
      entityType: 'opportunity',
      entityId: `${prefix}-o1`,
      fromStageId: `${prefix}-stage-0`,
      toStageId: `${prefix}-stage-3`,
      transitionedAt: daysAgo(15),
    },
    {
      id: `${prefix}-st4`,
      entityType: 'opportunity',
      entityId: `${prefix}-o3`,
      fromStageId: `${prefix}-stage-2`,
      toStageId: `${prefix}-stage-4`,
      transitionedAt: daysAgo(3),
    },
  ]
}

export function buildActivityData(prefix: string, userId: string) {
  return [
    {
      id: `${prefix}-a1`,
      type: 'call',
      title: 'Discovery call with Sarah',
      description: 'Discussed enterprise requirements and integration needs',
      entityType: 'contact',
      entityId: `${prefix}-c1`,
      ownerId: userId,
      status: 'completed',
      completedAt: daysAgo(5),
    },
    {
      id: `${prefix}-a2`,
      type: 'email',
      title: 'Send proposal to Marcus',
      description: 'Platform license pricing breakdown',
      entityType: 'lead',
      entityId: `${prefix}-l2`,
      ownerId: userId,
      status: 'pending',
      dueAt: daysFromNow(2),
    },
    {
      id: `${prefix}-a3`,
      type: 'meeting',
      title: 'Contract review \u2014 Wayne Tech',
      entityType: 'opportunity',
      entityId: `${prefix}-o1`,
      ownerId: userId,
      status: 'pending',
      dueAt: daysFromNow(5),
    },
    {
      id: `${prefix}-a4`,
      type: 'task',
      title: 'Prepare demo for Stark Labs',
      description: 'Set up sandbox environment',
      entityType: 'lead',
      entityId: `${prefix}-l3`,
      ownerId: userId,
      status: 'pending',
      dueAt: daysFromNow(7),
    },
  ]
}

export function buildNoteData(prefix: string, userId: string) {
  return [
    {
      id: `${prefix}-n1`,
      content:
        'Sarah mentioned evaluating 3 competing platforms. Key differentiator is our federation capability \u2014 no data duplication.',
      entityType: 'contact',
      entityId: `${prefix}-c1`,
      authorId: userId,
    },
    {
      id: `${prefix}-n2`,
      content: 'Budget approved for Q2. Decision expected by end of month.',
      entityType: 'opportunity',
      entityId: `${prefix}-o1`,
      authorId: userId,
      isPinned: true,
    },
  ]
}

export function buildTagData(prefix: string) {
  return [
    { id: `${prefix}-tag1`, name: 'VIP', color: '#8b5cf6' },
    { id: `${prefix}-tag2`, name: 'Enterprise', color: '#3b82f6' },
    { id: `${prefix}-tag3`, name: 'Hot Lead', color: '#ef4444' },
  ]
}

export function buildTaggableData(prefix: string) {
  return [
    { tagId: `${prefix}-tag1`, entityType: 'contact', entityId: `${prefix}-c1` },
    { tagId: `${prefix}-tag2`, entityType: 'contact', entityId: `${prefix}-c3` },
    { tagId: `${prefix}-tag3`, entityType: 'lead', entityId: `${prefix}-l1` },
  ]
}

export function buildNotificationData(prefix: string, userId: string) {
  return {
    id: `${prefix}-notif1`,
    userId,
    type: 'owner_assignment',
    title: 'New opportunity assigned',
    message: 'You have been assigned: Acme Enterprise Suite',
    entityType: 'opportunity',
    entityId: `${prefix}-o1`,
    isRead: false,
  }
}
