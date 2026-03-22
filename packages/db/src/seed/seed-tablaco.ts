import { eq } from 'drizzle-orm'
import { activities } from '../schema/activities'
import { contacts } from '../schema/contacts'
import { conversions } from '../schema/conversions'
import { externalReferences } from '../schema/external-references'
import { leads } from '../schema/leads'
import { notes } from '../schema/notes'
import { opportunities } from '../schema/opportunities'
import { orders } from '../schema/orders'
import { quotes } from '../schema/quotes'
import { stageTransitions } from '../schema/stage-transitions'
import { taggables, tags } from '../schema/tags'
import { visitorPageViews } from '../schema/visitor-page-views'
import { visitorSessions } from '../schema/visitor-sessions'
import type { Db, SeedIds } from './types'

export async function seedTablaco(db: Db, ids: SeedIds) {
  const { adminId, deliveryPipelineId, deliveryStages } = ids

  const now = new Date()
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000)
  const daysFromNow = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000)

  const stageId = (i: number) => deliveryStages[i]?.id ?? ''

  // --- Contact ---
  const [tablacoContact] = await db
    .insert(contacts)
    .values({
      name: 'Rodrigo Tablaco',
      email: 'rodrigo@tablaco.mx',
      company: 'Tablaco',
      phone: '+52-55-1234-5678',
      status: 'active',
      ownerId: adminId,
      externalJanuaId: 'janua-tablaco-001',
    })
    .returning()

  const contactId = tablacoContact?.id ?? ''

  // --- Lead (converted) ---
  const [tablacoLead] = await db
    .insert(leads)
    .values({
      contactId,
      source: 'referral',
      status: 'converted',
      score: 95,
      pipelineId: deliveryPipelineId,
      stageId: stageId(4),
      ownerId: adminId,
      createdAt: daysAgo(65),
    })
    .returning()

  const leadId = tablacoLead?.id ?? ''

  // --- Opportunity ---
  const [tablacoOpp] = await db
    .insert(opportunities)
    .values({
      name: 'Tablaco Phase 1+2 Development',
      contactId,
      pipelineId: deliveryPipelineId,
      stageId: stageId(4),
      value: '45000.00',
      probability: 90,
      status: 'open',
      ownerId: adminId,
      createdAt: daysAgo(60),
    })
    .returning()

  const oppId = tablacoOpp?.id ?? ''

  // --- Quotes (3 installments) ---
  const [quote1] = await db
    .insert(quotes)
    .values({
      quoteNumber: 'Q-2026-TAB-001',
      opportunityId: oppId,
      contactId,
      status: 'accepted',
      totalAmount: '15000.00',
      currency: 'USD',
      validUntil: daysAgo(30),
      ownerId: adminId,
      createdAt: daysAgo(60),
    })
    .returning()

  const [quote2] = await db
    .insert(quotes)
    .values({
      quoteNumber: 'Q-2026-TAB-002',
      opportunityId: oppId,
      contactId,
      status: 'accepted',
      totalAmount: '15000.00',
      currency: 'USD',
      validUntil: daysAgo(5),
      ownerId: adminId,
      createdAt: daysAgo(40),
    })
    .returning()

  const [quote3] = await db
    .insert(quotes)
    .values({
      quoteNumber: 'Q-2026-TAB-003',
      opportunityId: oppId,
      contactId,
      status: 'sent',
      totalAmount: '15000.00',
      currency: 'USD',
      validUntil: daysFromNow(15),
      ownerId: adminId,
      createdAt: daysAgo(10),
    })
    .returning()

  // --- Orders ---
  await db.insert(orders).values([
    {
      orderNumber: 'ORD-2026-TAB-001',
      opportunityId: oppId,
      quoteId: quote1?.id,
      contactId,
      status: 'fulfilled',
      totalAmount: '15000.00',
      currency: 'USD',
      estimatedCompletion: daysAgo(45),
      actualCompletion: daysAgo(44),
      ownerId: adminId,
      createdAt: daysAgo(58),
    },
    {
      orderNumber: 'ORD-2026-TAB-002',
      opportunityId: oppId,
      quoteId: quote2?.id,
      contactId,
      status: 'fulfilled',
      totalAmount: '15000.00',
      currency: 'USD',
      estimatedCompletion: daysAgo(15),
      actualCompletion: daysAgo(14),
      ownerId: adminId,
      createdAt: daysAgo(38),
    },
    {
      orderNumber: 'ORD-2026-TAB-003',
      opportunityId: oppId,
      quoteId: quote3?.id,
      contactId,
      status: 'confirmed',
      totalAmount: '15000.00',
      currency: 'USD',
      estimatedCompletion: daysFromNow(7),
      ownerId: adminId,
      createdAt: daysAgo(8),
    },
  ])

  // --- Activities ---
  await db.insert(activities).values([
    {
      type: 'meeting',
      title: 'Tablaco project kickoff',
      description: 'Initial kickoff with Rodrigo — scope, timeline, deliverables agreed',
      entityType: 'opportunity',
      entityId: oppId,
      ownerId: adminId,
      status: 'completed',
      completedAt: daysAgo(60),
      createdAt: daysAgo(60),
    },
    {
      type: 'task',
      title: 'GitHub repo created for Tablaco',
      description: 'Private repo set up: madfam/tablaco-web. Rodrigo added as collaborator',
      entityType: 'opportunity',
      entityId: oppId,
      ownerId: adminId,
      status: 'completed',
      completedAt: daysAgo(55),
      createdAt: daysAgo(55),
    },
    {
      type: 'task',
      title: 'Design mockups approved',
      description: 'Rodrigo approved Figma designs for yantra4d.com/tablaco landing + gallery',
      entityType: 'opportunity',
      entityId: oppId,
      ownerId: adminId,
      status: 'completed',
      completedAt: daysAgo(45),
      createdAt: daysAgo(48),
    },
    {
      type: 'task',
      title: 'Development sprint completed',
      description: 'Phase 1 frontend + backend complete. 3D viewer integration via Forj done',
      entityType: 'opportunity',
      entityId: oppId,
      ownerId: adminId,
      status: 'completed',
      completedAt: daysAgo(15),
      createdAt: daysAgo(40),
    },
    {
      type: 'task',
      title: 'yantra4d.com/tablaco deployed',
      description: 'Production deployment live. SSL, CDN, analytics configured',
      entityType: 'opportunity',
      entityId: oppId,
      ownerId: adminId,
      status: 'completed',
      completedAt: daysAgo(10),
      createdAt: daysAgo(12),
    },
    {
      type: 'task',
      title: 'Phase 1 QA review',
      description: 'Final QA pass before client handoff. Cross-browser + mobile testing',
      entityType: 'opportunity',
      entityId: oppId,
      ownerId: adminId,
      status: 'pending',
      dueAt: daysFromNow(3),
      createdAt: daysAgo(5),
    },
  ])

  // --- Notes ---
  await db.insert(notes).values([
    {
      content:
        'Design approved by Rodrigo on call. He loved the 3D product viewer integration. Wants to add more products in Phase 2.',
      entityType: 'opportunity',
      entityId: oppId,
      authorId: adminId,
      isPinned: true,
      createdAt: daysAgo(45),
    },
    {
      content:
        'GitHub repo: github.com/madfam/tablaco-web (private). Rodrigo has collaborator access.',
      entityType: 'opportunity',
      entityId: oppId,
      authorId: adminId,
      isPinned: true,
      createdAt: daysAgo(55),
    },
    {
      content: 'yantra4d.com/tablaco is live. Production deployment completed with SSL and CDN.',
      entityType: 'opportunity',
      entityId: oppId,
      authorId: adminId,
      createdAt: daysAgo(10),
    },
    {
      content:
        'Rodrigo prefers WhatsApp for quick updates, email for formal docs. Timezone: CST (UTC-6).',
      entityType: 'contact',
      entityId: contactId,
      authorId: adminId,
      createdAt: daysAgo(60),
    },
  ])

  // --- Tags ---
  const tagNames = [
    { name: 'tablaco', color: '#f59e0b' },
    { name: 'yantra4d', color: '#8b5cf6' },
    { name: 'phase-1', color: '#10b981' },
    { name: '3-installment', color: '#3b82f6' },
  ]

  await db.insert(tags).values(tagNames).onConflictDoNothing()

  // Query back by name to get IDs (handles conflict case)
  const tagRows = await Promise.all(
    tagNames.map(async (t) => {
      const [row] = await db.select().from(tags).where(eq(tags.name, t.name)).limit(1)
      return row
    }),
  )

  await db
    .insert(taggables)
    .values([
      { tagId: tagRows[0]?.id ?? '', entityType: 'contact', entityId: contactId },
      { tagId: tagRows[0]?.id ?? '', entityType: 'opportunity', entityId: oppId },
      { tagId: tagRows[1]?.id ?? '', entityType: 'opportunity', entityId: oppId },
      { tagId: tagRows[2]?.id ?? '', entityType: 'opportunity', entityId: oppId },
      { tagId: tagRows[3]?.id ?? '', entityType: 'opportunity', entityId: oppId },
    ])
    .onConflictDoNothing()

  // --- External References ---
  await db.insert(externalReferences).values([
    {
      entityType: 'contact',
      entityId: contactId,
      provider: 'janua',
      externalId: 'janua-tablaco-001',
      metadata: { roles: ['customer', 'project_client'] },
    },
    {
      entityType: 'contact',
      entityId: contactId,
      provider: 'dhanam',
      externalId: 'dhanam-tablaco-001',
      metadata: { plan: 'Project', invoiceCount: 3 },
    },
    {
      entityType: 'contact',
      entityId: contactId,
      provider: 'cotiza',
      externalId: 'cotiza-tablaco-001',
      metadata: { activeOrders: 1 },
    },
    {
      entityType: 'contact',
      entityId: contactId,
      provider: 'pravara',
      externalId: 'pravara-tablaco-001',
      metadata: { fabricationOrders: 1 },
    },
    {
      entityType: 'contact',
      entityId: contactId,
      provider: 'forj',
      externalId: 'forj-tablaco-001',
      metadata: { assetCount: 2 },
    },
    {
      entityType: 'opportunity',
      entityId: oppId,
      provider: 'github',
      externalId: 'madfam/tablaco-web',
      metadata: { type: 'private_repo' },
    },
  ])

  // --- Conversions ---
  await db.insert(conversions).values([
    {
      type: 'visitor_to_lead',
      contactId,
      leadId,
      value: '0',
      convertedAt: daysAgo(65),
    },
    {
      type: 'lead_to_opportunity',
      contactId,
      leadId,
      value: '45000.00',
      convertedAt: daysAgo(60),
    },
  ])

  // --- Stage Transitions (Delivery pipeline) ---
  await db.insert(stageTransitions).values([
    {
      entityType: 'opportunity',
      entityId: oppId,
      fromStageId: null,
      toStageId: stageId(0),
      transitionedAt: daysAgo(60),
    },
    {
      entityType: 'opportunity',
      entityId: oppId,
      fromStageId: stageId(0),
      toStageId: stageId(1),
      transitionedAt: daysAgo(55),
    },
    {
      entityType: 'opportunity',
      entityId: oppId,
      fromStageId: stageId(1),
      toStageId: stageId(2),
      transitionedAt: daysAgo(48),
    },
    {
      entityType: 'opportunity',
      entityId: oppId,
      fromStageId: stageId(2),
      toStageId: stageId(3),
      transitionedAt: daysAgo(12),
    },
    {
      entityType: 'opportunity',
      entityId: oppId,
      fromStageId: stageId(3),
      toStageId: stageId(4),
      transitionedAt: daysAgo(5),
    },
  ])

  // --- Visitor Sessions ---
  const sessionRows = await db
    .insert(visitorSessions)
    .values([
      {
        externalSessionId: 'sess-tablaco-001',
        fingerprint: 'fp-tablaco-desktop',
        contactId,
        identified: true,
        deviceType: 'desktop',
        browser: 'Chrome',
        os: 'macOS',
        ipCountry: 'MX',
        ipCity: 'Mexico City',
        utmSource: 'direct',
        pageViewCount: 3,
        startedAt: daysAgo(20),
      },
      {
        externalSessionId: 'sess-tablaco-002',
        fingerprint: 'fp-tablaco-mobile',
        contactId,
        identified: true,
        deviceType: 'mobile',
        browser: 'Safari',
        os: 'iOS',
        ipCountry: 'MX',
        ipCity: 'Mexico City',
        utmSource: 'email',
        utmMedium: 'notification',
        pageViewCount: 1,
        startedAt: daysAgo(8),
      },
    ])
    .returning()

  // --- Page Views ---
  await db.insert(visitorPageViews).values([
    {
      sessionId: sessionRows[0]?.id ?? '',
      url: 'https://yantra4d.com/tablaco',
      title: 'Tablaco — yantra4d',
      duration: 35000,
      viewedAt: daysAgo(20),
    },
    {
      sessionId: sessionRows[0]?.id ?? '',
      url: 'https://yantra4d.com/tablaco/gallery',
      title: 'Tablaco Gallery — yantra4d',
      duration: 55000,
      viewedAt: daysAgo(20),
    },
    {
      sessionId: sessionRows[0]?.id ?? '',
      url: 'forj://asset/forj-tablaco-3d-001/view',
      title: 'Tablaco 3D Product Viewer',
      duration: 42000,
      viewedAt: daysAgo(20),
    },
    {
      sessionId: sessionRows[1]?.id ?? '',
      url: 'https://yantra4d.com/tablaco',
      title: 'Tablaco — yantra4d',
      duration: 18000,
      viewedAt: daysAgo(8),
    },
  ])

  console.log('  → Tablaco project lifecycle seeded')
}
