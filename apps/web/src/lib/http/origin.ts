import type { NextRequest } from 'next/server'

const TRUSTED_HOSTS = new Set([
  'phynd.app',
  'www.phynd.app',
  'app.phyne.app',
  'crm.madfam.io',
])

function firstHeaderValue(value: string | null): string | null {
  return (
    value
      ?.split(',')
      .map((part) => part.trim())
      .find(Boolean) ?? null
  )
}

function normalizeHost(value: string | null): string | null {
  const host = firstHeaderValue(value)?.toLowerCase()
  if (!host) return null
  return host.replace(/^https?:\/\//, '').split('/')[0] ?? null
}

function isTrustedHost(host: string | null): host is string {
  if (!host) return false
  const hostWithoutPort = host.split(':')[0] ?? host
  if (TRUSTED_HOSTS.has(hostWithoutPort)) return true
  return hostWithoutPort === 'localhost' || hostWithoutPort === '127.0.0.1'
}

function forwardedProtocol(request: NextRequest): string {
  const proto = firstHeaderValue(request.headers.get('x-forwarded-proto'))
  if (proto === 'http' || proto === 'https') return proto
  return request.nextUrl.protocol.replace(':', '') || 'https'
}

export function externalOriginForRequest(request: NextRequest): string {
  const host =
    normalizeHost(request.headers.get('x-forwarded-host')) ??
    normalizeHost(request.headers.get('x-original-host')) ??
    normalizeHost(request.headers.get('host'))

  if (isTrustedHost(host)) {
    return `${forwardedProtocol(request)}://${host}`
  }

  const fallback = process.env.NEXT_PUBLIC_APP_URL ?? 'https://phynd.app'
  return new URL(fallback).origin
}

export function externalUrl(path: string, request: NextRequest): URL {
  return new URL(path, externalOriginForRequest(request))
}
