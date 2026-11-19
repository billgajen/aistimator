/**
 * T-187: Home, Pricing, Features and the footer after the owner's review.
 *
 * What is held here:
 *   - the three things shown before they are live (quotes inside WhatsApp, the
 *     on-site app, the room scan) are marked from ONE flag each, so setting a
 *     flag changes every page at once, and nothing about them is a claim;
 *   - the plan cards and Pricing's compare table are built from the plan
 *     definitions and plan-claims, never typed;
 *   - every new claim rests on a row of the inventory, and what the inventory
 *     cannot support is not said (a PDF, the AI quote checker);
 *   - the hero's example, the footer, the store badges, the wrapping rule.
 * How the pages look is in the screenshots (.checks/t187).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { FREE_ALLOWANCE, QUOTE_TURN_COPY, offeredPlans, operatorLine } from '@qolumns/shared'
import { recordedClaims } from '@/lib/marketing/ai-claims'
import { storeLinks } from '@/lib/marketing/app-stores'
import { HOME_EXAMPLE_TRADE, appQuoteLines, marketingExample, twoServiceExample } from '@/lib/marketing/examples'
import { FEATURE_SECTIONS } from '@/lib/marketing/features-copy'
import { ADD_IT, CONTROL, FAQ, HERO_DEMO_FRAMES, HOME_FAQ_UPCOMING_AFTER, SETUP } from '@/lib/marketing/home-copy'
import { COMING_SOON, PLAN_CHANNEL_LINES, PLAN_FEATURE_LINES, UPCOMING, appAvailability, isLive, planCards, soonMark, upcomingFaq } from '@/lib/marketing/plan-claims'
import { BILLING_NOTES, COMPARE, PRICING_FAQ, compareGroups } from '@/lib/marketing/pricing-copy'
import { FOOTER } from '@/lib/marketing/site-copy'
import { SCREEN_WORDS } from '@/lib/marketing/screen-words'
import { DEMO_LENGTH_MS, DEMO_TIMELINE } from '@/components/marketing/home/HeroDemo'

const ROOT = join(__dirname, '..', '..', '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
/** Source without comments */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
const WEB = 'apps/web/src'

/** Set a line live for the length of a check, then put it back */
function whileLive<T>(line: { live: boolean }, check: () => T): T {
  const before = line.live
  line.live = true
  try {
    return check()
  } finally {
    line.live = before
  }
}

// ---------------------------------------------------------------------------
// One flag each
// ---------------------------------------------------------------------------

