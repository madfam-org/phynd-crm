'use client'

/**
 * Sandboxed preview of the exact HTML the production email pipeline produced
 * for a variant. The email carries its own light-background styling — that is
 * the real artifact recipients see, so it renders as-is in dark mode too.
 * `sandbox=""` blocks scripts/navigation inside the preview document.
 */
export function EmailPreviewFrame({ html, title }: { html: string; title: string }) {
  return (
    <iframe
      title={title}
      srcDoc={html}
      sandbox=""
      className="h-[440px] w-full rounded-md border bg-white"
    />
  )
}
