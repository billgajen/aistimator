import Link from 'next/link'
import type { Metadata } from 'next'
import { DEMO_BUSINESS_NAME, DEMO_LOGO_PATH, DEMO_PRIMARY_COLOR, DEMO_SLUG, offeredPlans, formatMoney, freeOfferLabel, FREE_ALLOWANCE } from '@qolumns/shared'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { FounderNote } from '@/components/marketing/FounderNote'
import { HeroDemo } from '@/components/marketing/home/HeroDemo'
import { SetupSteps } from '@/components/marketing/home/SetupSteps'
import { PriceSentence } from '@/components/marketing/home/PriceSentence'
import { AddItAnywhere } from '@/components/marketing/home/AddItAnywhere'
import { listPacks } from '@/lib/vertical-packs'
import { templateTrades, tradeHref } from '@/lib/marketing/trades'
import { marketingExample } from '@/lib/marketing/examples'
import { MAIN_CTA, QUIET_BUTTON, QUIET_LINK } from '@/lib/marketing/cta'
import { HERO, HERO_DEMO, TRADES_HEADING, OTHER_TRADES, SETUP, CONTROL, STATISTICS, ADD_IT, PRICING_HEADING, FAQ, FINAL_CTA, FINAL_QUIET_LINK, PAGE_META } from '@/lib/marketing/home-copy'

export const metadata: Metadata = {
  title: PAGE_META.title,
  description: PAGE_META.description,
  openGraph: { title: PAGE_META.title, description: PAGE_META.description, type: 'website' },
  twitter: { card: 'summary_large_image', title: PAGE_META.title, description: PAGE_META.description },
}

const H2 = 'font-display text-3xl font-extrabold tracking-tight text-text-primary sm:text-4xl'
const WRAP = 'mx-auto max-w-container px-4 sm:px-6'

/**
 * T-165 home page: show the product, do not describe it (Docs/design/system.md
 * decides the look; audit.md sections 1 and 4 say what was missing).
 *
 * One idea per section, and no two neighbours share a layout:
 *   1 hero: the words, the one yellow button, and the product demo (three screens)
 *   2 trades: a slim line of links
 *   3 set up in minutes: three steps, each beside its screen, alternating sides
 *   4 your prices: a sentence that turns into price lines (the one moment)
 *   5 what homeowners want: three big figures, no boxes
 *   6 add it anywhere: a QR code, the quote page on a phone, the form on a website
 *   7 plans: three cards, each with its own button
 *   8 questions: a narrow column
 *   9 who is behind this (when filled in)
 *  10 the closing band: one button and one quiet link
 * Copy: lib/marketing/home-copy.ts. Screens: the product's own parts, at true size.
 */
