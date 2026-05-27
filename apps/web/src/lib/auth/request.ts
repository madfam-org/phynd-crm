import { externalOriginForRequest } from '@/lib/http/origin'
import { NextRequest } from 'next/server'

import { CANONICAL_PHYND_APP_HOST } from '../http/app-host'

type NextRequestInit = NonNullable<ConstructorParameters<typeof NextRequest>[1]>

function canonicalAuthOrigin(origin: string): string {
  const url = new URL(origin)

  if (url.hostname === 'phynd.app' || url.hostname === 'www.phynd.app') {
    url.hostname = CANONICAL_PHYND_APP_HOST
  }

  return url.origin
}

export function normalizeAuthRequest(request: NextRequest): NextRequest {
  const publicOrigin = canonicalAuthOrigin(externalOriginForRequest(request))
  const sourceUrl = new URL(request.url)
  const publicUrl = new URL(`${sourceUrl.pathname}${sourceUrl.search}`, publicOrigin)

  const headers = new Headers(request.headers)
  headers.set('host', publicUrl.host)
  headers.set('x-forwarded-host', publicUrl.host)
  headers.set('x-forwarded-proto', publicUrl.protocol.replace(':', ''))
  headers.set(
    'x-forwarded-port',
    publicUrl.port || (publicUrl.protocol === 'https:' ? '443' : '80'),
  )

  const init: NextRequestInit = {
    headers,
    method: request.method,
    redirect: request.redirect,
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body
    init.duplex = 'half'
  }

  return new NextRequest(publicUrl, init)
}
