import { leads } from '../schema/leads'
import { opportunities } from '../schema/opportunities'
import type { Db, SeedIds } from './types'

export async function seedLeadsAndOpps(db: Db, ids: SeedIds) {
  const { adminId, pipelineId, stages, contacts: c } = ids

  const sampleLeads = await db
    .insert(leads)
    .values([
      {
        contactId: c[0]?.id,
        source: 'website',
        status: 'qualified',
        score: 85,
        pipelineId,
        stageId: stages[2]?.id ?? stages[0]?.id ?? pipelineId,
        ownerId: adminId,
      },
      {
        contactId: c[1]?.id,
        source: 'referral',
        status: 'new',
        score: 60,
        pipelineId,
        stageId: stages[0]?.id ?? pipelineId,
        ownerId: adminId,
      },
      {
        contactId: c[3]?.id,
        source: 'trade_show',
        status: 'contacted',
        score: 72,
        pipelineId,
        stageId: stages[1]?.id ?? stages[0]?.id ?? pipelineId,
        ownerId: adminId,
      },
    ])
    .returning()

  const sampleOpps = await db
    .insert(opportunities)
    .values([
      {
        name: 'TechCorp Enterprise Deal',
        contactId: c[0]?.id,
        pipelineId,
        stageId: stages[2]?.id ?? stages[0]?.id ?? pipelineId,
        value: '50000.00',
        probability: 50,
        status: 'open',
        ownerId: adminId,
      },
      {
        name: 'DesignLab Platform License',
        contactId: c[1]?.id,
        pipelineId,
        stageId: stages[3]?.id ?? stages[0]?.id ?? pipelineId,
        value: '25000.00',
        probability: 75,
        status: 'open',
        ownerId: adminId,
      },
      {
        name: 'MfgWorks Custom Integration',
        contactId: c[2]?.id,
        pipelineId,
        stageId: stages[4]?.id ?? stages[0]?.id ?? pipelineId,
        value: '80000.00',
        probability: 100,
        status: 'won',
        ownerId: adminId,
      },
    ])
    .returning()

  return { leads: sampleLeads, opps: sampleOpps }
}
