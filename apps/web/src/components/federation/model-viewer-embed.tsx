'use client'

interface ModelViewerEmbedProps {
  src: string
  alt: string
  poster?: string
  className?: string
}

export function ModelViewerEmbed({ src, alt, poster: _poster, className }: ModelViewerEmbedProps) {
  return (
    <div className={className}>
      {/* @google/model-viewer provides the <model-viewer> custom element */}
      {/* It needs to be dynamically imported on the client side */}
      <div
        className="aspect-square w-full rounded-lg border bg-muted"
        // In production, render <model-viewer> web component
        // This requires dynamic import of @google/model-viewer
      >
        <div className="flex h-full items-center justify-center">
          <p className="text-sm text-muted-foreground">3D Model: {alt}</p>
          <p className="mt-1 text-xs text-muted-foreground">src: {src}</p>
        </div>
      </div>
    </div>
  )
}
