import Link from 'next/link'
import type { Metadata } from 'next'
import { DEMO_BUSINESS_NAME, DEMO_LOGO_PATH, DEMO_PRIMARY_COLOR, DEMO_SLUG, freeOfferLabel, FREE_ALLOWANCE, shortDate } from '@qolumns/shared'
import { upcomingFaq } from '@/lib/marketing/plan-claims'
import { PlanCards } from '@/components/marketing/PlanCards'
import { Faq } from '@/components/marketing/Faq'
import { AppSection } from '@/components/marketing/home/AppSection'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { FounderNote } from '@/components/marketing/FounderNote'
import { HeroDemo } from '@/components/marketing/home/HeroDemo'
import { WatchButton } from '@/components/guide/WatchButton'
import { SetupSteps } from '@/components/marketing/home/SetupSteps'
import { WhatItNotices } from '@/components/marketing/home/WhatItNotices'
import { HeroPhoto } from '@/components/marketing/home/HeroPhoto'
import { ScenePhoto } from '@/components/marketing/ScenePhoto'
import { CLOSING_PHOTO } from '@/lib/marketing/photos'
import { PriceSentence } from '@/components/marketing/home/PriceSentence'
import { AddItAnywhere } from '@/components/marketing/home/AddItAnywhere'
import { listPacks } from '@/lib/vertical-packs'
import { templateTrades, tradeHref } from '@/lib/marketing/trades'
import { appQuoteLines, marketingExample } from '@/lib/marketing/examples'
import { MAIN_CTA, QUIET_BUTTON, QUIET_LINK } from '@/lib/marketing/cta'
import { HERO, HERO_DEMO, HERO_DEMO_FRAMES, MESSAGE_LINE, NOTICES, OTHER_TRADES, SETUP, CONTROL, STATISTICS, ADD_IT, PRICING_HEADING, PLANS_SECTION, FAQ, HOME_FAQ_UPCOMING_AFTER, FINAL_CTA, FINAL_QUIET_LINK, PAGE_META, WATCH } from '@/lib/marketing/home-copy'

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
 * One idea per section, and no two neighbours share a layout or a background
 * (T-167 order):
 *   1 hero (paper): the words over the hero photograph, the one yellow button, and the product demo (three frames of one height, T-168)
 *   2 what homeowners want (grey): three large figures in three columns (T-168), one column on a phone
 *   3 what it notices (paper): the message line and four examples, each with its real screen
 *   4 your prices (mint): a sentence that turns into price lines (the one moment)
 *   5 set up in minutes (paper): three steps beside their screens; the trade links sit in step 1
 *   6 add it anywhere (grey): five ways, each with its picture; two are still to come (T-187)
 *   7 the on-site app (mint): words beside two of its screens; "Coming soon to iPhone" (T-187)
 *   8 plans (paper): two cards, centred, the same component as Pricing (T-187)
 *   9 questions (grey): a centred column
 *  10 who is behind this (when filled in)
 *  11 the closing band: one button and one quiet link, over an evening photograph (T-170)
 * Whatever is not live yet (quotes inside WhatsApp, the on-site app, the room scan) is drawn from
 * lib/marketing/plan-claims.ts with its "Coming soon" mark; nothing on this page says it is live.
 * Copy: lib/marketing/home-copy.ts. Screens: the product's own parts, at true size.
 */
