import Link from 'next/link'
import type { TradePage } from '@/lib/marketing/trades'
import { SiteNav } from './SiteNav'
import { SiteFooter } from './SiteFooter'
import { freeOfferLabel } from '@estimator/shared'
import { ProductStrip } from './ProductStrip'
import { marketingExample } from '@/lib/marketing/examples'
import { HERO } from '@/lib/marketing/home-copy'

/**
 * One landing page per launch trade (T-144), rendered from lib/marketing/trades.ts.
 * Same Measured Document system as the rest of the marketing site.
 */
export function TradeLanding({ trade }: { trade: TradePage }) {
  return (
    <main className="min-h-screen overflow-x-clip bg-background">
      <SiteNav />

      {/* T-154: the home page's hero pattern, with this trade's own example */}
      <section className="mx-auto max-w-6xl px-4 pb-12 pt-8 sm:px-6 sm:pt-14" data-testid="hero">
        <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-secondary">{trade.eyebrow}</p>
        <h1 className="max-w-3xl font-display text-[2.1rem] font-extrabold leading-[1.08] tracking-tight text-text-primary sm:text-5xl">
          {trade.headline}
        </h1>
        <p className="mt-4 max-w-2xl text-base text-text-secondary sm:text-lg">{trade.lede}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link href="/signup" className="inline-flex min-h-[48px] items-center justify-center rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-hover">
            {freeOfferLabel()}
          </Link>
          <Link href="/demo" className="inline-flex min-h-[48px] items-center justify-center rounded-lg border border-border bg-surface px-6 py-3 text-sm font-semibold text-text-primary transition-colors hover:border-border-strong">
            Try it as a customer
          </Link>
        </div>
        <p className="mt-3 text-xs text-text-muted">Your prices set the estimate, never the AI. No website needed.</p>
        <div className="mt-10">
          <ProductStrip example={marketingExample(trade.slug)} captions={HERO.frames} />
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
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
            shown back to you in plain English. Every estimate comes from those prices. When a detail isn’t clear, the
            customer is asked, and by default they can accept only once you’ve confirmed it.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
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
          <Link href="/signup" className="mt-8 inline-flex min-h-[48px] items-center justify-center rounded-lg bg-primary px-8 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-hover">
            {freeOfferLabel()}
          </Link>
        </div>
      </section>

      <SiteFooter />
    </main>
  )
}
