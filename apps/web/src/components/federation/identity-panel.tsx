import { Badge } from '@/components/ui/badge'
import type { JanuaIdentity } from '@phynd/types/federation'

interface IdentityPanelProps {
  data: JanuaIdentity
}

export function IdentityPanel({ data }: IdentityPanelProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {data.avatarUrl && (
          <img src={data.avatarUrl} alt={data.displayName} className="h-10 w-10 rounded-full" />
        )}
        <div>
          <p className="font-medium">{data.displayName}</p>
          <p className="text-sm text-muted-foreground">{data.email}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <span className="text-muted-foreground">Verified:</span>{' '}
          <Badge variant={data.verified ? 'success' : 'warning'}>
            {data.verified ? 'Yes' : 'No'}
          </Badge>
        </div>
        <div>
          <span className="text-muted-foreground">Last Login:</span>{' '}
          {data.lastLoginAt ? new Date(data.lastLoginAt).toLocaleDateString() : '—'}
        </div>
      </div>
      {data.roles.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {data.roles.map((role) => (
            <Badge key={role} variant="outline">
              {role}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
