import type { ForjAssetType, ForjAssets } from '@phyne/types/federation'
import type { FederationProvider } from '../../core/types'

interface ForjRawData {
  assets: Array<{
    id: string
    name: string
    asset_type: string
    thumbnail_url: string | null
    model_url: string | null
    format: string | null
    nft_certificate_url: string | null
    created_at: string
    updated_at: string
  }>
  total_count: number
}

export class ForjProvider implements FederationProvider<ForjRawData, ForjAssets> {
  readonly name = 'forj' as const
  private readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  async fetch(externalId: string, token: string, signal?: AbortSignal): Promise<ForjRawData> {
    const response = await fetch(`${this.baseUrl}/api/v1/owners/${externalId}/assets`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: signal ?? AbortSignal.timeout(8000),
    })

    if (!response.ok) {
      throw Object.assign(new Error(`Forj API error: ${response.statusText}`), {
        status: response.status,
      })
    }

    return response.json() as Promise<ForjRawData>
  }

  map(raw: ForjRawData): ForjAssets {
    return {
      assets: raw.assets.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.asset_type as ForjAssetType,
        thumbnailUrl: a.thumbnail_url,
        modelUrl: a.model_url,
        format: a.format,
        nftCertificateUrl: a.nft_certificate_url,
        createdAt: new Date(a.created_at),
        updatedAt: new Date(a.updated_at),
      })),
      totalCount: raw.total_count,
    }
  }

  getCacheKey(externalId: string, _tenantId: string): string {
    return externalId
  }
}
