const navDots = [
  { color: 'var(--color-accent-blue)', label: 'Overview' },
  { color: 'var(--color-accent-emerald)', label: 'Contacts' },
  { color: 'var(--color-accent-violet)', label: 'Leads' },
  { color: 'var(--color-accent-amber)', label: 'Pipeline' },
  { color: 'var(--color-accent-rose)', label: 'Analytics' },
]

const kpiCards = [
  { label: 'Open Deals', value: '$247K', color: 'var(--color-accent-blue)' },
  { label: 'Won Revenue', value: '$1.2M', color: 'var(--color-accent-emerald)' },
  { label: 'Active Leads', value: '38', color: 'var(--color-accent-violet)' },
  { label: 'Win Rate', value: '68%', color: 'var(--color-accent-amber)' },
]

const chartBars = [
  { label: 'Jan', height: '45%', color: 'var(--color-accent-blue)' },
  { label: 'Feb', height: '72%', color: 'var(--color-accent-emerald)' },
  { label: 'Mar', height: '58%', color: 'var(--color-accent-violet)' },
  { label: 'Apr', height: '85%', color: 'var(--color-accent-amber)' },
  { label: 'May', height: '63%', color: 'var(--color-accent-rose)' },
  { label: 'Jun', height: '91%', color: 'var(--color-accent-blue)' },
]

const tableRows = [
  { name: 'Acme Corp', stage: 'Negotiation', value: '$75K' },
  { name: 'Globex Inc', stage: 'Proposal', value: '$32K' },
  { name: 'Wayne Tech', stage: 'Closed Won', value: '$120K' },
]

export function DashboardPreview() {
  return (
    <div className="dashboard-preview-wrapper" aria-hidden="true">
      {/* Browser chrome */}
      <div className="overflow-hidden rounded-xl border border-border/50 bg-card shadow-2xl">
        {/* Title bar */}
        <div className="flex items-center gap-2 border-b border-border/50 bg-muted/50 px-4 py-2.5">
          <div className="flex gap-1.5">
            <div className="h-3 w-3 rounded-full bg-red-400" />
            <div className="h-3 w-3 rounded-full bg-amber-400" />
            <div className="h-3 w-3 rounded-full bg-green-400" />
          </div>
          <div className="mx-auto flex-1">
            <div className="mx-auto max-w-xs rounded-md bg-background/80 px-3 py-1 text-center text-[10px] text-muted-foreground">
              phynd.app/overview
            </div>
          </div>
        </div>

        {/* Dashboard body */}
        <div className="flex min-h-[280px] sm:min-h-[320px]">
          {/* Sidebar */}
          <div className="hidden w-12 flex-shrink-0 border-r border-border/30 bg-muted/30 p-2 sm:block">
            <div className="mb-4 text-center text-[8px] font-bold text-foreground/80">P</div>
            <div className="space-y-3">
              {navDots.map((dot) => (
                <div key={dot.label} className="flex flex-col items-center gap-0.5">
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: dot.color }} />
                  <span className="text-[5px] text-muted-foreground">{dot.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Main content */}
          <div className="flex-1 p-3 sm:p-4">
            {/* KPI cards */}
            <div className="mb-3 grid grid-cols-2 gap-2 sm:mb-4 sm:grid-cols-4">
              {kpiCards.map((card) => (
                <div
                  key={card.label}
                  className="rounded-lg border border-border/30 bg-background p-2"
                >
                  <div className="text-[7px] text-muted-foreground sm:text-[8px]">{card.label}</div>
                  <div className="text-sm font-bold sm:text-base" style={{ color: card.color }}>
                    {card.value}
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Chart */}
              <div className="rounded-lg border border-border/30 bg-background p-2">
                <div className="mb-2 text-[8px] font-medium text-muted-foreground">
                  Pipeline Velocity
                </div>
                <div className="flex h-24 items-end gap-1.5 sm:h-28">
                  {chartBars.map((bar) => (
                    <div
                      key={bar.label}
                      className="flex-1 rounded-t-sm transition-all"
                      style={{
                        height: bar.height,
                        background: `linear-gradient(to top, ${bar.color}40, ${bar.color})`,
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Table */}
              <div className="rounded-lg border border-border/30 bg-background p-2">
                <div className="mb-2 text-[8px] font-medium text-muted-foreground">
                  Recent Deals
                </div>
                <div className="space-y-1.5">
                  {tableRows.map((row) => (
                    <div
                      key={row.name}
                      className="flex items-center justify-between rounded px-1.5 py-1 text-[8px] odd:bg-muted/30 sm:text-[9px]"
                    >
                      <span className="font-medium text-foreground">{row.name}</span>
                      <span className="text-muted-foreground">{row.stage}</span>
                      <span className="font-semibold text-accent-emerald">{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