describe('T-187: what is not live yet is marked from one flag', () => {
  it('today: quotes inside WhatsApp, the app and the room scan are not live, and each is marked "Coming soon"', () => {
    expect(COMING_SOON).toBe('Coming soon')
    for (const key of ['whatsapp', 'app', 'roomScan'] as const) {
      expect(isLive(key), key).toBe(false)
      expect(soonMark(key), key).toBe('Coming soon')
    }
    expect(appAvailability()).toBe('Coming soon to iPhone')
  })

  it('the flag is the plan line’s own `live`: there is no second switch', () => {
    expect(whileLive(PLAN_CHANNEL_LINES.whatsapp, () => [isLive('whatsapp'), soonMark('whatsapp')])).toEqual([true, null])
    expect(whileLive(PLAN_CHANNEL_LINES.mobile_app, () => [isLive('app'), soonMark('app'), appAvailability()])).toEqual([true, null, 'On iPhone'])
    expect(whileLive(PLAN_FEATURE_LINES.lidar_scanning!, () => [isLive('roomScan'), soonMark('roomScan')])).toEqual([true, null])
    // and it is back
    expect(isLive('whatsapp') || isLive('app') || isLive('roomScan')).toBe(false)
  })

  it('setting the flag changes the plan card, Pricing’s table and the question, with no other edit', () => {
    const pro = () => planCards().find((c) => c.id === 'plan_us_pro')!
    const whatsapp = PLAN_CHANNEL_LINES.whatsapp.label
    const soonRows = () => compareGroups().find((g) => g.id === 'soon')?.rows.map((r) => r.label) ?? []
    const reachRows = () => compareGroups().find((g) => g.id === 'reach')!.rows.map((r) => r.label)

    expect(pro().lines.find((l) => l.label === whatsapp)!.live).toBe(false)
    expect(soonRows()).toContain(whatsapp)
    expect(reachRows()).not.toContain(whatsapp)
    expect(upcomingFaq()[0]!.a).toMatch(/is coming soon\.$/)

    whileLive(PLAN_CHANNEL_LINES.whatsapp, () => {
      expect(pro().lines.find((l) => l.label === whatsapp)!.live).toBe(true)
      expect(soonRows()).not.toContain(whatsapp)
      expect(reachRows()).toContain(whatsapp)
      expect(compareGroups().find((g) => g.id === 'reach')!.rows.find((r) => r.label === whatsapp)!.cells).toEqual([false, true])
      expect(upcomingFaq()[0]!.a).not.toMatch(/coming soon/i)
    })
    // with both of Pro's channels live, the last group has nothing left and is not drawn
    whileLive(PLAN_CHANNEL_LINES.whatsapp, () => whileLive(PLAN_CHANNEL_LINES.mobile_app, () => expect(compareGroups().map((g) => g.id)).toEqual(['quotes', 'reach', 'ai', 'brand'])))
  })

  it('every place that shows one of them draws the mark from the flag, and types neither the mark nor "soon"', () => {
    const marked: Array<[string, string[]]> = [
      ['components/marketing/home/SetupSteps.tsx', ['<Soon of="whatsapp" />', '<Soon of="app" />']],
      ['components/marketing/home/AddItAnywhere.tsx', ['soon="whatsapp"', 'soon="app"', '{soon ? <Soon of={soon}']],
      ['components/marketing/home/AppSection.tsx', ['{appAvailability()}', '<Soon of="roomScan" />']],
      ['components/marketing/PlanCards.tsx', ['<Soon line={line}']],
      ['app/features/page.tsx', ['<Soon of={soon} />', 'soon={item.key}']],
      ['app/pricing/page.tsx', ['if (cell === COMING_SOON)']],
    ]
    for (const [file, marks] of marked) {
      const source = code(`${WEB}/${file}`)
      for (const mark of marks) expect(source, `${file}: ${mark}`).toContain(mark)
      expect(source, file).not.toMatch(/coming (soon|later)/i)
    }
    // the copy files that are walked for claims say nothing about timing either
    for (const file of ['lib/marketing/home-copy.ts', 'lib/marketing/features-copy.ts', 'lib/marketing/site-copy.ts']) expect(code(`${WEB}/${file}`), file).not.toMatch(/coming (soon|later)/i)
  })

  it('nothing about them is a claim about the live product', () => {
    // their words are in plan-claims beside the flag, never written through says()
    const claims = [...recordedClaims().keys()].join('\n')
    expect(claims).not.toMatch(/inside WhatsApp|WhatsApp chat itself|\bthe app\b|on-site app|room scan|scanning|LiDAR|iPhone/i)
    for (const key of ['whatsapp', 'app', 'roomScan'] as const) {
      for (const line of UPCOMING[key].lines) expect(recordedClaims().has(line), line).toBe(false)
    }
    // sharing a link in a WhatsApp chat is live, and is said as that
    expect(ADD_IT.lead).toContain('a WhatsApp chat')
    expect(upcomingFaq()[0]!.a).toMatch(/^Yes, today, by link: send your quote link in any WhatsApp chat/)
  })

  it('no Android, and no text messages, anywhere on the marketing site', () => {
    const files = [
      'app/page.tsx',
      'app/pricing/page.tsx',
      'app/features/page.tsx',
      'lib/marketing/home-copy.ts',
      'lib/marketing/features-copy.ts',
      'lib/marketing/pricing-copy.ts',
      'lib/marketing/site-copy.ts',
      'components/marketing/SiteFooter.tsx',
      'components/marketing/PlanCards.tsx',
      'components/marketing/home/AppSection.tsx',
      'components/marketing/home/AddItAnywhere.tsx',
      'components/marketing/home/SetupSteps.tsx',
      'components/marketing/screens/AppScreens.tsx',
    ]
    for (const file of files) {
      const source = code(`${WEB}/${file}`)
      expect(source, file).not.toMatch(/\bSMS\b|text message|by text\b|\ba text\b/i)
      expect(source, file).not.toMatch(/Android|Google Play/i)
    }
    expect(JSON.stringify(UPCOMING)).not.toMatch(/Android|\bSMS\b|text message/i)
    expect(UPCOMING.app.platform).toBe('iPhone')
    for (const plan of planCards()) expect(plan.lines.map((l) => l.label).join(' | ')).not.toMatch(/\bSMS\b|text message|by text/i)
  })
})

