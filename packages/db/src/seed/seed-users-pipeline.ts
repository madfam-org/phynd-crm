import { pipelineStages, pipelines } from '../schema/pipelines'
import { users } from '../schema/users'
import type { Db } from './types'

export async function seedUsersAndPipeline(db: Db) {
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

  const [defaultPipeline] = await db
    .insert(pipelines)
    .values({ name: 'Default Sales Pipeline', isDefault: true })
    .returning()

  const pipelineId = defaultPipeline?.id
  if (!pipelineId) throw new Error('Failed to create default pipeline')

  const stageData = [
    { name: 'Prospecting', position: 0, probability: 10 },
    { name: 'Qualification', position: 1, probability: 20 },
    { name: 'Proposal', position: 2, probability: 50 },
    { name: 'Negotiation', position: 3, probability: 75 },
    { name: 'Closed Won', position: 4, probability: 100 },
    { name: 'Closed Lost', position: 5, probability: 0 },
  ]

  const stageRows = await db
    .insert(pipelineStages)
    .values(stageData.map((s) => ({ ...s, pipelineId })))
    .returning()

  // Project Delivery pipeline
  const [deliveryPipeline] = await db
    .insert(pipelines)
    .values({ name: 'Project Delivery', isDefault: false })
    .returning()

  const deliveryPipelineId = deliveryPipeline?.id
  if (!deliveryPipelineId) throw new Error('Failed to create delivery pipeline')

  const deliveryStageData = [
    { name: 'Proposal', position: 0, probability: 10 },
    { name: 'Scoping', position: 1, probability: 20 },
    { name: 'Development', position: 2, probability: 40 },
    { name: 'QA', position: 3, probability: 60 },
    { name: 'Delivery', position: 4, probability: 90 },
    { name: 'Support', position: 5, probability: 100 },
  ]

  const deliveryStageRows = await db
    .insert(pipelineStages)
    .values(deliveryStageData.map((s) => ({ ...s, pipelineId: deliveryPipelineId })))
    .returning()

  return {
    adminId,
    pipelineId,
    stages: stageRows,
    deliveryPipelineId,
    deliveryStages: deliveryStageRows,
  }
}
