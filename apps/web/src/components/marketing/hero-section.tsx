import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

const providers = [
  { name: 'Janua', cx: 80, cy: 50, color: 'var(--color-accent-blue)' },
  { name: 'Dhanam', cx: 220, cy: 30, color: 'var(--color-accent-emerald)' },
  { name: 'Cotiza', cx: 220, cy: 110, color: 'var(--color-accent-amber)' },
  { name: 'PravaraMES', cx: 80, cy: 150, color: 'var(--color-accent-violet)' },
  { name: 'Forj', cx: 40, cy: 100, color: 'var(--color-accent-rose)' },
]

const center = { cx: 150, cy: 90 }

export function HeroSection() {
  return (
    <section className="relative overflow-hidden pt-32 pb-20 lg:pt-40 lg:pb-28">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-5xl font-bold tracking-tight md:text-6xl lg:text-7xl">
            The CRM Built for{' '}
            <span className="bg-gradient-to-r from-accent-blue via-accent-violet to-accent-rose bg-clip-text text-transparent">
              Physical + Digital
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
            Phyne federates real-time data from your entire ecosystem into one unified view. No data
            duplication. No vendor lock-in. No per-seat pricing.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button size="lg" asChild>
              <Link href="/login">Get Started Free</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href="https://github.com/madfam/phyne" target="_blank" rel="noopener noreferrer">
                <svg
                  className="mr-2 h-5 w-5"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                    clipRule="evenodd"
                  />
                </svg>
                View on GitHub
              </a>
            </Button>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Badge variant="secondary">Open Source</Badge>
            <Badge variant="secondary">Self-Hostable</Badge>
            <Badge variant="secondary">MIT Licensed</Badge>
          </div>
        </div>

        <div className="mx-auto mt-16 flex max-w-md justify-center" aria-hidden="true">
          <svg viewBox="0 0 300 180" className="w-full" role="img">
            <title>Federation diagram showing Phyne connecting to ecosystem providers</title>
            {providers.map((p) => (
              <line
                key={p.name}
                x1={center.cx}
                y1={center.cy}
                x2={p.cx}
                y2={p.cy}
                stroke={p.color}
                strokeWidth="2"
                strokeOpacity="0.5"
                className="hero-line"
              />
            ))}
            <circle
              cx={center.cx}
              cy={center.cy}
              r="10"
              fill="currentColor"
              className="text-foreground"
            />
            <text
              x={center.cx}
              y={center.cy + 24}
              textAnchor="middle"
              className="fill-foreground text-[10px] font-bold"
            >
              Phyne
            </text>
            {providers.map((p) => (
              <g key={p.name}>
                <circle cx={p.cx} cy={p.cy} r="6" fill={p.color} className="hero-node" />
                <text
                  x={p.cx}
                  y={p.cy - 12}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[8px]"
                >
                  {p.name}
                </text>
              </g>
            ))}
          </svg>
        </div>
      </div>
    </section>
  )
}
