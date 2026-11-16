import Link from 'next/link'
import { DEMO_BUSINESS_NAME, DEMO_LOGO_PATH, DEMO_PRIMARY_COLOR, freeOfferLabel } from '@qolumns/shared'
import type { TradePage, TradeScreen } from '@/lib/marketing/trades'
import { SiteNav } from './SiteNav'
import { SiteFooter } from './SiteFooter'
import { marketingExample, type MarketingExample } from '@/lib/marketing/examples'
import { MAIN_CTA, QUIET_BUTTON } from '@/lib/marketing/cta'
import { HERO_DEMO } from '@/lib/marketing/home-copy'
import { TRADE_SMALL_LINE, TRADE_PRICING_BAND, TRADE_HOW_HEADING } from '@/lib/marketing/site-copy'
import { SCREEN_WORDS } from '@/lib/marketing/screen-words'
import { RequestFormScreen } from './home/RequestFormScreen'
import { EstimateSheet } from '@/components/quote/EstimateSheet'
import { Picture, QuestionScreen, TakeoffScreen, LedgerScreen, PriceCheckScreen } from './screens/ProductScreens'
import { ScenePhoto } from './ScenePhoto'
import { TRADE_PHOTOS } from '@/lib/marketing/photos'

const WRAP = 'mx-auto max-w-container px-4 sm:px-6'
/** The example business's colour: a customer's screen is in the business's colour, never ours */
const COLOR = DEMO_PRIMARY_COLOR

/**
 * One landing page per launch trade (T-144), rendered from lib/marketing/trades.ts.
 *
 * T-167: the page shows the trade's own screens (system.md, Imagery; audit.md
 * finding 8). The hero's right half is that trade's request form and what is
 * read for it; "How the price is set" is three steps, each beside its real
 * screen, alternating sides (it was three grey cards). Every screen is built
 * from the trade's own template (lib/marketing/examples.ts): its question,
 * its label, its prices. A page says only what the AI does for its trade
 * (Docs/design/ai-capabilities.md, section 5). One yellow button per screen.
 *
 * The only photograph of a label is the sample water heater label we ship;
 * for the other label trades the photo is named, not pictured: we draw no
 * look-alike of a real rating plate.
 *
 * T-170: the hero has a scene photograph of the trade's work behind it
 * (lib/marketing/photos.ts, Docs/design/photos.md), with the same treatment as
 * Home's hero at every width. It is a situation, never a customer or a job we
 * priced, and the trade's real screen sits partly on it.
 */
