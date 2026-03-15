import { stageTransitions } from '../schema/stage-transitions'
import type { Db, SeedIds } from './types'

export async function seedStageTransitions(db: Db, ids: SeedIds) {
  const { stages, leads: l, opps } = ids

  await db.insert(stageTransitions).values([
    {
      entityType: 'lead',
      entityId: l[0]?.id ?? '',
      fromStageId: stages[0]?.id,
      toStageId: stages[1]?.id ?? '',
      transitionedAt: new Date('2025-01-20'),
    },
    {
      entityType: 'lead',
      entityId: l[0]?.id ?? '',
      fromStageId: stages[1]?.id,
      toStageId: stages[2]?.id ?? '',
      transitionedAt: new Date('2025-02-05'),
    },
    {
      entityType: 'opportunity',
      entityId: opps[0]?.id ?? '',
      fromStageId: stages[0]?.id,
      toStageId: stages[2]?.id ?? '',
      transitionedAt: new Date('2025-01-25'),
    },
    {
      entityType: 'opportunity',
      entityId: opps[2]?.id ?? '',
      fromStageId: stages[2]?.id,
      toStageId: stages[4]?.id ?? '',
      transitionedAt: new Date('2025-02-15'),
    },
  ])
}
