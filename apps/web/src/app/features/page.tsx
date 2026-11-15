import Link from 'next/link'
import type { Metadata } from 'next'
import { DEMO_BUSINESS_NAME, DEMO_LOGO_PATH, DEMO_PRIMARY_COLOR, DEMO_SLUG, QUOTE_TURN_COPY, freeOfferLabel } from '@qolumns/shared'
import { HOME_WINDOW_DAYS } from '@/lib/home-numbers'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { RequestFormScreen } from '@/components/marketing/home/RequestFormScreen'
import { EstimateSheet } from '@/components/quote/EstimateSheet'
import { Picture, PhoneFrame, QuestionScreen, PriceCheckScreen, NumbersScreen } from '@/components/marketing/screens/ProductScreens'
import { marketingExample } from '@/lib/marketing/examples'
import { MAIN_CTA, QUIET_BUTTON, QUIET_LINK } from '@/lib/marketing/cta'
import { HERO_DEMO } from '@/lib/marketing/home-copy'
import { FEATURES_META, FEATURES_HERO, FEATURE_STEPS, FEATURES_PRICE_EXAMPLE, FEATURES_NUMBERS_EXAMPLE, FEATURES_CLOSING, type FeatureStep } from '@/lib/marketing/features-copy'

export const metadata: Metadata = {
  title: FEATURES_META.title,
  description: FEATURES_META.description,
}

const WRAP = 'mx-auto max-w-container px-4 sm:px-6'

/**
 * T-167: the Features page shows the product (system.md, Imagery and Layout;
 * audit.md finding 1 and section 4, item 7). It leads with the message line
 * and follows the product's five steps, each with its real screen at true
 * size in place of four text boxes:
 *   01 Ask      the request form on a phone                 words left, screen right
 *   02 Read     a photo and what was read from it           screen left, words right
 *   03 Price    a price sentence and the list it becomes    one centred column
 *   04 Confirm  the customer's quote page                   words left, screen right, on grey
 *   05 Track    Home's numbers for the last 30 days         words above a full-width screen
 * No two neighbouring steps share a layout. One yellow button per screen: the
 * hero's and the closing band's. Nothing moves but the hero's one entrance.
 * Copy: lib/marketing/features-copy.ts. Prices: the trade templates' own
 * (lib/marketing/examples.ts).
 */
