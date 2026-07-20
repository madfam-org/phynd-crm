'use client'

import { EmailPreviewFrame } from '@/components/campaigns/authorizations/email-preview-frame'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export type RenderedVariant = {
  variantId: string | null
  language: string | null
  claimKeysUsed: string[]
  subject: string
  html: string
  preheader?: string
}

/**
 * One tab per copy variant, each showing subject/preheader exactly as they
 * will appear in the inbox plus the full rendered email. The per-contact
 * unsubscribe link is generated at send time, so the preview footer omits it.
 */
export function VariantPreviewTabs({ variants }: { variants: RenderedVariant[] }) {
  if (variants.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        This snapshot contains no copy variants.
      </p>
    )
  }

  const tabValue = (variant: RenderedVariant, index: number) =>
    variant.variantId ?? `variant-${index}`

  return (
    <Tabs defaultValue={tabValue(variants[0] as RenderedVariant, 0)}>
      <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
        {variants.map((variant, index) => (
          <TabsTrigger key={tabValue(variant, index)} value={tabValue(variant, index)}>
            {variant.variantId ?? `Variant ${index + 1}`}
          </TabsTrigger>
        ))}
      </TabsList>
      {variants.map((variant, index) => (
        <TabsContent
          key={tabValue(variant, index)}
          value={tabValue(variant, index)}
          className="space-y-3"
        >
          <div className="rounded-md border bg-muted/40 p-4">
            <div className="flex flex-wrap items-center gap-2">
              {variant.language && <Badge variant="secondary">{variant.language}</Badge>}
              {variant.claimKeysUsed.map((key) => (
                <Badge key={key} variant="outline" className="text-xs font-normal">
                  {key}
                </Badge>
              ))}
            </div>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Subject
                </dt>
                <dd className="font-medium">{variant.subject}</dd>
              </div>
              {variant.preheader && (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Preheader
                  </dt>
                  <dd className="text-muted-foreground">{variant.preheader}</dd>
                </div>
              )}
            </dl>
          </div>
          <EmailPreviewFrame
            html={variant.html}
            title={`Email preview ${variant.variantId ?? index + 1}`}
          />
          <p className="text-xs text-muted-foreground">
            Rendered by the production email pipeline. The unsubscribe link is added per contact at
            send time.
          </p>
        </TabsContent>
      ))}
    </Tabs>
  )
}