// ---------------------------------------------------------------------------
// The store badges
// ---------------------------------------------------------------------------

describe('T-187: a store badge shows only when its address is set', () => {
  it('none today; one per address; a value that is not an https address is ignored', () => {
    expect(storeLinks({})).toEqual([])
    expect(storeLinks({ APP_STORE_URL: '', PLAY_STORE_URL: '   ' })).toEqual([])
    expect(storeLinks({ APP_STORE_URL: 'https://apps.apple.com/app/id0000000000' })).toEqual([{ store: 'app-store', url: 'https://apps.apple.com/app/id0000000000', label: 'Download on the App Store' }])
    expect(storeLinks({ APP_STORE_URL: 'https://apps.apple.com/app/id0000000000', PLAY_STORE_URL: 'https://play.google.com/store/apps/details?id=x' }).map((s) => s.store)).toEqual(['app-store', 'play-store'])
    for (const bad of ['http://apps.apple.com/app/x', 'javascript:alert(1)', 'not a url', 'apps.apple.com/app/x']) expect(storeLinks({ APP_STORE_URL: bad }), bad).toEqual([])
  })

  it('the section draws the slots from that list, and nothing when it is empty', () => {
    const section = code(`${WEB}/components/marketing/home/AppSection.tsx`)
    expect(section).toContain('const stores = storeLinks()')
    expect(section).toContain('{stores.length > 0 ? (')
    expect(read('apps/web/.env.example')).toMatch(/^APP_STORE_URL=$/m)
    expect(read('apps/web/.env.example')).toMatch(/^PLAY_STORE_URL=$/m)
  })
})

// ---------------------------------------------------------------------------
// The plan cards
// ---------------------------------------------------------------------------

