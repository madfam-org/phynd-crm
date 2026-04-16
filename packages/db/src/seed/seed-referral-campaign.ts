import { campaigns } from '../schema/campaigns'
import { offers } from '../schema/offers'
import type { Db } from './types'

export async function seedReferralCampaign(db: Db) {
  const [referralOffer] = await db
    .insert(offers)
    .values([
      {
        name: 'Referral Reward — 1 Month Free',
        type: 'referral_reward',
        description:
          'Referrer earns 1 free month of subscription + 50 bonus credits when a referred user converts to paid.',
        value: '0.00',
        status: 'active',
        maxRedemptions: 10000,
        currentRedemptions: 0,
      },
    ])
    .returning()

  await db.insert(campaigns).values([
    {
      name: 'MADFAM Ecosystem Referral Program',
      description:
        'Cross-product referral program. Users generate codes, share them, and earn subscription credits and bonus credits when referred users convert.',
      channel: 'referral',
      status: 'active',
      utmSource: 'referral',
      utmMedium: 'ecosystem',
      utmCampaign: 'madfam-referral',
      budget: '0.00',
      spend: '0.00',
      offerId: referralOffer?.id,
    },
  ])
}
