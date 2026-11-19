import Link from 'next/link'
import type { Metadata } from 'next'
import { DEMO_BUSINESS_NAME, DEMO_LOGO_PATH, DEMO_PRIMARY_COLOR, DEMO_SLUG, freeOfferLabel, shortDate } from '@qolumns/shared'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { Soon } from '@/components/marketing/Soon'
import { EstimateSheet } from '@/components/quote/EstimateSheet'
import { Picture, QuestionScreen, PriceCheckScreen, SectionsScreen, ApproveScreen, LinkScreen, UnderstoodScreen } from '@/components/marketing/screens/ProductScreens'
import { AppPhone, AppQuoteScreen, ChatScreen, RoomScanCard } from '@/components/marketing/screens/AppScreens'
import { appQuoteLines, marketingExample, twoServiceExample } from '@/lib/marketing/examples'
import { MAIN_CTA, QUIET_BUTTON, QUIET_LINK } from '@/lib/marketing/cta'
import { HERO_DEMO, NOTICES } from '@/lib/marketing/home-copy'
import { UPCOMING, type NotLiveYet } from '@/lib/marketing/plan-claims'
import { FEATURES_META, FEATURES_HERO, FEATURE_SECTIONS, FEATURES_PRICE_EXAMPLE, FEATURES_UPCOMING_HEADING, FEATURES_CLOSING, type FeatureId } from '@/lib/marketing/features-copy'

export const metadata: Metadata = {
  title: FEATURES_META.title,
  description: FEATURES_META.description,
}

const WRAP = 'mx-auto max-w-container px-4 sm:px-6'

/**
 * The ground of each section, so no two neighbours share one (system.md, Layout): paper, grey, paper,
 * mint, paper, grey, mint for the seven that are live; then paper (under the heading), grey, paper for
 * the three on the way, before the juniper closing band.
 */
const PAPER = ''
const GREY = 'border-y border-border bg-surface'
const MINT = 'bg-mint'
const LIVE_GROUNDS = [PAPER, GREY, PAPER, MINT, PAPER, GREY, MINT]
const UPCOMING_GROUNDS = [PAPER, GREY, PAPER]

/**
 * The Features page (T-187, the owner's review): one section per thing a
 * business cares about, each with a picture of the product and two or three
 * plain lines.
 *
 *   live       it reads photos and notes · your price list sets every price ·
 *              several services in one quote · you approve before it counts ·
 *              a quote page in your brand · share it anywhere · it flags what
 *              doesn't add up
 *   on the way quotes inside WhatsApp · the on-site app · the room scan
 *
 * The live ones come first. The three that are not live follow under their
 * own heading, each marked from its one flag in lib/marketing/plan-claims.ts,
 * which also holds their words.
 *
 * No two neighbouring sections share a layout or a ground: the picture
 * changes side from one section to the next, and the ground turns through
 * paper, grey and mint. One yellow button per screen: the hero's and the
 * closing band's. Nothing moves but the hero's one entrance.
 * Copy: lib/marketing/features-copy.ts. Prices: the trade templates' own
 * (lib/marketing/examples.ts).
 */
