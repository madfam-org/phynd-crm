'use client'

import { Badge } from '@/components/ui/badge'
import type { ForjAssets } from '@phynd/types/federation'
import { useCallback, useRef } from 'react'
import { ModelViewerEmbed } from './model-viewer-embed'
import { NftCertificateBadge } from './nft-certificate-badge'

interface AssetsPanelProps {
  data: ForjAssets
  visitorSessionId?: string
  onAssetInteraction?: (event: {
    assetId: string
    eventType: '3d_load' | '3d_interact' | '3d_rotate' | '3d_zoom'
    sessionId?: string
  }) => void
}

export function AssetsPanel({ data, visitorSessionId, onAssetInteraction }: AssetsPanelProps) {
  const interactionCountRef = useRef<Record<string, number>>({})

  const handleModelEvent = useCallback(
    (assetId: string, eventType: '3d_load' | '3d_interact' | '3d_rotate' | '3d_zoom') => {
      if (!onAssetInteraction) return
      const key = `${assetId}:${eventType}`
      const count = (interactionCountRef.current[key] ?? 0) + 1
      interactionCountRef.current[key] = count
      // Debounce: only fire on first interaction per type, and every 5th after
      if (count === 1 || count % 5 === 0) {
        onAssetInteraction({ assetId, eventType, sessionId: visitorSessionId })
      }
    },
    [onAssetInteraction, visitorSessionId],
  )

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
                <div
                  onPointerDown={() => handleModelEvent(asset.id, '3d_interact')}
                  onWheel={() => handleModelEvent(asset.id, '3d_zoom')}
                >
                  <ModelViewerEmbed
                    src={asset.modelUrl}
                    alt={asset.name}
                    poster={asset.thumbnailUrl ?? undefined}
                    className="mb-1"
                    onLoad={() => handleModelEvent(asset.id, '3d_load')}
                  />
                </div>
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
