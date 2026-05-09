import type { JanuaTelemetry } from '@phynd/types/federation'
import type { FederationProvider } from '../../core/types'

interface JanuaRawTelemetry {
  sessions: Array<{
    session_id: string
    fingerprint: string
    contact_id?: string | null
    identified: boolean
    ip_city?: string | null
    ip_country?: string | null
    device_type?: string | null
    browser?: string | null
    os?: string | null
    referrer?: string | null
    utm_source?: string | null
    utm_medium?: string | null
    utm_campaign?: string | null
    utm_term?: string | null
    utm_content?: string | null
    page_views: Array<{
      url: string
      title?: string | null
      duration?: number | null
      timestamp: string
    }>
    started_at: string
    ended_at?: string | null
    duration?: number | null
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

  async fetch(externalId: string, token: string, signal?: AbortSignal): Promise<JanuaRawTelemetry> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/telemetry/visitors?contactId=${encodeURIComponent(externalId)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        signal: signal ?? AbortSignal.timeout(5000),
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
      sessions: raw.sessions.map((s) => this.mapSession(s)),
      totalSessions: raw.total_sessions,
      uniqueDevices: raw.unique_devices,
      topSources: raw.top_sources,
    }
  }

  private mapSession(s: JanuaRawTelemetry['sessions'][number]): JanuaTelemetry['sessions'][number] {
    return {
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
      utm: this.mapUtm(s),
      pageViews: s.page_views.map((pv) => ({
        url: pv.url,
        title: pv.title ?? null,
        duration: pv.duration ?? null,
        timestamp: pv.timestamp,
      })),
      startedAt: s.started_at,
      endedAt: s.ended_at ?? null,
      duration: s.duration ?? null,
    }
  }

  private mapUtm(s: JanuaRawTelemetry['sessions'][number]) {
    if (!s.utm_source && !s.utm_medium && !s.utm_campaign) return null
    return {
      source: s.utm_source ?? null,
      medium: s.utm_medium ?? null,
      campaign: s.utm_campaign ?? null,
      term: s.utm_term ?? null,
      content: s.utm_content ?? null,
    }
  }

  getCacheKey(externalId: string, _tenantId: string): string {
    return `telemetry:${externalId}`
  }
}
