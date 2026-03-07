'use client'

import { useEffect, useRef, useState } from 'react'

interface ModelViewerEmbedProps {
  src: string
  alt: string
  poster?: string
  className?: string
  onLoad?: () => void
}

export function ModelViewerEmbed({ src, alt, poster, className, onLoad }: ModelViewerEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    import('@google/model-viewer')
      .then(() => {
        if (!cancelled) {
          setLoaded(true)
          onLoad?.()
        }
      })
      .catch(() => {
        // model-viewer failed to load; keep placeholder
      })
    return () => {
      cancelled = true
    }
  }, [onLoad])

  if (!loaded) {
    return (
      <div className={className}>
        <div className="flex aspect-square w-full items-center justify-center rounded-lg border bg-muted">
          <p className="text-sm text-muted-foreground">Loading 3D Model...</p>
        </div>
      </div>
    )
  }

  return (
    <div className={className} ref={containerRef}>
      {/* @ts-expect-error -- model-viewer is a custom element registered globally */}
      <model-viewer
        src={src}
        alt={alt}
        poster={poster}
        camera-controls
        auto-rotate
        ar
        shadow-intensity="1"
        style={{ width: '100%', aspectRatio: '1/1', borderRadius: '0.5rem' }}
      />
    </div>
  )
}