export default function HomePage() {
  const example = marketingExample(HERO_DEMO.trade)
  const trades = templateTrades(listPacks('US').filter((p) => p.region === 'US').map((p) => p.id))
  const free = FREE_ALLOWANCE.US!.quotes
  const appOrigin = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
  const quoteLink = `${appOrigin}/quote/${DEMO_SLUG}`
  const form = {
    businessName: DEMO_BUSINESS_NAME,
    logoUrl: DEMO_LOGO_PATH,
    primaryColor: DEMO_PRIMARY_COLOR,
    serviceName: example.serviceName,
    question: HERO_DEMO.question,
    answer: HERO_DEMO.answer,
  }

  return (
    <main className="min-h-screen overflow-x-clip bg-background">
      <SiteNav />

      {/* 1. Hero */}
      <section className={`${WRAP} pb-16 pt-8 sm:pt-14`} data-testid="hero">
        <div className="max-w-3xl">
          <h1 className="font-display text-display-sm font-extrabold text-text-primary sm:text-display-md lg:text-display-lg">{HERO.headline}</h1>
          <p className="mt-4 max-w-2xl text-base text-text-secondary sm:text-lg">{HERO.subline}</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link href="/signup" className={MAIN_CTA} data-testid="hero-signup" data-cta="main">
              {freeOfferLabel()}
            </Link>
            <Link href="/demo" className={QUIET_BUTTON} data-testid="hero-demo">
              Try it as a customer
            </Link>
          </div>
          <p className="mt-3 text-xs text-text-muted">{HERO.smallLine}</p>
        </div>
        <div className="mt-10 lg:mt-12">
          <HeroDemo
            content={{
              serviceName: example.serviceName,
              question: HERO_DEMO.question,
              answer: HERO_DEMO.answer,
              photo: { src: HERO_DEMO.photoSrc, alt: HERO_DEMO.photoAlt, label: HERO_DEMO.photoLabel },
              customerName: example.customerName,
              sheet: {
                businessName: DEMO_BUSINESS_NAME,
                logoUrl: DEMO_LOGO_PATH,
                customerName: example.customerName,
                reference: 'EST-2026-0142',
                lines: example.lines,
                total: example.total,
                currency: 'USD',
                locale: 'en-US',
                primaryColor: DEMO_PRIMARY_COLOR,
              },
              frames: HERO.frames,
              playAgain: HERO_DEMO.playAgain,
              sent: HERO_DEMO.sent,
              screens: HERO_DEMO.screens,
            }}
          />
        </div>
      </section>

      {/* 2. Trades: a slim line */}
      <section className="border-y border-border bg-surface py-6">
        <div className={`${WRAP} flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-6`}>
          {/* a label for the line of links, not a heading: it is smaller than any heading on the page */}
          <p className="shrink-0 font-display text-base font-bold text-text-primary" id="trades-label">{TRADES_HEADING}</p>
          <ul className="flex flex-wrap gap-2" aria-labelledby="trades-label" data-testid="trades-row">
            {trades.map((t) => (
              <li key={t.slug}>
                <Link href={tradeHref(t)} className="inline-flex min-h-[44px] items-center rounded-full border border-field bg-white px-4 text-sm font-semibold text-text-primary hover:border-primary">
                  {t.label}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/signup" className="inline-flex min-h-[44px] items-center rounded-full border border-dashed border-field px-4 text-sm font-medium text-text-secondary hover:border-primary">
                {OTHER_TRADES}
              </Link>
            </li>
          </ul>
        </div>
      </section>

      {/* 3. Set up in minutes */}
      <section className={`${WRAP} py-16 sm:py-20`} data-testid="setup">
        <h2 className={H2}>{SETUP.heading}</h2>
        <p className="mt-3 max-w-2xl text-text-secondary">{SETUP.lead}</p>
        <SetupSteps
          steps={SETUP.steps}
          screenLabels={SETUP.screens}
          trades={trades.map((t) => t.label)}
          chosenTrade={trades.find((t) => t.slug === HERO_DEMO.trade)?.label ?? trades[0]?.label ?? ''}
          serviceName={example.serviceName}
          prices={example.lines}
          quoteLink={quoteLink}
        />
      </section>

      {/* 4. Your prices: the one moment */}
      <section className="bg-mint py-16 sm:py-20" data-testid="control">
        <div className={WRAP}>
          <h2 className={`${H2} text-center`}>{CONTROL.heading}</h2>
          <div className="mt-10">
            <PriceSentence lead={CONTROL.sentenceLead} parts={CONTROL.sentence} listTitle={CONTROL.listTitle} replay={CONTROL.replay} />
          </div>
          {/* One column, like the rest of this section: the next section is a row of three */}
          <ul className="mx-auto mt-10 max-w-xl divide-y divide-primary border-y border-primary" data-testid="control-points">
            {CONTROL.points.map((p) => (
              <li key={p.title} className="py-4">
                <h3 className="font-display text-base font-bold text-text-primary">{p.title}</h3>
                <p className="mt-1 text-sm text-text-secondary">{p.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 5. What homeowners want: big figures, sources kept */}
      <section className={`${WRAP} py-16 sm:py-20`}>
        <h2 className={H2}>What homeowners want</h2>
        <div className="mt-10 grid gap-10 md:grid-cols-3 md:gap-0 md:divide-x md:divide-border" data-testid="statistics">
          {STATISTICS.map((s) => (
            <figure key={s.url} className="md:px-8 md:first:pl-0 md:last:pr-0">
              <p className="figure text-display-md font-medium text-primary lg:text-display-xl">{s.figure}</p>
              <blockquote className="mt-3 text-base text-text-primary">{s.text}</blockquote>
              <figcaption className="mt-3 text-xs text-text-muted">
                Source:{' '}
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center font-semibold text-primary underline underline-offset-2 sm:min-h-0">
                  {s.source}
                </a>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* 6. Add it anywhere */}
      <section className="border-y border-border bg-surface py-16 sm:py-20">
        <div className={WRAP}>
          <h2 className={H2}>{ADD_IT.heading}</h2>
          <p className="mt-3 max-w-2xl text-text-secondary">{ADD_IT.lead}</p>
          <AddItAnywhere shown={ADD_IT.shown} screenLabels={ADD_IT.screens} quoteLink={quoteLink} form={form} />
        </div>
      </section>

      {/* 7. Plans */}
      <section className={`${WRAP} py-16 sm:py-20`} data-testid="plans">
        <h2 className={H2}>{PRICING_HEADING}</h2>
        <p className="mt-3 text-text-secondary">
          <span className="figure">{free}</span> priced quotes free in total, no card.
        </p>
        <div className="mt-8 grid gap-5 sm:grid-cols-3">
          {offeredPlans().map((def) => (
            <div key={def.id} className={`flex flex-col rounded-2xl p-6 ${def.recommended ? 'bg-primary text-white shadow-warm-lg' : 'border border-border bg-white'}`} data-testid="plan-card">
              <p className={`text-sm font-semibold ${def.recommended ? 'text-on-primary/80' : 'text-text-secondary'}`}>{def.name}</p>
              <p className="figure mt-2 text-3xl font-medium">{formatMoney((def.monthlyPrice.USD ?? 0) / 100, 'USD', 'en-US', { decimals: 0 })}</p>
              <p className={`mt-1 text-xs ${def.recommended ? 'text-on-primary/70' : 'text-text-muted'}`}>
                per month · {def.quoteLimit.toLocaleString('en-US')} quotes a month
              </p>
              <Link
                href={`/signup?plan=${def.id}`}
                className={`motion-press mt-6 inline-flex min-h-[44px] items-center justify-center rounded-lg px-4 text-sm font-semibold ${def.recommended ? 'bg-white text-primary hover:bg-mint' : 'border border-field bg-background text-text-primary hover:bg-surface'}`}
                data-testid="plan-button"
              >
                Choose {def.name}
              </Link>
            </div>
          ))}
        </div>
        <p className="mt-6">
          <Link href="/pricing" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-primary hover:text-primary-hover">
            Compare plans →
          </Link>
        </p>
      </section>

      {/* 8. Questions */}
      <section className="border-t border-border bg-surface py-16">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <h2 className={H2}>Questions</h2>
          <div className="mt-6 divide-y divide-border rounded-2xl border border-border bg-white" data-testid="faq">
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

      {/* 10. The closing band: one button style and one quiet link */}
      <section className="bg-primary py-16 text-white" data-testid="closing">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{FINAL_CTA}</h2>
          <div className="mt-8 flex flex-col items-center gap-2">
            <Link href="/signup" className={MAIN_CTA} data-testid="closing-signup" data-cta="main">
              {freeOfferLabel()}
            </Link>
            <Link href="/demo" className={`${QUIET_LINK} text-white`} data-testid="closing-demo">
              {FINAL_QUIET_LINK}
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  )
}
