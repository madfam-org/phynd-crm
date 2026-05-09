import { SectionWrapper } from './section-wrapper'

const steps = [
  {
    step: '1',
    title: 'Connect',
    description:
      'Point Phynd at your existing platforms. Configure credentials once, federate forever.',
    icon: (
      <svg
        aria-hidden="true"
        className="h-8 w-8"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 22v-5" />
        <path d="M9 8V2" />
        <path d="M15 8V2" />
        <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
      </svg>
    ),
  },
  {
    step: '2',
    title: 'Federate',
    description:
      'A real-time virtual data layer queries all sources on demand. No ETL, no duplication.',
    icon: (
      <svg
        aria-hidden="true"
        className="h-8 w-8"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="18" r="3" />
        <circle cx="6" cy="6" r="3" />
        <circle cx="18" cy="6" r="3" />
        <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" />
        <path d="M12 12v3" />
      </svg>
    ),
  },
  {
    step: '3',
    title: 'Operate',
    description:
      'A unified CRM with contacts, pipelines, and federated profiles. Your team sees the full picture.',
    icon: (
      <svg
        aria-hidden="true"
        className="h-8 w-8"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09Z" />
        <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2Z" />
        <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
        <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
      </svg>
    ),
  },
]

export function HowItWorksSection() {
  return (
    <SectionWrapper id="how-it-works" stagger>
      <div className="reveal mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Up and Running in Minutes</h2>
        <p className="mt-4 text-lg text-muted-foreground">
          Three steps from scattered systems to a unified phygital CRM.
        </p>
      </div>

      <div className="relative mt-16 grid gap-8 md:grid-cols-3">
        <div className="absolute top-12 right-[16.67%] left-[16.67%] hidden h-0.5 bg-gradient-to-r from-accent-blue via-accent-violet to-accent-rose md:block" />

        {steps.map((s) => (
          <div key={s.step} className="reveal relative text-center">
            <div className="relative z-10 mx-auto flex h-24 w-24 items-center justify-center rounded-full border-2 bg-background">
              {s.icon}
            </div>
            <div className="mt-4 text-sm font-bold text-muted-foreground">Step {s.step}</div>
            <h3 className="mt-1 text-xl font-bold">{s.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{s.description}</p>
          </div>
        ))}
      </div>
    </SectionWrapper>
  )
}
