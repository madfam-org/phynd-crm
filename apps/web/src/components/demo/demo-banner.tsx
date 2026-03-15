import { Button } from '@/components/ui/button'
import Link from 'next/link'

export function DemoBanner() {
  return (
    <div className="relative flex items-center justify-center gap-4 bg-gradient-to-r from-accent-violet via-accent-blue to-accent-emerald px-4 py-2 text-sm font-medium text-white">
      <span>You&apos;re exploring Phyne with live demo data</span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" className="h-7 text-xs" asChild>
          <Link href="/login">Sign Up</Link>
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 border-white/30 text-xs text-white hover:bg-white/10"
          asChild
        >
          <Link href="/demo/exit">Exit Demo</Link>
        </Button>
      </div>
    </div>
  )
}