export function TradeLanding({ trade }: { trade: TradePage }) {
  const example = marketingExample(trade.slug)
  const business = DEMO_BUSINESS_NAME
  const photo = TRADE_PHOTOS[trade.slug]
  return (
    <main className="min-h-screen overflow-x-clip bg-background">
      <SiteNav />

      {/* Hero: the words, the one yellow button, and this trade's own screen. T-170: behind them a photograph
          of the trade's work, treated as Home's hero is (globals.css, "scene photographs") */}
      <section className="hero-band trade-hero" data-testid="hero">
        <div className={`${WRAP} hero-inner grid items-start gap-10 pb-16 pt-8 sm:pt-14 lg:grid-cols-[1fr_minmax(0,25rem)] lg:gap-16`}>
          <div className="trade-hero-words">
            {photo ? <ScenePhoto photo={photo} priority testId="hero-photo" /> : null}
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-secondary">{trade.eyebrow}</p>
            <h1 className="max-w-3xl font-display text-display-sm font-extrabold text-text-primary sm:text-display-md">{trade.headline}</h1>
            <p className="mt-4 max-w-2xl text-base text-text-secondary sm:text-lg">{trade.lede}</p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link href="/signup" className={MAIN_CTA} data-testid="hero-signup" data-cta="main">
                {freeOfferLabel()}
              </Link>
              <Link href="/demo" className={QUIET_BUTTON} data-testid="hero-demo">
                Try it as a customer
              </Link>
            </div>
            <p className="hero-small-line mt-3 text-xs text-text-muted">{TRADE_SMALL_LINE}</p>
          </div>
          <Picture label={trade.heroScreen} className="trade-hero-screen animate-fade-in-up mx-auto w-full max-w-[25rem] lg:mx-0" testId="trade-hero-screen">
            <Screen kind="form" trade={trade} example={example} business={business} />
            {example.reading ? (
              <QuestionScreen value={example.reading.value} readFrom={example.reading.readFrom} primaryColor={COLOR} stacked className="mt-4" />
            ) : example.measured ? (
              <TakeoffScreen primaryColor={COLOR} rows={[{ ...example.measured, method: SCREEN_WORDS.estimate.fromPhotos }]} className="mt-4 bg-white shadow-warm-md" />
            ) : null}
          </Picture>
        </div>
      </section>

      {/* How the price is set: three steps, each beside its real screen, alternating sides */}
      <section className="border-y border-border bg-surface py-16 sm:py-20" data-testid="how-priced">
        <div className={WRAP}>
          <h2 className="font-display text-3xl font-extrabold tracking-tight text-text-primary sm:text-4xl">{TRADE_HOW_HEADING}</h2>
          <ol className="mt-10 space-y-12 lg:space-y-16">
            {trade.howPriced.map((step, i) => (
              <li key={step.title} className="grid items-center gap-6 lg:grid-cols-2 lg:gap-16" data-testid="how-step">
                <div className={i % 2 === 1 ? 'lg:order-2' : ''}>
                  <p className="figure text-sm font-medium text-text-muted">0{i + 1}</p>
                  <h3 className="mt-1 font-display text-2xl font-bold text-text-primary sm:text-3xl">{step.title}</h3>
                  <p className="mt-3 max-w-md text-text-secondary">{step.text}</p>
                </div>
                <Picture label={step.screen} className={`mx-auto w-full max-w-md lg:mx-0 ${i % 2 === 1 ? 'lg:order-1' : 'lg:justify-self-end'}`} testId="how-screen">
                  <Screen kind={step.shows} trade={trade} example={example} business={business} />
                </Picture>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Your prices, in plain English: one centred column */}
      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="font-display text-3xl font-extrabold tracking-tight text-text-primary">{TRADE_PRICING_BAND.heading}</h2>
          <p className="mt-4 text-text-secondary">
            {TRADE_PRICING_BAND.before} <span className="font-medium text-text-primary">{trade.pricingExample}</span> {TRADE_PRICING_BAND.after}
          </p>
        </div>
      </section>

      <section className="border-t border-border bg-mint py-16">
        <div className={`${WRAP} grid gap-6 sm:grid-cols-3`}>
          {trade.features.map((f) => (
            <div key={f.title} className="rounded-xl bg-white p-5 shadow-warm">
              <h3 className="font-semibold text-text-primary">{f.title}</h3>
              <p className="mt-1 text-sm text-text-secondary">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The closing band: one yellow button */}
      <section className="bg-primary py-16 text-white" data-testid="closing">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="font-display text-3xl font-extrabold tracking-tight">{trade.closing}</h2>
          <p className="mt-3 text-on-primary/80">Start from the {trade.templateName} template with typical rates you make your own.</p>
          <Link href="/signup" className={`${MAIN_CTA} mt-8`} data-testid="closing-signup" data-cta="main">
            {freeOfferLabel()}
          </Link>
        </div>
      </section>

      <SiteFooter />
    </main>
  )
}

/** One real screen of this trade, built from its template's example */
function Screen({ kind, trade, example, business }: { kind: TradeScreen; trade: TradePage; example: MarketingExample; business: string }) {
  const sheet = {
    businessName: business,
    logoUrl: DEMO_LOGO_PATH,
    customerName: example.customerName,
    reference: 'EST-2026-0142',
    lines: example.lines,
    total: example.total,
    currency: 'USD',
    locale: 'en-US',
    primaryColor: COLOR,
  }
  switch (kind) {
    case 'form':
      return (
        <RequestFormScreen
          businessName={business}
          logoUrl={DEMO_LOGO_PATH}
          primaryColor={COLOR}
          serviceName={example.serviceName}
          question={example.form.question}
          answer={example.form.answer}
          photo={
            example.photo
              ? // the one photograph we have is the sample tank label; any other label is named, not drawn
                trade.slug === HERO_DEMO.trade
                ? { src: HERO_DEMO.photoSrc, alt: '', label: HERO_DEMO.photoLabel }
                : { label: example.photo }
              : null
          }
        />
      )
    case 'label':
      // eslint-disable-next-line @next/next/no-img-element -- the sample label shipped in public/demo
      return <img src={HERO_DEMO.photoSrc} alt="" width={1000} height={750} className="w-full rounded-2xl border border-border shadow-warm-md" />
    case 'question':
      return example.reading ? <QuestionScreen value={example.reading.value} readFrom={example.reading.readFrom} primaryColor={COLOR} /> : null
    case 'takeoff':
      return example.measured ? (
        <TakeoffScreen primaryColor={COLOR} rows={[{ ...example.measured, method: SCREEN_WORDS.estimate.fromPhotos }]} className="bg-white shadow-warm-md" />
      ) : null
    case 'extra':
      return example.extra ? (
        <LedgerScreen primaryColor={COLOR} lines={[...example.lines, { label: example.extra.label, amount: example.extra.amount, added: true }]} total={example.total + example.extra.amount} />
      ) : null
    case 'prices':
      return <PriceCheckScreen serviceName={example.serviceName} prices={example.priceList} />
    case 'estimate':
      return <EstimateSheet data={sheet} />
  }
}
