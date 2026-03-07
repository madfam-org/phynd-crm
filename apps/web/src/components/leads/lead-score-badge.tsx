'use client'

import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface LeadScoreBadgeProps {
  score: number
  breakdown?: Record<string, number> | null
}

function getScoreVariant(score: number): 'success' | 'warning' | 'default' | 'error' {
  if (score >= 80) return 'success'
  if (score >= 50) return 'warning'
  if (score >= 20) return 'default'
  return 'error'
}

export function LeadScoreBadge({ score, breakdown }: LeadScoreBadgeProps) {
  const badge = (
    <Badge variant={getScoreVariant(score)} className="font-mono">
      {score}
    </Badge>
  )

  if (!breakdown || Object.keys(breakdown).length === 0) {
    return badge
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent>
          <div className="space-y-1 text-xs">
            {Object.entries(breakdown).map(([rule, points]) => (
              <div key={rule} className="flex justify-between gap-4">
                <span>{rule}</span>
                <span className={points >= 0 ? 'text-green-400' : 'text-red-400'}>
                  {points > 0 ? '+' : ''}
                  {points}
                </span>
              </div>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
