import { campaigns } from '../schema/campaigns'
import { offers } from '../schema/offers'
import type { Db } from './types'

export async function seedOffersAndCampaigns(db: Db) {
  const sampleOffers = await db
    .insert(offers)
    .values([
      {
        name: 'Early Adopter Discount',
        type: 'discount',
        description: '20% off first year subscription',
        value: '20.00',
        status: 'active',
        maxRedemptions: 50,
        currentRedemptions: 3,
        validFrom: new Date('2025-01-01'),
        validUntil: new Date('2025-12-31'),
      },
      {
        name: 'Free Trial - 30 Days',
        type: 'free_trial',
        description: 'Full platform access for 30 days',
        status: 'active',
        maxRedemptions: 100,
        currentRedemptions: 12,
      },
    ])
    .returning()

  const sampleCampaigns = await db
    .insert(campaigns)
    .values([
      {
        name: 'Q1 Product Launch',
        status: 'active',
        utmSource: 'email',
        utmMedium: 'newsletter',
        utmCampaign: 'q1-launch-2025',
        budget: '10000.00',
        spend: '4500.00',
        offerId: sampleOffers[0]?.id,
        startDate: new Date('2025-01-15'),
        endDate: new Date('2025-03-31'),
      },
      {
        name: 'Trade Show Follow-up',
        status: 'active',
        utmSource: 'tradeshow',
        utmMedium: 'email',
        utmCampaign: 'tradeshow-followup',
        budget: '5000.00',
        spend: '2200.00',
        startDate: new Date('2025-02-01'),
      },
    ])
    .returning()

  return { offers: sampleOffers, campaigns: sampleCampaigns }
}
