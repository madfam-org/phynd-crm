type TulanaMetadata = Record<string, unknown> | null

type TulanaG4EvidenceInput = {
  campaignId: string
  contactId: string
  skuKey: string
  channel: string
  tulanaMetadata: TulanaMetadata
}

function metadataString(metadata: TulanaMetadata, key: string): string | null {
  const value = metadata?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function splitSkuKey(skuKey: string): { productSlug: string; tierSlug: string } | null {
  const [productSlug, tierSlug] = skuKey.split('__', 2)
  if (!productSlug || !tierSlug) return null
  return { productSlug, tierSlug }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function resolveEvidenceUrl(campaignId: string): string {
  const baseUrl = process.env.PHYND_CRM_PUBLIC_URL ?? 'https://phynecrm.madfam.io'
  return `${stripTrailingSlash(baseUrl)}/campaigns?campaign_id=${encodeURIComponent(campaignId)}`
}

function resolveTulanaConfig(metadata: TulanaMetadata) {
  const period =
    metadataString(metadata, 'commercial_ga_period') ?? process.env.TULANA_COMMERCIAL_GA_PERIOD

  if (!period) {
    return { ok: false as const, reason: 'missing_commercial_ga_period' }
  }

  return {
    ok: true as const,
    apiBaseUrl: stripTrailingSlash(
      process.env.TULANA_API_BASE_URL ?? 'https://tulana-api.madfam.io/api/v1',
    ),
    environment:
      metadataString(metadata, 'commercial_ga_environment') ??
      process.env.TULANA_COMMERCIAL_GA_ENVIRONMENT ??
      'production',
    period,
  }
}

function buildEvidenceBody(input: TulanaG4EvidenceInput, completeApproval: boolean) {
  const audienceId = metadataString(input.tulanaMetadata, 'audience_id')
  const consentBasis = metadataString(input.tulanaMetadata, 'consent_basis')

  return {
    gate_id: 'G4',
    status: completeApproval ? 'passed' : 'pending',
    confidence: completeApproval ? 'high' : 'medium',
    evidence_type: completeApproval
      ? 'phynecrm_consent_send_gate'
      : 'phynecrm_consent_send_gate_partial',
    evidence_url: resolveEvidenceUrl(input.campaignId),
    source_system: 'phynd-crm',
    source_record_id: input.campaignId,
    approved_by_email: metadataString(input.tulanaMetadata, 'human_approver_email') ?? '',
    remediation_owner: completeApproval ? '' : 'phynd-crm',
    commercial_risk: completeApproval
      ? ''
      : 'Campaign send succeeded, but audience_id or consent_basis is missing from Tulana import metadata.',
    metadata: {
      sku_key: input.skuKey,
      campaign_id: input.campaignId,
      contact_id: input.contactId,
      audience_id: audienceId,
      consent_basis: consentBasis,
      suppression_passed: true,
      human_approval: true,
      channel: input.channel,
      campaign_type: metadataString(input.tulanaMetadata, 'campaign_type'),
      commercial_ga_status: metadataString(input.tulanaMetadata, 'commercial_ga_status'),
    },
  }
}

export async function recordTulanaCommercialGaG4Evidence(
  input: TulanaG4EvidenceInput,
): Promise<{ attempted: boolean; status: 'skipped' | 'recorded' | 'failed'; reason?: string }> {
  const token = process.env.TULANA_COMMERCIAL_GA_EVIDENCE_TOKEN
  if (!token) {
    return { attempted: false, status: 'skipped', reason: 'missing_tulana_token' }
  }

  const sku = splitSkuKey(input.skuKey)
  if (!sku) {
    return { attempted: false, status: 'skipped', reason: 'invalid_sku_key' }
  }

  const audienceId = metadataString(input.tulanaMetadata, 'audience_id')
  const consentBasis = metadataString(input.tulanaMetadata, 'consent_basis')
  const completeApproval = Boolean(audienceId && consentBasis)
  const config = resolveTulanaConfig(input.tulanaMetadata)
  if (!config.ok) return { attempted: false, status: 'skipped', reason: config.reason }
  const body = {
    ...buildEvidenceBody(input, completeApproval),
    environment: config.environment,
    period: config.period,
  }

  try {
    const response = await fetch(
      `${config.apiBaseUrl}/madfam-skus/${encodeURIComponent(sku.productSlug)}/${encodeURIComponent(
        sku.tierSlug,
      )}/commercial-ga-evidence/`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    )

    if (!response.ok) {
      return { attempted: true, status: 'failed', reason: `http_${response.status}` }
    }
    return { attempted: true, status: 'recorded' }
  } catch (error) {
    return {
      attempted: true,
      status: 'failed',
      reason: error instanceof Error ? error.message : 'unknown_error',
    }
  }
}
