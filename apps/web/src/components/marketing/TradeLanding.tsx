import Link from 'next/link'
import type { TradePage } from '@/lib/marketing/trades'
import { SiteNav } from './SiteNav'
import { SiteFooter } from './SiteFooter'

/**
 * One landing page per launch trade (T-144), rendered from lib/marketing/trades.ts.
 * Same Measured Document system as the rest of the marketing site.
 */
export function TradeLanding({ trade }: { trade: TradePage }) {
  return (
    <main className="min-h-screen bg-background">
      <SiteNav />

      <section className="mx-auto max-w-5xl px-6 pb-16 pt-20 text-center">
        <p className="mb-4 text-sm font-semibold uppercase tracking-widest text-secondary">{trade.eyebrow}</p>
        <h1 className="mx-auto max-w-3xl font-display text-4xl font-extrabold leading-tight tracking-tight text-text-primary sm:text-5xl">
          {trade.headline}
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-text-secondary">{trade.lede}</p>
        <p className="mx-auto mt-4 max-w-2xl text-base font-semibold text-text-primary">
          Your rates set the price, never the AI.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Link href="/signup" className="rounded-lg bg-primary px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-hover">
            Start free — set up in minutes
          </Link>
          <Link href="/demo" className="rounded-lg border border-border bg-surface px-8 py-3 text-sm font-semibold text-text-primary transition-colors hover:border-border-strong">
            Try the live demo
          </Link>
        </div>
      </section>

      <section className="border-y border-border bg-primary py-14 text-white">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="text-center font-display text-2xl font-bold">The first quote usually wins the job.</h2>
          <div className="mt-10 grid gap-8 text-center sm:grid-cols-3">
            <div>
              <p className="font-display text-5xl font-extrabold">40%</p>
              <p className="mt-2 text-sm text-white/70">of home-service businesses never respond to a lead at all</p>
            </div>
            <div>
              <p className="font-display text-5xl font-extrabold">95%</p>
              <p className="mt-2 text-sm text-white/70">miss the 5-minute window customers judge you by</p>
            </div>
            <div>
              <p className="font-display text-5xl font-extrabold">21×</p>
              <p className="mt-2 text-sm text-white/70">more likely to win the conversation responding in 5 minutes instead of 30</p>
            </div>
          </div>
          <p className="mt-8 text-center text-xs text-white/50">
            Sources: Valve+Meter home-services audit (2024, n=466) · Lead Response Management Study
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-center font-display text-3xl font-extrabold tracking-tight text-text-primary">How the price is set</h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          {trade.howPriced.map((step, i) => (
            <div key={step.title} className="rounded-xl border border-border bg-surface p-6">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary font-display text-sm font-bold text-white">
                {i + 1}
              </span>
              <h3 className="mt-3 font-semibold text-text-primary">{step.title}</h3>
              <p className="mt-1 text-sm text-text-secondary">{step.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-border bg-surface py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="font-display text-3xl font-extrabold tracking-tight text-text-primary">Tell it your prices the way you’d tell a new hire.</h2>
          <p className="mt-4 text-text-secondary">
            Type <span className="font-medium text-text-primary">{trade.pricingExample}</span> and it becomes your pricing,
            shown back to you in plain English. Every quote is calculated from those rates. When a number isn’t certain, the
            customer confirms it, or the quote waits for your approval.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-16">
        <div className="grid gap-6 sm:grid-cols-3">
          {trade.features.map((f) => (
            <div key={f.title} className="rounded-xl border border-border p-5">
              <h3 className="font-semibold text-text-primary">{f.title}</h3>
              <p className="mt-1 text-sm text-text-secondary">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-border py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="font-display text-3xl font-extrabold tracking-tight text-text-primary">{trade.closing}</h2>
          <p className="mt-3 text-text-secondary">Start from the {trade.templateName} template with typical rates you make your own.</p>
          <Link href="/signup" className="mt-8 inline-block rounded-lg bg-primary px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-hover">
            Start quoting today
          </Link>
        </div>
      </section>

      <SiteFooter />
    </main>
  )
}
