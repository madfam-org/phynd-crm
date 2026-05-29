export const SELVA_FRAME_ANCESTORS =
  "'self' https://selva.town https://*.selva.town https://*.madfam.io"

export const DASHBOARD_EMBED_PREFIXES = [
  '/overview',
  '/contacts',
  '/leads',
  '/opportunities',
  '/pipeline',
  '/quotes',
  '/orders',
  '/activities',
  '/analytics',
  '/campaigns',
  '/offers',
  '/engagements',
  '/visitors',
  '/funnel',
  '/settings',
] as const

export function isSelvaEmbedAllowed(): boolean {
  return process.env.PHYND_SELVA_EMBED_ALLOWED === 'true'
}

export function isEmbeddableDashboardPath(pathname: string): boolean {
  return DASHBOARD_EMBED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

export function shouldAllowSelvaEmbed(pathname: string): boolean {
  return isSelvaEmbedAllowed() && isEmbeddableDashboardPath(pathname)
}

export function applyFrameEmbeddingHeaders(headers: Headers, pathname: string): void {
  if (shouldAllowSelvaEmbed(pathname)) {
    headers.set('Content-Security-Policy', `frame-ancestors ${SELVA_FRAME_ANCESTORS}`)
    headers.delete('X-Frame-Options')
    return
  }

  headers.set('X-Frame-Options', 'DENY')
  headers.delete('Content-Security-Policy')
}
