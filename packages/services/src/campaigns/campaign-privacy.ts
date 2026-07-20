/**
 * Product-specific Aviso de Privacidad resolution, shared by the real send
 * path (`dispatchCampaignEmail`) and the authorization preview so the owner
 * reviews exactly the footer that will ship. Falls back to the corporate
 * page inside `campaignVariantEmail` when this returns undefined.
 */
export function resolveCampaignPrivacyUrl(skuKey: string | null | undefined): string | undefined {
  if (skuKey?.startsWith('dhanam')) {
    return 'https://app.dhan.am/privacy'
  }
  return undefined
}
