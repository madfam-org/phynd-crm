import { SectionWrapper } from './section-wrapper'

const features = [
  {
    title: 'Federation, Not Duplication',
    description:
      'Phynd queries your source systems in real time. Data stays authoritative at the origin — no copies, no drift, no stale records.',
    icon: (
      <svg
        aria-hidden="true"
        className="h-10 w-10 text-accent-blue"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="16" y="16" width="6" height="6" rx="1" />
        <rect x="2" y="16" width="6" height="6" rx="1" />
        <rect x="9" y="2" width="6" height="6" rx="1" />
        <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" />
        <path d="M12 12V8" />
      </svg>
    ),
  },
  {
    title: 'Synthetic Single Pane of Glass',
    description:
      'One unified client profile spanning identity, billing, manufacturing, and digital assets. Every team sees the full picture.',
    icon: (
      <svg
        aria-hidden="true"
        className="h-10 w-10 text-accent-emerald"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
        <path d="m6.08 9.5-3.5 1.6a1 1 0 0 0 0 1.81l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9a1 1 0 0 0 0-1.83l-3.5-1.59" />
        <path d="m6.08 14.5-3.5 1.6a1 1 0 0 0 0 1.81l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9a1 1 0 0 0 0-1.83l-3.5-1.59" />
      </svg>
    ),
  },
  {
    title: 'Circuit Breaker Resilience',
    description:
      'When one provider goes down, everything else keeps working. Partial failures never block your operations or your team.',
    icon: (
      <svg
        aria-hidden="true"
        className="h-10 w-10 text-accent-violet"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    title: 'Open Source Core',
    description:
      'AGPL-3.0-licensed. Self-host anywhere. Inspect every line. No vendor lock-in, no black boxes, no surprise pricing changes.',
    icon: (
      <svg
        aria-hidden="true"
        className="h-10 w-10 text-accent-rose"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path
          fillRule="evenodd"
          d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
]

export function FeaturesSection() {
  return (
    <SectionWrapper id="features">
      <div className="reveal mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
          Built Different, By Design
        </h2>
        <p className="mt-4 text-lg text-muted-foreground">
          Phynd&apos;s federation architecture solves the problems other CRMs create.
        </p>
      </div>
      <div className="mt-16 space-y-20">
        {features.map((feature, i) => (
          <div
            key={feature.title}
            className={`reveal flex flex-col items-center gap-8 md:flex-row ${i % 2 === 1 ? 'md:flex-row-reverse' : ''}`}
          >
            <div className="flex shrink-0 items-center justify-center rounded-2xl bg-muted/50 p-8">
              {feature.icon}
            </div>
            <div>
              <h3 className="text-xl font-bold">{feature.title}</h3>
              <p className="mt-2 text-muted-foreground">{feature.description}</p>
            </div>
          </div>
        ))}
      </div>
    </SectionWrapper>
  )
}
