import { pipelineStages, pipelines } from '../schema/pipelines'
import type { Db } from './types'

export async function seedGrantsPipeline(db: Db) {
  const [grantsPipeline] = await db
    .insert(pipelines)
    .values({ name: 'Treasury Hunter', isDefault: false })
    .returning()

  const grantsPipelineId = grantsPipeline?.id
  if (!grantsPipelineId) throw new Error('Failed to create Treasury Hunter pipeline')

  const stageData = [
    { name: 'Discovered', position: 0, probability: 5 },
    { name: 'Evaluating', position: 1, probability: 15 },
    { name: 'Preparing', position: 2, probability: 30 },
    { name: 'HITL Review', position: 3, probability: 50 },
    { name: 'Submitted', position: 4, probability: 65 },
    { name: 'Under Evaluation', position: 5, probability: 75 },
    { name: 'Awarded', position: 6, probability: 95 },
    { name: 'Rejected', position: 7, probability: 0 },
  ]

  const stageRows = await db
    .insert(pipelineStages)
    .values(stageData.map((s) => ({ ...s, pipelineId: grantsPipelineId })))
    .returning()

  return {
    grantsPipelineId,
    grantsStages: stageRows,
  }
}
