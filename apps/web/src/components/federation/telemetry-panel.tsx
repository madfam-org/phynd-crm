'use client'

import { Badge } from '@/components/ui/badge'
import type { JanuaTelemetry } from '@phyne/types/federation'

interface TelemetryPanelProps {
  data: JanuaTelemetry
}

export function TelemetryPanel({ data }: TelemetryPanelProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Total Sessions</p>
          <p className="text-lg font-semibold">{data.totalSessions}</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Unique Devices</p>
          <p className="text-lg font-semibold">{data.uniqueDevices}</p>
        </div>
      </div>
      {data.topSources.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-medium">Top Sources</p>
          <div className="flex flex-wrap gap-2">
            {data.topSources.slice(0, 5).map((source) => (
              <Badge key={source.source} variant="outline">
                {source.source} ({source.count})
              </Badge>
            ))}
          </div>
        </div>
      )}
      {data.sessions.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-medium">Recent Sessions</p>
          <div className="space-y-2">
            {data.sessions.slice(0, 5).map((session) => (
              <div
                key={session.sessionId}
                className="flex items-center justify-between rounded border p-2 text-sm"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">{session.sessionId.slice(0, 8)}</span>
                    <Badge variant={session.identified ? 'success' : 'secondary'}>
                      {session.identified ? 'Identified' : 'Anonymous'}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[session.browser, session.os, session.ipCountry].filter(Boolean).join(' / ')}
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <div>{session.pageViews.length} pages</div>
                  {session.duration != null && <div>{Math.round(session.duration / 60)}min</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
