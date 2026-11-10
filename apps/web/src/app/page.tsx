import Link from 'next/link'
import type { Metadata } from 'next'
import { offeredPlans, formatMoney, freeOfferLabel, FREE_ALLOWANCE } from '@estimator/shared'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { ProductStrip } from '@/components/marketing/ProductStrip'
import { FounderNote } from '@/components/marketing/FounderNote'
import { listPacks } from '@/lib/vertical-packs'
import { templateTrades, tradeHref } from '@/lib/marketing/trades'
import { marketingExample } from '@/lib/marketing/examples'
import { HERO, TRADES_HEADING, OTHER_TRADES, HOW_IT_WORKS, CONTROL, STATISTICS, ADD_IT, PRICING_HEADING, FAQ, FINAL_CTA, PAGE_META } from '@/lib/marketing/home-copy'

export const metadata: Metadata = {
  title: PAGE_META.title,
  description: PAGE_META.description,
  openGraph: { title: PAGE_META.title, description: PAGE_META.description, type: 'website' },
  twitter: { card: 'summary_large_image', title: PAGE_META.title, description: PAGE_META.description },
}

const primaryButton =
  'inline-flex min-h-[48px] items-center justify-center rounded-lg bg-primary px-6 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-primary-hover'
const secondaryButton =
  'inline-flex min-h-[48px] items-center justify-center rounded-lg border border-border bg-surface px-6 py-3 text-center text-sm font-semibold text-text-primary transition-colors hover:border-border-strong'

/**
 * T-154 home page: say what it is, show it working, earn trust.
 * Copy: lib/marketing/home-copy.ts. Visuals: our own UI (ProductStrip).
 */