export default function FeaturesPage() {
  const heater = marketingExample(HERO_DEMO.trade)
  const appOrigin = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
  const address = `${appOrigin}/quote/${DEMO_SLUG}`.replace(/^https?:\/\//, '')
  const N = QUOTE_TURN_COPY.home.numbers
  const E = FEATURES_NUMBERS_EXAMPLE
  const step = (id: FeatureStep['id']) => FEATURE_STEPS.find((s) => s.id === id)!

  const form = (
    <RequestFormScreen
      businessName={DEMO_BUSINESS_NAME}
      logoUrl={DEMO_LOGO_PATH}
      primaryColor={DEMO_PRIMARY_COLOR}
      serviceName={heater.serviceName}
      question={HERO_DEMO.question}
      answer={HERO_DEMO.answer}
      photo={{ src: HERO_DEMO.photoSrc, alt: '', label: HERO_DEMO.photoLabel }}
      className="shadow-warm-md"
    />
  )

  return (
    <main className="min-h-screen overflow-x-clip bg-background">
      <SiteNav />

      {/* Hero: the message line, and the page's one yellow button above the fold */}
      <section className={`${WRAP} pb-14 pt-10 sm:pb-20 sm:pt-16`} data-testid="hero">
        <div className="animate-fade-in-up max-w-4xl">
          <h1 className="font-display text-display-sm font-extrabold text-text-primary sm:text-display-md lg:text-display-lg" data-testid="message-line">
            {FEATURES_HERO.headline}
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-text-secondary">{FEATURES_HERO.lead}</p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link href="/signup" className={MAIN_CTA} data-testid="hero-signup" data-cta="main">
              {freeOfferLabel()}
            </Link>
            <Link href="/demo" className={QUIET_BUTTON} data-testid="hero-demo">
              Try it as a customer
            </Link>
          </div>
        </div>
      </section>

      {/* 01 Ask: words left, the form on a phone right */}
      <section className="border-t border-border" data-testid="feature-step" data-step="ask">
        <div className={`${WRAP} grid items-center gap-10 py-16 sm:py-20 lg:grid-cols-[1fr_minmax(0,24rem)] lg:gap-20`}>
          <Words step={step('ask')} />
          <Picture label={step('ask').screen} testId="feature-screen">
            <PhoneFrame address={address}>{form}</PhoneFrame>
          </Picture>
        </div>
      </section>

      {/* 02 Read the job: the photo and what was read from it left, words right, on mint */}
      <section className="bg-mint" data-testid="feature-step" data-step="read">
        <div className={`${WRAP} grid items-center gap-10 py-16 sm:py-20 lg:grid-cols-2 lg:gap-20`}>
          <Picture label={step('read').screen} className="mx-auto w-full max-w-md lg:order-1 lg:mx-0" testId="feature-screen">
            {/* eslint-disable-next-line @next/next/no-img-element -- the sample label shipped in public/demo */}
            <img src={HERO_DEMO.photoSrc} alt="" width={1000} height={750} className="w-full rounded-2xl border border-border shadow-warm-md" />
            {heater.reading ? (
              <QuestionScreen value={heater.reading.value} readFrom={heater.reading.readFrom} primaryColor={DEMO_PRIMARY_COLOR} className="-mt-6 ml-6 sm:ml-12" />
            ) : null}
          </Picture>
          <Words step={step('read')} className="lg:order-2" />
        </div>
      </section>

      {/* 03 Price: one centred column, the sentence and the list it becomes */}
      <section data-testid="feature-step" data-step="price">
        <div className={`${WRAP} py-16 text-center sm:py-20`}>
          <Words step={step('price')} className="mx-auto max-w-2xl" centred />
          <Picture label={step('price').screen} className="mx-auto mt-10 max-w-lg" testId="feature-screen">
            <PriceCheckScreen serviceName={FEATURES_PRICE_EXAMPLE.service} sentence={FEATURES_PRICE_EXAMPLE.sentence} prices={[...FEATURES_PRICE_EXAMPLE.list]} />
          </Picture>
        </div>
      </section>

      {/* 04 Confirm: words left, the customer's quote page right, on grey */}
      <section className="border-y border-border bg-surface" data-testid="feature-step" data-step="confirm">
        <div className={`${WRAP} grid items-start gap-10 py-16 sm:py-20 lg:grid-cols-[minmax(0,26rem)_1fr] lg:gap-20`}>
          <Words step={step('confirm')} className="lg:sticky lg:top-28" />
          <Picture label={step('confirm').screen} className="mx-auto w-full max-w-lg lg:mx-0 lg:justify-self-end" testId="feature-screen">
            <EstimateSheet
              confirmed
              data={{
                businessName: DEMO_BUSINESS_NAME,
                logoUrl: DEMO_LOGO_PATH,
                customerName: heater.customerName,
                reference: 'EST-2026-0142',
                lines: heater.lines,
                total: heater.total,
                currency: 'USD',
                locale: 'en-US',
                primaryColor: DEMO_PRIMARY_COLOR,
              }}
            />
          </Picture>
        </div>
      </section>

      {/* 05 Track: words above, Home's numbers across the full width */}
      <section data-testid="feature-step" data-step="track">
        <div className={`${WRAP} py-16 sm:py-20`}>
          <Words step={step('track')} className="max-w-2xl" />
          <Picture label={step('track').screen} className="mt-10" testId="feature-screen">
            <NumbersScreen
              title={N.title(HOME_WINDOW_DAYS)}
              note={N.note(HOME_WINDOW_DAYS)}
              numbers={[
                { title: N.requests, value: E.requests.value, change: N.up(E.requests.up) },
                { title: N.sent, value: E.sent.value, change: N.up(E.sent.up) },
                { title: N.accepted, value: E.accepted.value, change: N.up(E.accepted.up) },
                { title: N.valueAccepted, value: E.valueAccepted.value, change: N.up(E.valueAccepted.up) },
              ]}
            />
          </Picture>
        </div>
      </section>

      {/* The closing band: one yellow button and one quiet link */}
      <section className="bg-primary py-16 text-white" data-testid="closing">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{FEATURES_CLOSING.heading}</h2>
          <p className="mx-auto mt-3 max-w-xl text-on-primary/80">{FEATURES_CLOSING.lead}</p>
          <div className="mt-8 flex flex-col items-center gap-2">
            <Link href="/signup" className={MAIN_CTA} data-testid="closing-signup" data-cta="main">
              {freeOfferLabel()}
            </Link>
            <Link href="/pricing" className={`${QUIET_LINK} text-white`}>
              {FEATURES_CLOSING.quietLink}
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  )
}

function Words({ step, className = '', centred = false }: { step: FeatureStep; className?: string; centred?: boolean }) {
  return (
    <div className={className}>
      <p className="text-text-muted">
        <span className="figure text-sm font-medium">{step.number}</span>
        <span className="ml-3 text-xs font-semibold uppercase tracking-widest">{step.name}</span>
      </p>
      <h2 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-text-primary sm:text-4xl">{step.headline}</h2>
      <p className={`mt-4 text-lg leading-relaxed text-text-secondary ${centred ? '' : 'max-w-xl'}`}>{step.body}</p>
    </div>
  )
}
