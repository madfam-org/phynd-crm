import { getDb } from '@phyne/db'
import {
  activities,
  contacts,
  leads,
  notes,
  notifications,
  opportunities,
  orders,
  pipelineStages,
  pipelines,
  quotes,
  taggables,
  tags,
  users,
} from '@phyne/db/schema'

export async function seedDemoTenant(sessionId: string) {
  const db = getDb()
  const prefix = `demo-${sessionId}`
  const userId = prefix

  await db.transaction(async (tx) => {
    // 1. Demo user
    await tx.insert(users).values({
      id: userId,
      email: 'demo@phyne.io',
      name: 'Demo Visitor',
      role: 'admin',
    })

    // 2. Pipeline + stages
    const [pipeline] = await tx
      .insert(pipelines)
      .values({ id: `${prefix}-pipeline`, name: 'Sales Pipeline', isDefault: true })
      .returning()

    const pipelineId = pipeline?.id ?? `${prefix}-pipeline`

    const stageData = [
      { id: `${prefix}-stage-0`, name: 'Prospecting', position: 0, probability: 10, pipelineId },
      { id: `${prefix}-stage-1`, name: 'Qualification', position: 1, probability: 25, pipelineId },
      { id: `${prefix}-stage-2`, name: 'Proposal', position: 2, probability: 50, pipelineId },
      { id: `${prefix}-stage-3`, name: 'Negotiation', position: 3, probability: 75, pipelineId },
      { id: `${prefix}-stage-4`, name: 'Closed Won', position: 4, probability: 100, pipelineId },
    ]

    await tx.insert(pipelineStages).values(stageData)

    // 3. Contacts
    const contactData = [
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

    await tx.insert(contacts).values(contactData)

    // 4. Leads
    const leadData = [
      {
        id: `${prefix}-l1`,
        contactId: `${prefix}-c1`,
        source: 'website',
        status: 'qualified',
        score: 82,
        pipelineId,
        stageId: `${prefix}-stage-2`,
        ownerId: userId,
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
      },
    ]

    await tx.insert(leads).values(leadData)

    // 5. Opportunities
    const oppData = [
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
      },
    ]

    await tx.insert(opportunities).values(oppData)

    // 6. Quotes
    const quoteData = [
      {
        id: `${prefix}-q1`,
        quoteNumber: 'Q-DEMO-001',
        opportunityId: `${prefix}-o1`,
        contactId: `${prefix}-c1`,
        status: 'sent',
        totalAmount: '72000.00',
        currency: 'USD',
        validUntil: new Date(Date.now() + 30 * 86400000),
        ownerId: userId,
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
      },
    ]

    await tx.insert(quotes).values(quoteData)

    // 7. Orders
    const orderData = [
      {
        id: `${prefix}-ord1`,
        orderNumber: 'ORD-DEMO-001',
        opportunityId: `${prefix}-o3`,
        quoteId: `${prefix}-q2`,
        contactId: `${prefix}-c3`,
        status: 'in_production',
        totalAmount: '120000.00',
        currency: 'USD',
        estimatedCompletion: new Date(Date.now() + 14 * 86400000),
        ownerId: userId,
      },
      {
        id: `${prefix}-ord2`,
        orderNumber: 'ORD-DEMO-002',
        contactId: `${prefix}-c1`,
        status: 'confirmed',
        totalAmount: '18000.00',
        currency: 'USD',
        estimatedCompletion: new Date(Date.now() + 45 * 86400000),
        ownerId: userId,
      },
    ]

    await tx.insert(orders).values(orderData)

    // 8. Activities
    await tx.insert(activities).values([
      {
        id: `${prefix}-a1`,
        type: 'call',
        title: 'Discovery call with Sarah',
        description: 'Discussed enterprise requirements and integration needs',
        entityType: 'contact',
        entityId: `${prefix}-c1`,
        ownerId: userId,
        status: 'completed',
        completedAt: new Date(Date.now() - 5 * 86400000),
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
        dueAt: new Date(Date.now() + 2 * 86400000),
      },
      {
        id: `${prefix}-a3`,
        type: 'meeting',
        title: 'Contract review — Wayne Tech',
        entityType: 'opportunity',
        entityId: `${prefix}-o1`,
        ownerId: userId,
        status: 'pending',
        dueAt: new Date(Date.now() + 5 * 86400000),
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
        dueAt: new Date(Date.now() + 7 * 86400000),
      },
    ])

    // 9. Notes
    await tx.insert(notes).values([
      {
        id: `${prefix}-n1`,
        content:
          'Sarah mentioned evaluating 3 competing platforms. Key differentiator is our federation capability — no data duplication.',
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
    ])

    // 10. Tags + taggables
    const tagData = [
      { id: `${prefix}-tag1`, name: 'VIP', color: '#8b5cf6' },
      { id: `${prefix}-tag2`, name: 'Enterprise', color: '#3b82f6' },
      { id: `${prefix}-tag3`, name: 'Hot Lead', color: '#ef4444' },
    ]

    await tx.insert(tags).values(tagData)

    await tx.insert(taggables).values([
      { tagId: `${prefix}-tag1`, entityType: 'contact', entityId: `${prefix}-c1` },
      { tagId: `${prefix}-tag2`, entityType: 'contact', entityId: `${prefix}-c3` },
      { tagId: `${prefix}-tag3`, entityType: 'lead', entityId: `${prefix}-l1` },
    ])

    // 11. Notification
    await tx.insert(notifications).values({
      id: `${prefix}-notif1`,
      userId,
      type: 'owner_assignment',
      title: 'New opportunity assigned',
      message: 'You have been assigned: Acme Enterprise Suite',
      entityType: 'opportunity',
      entityId: `${prefix}-o1`,
      isRead: false,
    })
  })
}
