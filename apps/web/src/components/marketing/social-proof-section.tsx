const metrics = [
  {
    value: '6',
    label: 'Federated Providers',
    description: 'Real-time data synthesis',
    color: 'var(--color-accent-blue)',
  },
  {
    value: '25',
    label: 'Data Tables',
    description: 'Full CRM depth',
    color: 'var(--color-accent-emerald)',
  },
  {
    value: '0',
    label: 'Data Duplication',
    description: 'Federation, not ETL',
    color: 'var(--color-accent-violet)',
  },
  {
    value: 'AGPLv3',
    label: 'Licensed',
    description: 'Open source core',
    color: 'var(--color-accent-amber)',
  },
]

export function SocialProofSection() {
  return (
    <section className="border-y bg-muted/30 py-16">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <h2 className="mb-10 text-center text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Built for the Phygital Enterprise
        </h2>
        <div className="grid grid-cols-2 gap-6 sm:gap-8 lg:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.label} className="text-center">
              <div
                className="text-4xl font-bold tracking-tight md:text-5xl"
                style={{ color: metric.color }}
              >
                {metric.value}
              </div>
              <div className="mt-1 text-sm font-semibold">{metric.label}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{metric.description}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
