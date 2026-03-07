import type { JanuaTelemetry } from '@phyne/types/federation'
import type { FederationProvider } from '../../core/types'

interface JanuaRawTelemetry {
  sessions: Array<{
    session_id: string
    fingerprint: string
    contact_id?: string
    identified: boolean
    ip_city?: string
    ip_country?: string
    device_type?: string
    browser?: string
    os?: string
    referrer?: string
    utm_source?: string
    utm_medium?: string
    utm_campaign?: string
    utm_term?: string
    utm_content?: string
    page_views: Array<{
      url: string
      title?: string
      duration?: number
      timestamp: string
    }>
    started_at: string
    ended_at?: string
    duration?: number
  }>
  total_sessions: number
  unique_devices: number
  top_sources: Array<{ source: string; count: number }>
}

export class JanuaTelemetryProvider
  implements FederationProvider<JanuaRawTelemetry, JanuaTelemetry>
{
  readonly name = 'janua-telemetry' as const
  private readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  async fetch(externalId: string, token: string): Promise<JanuaRawTelemetry> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/telemetry/visitors?contactId=${encodeURIComponent(externalId)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      },
    )

    if (!response.ok) {
      throw Object.assign(new Error(`Janua Telemetry API error: ${response.statusText}`), {
        status: response.status,
      })
    }

    return response.json() as Promise<JanuaRawTelemetry>
  }

  map(raw: JanuaRawTelemetry): JanuaTelemetry {
    return {
      sessions: raw.sessions.map((s) => ({
        sessionId: s.session_id,
        fingerprint: s.fingerprint,
        contactId: s.contact_id ?? null,
        identified: s.identified,
        ipCity: s.ip_city ?? null,
        ipCountry: s.ip_country ?? null,
        deviceType: s.device_type ?? null,
        browser: s.browser ?? null,
        os: s.os ?? null,
        referrer: s.referrer ?? null,
        utm:
          s.utm_source || s.utm_medium || s.utm_campaign
            ? {
                source: s.utm_source ?? null,
                medium: s.utm_medium ?? null,
                campaign: s.utm_campaign ?? null,
                term: s.utm_term ?? null,
                content: s.utm_content ?? null,
              }
            : null,
        pageViews: s.page_views.map((pv) => ({
          url: pv.url,
          title: pv.title ?? null,
          duration: pv.duration ?? null,
          timestamp: pv.timestamp,
        })),
        startedAt: s.started_at,
        endedAt: s.ended_at ?? null,
        duration: s.duration ?? null,
      })),
      totalSessions: raw.total_sessions,
      uniqueDevices: raw.unique_devices,
      topSources: raw.top_sources,
    }
  }

  getCacheKey(externalId: string, _tenantId: string): string {
    return `telemetry:${externalId}`
  }
}
