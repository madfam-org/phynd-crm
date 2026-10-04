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

export async function seedProjectClient(db: Db, ids: SeedIds) {
  const { adminId, deliveryPipelineId, deliveryStages } = ids

  const now = new Date()
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000)
  const daysFromNow = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000)

  const stageId = (i: number) => deliveryStages[i]?.id ?? ''

  // --- Contact ---
  const [projectContact] = await db
    .insert(contacts)
    .values({
      name: 'Mateo Ríos',
      email: 'mateo@acme-fabricacion.example',
      company: 'Acme Fabricación',
      phone: '+52-55-1234-5678',
      status: 'active',
      ownerId: adminId,
      externalJanuaId: 'janua-demo-project-001',
    })
    .returning()

  const contactId = projectContact?.id ?? ''

  // --- Lead (converted) ---
  const [projectLead] = await db
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

  const leadId = projectLead?.id ?? ''

  // --- Opportunity ---
  const [projectOpp] = await db
    .insert(opportunities)
    .values({
      name: 'Product Configurator, Phases 1+2',
      contactId,
      pipelineId: deliveryPipelineId,
      stageId: stageId(4),
      value: '14400.00',
      probability: 90,
      status: 'open',
      ownerId: adminId,
      createdAt: daysAgo(60),
    })
    .returning()

  const oppId = projectOpp?.id ?? ''

  // --- Quotes (3 installments) ---
  const [quote1] = await db
    .insert(quotes)
    .values({
      quoteNumber: 'Q-2026-TAB-001',
      opportunityId: oppId,
      contactId,
      status: 'accepted',
      totalAmount: '4800.00',
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
      totalAmount: '4800.00',
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
      totalAmount: '4800.00',
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
      totalAmount: '4800.00',
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
      totalAmount: '4800.00',
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
      totalAmount: '4800.00',
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
      title: 'Project kickoff',
      description: 'Initial kickoff with Mateo — scope, timeline, deliverables agreed',
      entityType: 'opportunity',
      entityId: oppId,
      ownerId: adminId,
      status: 'completed',
      completedAt: daysAgo(60),
      createdAt: daysAgo(60),
    },
    {
      type: 'task',
      title: 'Project repository created',
      description:
        'Private project repository set up; the client contact was added as a collaborator',
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
      description: 'Mateo approved Figma designs for the product configurator landing + gallery',
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
      title: 'Product configurator deployed',
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
        'Design approved on the review call, including the 3D product viewer. More products planned for phase 2.',
      entityType: 'opportunity',
      entityId: oppId,
      authorId: adminId,
      isPinned: true,
      createdAt: daysAgo(45),
    },
    {
      content: 'Project repository is private; the client contact has collaborator access.',
      entityType: 'opportunity',
      entityId: oppId,
      authorId: adminId,
      isPinned: true,
      createdAt: daysAgo(55),
    },
    {
      content:
        'The product configurator is live. Production deployment completed with SSL and CDN.',
      entityType: 'opportunity',
      entityId: oppId,
      authorId: adminId,
      createdAt: daysAgo(10),
    },
    {
      content: 'Prefers WhatsApp for quick updates and email for formal documents.',
      entityType: 'contact',
      entityId: contactId,
      authorId: adminId,
      createdAt: daysAgo(60),
    },
  ])

  // --- Tags ---
  const tagNames = [
    { name: 'acme-demo', color: '#f59e0b' },
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
      externalId: 'janua-demo-project-001',
      metadata: { roles: ['customer', 'project_client'] },
    },
    {
      entityType: 'contact',
      entityId: contactId,
      provider: 'dhanam',
      externalId: 'dhanam-demo-project-001',
      metadata: { plan: 'Project', invoiceCount: 3 },
    },
    {
      entityType: 'contact',
      entityId: contactId,
      provider: 'cotiza',
      externalId: 'cotiza-demo-project-001',
      metadata: { activeOrders: 1 },
    },
    {
      entityType: 'contact',
      entityId: contactId,
      provider: 'pravara',
      externalId: 'pravara-demo-project-001',
      metadata: { fabricationOrders: 1 },
    },
    {
      entityType: 'contact',
      entityId: contactId,
      provider: 'forj',
      externalId: 'forj-demo-project-001',
      metadata: { assetCount: 2 },
    },
    {
      entityType: 'opportunity',
      entityId: oppId,
      provider: 'github',
      externalId: 'example-org/product-configurator',
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
      value: '14400.00',
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
        externalSessionId: 'sess-demo-001',
        fingerprint: 'fp-demo-desktop',
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
        externalSessionId: 'sess-demo-002',
        fingerprint: 'fp-demo-mobile',
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
      url: 'https://yantra4d.com/acme-demo',
      title: 'Acme Fabricación — yantra4d',
      duration: 35000,
      viewedAt: daysAgo(20),
    },
    {
      sessionId: sessionRows[0]?.id ?? '',
      url: 'https://yantra4d.com/acme-demo/gallery',
      title: 'Acme Fabricación Gallery — yantra4d',
      duration: 55000,
      viewedAt: daysAgo(20),
    },
    {
      sessionId: sessionRows[0]?.id ?? '',
      url: 'forj://asset/forj-demo-3d-001/view',
      title: '3D Product Viewer',
      duration: 42000,
      viewedAt: daysAgo(20),
    },
    {
      sessionId: sessionRows[1]?.id ?? '',
      url: 'https://yantra4d.com/acme-demo',
      title: 'Acme Fabricación — yantra4d',
      duration: 18000,
      viewedAt: daysAgo(8),
    },
  ])

  console.log('  → Project-client lifecycle seeded')
}