describe('T-187: the plan cards, from the plan definitions and plan-claims', () => {
  const [starter, pro] = planCards()

  it('two cards: Starter and Pro, with the prices and limits of the plan definitions', () => {
    expect(planCards().map((c) => c.id)).toEqual(['plan_us_starter', 'plan_us_pro'])
    const defs = new Map(offeredPlans().map((p) => [p.id, p]))
    for (const card of planCards()) {
      const def = defs.get(card.id)!
      expect([card.name, card.monthly, card.yearly]).toEqual([def.name, def.monthlyPrice.USD, def.annualPrice!.USD])
      expect(card.quotes).toBe(`${def.quoteLimit} quotes a month`)
      // yearly is ten months: "two months free"
      expect(card.yearly).toBe(card.monthly * 10)
    }
    expect([starter!.monthly, starter!.yearly, starter!.quotes]).toEqual([4900, 49000, '50 quotes a month'])
    expect([pro!.monthly, pro!.yearly, pro!.quotes]).toEqual([9900, 99000, '200 quotes a month'])
  })

  it('Starter says what you get; Pro says "Everything in Starter, plus" and only what it adds', () => {
    expect(starter!.buildsOn).toBeNull()
    expect(starter!.lines.map((l) => [l.label, l.live])).toEqual([
      ['Customers see your price straight away, on your website or from a link you share', true],
      ['Every customer gets their own estimate page to open, accept and come back to', true],
    ])
    expect(pro!.buildsOn).toBe('Everything in Starter, plus')
    expect(pro!.lines.map((l) => [l.label, l.live])).toEqual([
      ['Estimates under your brand alone, with no badge of ours', true],
      ['See how your estimates compare with your final invoices', true],
      ['Quotes inside WhatsApp, on your own business number', false],
      ['An app for pricing a job while you are on site', false],
    ])
    // nothing of Starter's is repeated on Pro
    for (const line of starter!.lines) expect(pro!.lines.map((l) => l.label)).not.toContain(line.label)
    // the room scan is a Business line; Business is off the site, so no card carries it
    expect(planCards().flatMap((c) => c.lines.map((l) => l.label))).not.toContain(PLAN_FEATURE_LINES.lidar_scanning!.label)
  })

  it('one component draws them on Home and on Pricing: the price with "plus tax", monthly and yearly, one button', () => {
    const cards = code(`${WEB}/components/marketing/PlanCards.tsx`)
    expect(cards).toContain('a month, {PLUS_TAX}')
    expect(cards).toContain('a year, {PLUS_TAX} (two months free)')
    expect(cards).toContain('{card.buildsOn}')
    expect(cards.match(/<Link\s+href=\{`\/signup\?plan=\$\{card\.id\}`\}/g)).toHaveLength(1)
    // two cards sit as a centred pair
    expect(cards).toContain("cards.length === 2 ? 'max-w-4xl md:grid-cols-2' : 'lg:grid-cols-3'")
    expect(cards).toContain('mx-auto grid')
    const home = code(`${WEB}/app/page.tsx`)
    expect(home).toContain('<PlanCards className="mt-10" />')
    expect(home).toContain('{PLANS_SECTION.free}')
    expect(FREE_ALLOWANCE.US!.quotes).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

describe('T-187: Pricing’s compare table is built, in the owner’s five groups', () => {
  const groups = compareGroups()

  it('Quotes, Where customers reach you, What the AI does, Your brand, Coming soon', () => {
    expect(groups.map((g) => g.title)).toEqual(['Quotes', 'Where customers reach you', 'What the AI does', 'Your brand', 'Coming soon'])
    expect(COMPARE.groups.soon).toBe(COMING_SOON)
    for (const group of groups) for (const row of group.rows) expect(row.cells, row.label).toHaveLength(2)
  })

  it('the numbers are the plans’ own, and a line a plan lacks is a dash, never a tick', () => {
    const quotes = groups.find((g) => g.id === 'quotes')!
    expect(quotes.rows[0]).toEqual({ label: 'Quotes a month', cells: ['50', '200'] })
    expect(quotes.rows.find((r) => r.label === PLAN_FEATURE_LINES.calibration_insights!.label)!.cells).toEqual([false, true])
    expect(groups.find((g) => g.id === 'brand')!.rows.find((r) => r.label === PLAN_FEATURE_LINES.custom_branding!.label)!.cells).toEqual([false, true])
  })

  it('what is not live is only in the last group, and is never a tick', () => {
    const soon = groups.find((g) => g.id === 'soon')!
    expect(soon.rows).toEqual([
      { label: 'Quotes inside WhatsApp, on your own business number', cells: [false, 'Coming soon'] },
      { label: 'An app for pricing a job while you are on site', cells: [false, 'Coming soon'] },
    ])
    const notLive = soon.rows.map((r) => r.label)
    for (const group of groups.filter((g) => g.id !== 'soon')) for (const row of group.rows) expect(notLive).not.toContain(row.label)
    // no shown plan includes the room scan, so the table has no row for it
    expect(groups.flatMap((g) => g.rows.map((r) => r.label))).not.toContain(PLAN_FEATURE_LINES.lidar_scanning!.label)
    expect(JSON.stringify(groups)).not.toMatch(/\bSMS\b|text message/i)
  })

  it('what the product does is the same on every plan, and each row is a claim with its row of the inventory', () => {
    const ai = groups.find((g) => g.id === 'ai')!
    expect(ai.rows.length).toBe(4)
    for (const row of ai.rows) {
      expect(row.cells, row.label).toEqual([true, true])
      expect(recordedClaims().get(row.label)?.length, row.label).toBeGreaterThan(0)
    }
  })

  it('the page: cards, table, billing notes, questions, in that order; the notes say the five things', () => {
    const page = code(`${WEB}/app/pricing/page.tsx`)
    const order = ['<PlanCards />', 'data-testid="compare"', 'data-testid="billing-notes"', '<Faq heading={PRICING_FAQ_HEADING}', 'data-testid="closing"']
    const at = order.map((mark) => page.indexOf(mark))
    expect(at.every((i) => i > 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(BILLING_NOTES.map((n) => n.title)).toEqual(['Billed in advance', 'Plus tax', 'Cancel any time', 'Moving to a smaller plan', 'Over your limit'])
    expect(BILLING_NOTES[3]!.text).toMatch(/starts at the end of the period you paid for/)
    expect(BILLING_NOTES[4]!.text).toMatch(/saved as leads/)
    expect(BILLING_NOTES[4]!.text).toMatch(/Nothing extra is charged/)
    // the Terms say the same about billing and cancelling
    expect(read(`${WEB}/app/terms/page.tsx`)).toContain('Paid plans are billed in advance, monthly or yearly. You can cancel at any time; access continues to the end of the paid period.')
    expect(PRICING_FAQ.map((f) => f.q)).toEqual(['Can I try it for free?', 'What counts as a quote?', 'Does the AI decide my prices?', 'When do I start paying?', 'Do I need a website?'])
  })
})

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

describe('T-187: the Features page says only what the inventory supports', () => {
  const inventory = read('Docs/design/ai-capabilities.md')
  const claims = recordedClaims()

  it('one section per thing, each with two or three lines and a picture', () => {
    expect(FEATURE_SECTIONS.map((s) => s.title)).toEqual([
      'It reads the photos and notes your customer sends.',
      'Your price list sets every price.',
      'Several services in one quote.',
      'You approve before it counts.',
      'A quote page in your brand.',
      'Share it anywhere.',
      'It flags what doesn’t add up.',
    ])
    for (const section of FEATURE_SECTIONS) {
      expect(section.lines.length, section.id).toBeGreaterThanOrEqual(2)
      expect(section.lines.length, section.id).toBeLessThanOrEqual(3)
      expect(section.screen.length, section.id).toBeGreaterThan(30)
    }
    const page = code(`${WEB}/app/features/page.tsx`)
    for (const section of FEATURE_SECTIONS) expect(page, section.id).toMatch(new RegExp(`\\n    ${section.id}: [(<]`))
    // then the three that are on the way, from plan-claims
    for (const key of ['whatsapp', 'app', 'roomScan']) expect(page).toContain(`key: '${key}'`)
    expect(page.indexOf('{FEATURE_SECTIONS.map(')).toBeLessThan(page.indexOf('data-testid="features-upcoming"'))
  })

  it('"several services in one quote" has its row, with its evidence, and is claimed as noticing and offering, never as pricing by itself', () => {
    expect(inventory).toMatch(/^\| `also-asked` \| Notices when the customer's own words ask for another of the business's services/m)
    expect(inventory).toContain('64 quotes carry more than one service')
    const line = FEATURE_SECTIONS.find((s) => s.id === 'services')!.lines[0]!
    expect(claims.get(line)).toEqual(['also-asked'])
    expect(FEATURE_SECTIONS.find((s) => s.id === 'services')!.lines.join(' ')).toMatch(/They add it with one tap/)
    // the example is two of the painting template's services, each at its own rates, added up
    const two = twoServiceExample()
    expect([two.main.serviceName, two.main.subtotal]).toEqual(['Interior Painting', 1200])
    expect([two.added.serviceName, two.added.subtotal]).toEqual(['Exterior Painting', 2300])
    expect(two.total).toBe(3500)
    expect(two.added.lines).toEqual([{ label: 'Exterior walls, 920 sq ft', amount: 2300 }])
  })

  it('asked for and not claimed: a PDF, and the AI quote checker', () => {
    const features = code(`${WEB}/lib/marketing/features-copy.ts`) + code(`${WEB}/app/features/page.tsx`)
    expect(features).not.toMatch(/\bPDFs?\b/)
    expect(FEATURE_SECTIONS.find((s) => s.id === 'page')!.title).toBe('A quote page in your brand.')
    // "flags what doesn't add up" rests on three rows the inventory lists, not on the checker
    const flags = FEATURE_SECTIONS.find((s) => s.id === 'flags')!
    expect(flags.lines.map((l) => claims.get(l))).toEqual([['photo-quality-check'], ['service-match'], ['words-against-answers']])
    expect(inventory).toMatch(/^\| `checker` \|/m)
    expect([...claims.values()].flat()).not.toContain('checker')
    expect(features).not.toMatch(/checks every quote|double-checks|reviews every quote|worth checking/i)
    expect(inventory).toContain('**Asked for in T-187 and not claimed:**')
  })

  it('no promise of accuracy and no pricing advice in any new words', () => {
    const words = [...FEATURE_SECTIONS.flatMap((s) => [s.title, ...s.lines]), ...BILLING_NOTES.map((n) => n.text), ...PRICING_FAQ.map((f) => f.a), ...FAQ.map((f) => f.a), ...upcomingFaq().map((f) => f.a), JSON.stringify(UPCOMING), ...CONTROL.points.map((p) => p.text)].join('\n')
    expect(words).not.toMatch(/\baccura\w+|\bprecis\w+|never wrong|100%|guarantee\w*|\bexact\w*|what to charge|recommend(s|ed)? (a |your )?price|price suggestion/i)
  })
})

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

describe('T-187: Home', () => {
  const home = code(`${WEB}/app/page.tsx`)

  it('the hero demo is the interior painting example, at the template’s $375 a room: the price said further down the page', () => {
    expect(HOME_EXAMPLE_TRADE).toBe('painting')
    const demo = marketingExample()
    expect([demo.serviceName, demo.question, demo.answer, demo.photo]).toEqual(['Interior Painting', 'How many rooms?', '3', null])
    expect(demo.lines).toEqual([
      { label: 'Walls & ceilings, 3 rooms', amount: 1125 },
      { label: 'Visit and setup', amount: 75 },
    ])
    expect(demo.total).toBe(1200)
    // the per-room rate in the demo is the one in "Tell it your prices": $375 per room
    const perRoom = appQuoteLines()[0]!
    expect([perRoom.name, perRoom.rate, perRoom.quantity, perRoom.unit]).toEqual(['Walls & ceilings', 375, 3, 'room'])
    expect(CONTROL.sentence[0]!.words).toBe('$375 per room,')
    expect(home).toContain('const demo = marketingExample()')
  })

  it('the third card: "Approve & send" is pressed, the card changes to its sent state, and the run stays under six seconds', () => {
    const T = DEMO_TIMELINE
    expect(T.lead).toBeLessThan(T.approve)
    expect(T.approve).toBeLessThan(T.sent)
    expect(DEMO_LENGTH_MS).toBeLessThan(6000)
    const demo = code(`${WEB}/components/marketing/home/HeroDemo.tsx`)
    // the button is pressed, then leaves; the chip and the line each change; the place says it was sent
    expect(demo).toMatch(/className="demo-press" style=\{at\(T\.approve\)\}/)
    for (const id of ['demo-lead-before', 'demo-chip-before', 'demo-approve-wrap']) expect(demo).toMatch(new RegExp(`className="demo-out[^"]*" style=\\{at\\(T\\.sent\\)\\} data-testid="${id}"`))
    for (const id of ['demo-lead-after', 'demo-chip-after']) expect(demo).toMatch(new RegExp(`className="demo-in[^"]*" style=\\{at\\(T\\.sent\\)\\} data-testid="${id}"`))
    expect(demo).toMatch(/className="demo-in [^"]*" style=\{at\(T\.sent\)\} data-testid="demo-sent"/)
    // the two states share one grid cell, so nothing changes size (transform and opacity only)
    expect(demo.match(/col-start-1 row-start-1/g)!.length).toBeGreaterThanOrEqual(6)
    // "Play again" follows
    expect(demo.indexOf('data-testid="demo-sent"')).toBeLessThan(demo.indexOf('data-testid="demo-replay"'))
    expect(HERO_DEMO_FRAMES.sentNote).toBe('Sent to the customer')
    expect(read(`${WEB}/app/(dashboard)/app/quotes/[quoteId]/page.tsx`)).toContain("'Sent to the customer'")
    expect(QUOTE_TURN_COPY.labels.waiting).toBe('Waiting for customer')
  })

  it('"Your prices. You stay in control.": two points; the second says it so anyone understands', () => {
    expect(CONTROL.points).toHaveLength(2)
    expect(CONTROL.points[1]).toEqual({
      title: 'You approve before they can accept',
      text: 'Your customer sees the price straight away. They can only accept after you approve it, and you can change anything first.',
    })
    expect(JSON.stringify(CONTROL)).not.toMatch(/Three ways to send/)
  })

  it('"Set up in minutes", step 3: the link and QR box, where else it works, and a link down to "Add it anywhere"', () => {
    expect(SETUP.steps[2]!.title).toBe('Share your link')
    expect(SETUP.elsewhere).toEqual({ website: 'On your website', link: { label: 'See every way to add it', href: '#add-it-anywhere' } })
    expect([UPCOMING.whatsapp.where, UPCOMING.app.where]).toEqual(['In your WhatsApp chat', 'On site, with the app'])
    const steps = code(`${WEB}/components/marketing/home/SetupSteps.tsx`)
    expect(steps).toContain('<LinkScreen key="link" quoteLink={quoteLink} />')
    expect(steps).toContain('{UPCOMING.whatsapp.where}')
    expect(steps).toContain('{UPCOMING.app.where}')
    expect(home).toContain('<section id={ADD_IT.id}')
    expect(`#${ADD_IT.id}`).toBe(SETUP.elsewhere.link.href)
  })

  it('"Add it anywhere": five ways, three live and two on the way; three to a row, never five across', () => {
    const add = code(`${WEB}/components/marketing/home/AddItAnywhere.tsx`)
    expect(Object.keys(ADD_IT.shown)).toEqual(['qr', 'page', 'site'])
    expect(add.match(/data-testid="add-it-item"/g)).toHaveLength(5)
    expect(add).toContain('title={UPCOMING.whatsapp.name}')
    expect(add).toContain('title={UPCOMING.app.name}')
    expect([UPCOMING.whatsapp.name, UPCOMING.app.name]).toEqual(['WhatsApp, on your own business number', 'The on-site app'])
    const css = read(`${WEB}/app/globals.css`)
    expect(css).toContain('.add-it { grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-rows: auto auto auto auto; gap: 1.25rem 2rem; }')
  })

  it('the app section: its heading, three short lines, two phones and the room scan card; every word from plan-claims', () => {
    expect(UPCOMING.app.heading).toBe('Price a job while you are standing in it.')
    expect(UPCOMING.app.lines).toHaveLength(3)
    const section = code(`${WEB}/components/marketing/home/AppSection.tsx`)
    for (const part of ['{app.heading}', '{app.lines.map(', '<AppListScreen', '<AppQuoteScreen', '<RoomScanCard />']) expect(section).toContain(part)
    expect(home.indexOf('<AddItAnywhere')).toBeLessThan(home.indexOf('<AppSection'))
    expect(home.indexOf('<AppSection')).toBeLessThan(home.indexOf('data-testid="plans"'))
  })

  it('the app’s screens say the app’s own words, and take every status, step and note from the shared functions the app calls', () => {
    const A = SCREEN_WORDS.app
    const list = read('apps/mobile/app/(tabs)/index.tsx')
    const tabs = read('apps/mobile/app/(tabs)/_layout.tsx')
    const fresh = read('apps/mobile/app/(tabs)/new.tsx')
    const quote = read('apps/mobile/app/quote/[id].tsx')
    expect(list).toContain(`<TopBar title="${A.listTitle}"`)
    expect(list).toContain(`placeholder="${A.search}"`)
    expect(tabs).toContain(`title: '${A.tabs.quotes}'`)
    expect(tabs).toContain(`title: '${A.tabs.account}'`)
    expect(fresh).toContain(`<Shell title="${A.tabs.newQuote}">`)
    expect(fresh).toContain(`<Label>${A.scanTitle}</Label>`)
    expect(fresh).toContain(`<Muted>${A.scanLead}</Muted>`)
    expect(fresh).toContain(`'${A.scanButton}'`)
    expect(quote).toContain(`'${A.priceTitle}'`)
    const screens = code(`${WEB}/components/marketing/screens/AppScreens.tsx`)
    for (const shared of ['quoteStory(', 'lineDetail(', 'sourceForBusiness(', 'certaintySentence(', 'QUOTE_TURN_COPY.pageButtons.approve', 'QUOTE_TURN_COPY.tracker.title']) expect(screens).toContain(shared)
    // no status, step name or source note is typed into the pictures
    expect(screens).not.toMatch(/Needs your approval|Waiting for customer|Approve and send|Your answer|Your fixed price/)
    // the chat's reply is the assistant's own function, word for word
    expect(screens).toContain('say.openingWithLink(')
  })

  it('the questions: centred, the two about what is not live placed after the first, and nothing missing', () => {
    expect(home).toContain('const faq = [...FAQ.slice(0, HOME_FAQ_UPCOMING_AFTER), ...upcomingFaq(), ...FAQ.slice(HOME_FAQ_UPCOMING_AFTER)]')
    expect(HOME_FAQ_UPCOMING_AFTER).toBe(1)
    expect(FAQ[0]!.q).toBe('Do I need a website?')
    expect(upcomingFaq().map((f) => f.q)).toEqual(['Can my customers get a quote in WhatsApp?', 'Is there an app?'])
    expect(FAQ.map((f) => f.q)).toContain('What happens after the 10 free quotes?')
    const faq = code(`${WEB}/components/marketing/Faq.tsx`)
    expect(faq).toContain('<h2 className="text-center')
    expect(faq).toContain('mx-auto max-w-3xl')
    // Pricing's questions are the same component
    expect(code(`${WEB}/app/pricing/page.tsx`)).toContain('<Faq heading={PRICING_FAQ_HEADING} items={PRICING_FAQ} />')
  })
})

// ---------------------------------------------------------------------------
// The footer, and the wrapping
// ---------------------------------------------------------------------------

describe('T-187: the footer', () => {
  const footer = code(`${WEB}/components/marketing/SiteFooter.tsx`)

  it('one short line with no claim in it; the message line is not repeated', () => {
    expect(FOOTER.line).toBe('Instant quotes for your customers, in your own prices.')
    expect(recordedClaims().has(FOOTER.line)).toBe(false)
    expect(footer).not.toMatch(/MESSAGE_LINE|FOOTER\.closing|FOOTER\.tagline/)
    expect(JSON.stringify(FOOTER)).not.toMatch(/\bAI\b|works out/)
  })

  it('four link columns, the support address, and who runs it, with the company number from the setting', () => {
    expect(Object.values(FOOTER.columns)).toEqual(['Product', 'Trades', 'Company', 'Legal'])
    for (const column of ['product', 'trades', 'company', 'legal']) expect(footer).toContain(`{FOOTER.columns.${column}}`)
    expect(footer).toContain('href={`mailto:${SUPPORT_EMAIL}`}')
    expect(footer).toContain('{operatorLine(process.env.NEXT_PUBLIC_COMPANY_NUMBER)}')
    expect(operatorLine('01234567')).toBe('Run by Billiom Limited, a company registered in England and Wales (company number 01234567).')
    expect(operatorLine('')).toBe('Run by Billiom Limited, a company registered in England and Wales.')
    // no company number is typed anywhere in the site's source
    expect(footer).not.toMatch(/company number \d/)
    for (const href of ['/features', '/pricing', '/demo', '/signup', '/trades', '/login', '/terms', '/privacy']) expect(footer).toContain(`href="${href}"`)
  })
})

describe('T-187: balanced wrapping on every marketing page', () => {
  it('one rule: a heading and the line under it are balanced, other text is kept from ending on a lone word', () => {
    const css = read(`${WEB}/app/globals.css`)
    expect(css).toContain('main:has(> nav[aria-label="Site"]) :is(h1, h2, h3, h4),')
    expect(css).toContain('main:has(> nav[aria-label="Site"]) :is(h1, h2, h3, h4) + p,')
    expect(css).toMatch(/\.balance \{ text-wrap: balance; \}/)
    expect(css).toContain('main:has(> nav[aria-label="Site"]) :is(p, li, blockquote, figcaption, summary, dd) { text-wrap: pretty; }')
    // every marketing page is a <main> whose first child is that navigation, so the rule reaches it
    expect(read(`${WEB}/components/marketing/SiteNav.tsx`)).toContain('aria-label="Site"')
    for (const page of ['app/page.tsx', 'app/pricing/page.tsx', 'app/features/page.tsx', 'app/trades/page.tsx', 'components/marketing/TradeLanding.tsx', 'app/terms/page.tsx', 'app/privacy/page.tsx', 'app/data-deletion/page.tsx', 'app/demo/page.tsx']) {
      expect(read(`${WEB}/${page}`), page).toMatch(/<main [^>]*>\s*<SiteNav \/>/)
    }
  })
})
