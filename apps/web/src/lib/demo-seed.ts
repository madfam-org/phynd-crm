import { getDb } from '@phyne/db'
import {
  activities,
  campaigns,
  contacts,
  conversions,
  externalReferences,
  leadScoringRules,
  leads,
  notes,
  notifications,
  offers,
  opportunities,
  orders,
  pipelineStages,
  pipelines,
  quotes,
  stageTransitions,
  taggables,
  tags,
  users,
  visitorPageViews,
  visitorSessions,
} from '@phyne/db/schema'
import {
  buildActivityData,
  buildCampaignData,
  buildContactData,
  buildConversionData,
  buildExternalRefData,
  buildLeadData,
  buildNoteData,
  buildNotificationData,
  buildOfferData,
  buildOpportunityData,
  buildOrderData,
  buildPageViewData,
  buildPipelineData,
  buildQuoteData,
  buildScoringRuleData,
  buildStageData,
  buildStageTransitionData,
  buildTagData,
  buildTaggableData,
  buildUserData,
  buildVisitorSessionData,
} from './demo-seed/data-builders'

export async function seedDemoTenant(sessionId: string) {
  const db = getDb()
  const prefix = `demo-${sessionId}`
  const userId = prefix

  await db.transaction(async (tx) => {
    await tx.insert(users).values(buildUserData(prefix))

    const [pipeline] = await tx.insert(pipelines).values(buildPipelineData(prefix)).returning()
    const pipelineId = pipeline?.id ?? `${prefix}-pipeline`

    await tx.insert(pipelineStages).values(buildStageData(prefix, pipelineId))
    await tx.insert(contacts).values(buildContactData(prefix, userId))
    await tx.insert(leads).values(buildLeadData(prefix, pipelineId, userId))
    await tx.insert(opportunities).values(buildOpportunityData(prefix, pipelineId, userId))
    await tx.insert(quotes).values(buildQuoteData(prefix, userId))
    await tx.insert(orders).values(buildOrderData(prefix, userId))
    await tx.insert(offers).values(buildOfferData(prefix))
    await tx.insert(campaigns).values(buildCampaignData(prefix))
    await tx.insert(conversions).values(buildConversionData(prefix))
    await tx.insert(visitorSessions).values(buildVisitorSessionData(prefix))
    await tx.insert(visitorPageViews).values(buildPageViewData(prefix))
    await tx.insert(leadScoringRules).values(buildScoringRuleData(prefix))
    await tx.insert(externalReferences).values(buildExternalRefData(prefix))
    await tx.insert(stageTransitions).values(buildStageTransitionData(prefix))
    await tx.insert(activities).values(buildActivityData(prefix, userId))
    await tx.insert(notes).values(buildNoteData(prefix, userId))
    await tx.insert(tags).values(buildTagData(prefix))
    await tx.insert(taggables).values(buildTaggableData(prefix))
    await tx.insert(notifications).values(buildNotificationData(prefix, userId))
  })
}
