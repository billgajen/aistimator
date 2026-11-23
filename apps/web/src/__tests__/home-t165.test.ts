/**
 * T-165: the home page shows the product; one free offer; the owner's choices.
 *
 * 1. One free offer: no plan has a trial, checkout cannot start one, and no
 *    page says "trial" or "14-day".
 * 2. The home page: its sections in order, one idea each; the hero demo's
 *    timeline; the screens are built from the product's own parts.
 * 3. Login is the form alone (T-200; it showed an estimate document); the email field can be autofilled; a
 *    skip link; footer links are tap-sized on a phone.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { offeredPlans, PLANS, freeOfferLabel, FREE_ALLOWANCE } from '@qolumns/shared'
import { HERO_DEMO, SETUP, CONTROL, ADD_IT } from '@/lib/marketing/home-copy'
import { marketingExample } from '@/lib/marketing/examples'
import { waterHeaterPackUS } from '@/lib/vertical-packs/water-heater-us'
import { DEMO_TIMELINE, DEMO_LENGTH_MS } from '@/components/marketing/home/HeroDemo'

const ROOT = join(__dirname, '..', '..', '..', '..')
const WEB = join(ROOT, 'apps/web/src')
const code = (file: string) => readFileSync(join(WEB, file), 'utf8')

function sources(dir = WEB, out: Array<[string, string]> = []): Array<[string, string]> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name !== '__tests__') sources(full, out)
    } else if (/\.tsx?$/.test(name)) out.push([full.slice(WEB.length + 1), readFileSync(full, 'utf8')])
  }
  return out
}

describe('T-165: one free offer (the owner’s pricing decision)', () => {
  it('no plan, offered or legacy, has a trial', () => {
    expect(PLANS.filter((p) => p.trialDays).map((p) => p.id)).toEqual([])
    expect(offeredPlans().find((p) => p.id === 'plan_us_pro')).toBeDefined()
  })

  it('so checkout sends no trial period: it charges from the day a plan is chosen', () => {
    // the route takes the trial from the plan, and only from the plan
    // (T-180: checkout was rewritten for Managed Payments; the rule is the same)
    expect(code('app/api/billing/checkout/route.ts')).toContain('trialDays: plan.trialDays && !row?.stripe_customer_id ? plan.trialDays : undefined,')
    expect(code('lib/stripe.ts')).toContain('...(input.trialDays ? { trial_period_days: input.trialDays } : {}),')
  })

  it('the free offer is the same everywhere: 10 quotes, no card', () => {
    expect(FREE_ALLOWANCE.US!.quotes).toBe(10)
    expect(freeOfferLabel()).toBe('Try every Pro feature free: 10 quotes, no card')
  })

  it('no marketing page or shared marketing copy says "trial" or "14-day"', () => {
    const marketing = sources().filter(([f]) => /^(app\/(page|pricing|features|trades|painting|demo|privacy|terms)|components\/marketing|lib\/marketing|app\/\(auth\))/.test(f))
    expect(marketing.length).toBeGreaterThan(15)
    expect(marketing.filter(([, src]) => /\btrial\b|14-day|14 day/i.test(src)).map(([f]) => f)).toEqual([])
  })

  it('the pricing page: Pro is "Choose Pro", the closing button is the free offer', () => {
    const pricing = code('app/pricing/page.tsx')
    // T-187: the cards are the component Home uses too
    expect(pricing).toContain('<PlanCards />')
    expect(code('components/marketing/PlanCards.tsx')).toContain('Choose {card.name}')
    expect(pricing).not.toMatch(/TRIAL_PLAN|trialDays/)
    expect([...pricing.matchAll(/className=\{(?:`\$\{)?MAIN_CTA/g)]).toHaveLength(2)
  })

  it('the billing page words a trial only from a plan that has one, so it says nothing now', () => {
    const billing = code('app/(dashboard)/app/settings/billing/page.tsx')
    expect(billing).toMatch(/\{plan\.trialDays \? \(/)
    expect(billing).not.toMatch(/14-day|14 day/)
  })
})

describe('T-165: the home page', () => {
  const home = code('app/page.tsx')

  it('has its sections in this order, one idea each', () => {
    // T-167: the figures are second, "What it notices" is third, and the trade
    // links moved from a row of their own into step 1 of "Set up in minutes"
    // T-187: the on-site app has a section of its own after "Add it anywhere"; the questions are the shared <Faq>
    const order = ['data-testid="hero"', 'data-testid="statistics"', 'data-testid="notices"', 'data-testid="control"', 'data-testid="setup"', '<AddItAnywhere', '<AppSection', 'data-testid="plans"', '<Faq', '<FounderNote', 'data-testid="closing"', '<SiteFooter']
    const at = order.map((mark) => home.indexOf(mark))
    expect(at.every((i) => i > 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(home).not.toContain('data-testid="trades-row"')
    expect(code('components/marketing/home/SetupSteps.tsx')).toContain('data-testid="trades-row"')
    // "How it works" repeated the hero in words: it is gone
    expect(home).not.toMatch(/How it works|HOW_IT_WORKS|ProductStrip/)
  })

  // T-168: the demo is three frames of one height again (the look before T-165): the answer arrives and the
  // button is pressed, the price lands, the lead arrives for the business. T-187: then "Approve & send" is
  // pressed and the lead reads as sent.
  it('the hero demo: the customer answers, the price lands, the lead reaches the business and is approved, in that order', () => {
    const T = DEMO_TIMELINE
    const order = [T.answer, T.ask, T.tape, T.lines, T.total, T.lead, T.approve, T.sent]
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    // it plays once and is over within six seconds
    expect(DEMO_LENGTH_MS).toBeLessThanOrEqual(6000)
    const demo = code('components/marketing/home/HeroDemo.tsx')
    expect(demo).toContain('<ol key={run}')
    expect(demo).toContain('data-testid="demo-replay"')
    expect(demo).not.toMatch(/setInterval|requestAnimationFrame|setTimeout/)
  })

  it('the demo is built from the product’s own parts, in the example business’s colour', () => {
    const demo = code('components/marketing/home/HeroDemo.tsx')
    // T-168: the short estimate in the middle frame is drawn in the demo itself; the status label and the button are the product's
    for (const part of ["from '@/components/quotes/TurnBadge'", "from '@/components/ui/Button'", "from '@/lib/color'"]) expect(demo).toContain(part)
    expect(demo).toContain('brandStyleVars(content.primaryColor)')
    expect(demo).not.toMatch(/\b(bg|text|border)-(accent|on-accent)\b/)
    // the estimate document's parts are the quote page's own, moved to one file
    expect(code('app/q/[quoteId]/page.tsx')).toContain("import { Money, SectionLabel } from '@/components/quote/document-parts'")
    expect(code('components/quote/EstimateSheet.tsx')).toContain("import { Money, SectionLabel } from './document-parts'")
    expect(code('components/quote/EstimateSheet.tsx')).toContain('style={brandStyleVars(data.primaryColor)}')
    // our accent is never on the customer's screens
    for (const f of ['components/quote/EstimateSheet.tsx', 'components/marketing/home/RequestFormScreen.tsx']) expect(code(f)).not.toMatch(/\b(bg|text|border)-(accent|on-accent)\b/)
  })

  it('the demo’s question, answer and photo are the water-heater template’s own, and its prices come from it', () => {
    const service = waterHeaterPackUS.services.find((s) => s.name === 'Water Heater Replacement')!
    const text = JSON.stringify(service)
    expect(text).toContain(`"label":"${HERO_DEMO.question}"`)
    expect(text).toContain(`"${HERO_DEMO.answer}"`)
    expect(text).toContain(`"label":"${HERO_DEMO.photoLabel}"`)
    const example = marketingExample(HERO_DEMO.trade)
    expect(example.serviceName).toBe(service.name)
    expect(example.total).toBe(example.lines.reduce((sum, l) => sum + l.amount, 0))
  })

  it('motion is CSS only, from the tokens: transform and opacity, and one flourish for the tape', () => {
    const css = code('app/globals.css')
    const demoCss = css.slice(css.indexOf("The home page's product demo"))
    for (const frame of ['demo-in', 'demo-pop', 'demo-out', 'demo-press', 'demo-draw']) expect(demoCss).toContain(`@keyframes ${frame}`)
    const props = new Set([...demoCss.matchAll(/^\s+(?:from|to|0%, 100%|50%) \{ ([a-z-]+):/gm)].map((m) => m[1]))
    expect([...props].sort()).toEqual(['opacity', 'transform'])
    expect(demoCss).toMatch(/animation: demo-draw var\(--motion-draw\) var\(--ease-enter\)/)
    expect(css).toMatch(/--motion-draw: 800ms;/)
    // no duration typed by hand: every one is a token (0ms is only the default wait)
    expect(demoCss).not.toMatch(/\b[1-9]\d*ms\b|\d\.\d+s\b/)
  })

  it('set up in minutes: three steps, each beside its screen', () => {
    expect(SETUP.heading).toBe('Set up in minutes')
    expect(SETUP.steps.map((s) => s.title)).toEqual(['Choose your trade', 'Check your prices', 'Share your link'])
    const steps = code('components/marketing/home/SetupSteps.tsx')
    for (const id of ['setup-screen-trade', 'setup-screen-prices']) expect(steps).toContain(`data-testid="${id}"`)
    // T-187: the link screen is shared with the Features page (ProductScreens); step 3 still shows it
    expect(steps).toContain('<LinkScreen key="link" quoteLink={quoteLink} />')
    expect(code('components/marketing/screens/ProductScreens.tsx')).toContain('data-testid="setup-screen-link"')
  })

  it('your prices: a sentence of two prices and the two price lines it becomes; the minimum is not an item', () => {
    expect(CONTROL.sentence.map((p) => p.words).join(' ')).toBe('$375 per room, heavy prep adds $250.')
    // T-167: Features uses the same two-price sentence (its words live in features-copy.ts)
    expect(code('lib/marketing/features-copy.ts')).toContain('“$375 per room, heavy prep adds $250.”')
    expect(code('lib/marketing/features-copy.ts')).not.toMatch(/minimum job/i)
    expect(CONTROL.sentence.map((p) => p.line.label)).toEqual(['Per room', 'Heavy prep'])
    expect(CONTROL.sentence.map((p) => p.line.amount)).toEqual(['$375.00', '+ $250.00'])
    // a minimum charge is a floor, not an item: no line, no highlighted row
    expect(JSON.stringify(CONTROL.sentence).toLowerCase()).not.toContain('minimum')
    // on the page from the first paint; the lines wait only when script has seen the section is below the screen
    const moment = code('components/marketing/home/PriceSentence.tsx')
    expect(moment).toContain("useState<'still' | 'waiting' | 'playing'>('still')")
    expect(moment).toContain("matchMedia('(prefers-reduced-motion: reduce)').matches) return")
  })

  it('add it anywhere: a real QR code, the quote page on a phone, the form on a website', () => {
    const add = code('components/marketing/home/AddItAnywhere.tsx')
    for (const id of ['qr-svg', 'add-it-phone', 'add-it-site']) expect(add + code('components/marketing/QrSvg.tsx')).toContain(`data-testid="${id}"`)
    expect(code('components/marketing/QrSvg.tsx')).toContain("import { qrMatrix } from '@/lib/qr'")
    expect(Object.keys(ADD_IT.shown)).toEqual(['qr', 'page', 'site'])
    // T-187: two more ways, not live yet: their words and their mark come from plan-claims, not from here
    for (const id of ['add-it-chat', 'add-it-app']) expect(add).toContain(`data-testid="${id}"`)
    expect(add).toContain('soon="whatsapp"')
    expect(add).toContain('soon="app"')
  })

  it('each plan card on Home has its own button, and the closing band has one button and one quiet link', () => {
    // T-187: the cards are one component, shared with Pricing
    expect(home).toContain('<PlanCards')
    const cards = code('components/marketing/PlanCards.tsx')
    expect(cards).toContain('href={`/signup?plan=${card.id}`}')
    expect(cards.match(/data-testid="plan-button"/g)).toHaveLength(1)
    const closing = home.slice(home.indexOf('data-testid="closing"'), home.indexOf('<SiteFooter'))
    expect(closing.match(/<Link /g)).toHaveLength(2)
    expect(closing).toMatch(/className=\{MAIN_CTA\}/)
    expect(closing).toMatch(/className=\{`\$\{QUIET_LINK\} text-white`\}/)
  })

  // T-168: the hero now has one photograph (HeroPhoto, recorded in Docs/design/photos.md) and its fade into
  // paper, both outside these files. Nothing else was added.
  it('no stock images or gradients in the page and its sections', () => {
    for (const f of ['app/page.tsx', 'components/marketing/home/HeroDemo.tsx', 'components/marketing/home/SetupSteps.tsx', 'components/marketing/home/AddItAnywhere.tsx', 'components/marketing/home/PriceSentence.tsx', 'components/marketing/home/RequestFormScreen.tsx']) {
      expect(code(f), f).not.toMatch(/gradient|backdrop-blur|\.jpe?g|unsplash|picsum/)
    }
    // the one image is the sample label the live demo already offers
    expect(HERO_DEMO.photoSrc).toBe('/demo/sample-water-heater-label.png')
  })
})

describe('T-165: login and small fixes', () => {
  it('T-200: log-in is the form alone, centred (the example estimate beside it is gone, at every width)', () => {
    const layout = code('app/(auth)/layout.tsx')
    expect(layout).not.toMatch(/EstimateSheet|LoginAside|login-document|marketingExample/)
    expect(existsSync(join(WEB, 'components/auth/LoginAside.tsx'))).toBe(false)
    // one column, in the middle of the screen both ways, with nothing beside it to make room for
    expect(layout).toContain('<div className="flex min-h-screen items-center justify-center bg-background p-4">')
    expect(layout).toContain('<div className="w-full max-w-md">')
    expect(layout).not.toMatch(/gap-16|xl:gap-24|lg:block/)
    // the log-in page itself is its heading and its form
    const login = code('app/(auth)/login/page.tsx')
    expect(login).toContain('Log in to your account')
    expect(login).not.toMatch(/EstimateSheet|MiniEstimate/)
  })

  it('the email and password fields can be autofilled', () => {
    const login = code('app/(auth)/login/page.tsx')
    expect(login).toContain('autoComplete="email"')
    expect(login).toContain('autoComplete="current-password"')
  })

  it('a skip link is the first thing in the header, and lands after it', () => {
    const nav = code('components/marketing/SiteNav.tsx')
    expect(nav.indexOf('href="#content"')).toBeLessThan(nav.indexOf('<nav '))
    expect(nav).toContain('<span id="content" tabIndex={-1}')
  })

  it('footer links are 44 px tall on a phone', () => {
    const footer = code('components/marketing/SiteFooter.tsx')
    expect(footer).toContain("const FOOT_LINK = 'inline-flex min-h-[44px] items-center")
    // T-187: four columns. Written once each: four product links, one per trade (a loop) and "All trades",
    // two company links, three legal ones. The support address is a link of the same height.
    expect(footer.match(/className=\{FOOT_LINK\}/g)).toHaveLength(11)
    // T-195: the trades with a page, in the template order
    expect(footer).toContain('{templateTrades(listPacks().map((p) => p.id)).map((trade) => (')
    expect(footer).toMatch(/data-testid="footer-support"/)
    expect(footer).toMatch(/inline-flex min-h-\[44px\] items-center font-semibold text-primary/)
  })

  it('one wordmark component draws the name everywhere', () => {
    for (const f of ['components/marketing/SiteNav.tsx', 'components/marketing/SiteFooter.tsx', 'app/(auth)/layout.tsx', 'app/(dashboard)/layout.tsx']) expect(code(f), f).toContain('<Wordmark')
    expect(code('components/brand/Wordmark.tsx')).not.toMatch(/toLowerCase|form/)
  })
})