export default function HomePage() {
  const example = marketingExample()
  const trades = templateTrades(listPacks('US').filter((p) => p.region === 'US').map((p) => p.id))
  const free = FREE_ALLOWANCE.US!.quotes

  return (
    <main className="min-h-screen overflow-x-clip bg-background">
      <SiteNav />

      {/* 1. Hero */}
      <section className="mx-auto max-w-6xl px-4 pb-14 pt-8 sm:px-6 sm:pt-14" data-testid="hero">
        <div className="max-w-3xl">
          <h1 className="font-display text-[2.15rem] font-extrabold leading-[1.08] tracking-tight text-text-primary sm:text-5xl lg:text-6xl">
            {HERO.headline}
          </h1>
          <p className="mt-4 max-w-2xl text-base text-text-secondary sm:text-lg">{HERO.subline}</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link href="/signup" className={primaryButton} data-testid="hero-signup">
              {freeOfferLabel()}
            </Link>
            <Link href="/demo" className={secondaryButton} data-testid="hero-demo">
              Try it as a customer
            </Link>
          </div>
          <p className="mt-3 text-xs text-text-muted">{HERO.smallLine}</p>
        </div>
        <div className="mt-10">
          <ProductStrip example={example} captions={HERO.frames} />
        </div>
      </section>

      {/* 2. Trades */}
      <section className="border-y border-border bg-surface py-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="font-display text-xl font-bold text-text-primary sm:text-2xl">{TRADES_HEADING}</h2>
          <ul className="mt-4 flex flex-wrap gap-2" data-testid="trades-row">
            {trades.map((t) => (
              <li key={t.slug}>
                <Link href={tradeHref(t)} className="inline-flex min-h-[44px] items-center rounded-full border border-border bg-white px-4 text-sm font-semibold text-text-primary hover:border-primary">
                  {t.label}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/signup" className="inline-flex min-h-[44px] items-center rounded-full border border-dashed border-border px-4 text-sm font-medium text-text-secondary hover:border-primary">
                {OTHER_TRADES}
              </Link>
            </li>
          </ul>
        </div>
      </section>

      {/* 3. How it works */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="font-display text-3xl font-extrabold tracking-tight text-text-primary sm:text-4xl">How it works</h2>
        <ol className="mt-8 grid gap-5 md:grid-cols-3">
          {HOW_IT_WORKS.map((step, i) => (
            <li key={step.title} className="rounded-warm-xl border border-border bg-white p-5">
              <StepIcon index={i} />
              <h3 className="mt-3 font-display text-lg font-bold text-text-primary">
                <span className="figure mr-2 text-primary">{i + 1}</span>
                {step.title}
              </h3>
              <p className="mt-1 text-sm text-text-secondary">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* 4. Control */}
      <section className="bg-mint py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="font-display text-3xl font-extrabold tracking-tight text-text-primary sm:text-4xl">{CONTROL.heading}</h2>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {CONTROL.points.map((p) => (
              <div key={p.title} className="rounded-warm-xl bg-white p-5 shadow-warm">
                <h3 className="font-display text-base font-bold text-text-primary">{p.title}</h3>
                <p className="mt-1 text-sm text-text-secondary">{p.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5. What homeowners want */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="font-display text-3xl font-extrabold tracking-tight text-text-primary sm:text-4xl">What homeowners want</h2>
        <div className="mt-8 grid gap-5 md:grid-cols-3" data-testid="statistics">
          {STATISTICS.map((s) => (
            <figure key={s.url} className="rounded-warm-xl border border-border bg-white p-5">
              <p className="figure text-4xl font-medium text-primary">{s.figure}</p>
              <blockquote className="mt-2 text-sm text-text-primary">{s.text}</blockquote>
              <figcaption className="mt-3 text-xs text-text-muted">
                Source:{' '}
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline underline-offset-2">
                  {s.source}
                </a>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* 6. Add it anywhere */}
      <section className="border-y border-border bg-surface py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="font-display text-3xl font-extrabold tracking-tight text-text-primary sm:text-4xl">{ADD_IT.heading}</h2>
          <p className="mt-3 max-w-2xl text-text-secondary">{ADD_IT.lead}</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ADD_IT.ways.map((w) => (
              <div key={w.title} className="rounded-warm-xl bg-white p-5 shadow-warm">
                <h3 className="font-display text-base font-bold text-text-primary">{w.title}</h3>
                <p className="mt-1 text-sm text-text-secondary">{w.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 7. Pricing */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="font-display text-3xl font-extrabold tracking-tight text-text-primary sm:text-4xl">{PRICING_HEADING}</h2>
        <p className="mt-3 text-text-secondary">
          <span className="figure">{free}</span> priced quotes free in total, no card.
        </p>
        <div className="mt-8 grid gap-5 sm:grid-cols-3">
          {offeredPlans().map((def) => (
            <div key={def.id} className={`rounded-warm-xl p-6 ${def.recommended ? 'bg-primary text-white shadow-warm-lg' : 'border border-border bg-white'}`}>
              <p className={`text-sm font-semibold ${def.recommended ? 'text-white/80' : 'text-text-secondary'}`}>{def.name}</p>
              <p className="figure mt-2 text-3xl font-medium">{formatMoney((def.monthlyPrice.USD ?? 0) / 100, 'USD', 'en-US', { decimals: 0 })}</p>
              <p className={`mt-1 text-xs ${def.recommended ? 'text-white/70' : 'text-text-muted'}`}>
                per month · {def.quoteLimit.toLocaleString('en-US')} quotes a month
              </p>
            </div>
          ))}
        </div>
        <p className="mt-6">
          <Link href="/pricing" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-primary hover:text-primary-hover">
            Compare plans →
          </Link>
        </p>
      </section>

      {/* 8. FAQ */}
      <section className="border-t border-border bg-surface py-16">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <h2 className="font-display text-3xl font-extrabold tracking-tight text-text-primary sm:text-4xl">Questions</h2>
          <div className="mt-6 divide-y divide-border rounded-warm-xl border border-border bg-white" data-testid="faq">
            {FAQ.map((f) => (
              <details key={f.q} className="group px-5">
                <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 py-3 font-semibold text-text-primary">
                  {f.q}
                  <span className="text-text-muted transition-transform group-open:rotate-45" aria-hidden="true">+</span>
                </summary>
                <p className="pb-4 text-sm text-text-secondary">
                  {f.a}
                  {'link' in f && f.link ? (
                    <>
                      {' '}
                      <Link href={f.link.href} className="font-semibold text-primary underline underline-offset-2">
                        {f.link.label}
                      </Link>
                    </>
                  ) : null}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* 9. Who is behind this (renders nothing until lib/marketing/founder.ts is filled in) */}
      <FounderNote />

      {/* 10. Final call to action */}
      <section className="bg-primary py-16 text-white">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{FINAL_CTA}</h2>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/signup" className="inline-flex min-h-[48px] items-center justify-center rounded-lg bg-white px-6 py-3 text-sm font-semibold text-primary hover:bg-mint">
              {freeOfferLabel()}
            </Link>
            <Link href="/demo" className="inline-flex min-h-[48px] items-center justify-center rounded-lg border border-white/40 px-6 py-3 text-sm font-semibold text-white hover:bg-white/10">
              Try it as a customer
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  )
}

/** Small line icons for the three steps (ask, price, confirm) */
function StepIcon({ index }: { index: number }) {
  const paths = [
    'M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
    'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  ]
  return (
    <span className="inline-flex h-10 w-10 items-center justify-center rounded-warm-lg bg-mint text-primary" aria-hidden="true">
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
        <path strokeLinecap="round" strokeLinejoin="round" d={paths[index]} />
      </svg>
    </span>
  )
}
