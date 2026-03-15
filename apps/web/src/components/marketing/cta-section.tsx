import { Button } from '@/components/ui/button'
import Link from 'next/link'

export function CtaSection() {
  return (
    <section className="bg-foreground text-background">
      <div className="mx-auto max-w-7xl px-6 py-24 text-center lg:px-8">
        <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
          Ready to Unify Your Phygital Operations?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-lg opacity-80">
          Stop duplicating data across systems. Start federating it in real time.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Button
            size="lg"
            className="bg-background text-foreground hover:bg-background/90"
            asChild
          >
            <Link href="/login">Get Started</Link>
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="border-background/30 text-background hover:bg-background/10"
            asChild
          >
            <Link href="/demo">Try Live Demo</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