export default function HomePage() {
  // the water-heater example the sections below are built on, and the hero demo's own short example
  // (the default one, interior painting since T-187: one question, the price from the template's rates)
  const example = marketingExample(HERO_DEMO.trade)
  const demo = marketingExample()
  const hvac = marketingExample('hvac')
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
  // T-187: the on-site app's screens show the same example jobs, at the templates' own prices
  const appRows = [
    { customer: demo.customerName, service: demo.serviceName, total: demo.total, status: 'pending_review' as const, when: 'just now' },
    { customer: example.customerName, service: example.serviceName, total: example.total, status: 'sent' as const, when: '2 hours ago' },
    { customer: hvac.customerName, service: hvac.serviceName, total: hvac.total, status: 'viewed' as const, when: 'yesterday' },
  ]
  const appQuote = { customer: demo.customerName, service: demo.serviceName, total: demo.total, lines: appQuoteLines(), receivedOn: shortDate(new Date().toISOString(), { locale: 'en-US' }) ?? '' }
  const faq = [...FAQ.slice(0, HOME_FAQ_UPCOMING_AFTER), ...upcomingFaq(), ...FAQ.slice(HOME_FAQ_UPCOMING_AFTER)]

  // the hero's words and its demo: the same in production and on a hero-test preview
  const heroBody = (
    <>
      <div className="max-w-3xl">
        <h1 className="font-display text-display-sm font-extrabold text-text-primary sm:text-display-md lg:text-display-lg">{HERO.headline}</h1>
        <p className="mt-4 max-w-2xl text-base text-text-secondary sm:text-lg">{HERO.subline}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center" data-testid="hero-actions">
          <Link href="/signup" className={MAIN_CTA} data-testid="hero-signup" data-cta="main">
            {freeOfferLabel()}
          </Link>
          <Link href="/demo" className={QUIET_BUTTON} data-testid="hero-demo">
            Try it as a customer
          </Link>
          {/* T-208: the product in a minute, in a window over the page: words only, quieter than the two buttons */}
          <WatchButton id="hero" words={WATCH.hero} className="sm:px-2" />
        </div>
        <p className="hero-small-line mt-3 text-xs text-text-muted">{HERO.smallLine}</p>
      </div>
      <div className="mt-10 lg:mt-12">
        <HeroDemo
          content={{
            businessName: DEMO_BUSINESS_NAME,
            logoUrl: DEMO_LOGO_PATH,
            primaryColor: DEMO_PRIMARY_COLOR,
            serviceName: demo.serviceName,
            question: demo.question,
            answer: demo.answer,
            customerName: demo.customerName,
            lines: demo.lines,
            total: demo.total,
            currency: 'USD',
            locale: 'en-US',
            frames: HERO.frames,
            playAgain: HERO_DEMO_FRAMES.playAgain,
            acceptNote: HERO_DEMO_FRAMES.acceptNote(DEMO_BUSINESS_NAME),
            sentNote: HERO_DEMO_FRAMES.sentNote,
            screens: HERO_DEMO_FRAMES.screens,
          }}
        />
      </div>
      
    </>
  )

  return (
    <main className="min-h-screen overflow-x-clip bg-background">
      <SiteNav />

      {/* 1. Hero. T-168, T-170: a band with the hero photograph. From 768 px the photograph is the band's
          background, fading into paper under the words, and the demo frames sit half on it; under 768 px it
          fills the top of the band and fades down into paper, with the headline over the faded part
          (globals.css, "scene photographs"). */}
      <section className="hero-band home-hero" data-testid="hero">
        <HeroPhoto />
        <div className={`${WRAP} hero-inner pb-16 pt-8 sm:pt-14`}>{heroBody}</div>
      </section>

      {/* 2. What homeowners want: the second thing a visitor sees. T-168: three columns side by side again
          (the large figure, the short line under it, then its source); one column on a phone */}
      <section className="border-y border-border bg-surface py-16 sm:py-20" data-testid="homeowners">
        <div className={WRAP}>
          <h2 className={H2}>What homeowners want</h2>
          <div className="mt-10 grid gap-10 md:grid-cols-3 md:gap-0 md:divide-x md:divide-border-strong" data-testid="statistics">
            {STATISTICS.map((s) => (
              <figure key={s.url} className="md:px-8 md:first:pl-0 md:last:pr-0">
                <p className="figure text-display-md font-medium leading-none text-primary lg:text-display-xl">{s.figure}</p>
                <blockquote className="mt-4 text-base text-text-primary">{s.text}</blockquote>
                <figcaption className="mt-3 text-xs text-text-secondary">
                  Source:{' '}
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center font-semibold text-primary underline underline-offset-2 sm:min-h-0">
                    {s.source}
                  </a>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* 3. What it notices: the message, and four real examples each with its real screen (T-167) */}
      <section className={`${WRAP} py-16 sm:py-24`} data-testid="notices">
        <div className="max-w-3xl">
          <h2 className={H2}>{NOTICES.heading}</h2>
          <p className="mt-4 font-display text-2xl font-bold text-text-primary sm:text-3xl" data-testid="message-line">{MESSAGE_LINE}</p>
        </div>
        <WhatItNotices
          examples={NOTICES.examples}
          heater={example}
          painting={marketingExample('painting')}
          range={HERO_DEMO.rangeBeforeConfirming}
          business={{ name: DEMO_BUSINESS_NAME, primaryColor: DEMO_PRIMARY_COLOR }}
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

      {/* 5. Set up in minutes: the trade pages are linked from step 1 */}
      <section className={`${WRAP} py-16 sm:py-20`} data-testid="setup">
        <h2 className={H2}>{SETUP.heading}</h2>
        <p className="mt-3 max-w-2xl text-text-secondary">{SETUP.lead}</p>
        {/* T-208: the first setup guide, in the same window as the hero's video */}
        <div className="mt-1 flex justify-start">
          <WatchButton id="add-service" words={WATCH.setup} />
        </div>
        <SetupSteps
          steps={SETUP.steps}
          screenLabels={SETUP.screens}
          trades={trades.map((t) => t.label)}
          chosenTrade={trades.find((t) => t.slug === HERO_DEMO.trade)?.label ?? trades[0]?.label ?? ''}
          serviceName={example.serviceName}
          prices={example.lines}
          quoteLink={quoteLink}
          tradeLinks={[...trades.map((t) => ({ label: t.label, href: tradeHref(t) })), { label: OTHER_TRADES, href: '/signup', other: true }]}
          elsewhere={SETUP.elsewhere}
        />
      </section>

      {/* 6. Add it anywhere: five ways, two of them still to come (T-187) */}
      <section id={ADD_IT.id} className="scroll-mt-20 border-y border-border bg-surface py-16 sm:py-20" data-testid="add-it-section">
        <div className={WRAP}>
          <h2 className={H2}>{ADD_IT.heading}</h2>
          <p className="mt-3 max-w-2xl text-text-secondary">{ADD_IT.lead}</p>
          <AddItAnywhere
            shown={ADD_IT.shown}
            screenLabels={ADD_IT.screens}
            quoteLink={quoteLink}
            form={form}
            chat={{ serviceName: demo.serviceName, customerName: demo.customerName, link: `${appOrigin.replace(/^https?:\/\//, '')}/q/…` }}
            appRows={appRows.slice(0, 2)}
          />
        </div>
      </section>

      {/* 7. The on-site app (T-187): not live; every word about it comes from plan-claims with its mark */}
      <section className="bg-mint py-16 sm:py-20" data-testid="app">
        <div className={WRAP}>
          <AppSection listRows={appRows} quote={appQuote} />
        </div>
      </section>

      {/* 8. Plans: two cards, centred, the same component as Pricing (T-187) */}
      <section className={`${WRAP} py-16 text-center sm:py-20`} data-testid="plans">
        <h2 className={H2}>{PRICING_HEADING}</h2>
        <p className="mt-3 text-text-secondary" data-testid="plans-free">
          <span className="figure">{free}</span> {PLANS_SECTION.free}
        </p>
        <PlanCards className="mt-10" />
        <p className="mt-6">
          <Link href="/pricing" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-primary underline underline-offset-4 hover:text-primary-hover">
            {PLANS_SECTION.compare}
          </Link>
        </p>
      </section>

      {/* 9. Questions: a centred column (T-187) */}
      <section className="border-t border-border bg-surface py-16 sm:py-20" data-testid="questions">
        <Faq heading="Questions" items={faq} />
      </section>

      {/* 10. Who is behind this (renders nothing until lib/marketing/founder.ts is filled in) */}
      <FounderNote />

      {/* 11. The closing band: one button style and one quiet link. T-170: an evening photograph behind it, with
          the same treatment as the hero on juniper: the words are light, on the side that is solid juniper */}
      <section className="hero-band closing-band text-white" data-testid="closing">
        <ScenePhoto photo={CLOSING_PHOTO} testId="closing-photo" />
        <div className={`${WRAP} hero-inner pb-16 md:py-24`}>
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{FINAL_CTA}</h2>
          <div className="mt-8 flex flex-col items-start gap-2">
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
