import type { ReactNode } from 'react'

type Status = 'ok' | 'degraded' | 'unavailable'

interface StatusIndicatorProps {
  status: Status
  label?: string
  children?: ReactNode
}

const statusStyles: Record<Status, string> = {
  ok: 'bg-green-500',
  degraded: 'bg-amber-500',
  unavailable: 'bg-red-500',
}

export function StatusIndicator({ status, label, children }: StatusIndicatorProps) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`inline-block h-2 w-2 rounded-full ${statusStyles[status]}`} />
      {label && <span className="text-sm">{label}</span>}
      {children}
    </span>
  )
}