export default function FeaturesPage() {
  const heater = marketingExample(HERO_DEMO.trade)
  const painting = marketingExample('painting')
  const two = twoServiceExample()
  const appOrigin = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
  const quoteLink = `${appOrigin}/quote/${DEMO_SLUG}`
  const words = NOTICES.examples[0]
  const understood = words.understood

  const pictures: Record<FeatureId, React.ReactNode> = {
    photos: (
      <div className="mx-auto w-full max-w-md">
        {/* eslint-disable-next-line @next/next/no-img-element -- the sample label shipped in public/demo */}
        <img src={HERO_DEMO.photoSrc} alt="" width={1000} height={750} loading="lazy" className="w-full rounded-2xl border border-border shadow-warm-md" />
        {heater.reading ? <QuestionScreen value={heater.reading.value} readFrom={heater.reading.readFrom} primaryColor={DEMO_PRIMARY_COLOR} className="-mt-6 ml-6 sm:ml-12" /> : null}
      </div>
    ),
    prices: <PriceCheckScreen serviceName={FEATURES_PRICE_EXAMPLE.service} sentence={FEATURES_PRICE_EXAMPLE.sentence} prices={[...FEATURES_PRICE_EXAMPLE.list]} className="mx-auto max-w-lg" />,
    services: <SectionsScreen parts={[two.main, two.added]} total={two.total} primaryColor={DEMO_PRIMARY_COLOR} className="mx-auto max-w-lg" />,
    approve: <ApproveScreen customerName={painting.customerName} serviceName={painting.serviceName} total={painting.total} className="mx-auto max-w-sm" />,
    page: (
      <div className="mx-auto w-full max-w-lg">
        <EstimateSheet
          confirmed
          data={{
            businessName: DEMO_BUSINESS_NAME,
            logoUrl: DEMO_LOGO_PATH,
            customerName: painting.customerName,
            reference: 'EST-2026-0142',
            lines: painting.lines,
            total: painting.total,
            currency: 'USD',
            locale: 'en-US',
            primaryColor: DEMO_PRIMARY_COLOR,
          }}
        />
      </div>
    ),
    share: <LinkScreen quoteLink={quoteLink} className="mx-auto max-w-md" />,
    flags: (
      <UnderstoodScreen
        wroteTitle={words.wroteTitle}
        message={words.message}
        understoodTitle={words.understoodTitle}
        primaryColor={DEMO_PRIMARY_COLOR}
        rows={[
          { id: 'service', label: understood.service.label, value: painting.serviceName, text: understood.service.text },
          { id: 'size', label: understood.size.label, value: understood.size.value, text: understood.size.text },
          { id: 'extra', label: understood.extra.label, value: painting.extra?.label ?? '', text: understood.extra.text },
        ]}
      />
    ),
  }

  const upcoming: Array<{ key: NotLiveYet; heading: string; lines: readonly string[]; screen: string; picture: React.ReactNode }> = [
    {
      key: 'whatsapp',
      heading: UPCOMING.whatsapp.heading,
      lines: UPCOMING.whatsapp.lines,
      screen: UPCOMING.whatsapp.screen,
      picture: (
        <AppPhone>
          <ChatScreen businessName={DEMO_BUSINESS_NAME} serviceName={painting.serviceName} customerName={painting.customerName} message={UPCOMING.whatsapp.customerMessage} link={`${appOrigin.replace(/^https?:\/\//, '')}/q/…`} />
        </AppPhone>
      ),
    },
    {
      key: 'app',
      heading: UPCOMING.app.heading,
      lines: UPCOMING.app.lines,
      screen: UPCOMING.app.screens.quote,
      picture: (
        <AppPhone>
          <AppQuoteScreen customer={painting.customerName} service={painting.serviceName} lines={appQuoteLines()} total={painting.total} receivedOn={shortDate(new Date().toISOString(), { locale: 'en-US' }) ?? ''} />
        </AppPhone>
      ),
    },
    {
      key: 'roomScan',
      heading: UPCOMING.roomScan.heading,
      lines: UPCOMING.roomScan.lines,
      screen: UPCOMING.roomScan.screen,
      picture: <RoomScanCard className="mx-auto max-w-sm" />,
    },
  ]

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

      {/* What is live: one section each, the picture changing side, the ground turning */}
      {FEATURE_SECTIONS.map((section, i) => (
        <Section key={section.id} id={section.id} index={i} ground={LIVE_GROUNDS[i % LIVE_GROUNDS.length]!} title={section.title} lines={section.lines} screen={section.screen}>
          {pictures[section.id]}
        </Section>
      ))}

      {/* What is on the way: marked from the flags in plan-claims; never shown as live */}
      <div data-testid="features-upcoming">
        <div className={`${WRAP} pt-14`}>
          <p className="font-display text-2xl font-extrabold text-text-primary sm:text-3xl" data-testid="features-upcoming-heading">
            {FEATURES_UPCOMING_HEADING}
          </p>
        </div>
        {upcoming.map((item, i) => (
          <Section key={item.key} id={item.key} index={FEATURE_SECTIONS.length + i} ground={UPCOMING_GROUNDS[i % UPCOMING_GROUNDS.length]!} title={item.heading} lines={item.lines} screen={item.screen} soon={item.key} first={i === 0}>
            {item.picture}
          </Section>
        ))}
      </div>

      {/* The closing band: one yellow button and one quiet link */}
      <section className="bg-primary py-16 text-white" data-testid="closing">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{FEATURES_CLOSING.heading}</h2>
          <p className="mx-auto mt-3 max-w-xl text-on-primary">{FEATURES_CLOSING.lead}</p>
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

/**
 * One feature: its title, two or three lines, and its picture. The picture is
 * on the right in an even section and on the left in an odd one; on a phone
 * the words come first.
 */
function Section({
  id,
  index,
  ground,
  title,
  lines,
  screen,
  soon,
  first = false,
  children,
}: {
  id: string
  index: number
  /** The section's ground: its neighbours have another */
  ground: string
  title: string
  lines: readonly string[]
  screen: string
  /** Not live yet: the mark beside the title comes from this thing's flag */
  soon?: NotLiveYet
  /** The first of the sections that are on the way sits straight under their heading */
  first?: boolean
  children: React.ReactNode
}) {
  const flipped = index % 2 === 1
  return (
    <section className={ground} data-testid="feature-section" data-feature={id} data-side={flipped ? 'left' : 'right'} {...(soon ? { 'data-upcoming': soon } : {})}>
      <div className={`${WRAP} grid items-center gap-10 ${first ? 'pb-16 pt-8 sm:pb-20' : 'py-16 sm:py-20'} lg:grid-cols-2 lg:gap-20`}>
        <div className={flipped ? 'lg:order-2' : ''}>
          <h2 className="font-display text-3xl font-extrabold tracking-tight text-text-primary sm:text-4xl">{title}</h2>
          {soon ? (
            <p className="mt-3">
              <Soon of={soon} />
            </p>
          ) : null}
          <ul className="mt-5 max-w-xl space-y-3 text-lg text-text-secondary" data-testid="feature-lines">
            {lines.map((line) => (
              <li key={line} className="flex gap-3">
                <span aria-hidden="true" className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
        <Picture label={screen} className={flipped ? 'lg:order-1' : ''} testId="feature-screen">
          {children}
        </Picture>
      </div>
    </section>
  )
}
