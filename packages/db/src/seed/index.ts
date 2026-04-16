import { getDb } from '../client'
import { seedActivitiesAndNotes } from './seed-activities-notes'
import { seedContacts } from './seed-contacts'
import { seedConversions } from './seed-conversions'
import { seedExternalRefs } from './seed-external-refs'
import { seedGrantsPipeline } from './seed-grants-pipeline'
import { seedReferralCampaign } from './seed-referral-campaign'
import { seedLeadsAndOpps } from './seed-leads-opps'
import { seedOffersAndCampaigns } from './seed-offers-campaigns'
import { seedPreferences } from './seed-preferences'
import { seedQuotesAndOrders } from './seed-quotes-orders'
import { seedScoringRules } from './seed-scoring-rules'
import { seedStageTransitions } from './seed-stage-transitions'
import { seedTablaco } from './seed-tablaco'
import { seedTagsAndNotifications } from './seed-tags-notifications'
import { seedUsersAndPipeline } from './seed-users-pipeline'
import { seedVisitorData } from './seed-visitor-data'
import type { SeedIds } from './types'

export async function seed() {
  const db = getDb()
  console.log('Seeding database...')

  const { adminId, pipelineId, stages, deliveryPipelineId, deliveryStages } =
    await seedUsersAndPipeline(db)
  const sampleContacts = await seedContacts(db, adminId)

  const ids: SeedIds = {
    adminId,
    pipelineId,
    stages,
    deliveryPipelineId,
    deliveryStages,
    contacts: sampleContacts,
    leads: [],
    opps: [],
    quotes: [],
    offers: [],
    campaigns: [],
    sessions: [],
    tags: [],
  }

  const { leads: sampleLeads, opps: sampleOpps } = await seedLeadsAndOpps(db, ids)
  ids.leads = sampleLeads
  ids.opps = sampleOpps

  const { quotes: sampleQuotes } = await seedQuotesAndOrders(db, ids)
  ids.quotes = sampleQuotes

  await seedActivitiesAndNotes(db, ids)

  const { offers: sampleOffers, campaigns: sampleCampaigns } = await seedOffersAndCampaigns(db)
  ids.offers = sampleOffers
  ids.campaigns = sampleCampaigns

  await seedConversions(db, ids)
  await seedVisitorData(db, ids)
  await seedScoringRules(db)
  await seedExternalRefs(db, ids)
  await seedStageTransitions(db, ids)
  await seedPreferences(db)
  await seedTagsAndNotifications(db, ids)
  await seedTablaco(db, ids)
  await seedGrantsPipeline(db)
  await seedReferralCampaign(db)

  console.log('Seed complete!')
}
