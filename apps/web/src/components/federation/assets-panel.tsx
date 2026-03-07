'use client'

import { Badge } from '@/components/ui/badge'
import type { ForjAssets } from '@phyne/types/federation'
import { ModelViewerEmbed } from './model-viewer-embed'
import { NftCertificateBadge } from './nft-certificate-badge'

interface AssetsPanelProps {
  data: ForjAssets
}

export function AssetsPanel({ data }: AssetsPanelProps) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm text-muted-foreground">Total Assets</p>
        <p className="text-lg font-semibold">{data.totalCount}</p>
      </div>
      {data.assets.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {data.assets.slice(0, 4).map((asset) => (
            <div key={asset.id} className="space-y-1.5 rounded-lg border p-2">
              {asset.modelUrl && asset.type === 'model_3d' ? (
                <ModelViewerEmbed
                  src={asset.modelUrl}
                  alt={asset.name}
                  poster={asset.thumbnailUrl ?? undefined}
                  className="mb-1"
                />
              ) : (
                <div className="flex aspect-square items-center justify-center rounded bg-muted text-xs text-muted-foreground">
                  {asset.type}
                </div>
              )}
              <div className="flex items-center justify-between">
                <p className="truncate text-sm font-medium">{asset.name}</p>
                <Badge variant="outline" className="text-xs">
                  {asset.type.replace('_', ' ')}
                </Badge>
              </div>
              {asset.nftCertificateUrl && <NftCertificateBadge url={asset.nftCertificateUrl} />}
            </div>
          ))}
        </div>
      )}
      {data.assets.length === 0 && (
        <p className="text-sm text-muted-foreground">No digital assets found.</p>
      )}
    </div>
  )
}
