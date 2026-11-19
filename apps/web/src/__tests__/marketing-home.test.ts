/**
 * T-154: the home page rewrite — every claim true of the live product, the
 * statistics as sourced, no grades or engine words anywhere on the marketing
 * site, the phone menu, the founder slot, and visuals priced from the packs.
 * T-155: the polish after review (hero small line, no time claim, the phone
 * header button, a full-screen phone menu, tighter frames, the social image).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SUPPORT_EMAIL, PRODUCT_NAME, freeOfferLabel } from '@qolumns/shared'
import { HERO, OTHER_TRADES, STATISTICS, FAQ, ADD_IT, CONTROL, SETUP } from '@/lib/marketing/home-copy'
import { FOUNDER, founderReady } from '@/lib/marketing/founder'
import { FounderNote } from '@/components/marketing/FounderNote'
import { NAV_LINKS, HEADER_SHORT_CTA } from '@/lib/marketing/nav'
import { MobileMenu } from '@/components/marketing/MobileMenu'
import { lockPageScroll } from '@/lib/marketing/scroll-lock'
import { marketingExample, EXAMPLE_TRADES } from '@/lib/marketing/examples'
import { TRADES, templateTrades, tradeHref } from '@/lib/marketing/trades'
import { listPacks } from '@/lib/vertical-packs'

const ROOT = join(__dirname, '..', '..', '..', '..')
const WEB = 'apps/web/src/'
/** Source without comments: rules written in comments aren't claims */
const code = (file: string) =>
  readFileSync(join(ROOT, WEB, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const MARKETING_FILES = [
  'app/page.tsx',
  'app/features/page.tsx',
  'app/pricing/page.tsx',
  'app/trades/page.tsx',
  'app/painting/page.tsx',
  'app/terms/page.tsx',
  'app/privacy/page.tsx',
  'app/data-deletion/page.tsx', // T-181
  'app/opengraph-image.tsx',
  'components/marketing/TradeLanding.tsx',
  'components/marketing/ProductStrip.tsx',
  'components/marketing/SiteNav.tsx',
  'components/marketing/SiteFooter.tsx',
  'lib/marketing/home-copy.ts',
  'lib/marketing/trades.ts',
  // T-167: the copy files and screens added with "What it notices", Features and the trade pages
  'lib/marketing/features-copy.ts',
  'lib/marketing/site-copy.ts',
  'lib/marketing/screen-words.ts',
  'components/marketing/home/WhatItNotices.tsx',
  'components/marketing/screens/ProductScreens.tsx',
  '../../../packages/shared/src/plans.ts',
]

describe('T-154: no grades, seals or engine words on the marketing site', () => {
  const banned =
    /\bgrades?\b|grade-seal|Confirmed \/ Measured \/ Concept|determinist|escalat|stronger model|senior model|against references|reference-anchored|\bexact(ly)?\b|60 seconds|under a minute|deposit|firm price|firm replacement|Start free|in a minute/i

  it.each(MARKETING_FILES)('%s', (file) => {
    const match = banned.exec(code(file))
    expect(match?.[0] ?? null).toBeNull()
  })

  it('the old speed-to-lead block and the grade seal component are gone', () => {
    for (const f of ['app/page.tsx', 'components/marketing/TradeLanding.tsx']) expect(code(f)).not.toMatch(/40%|95%|21×/)
    expect(existsSync(join(ROOT, WEB, 'components/marketing/MiniEstimate.tsx'))).toBe(false)
  })

  it('no feature that isn’t live for a new business: text-message quoting, the on-site app', () => {
    expect(code('lib/marketing/trades.ts')).not.toMatch(/Text-message quoting|On-site app|by SMS/)
    expect(code('app/features/page.tsx')).not.toMatch(/SMS|text-message intake/i)
  })
})

describe('T-154: the approved copy', () => {
  it('the hero says what it is', () => {
    expect(HERO.headline).toBe('Instant quotes for your customers, in your prices.')
    // T-167, reworded in T-168 (the owner's wording): what the AI does in one plain sentence, then where the price comes from
    expect(HERO.subline).toBe('The AI reads what your customer tells you and the photos they send, and works out the job. The price comes from your own price list, and you confirm it.')
    // T-167: the trades row and its heading are gone; the links sit in step 1 of "Set up in minutes", ending with this pill
    expect(OTHER_TRADES).toBe('Other trades: describe your prices in plain English')
  })

  it('T-155: the small line under the hero buttons doesn’t contradict "on your website"', () => {
    // T-181: any business (it named contractors and home-service businesses only); T-188: the words are dropped
    expect(HERO.smallLine).toBe('For any business that quotes for its work. No website? Use your quote link.')
    expect(code('app/page.tsx')).toContain('{HERO.smallLine}')
    // trade pages keep their own line (T-167: it carries the message; its words live in site-copy.ts)
    expect(code('components/marketing/TradeLanding.tsx')).toContain('{TRADE_SMALL_LINE}')
    expect(code('lib/marketing/site-copy.ts')).toContain('The AI works out the job. Your prices work out the cost. No website needed.')
  })

  it('T-155: no time promise in the "add it" heading', () => {
    expect(ADD_IT.heading).toBe('Add it anywhere')
    expect(code('app/page.tsx')).not.toMatch(/in a minute/i)
  })

  it('the FAQ answers as approved', () => {
    const a = (q: string) => FAQ.find((f) => f.q === q)!.a
    expect(a('Can it quote the wrong price?')).toBe(
      // T-187: "can only accept after you approve it", the words the page now uses for it everywhere
      'Every price comes from the prices you set. A photo or an answer can still be misread, so your customer sees an estimate, or a range and one quick question, and can only accept after you approve it.'
    )
    expect(a('Is my data private?')).toBe(
      'Your customers’ details and photos are visible to you and never to other businesses. Photos are stored privately and used only to prepare the estimate. Our privacy policy has the details.'
    )
    expect(a('Does it work with WordPress, Wix or Squarespace?')).toContain('a short piece of code')
    expect(JSON.stringify({ FAQ, ADD_IT })).not.toMatch(/one line of code/i)
    // T-187: reviewed against the new page. The two questions about what is not live yet (WhatsApp, the
    // app) are not in this list: they come from plan-claims, beside their flags (site-t187.test.ts)
    expect(FAQ.map((f) => f.q)).toEqual([
      'Do I need a website?',
      'Can it quote the wrong price?',
      'Can I approve before the customer accepts?',
      'Does it work with WordPress, Wix or Squarespace?',
      'What does the customer see?',
      'What happens after the 10 free quotes?',
      'Is my data private?',
    ])
  })

  it('whenever the owner confirms "every" estimate, it says "by default" (a service can send on its own)', () => {
    const texts = [...FAQ.map((f) => f.a), ...CONTROL.points.map((p) => p.text), ...SETUP.steps.map((s) => s.text), ...TRADES.flatMap((t) => [t.lede, ...t.features.map((f) => f.text), ...t.howPriced.map((h) => h.text)])]
    for (const t of texts) {
      if (/\b(check|confirm|approve)s?\b[^.]*\bevery\b|\bevery (estimate|quote)\b[^.]*\b(check|confirm|approve)/i.test(t)) expect(t).toMatch(/by default/)
    }
    // T-187 (the owner's review): "Three ways to send, per service" left the "Your prices" section. That a
    // service can hold its price, or send without waiting, is still said on the page: in the questions.
    expect(CONTROL.points.map((p) => p.title)).toEqual(['Only your prices', 'You approve before they can accept'])
    expect(FAQ.find((f) => f.q === 'Can I approve before the customer accepts?')!.a).toMatch(/hold its price until you approve, or send without waiting for you/)
  })

  it('the privacy policy says the same as the FAQ', () => {
    const privacy = code('app/privacy/page.tsx')
    expect(privacy).toContain('Photos are used only to prepare the estimate.')
    expect(privacy).toContain('Each business sees only its own customers’ details and photos; no other business can.')
    expect(privacy).not.toMatch(/to improve the accuracy of the business’s own future estimates\. We/)
  })
})

describe('T-154: the statistics, as sourced', () => {
  it('three, each linked to its source', () => {
    expect(STATISTICS.map((s) => s.url)).toEqual([
      'https://achrnews.com/articles/163836',
      'https://www.roofingcontractor.com/articles/100649-2025-homeowner-roofing-survey-tracking-the-journey',
      'https://www.usemantel.com/blog/homeowner-shopping-attitudes-report-2025',
    ])
    for (const s of STATISTICS) expect(s.text.startsWith(s.figure) || s.text.length > 0).toBe(true)
  })

  it('in the sources’ own words', () => {
    const [achr, roofing, mantel] = STATISTICS
    expect(achr!.figure).toBe('70%')
    expect(achr!.text).toContain('more likely to call an HVAC contractor who is transparent on pricing')
    expect(achr!.text).toContain('Only 31% of HVAC contractors surveyed feature pricing on their websites')
    expect(roofing!.figure).toBe('78%')
    expect(roofing!.text).toContain('more likely to call a roofing contractor that offers pricing on its website, up from 66% in 2023')
    expect(mantel!.figure).toBe('69%')
    expect(mantel!.text).toBe('search for pricing online, but only 15% find it clear enough to estimate costs.')
    expect(mantel!.source).toContain('422 homeowners, fall 2025')
  })

  it('the home page links every one', () => {
    const home = code('app/page.tsx')
    expect(home).toMatch(/STATISTICS\.map[\s\S]{0,600}href=\{s\.url\}/)
  })
})

describe('T-154: the founder section', () => {
  it('renders nothing while the content file is empty', () => {
    expect(FOUNDER.name).toBe('')
    // T-174: the address exists; the section still waits for a name and a note
    expect(SUPPORT_EMAIL).toBe('hello@qolumns.com')
    expect(founderReady()).toBe(false)
    expect(renderToStaticMarkup(createElement(FounderNote))).toBe('')
  })

  it('renders once a name and a note are filled in; the email shows only when set', () => {
    const content = { name: 'Pat Founder', role: 'Founder', note: 'I built this after losing jobs to slow quotes.', photo: '', supportEmail: '' }
    const html = renderToStaticMarkup(createElement(FounderNote, { content }))
    expect(html).toContain('Who is behind this')
    expect(html).toContain('Pat Founder')
    expect(html).not.toContain('mailto:')
    expect(renderToStaticMarkup(createElement(FounderNote, { content: { ...content, supportEmail: 'help@example.com' } }))).toContain('mailto:help@example.com')
    expect(founderReady({ ...content, note: '  ' })).toBe(false)
  })
})

describe('T-154: visuals priced from the packs', () => {
  it('every trade’s example resolves from its pack’s template rates', () => {
    for (const t of EXAMPLE_TRADES) {
      const ex = marketingExample(t)
      expect(ex.total).toBeGreaterThan(0)
      expect(ex.total).toBe(Math.max(ex.lines.reduce((s, l) => s + l.amount, 0), 0))
    }
    // T-187: the home page's demo is interior painting (it was the garage door spring pair, $375):
    // three rooms at the template's $375 a room, and its visit fee
    expect(marketingExample().serviceName).toBe('Interior Painting')
    expect(marketingExample().total).toBe(1200)
    expect(marketingExample('garage-doors').total).toBe(375)
    expect(marketingExample('water-heaters').total).toBe(2150)
    // T-181: three rooms, as in the customer's message on Home ($75 + 3 × $375); it was two rooms, $825
    expect(marketingExample('painting').total).toBe(1200)
    expect(marketingExample('painting').lines.map((l) => l.label)).toContain('Walls & ceilings, 3 rooms')
    expect(marketingExample('painting').answer).toBe('3')
  })

  it('every trade page has its own example', () => {
    for (const t of TRADES) expect(EXAMPLE_TRADES).toContain(t.slug)
  })

  it('the trades row lists every US template, in the pack registry’s order, each linking to its page', () => {
    const ids = listPacks('US').filter((p) => p.region === 'US').map((p) => p.id)
    const row = templateTrades(ids)
    expect(row).toHaveLength(ids.length)
    expect(row.map(tradeHref)).toContain('/painting')
    expect(row.map(tradeHref)).toContain('/trades/hvac')
  })
})

describe('T-154: phone menu, buttons, metadata', () => {
  it('the menu has Features, Pricing, Trades, the demo and Log in', () => {
    expect(NAV_LINKS.map((l) => [l.label, l.href])).toEqual([
      ['Features', '/features'],
      ['Pricing', '/pricing'],
      ['Trades', '/trades'],
      ['Try it as a customer', '/demo'],
      ['Log in', '/login'],
    ])
    expect(code('components/marketing/SiteNav.tsx')).toContain('<MobileMenu />')
  })

  it('every primary button leads to signup or the demo', () => {
    // T-167: the trade pages' buttons come from lib/marketing/cta.ts too (48 px tall, there);
    // the yellow one is the main call to action: the hero's and the closing band's
    const tradePage = code('components/marketing/TradeLanding.tsx')
    const trade = [...tradePage.matchAll(/<Link href="([^"]+)" className=\{(?:`\$\{)?(?:MAIN_CTA|QUIET_BUTTON)/g)].map((m) => m[1])
    expect(trade).toEqual(['/signup', '/demo', '/signup'])
    expect([...tradePage.matchAll(/<Link href="([^"]+)" className=\{(?:`\$\{)?MAIN_CTA/g)].map((m) => m[1])).toEqual(['/signup', '/signup'])
    // T-165: the home page's buttons come from lib/marketing/cta.ts. The yellow
    // one (MAIN_CTA) is the main call to action: the hero's and the closing band's.
    const home = code('app/page.tsx')
    expect([...home.matchAll(/<Link href="([^"]+)" className=\{MAIN_CTA\}/g)].map((m) => m[1])).toEqual(['/signup', '/signup'])
    expect(home).toMatch(/href="\/demo" className=\{QUIET_BUTTON\}/)
    expect(code('lib/marketing/cta.ts')).toMatch(/const BASE = '[^']*min-h-\[48px\]/)
  })

  it('the page title, description and social image carry the new message', () => {
    expect(code('app/page.tsx')).toMatch(/title: PAGE_META\.title/)
    expect(existsSync(join(ROOT, WEB, 'app/opengraph-image.tsx'))).toBe(true)
    expect(code('app/opengraph-image.tsx')).toContain('HERO.headline')
    expect(PRODUCT_NAME).toBe('Qolumns')
  })
})

describe('T-155, T-165: the header button', () => {
  it('says only "Try it free", at every width (T-165; it was the full offer from md up)', () => {
    expect(HEADER_SHORT_CTA).toBe('Try it free')
    const nav = code('components/marketing/SiteNav.tsx')
    expect(nav).toMatch(/data-testid="nav-signup"\s*>\s*\{HEADER_SHORT_CTA\}\s*<\/Link>/)
    expect(nav).not.toContain('freeOfferLabel')
    expect(nav).not.toContain('md:hidden')
    // one line, never wrapped into a two-line pill
    expect(nav).toMatch(/href="\/signup"\s+className="[^"]*whitespace-nowrap/)
    expect(freeOfferLabel()).toBe('Try it free: 10 quotes, no card')
  })

  it('in-page buttons keep the full offer', () => {
    for (const f of ['app/page.tsx', 'components/marketing/TradeLanding.tsx']) {
      expect(code(f)).toContain('{freeOfferLabel()}')
      expect(code(f)).not.toContain('HEADER_SHORT_CTA')
    }
  })
})

describe('T-155: the open phone menu', () => {
  const html = renderToStaticMarkup(createElement(MobileMenu, { defaultOpen: true }))
  const panel = /<div[^>]*data-testid="site-menu"[^>]*>/.exec(html)?.[0] ?? ''

  it('covers the whole screen, opaque and above the sticky header, as a modal', () => {
    expect(panel).toMatch(/\bfixed\b/)
    expect(panel).toMatch(/\binset-0\b/)
    expect(panel).toMatch(/\bbg-background\b/) // opaque: nothing of the page shows through
    expect(panel).toMatch(/\bz-50\b/) // the header is z-40
    expect(code('components/marketing/SiteNav.tsx')).toMatch(/sticky top-0 z-40/)
    expect(panel).toContain('role="dialog"')
    expect(panel).toContain('aria-modal="true"')
  })

  it('has the five links, then one sign-up button, and an X', () => {
    const labels = [...html.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((m) => m[1])
    expect(labels).toEqual(['Features', 'Pricing', 'Trades', 'Try it as a customer', 'Log in', 'Try it free: 10 quotes, no card'])
    expect(html).toMatch(/data-testid="site-menu-signup"/)
    expect(html).toContain('aria-label="Close menu"')
  })

  it('locks the page behind it from scrolling, and puts it back on close', () => {
    const html_ = { style: { overflow: '', overscrollBehavior: '' } }
    const body = { style: { overflow: 'auto', overscrollBehavior: '' } }
    const unlock = lockPageScroll(html_, body)
    expect([html_.style.overflow, body.style.overflow]).toEqual(['hidden', 'hidden'])
    expect([html_.style.overscrollBehavior, body.style.overscrollBehavior]).toEqual(['none', 'none'])
    unlock()
    expect([html_.style.overflow, body.style.overflow]).toEqual(['', 'auto'])
    // the menu takes the lock while open and releases it in the effect's clean-up
    const menu = code('components/marketing/MobileMenu.tsx')
    expect(menu).toMatch(/if \(!open\) return\s+const unlock = lockPageScroll\(document\.documentElement, document\.body\)/)
    expect(menu).toMatch(/return \(\) => \{\s+unlock\(\)/)
  })

  it('closes on a link, the X and Escape, and returns focus to the menu button', () => {
    const menu = code('components/marketing/MobileMenu.tsx')
    expect(menu).toMatch(/e\.key === 'Escape'[\s\S]{0,60}close\(\)/)
    expect(menu).toMatch(/data-testid="site-menu-close"/)
    expect((menu.match(/onClick=\{close\}/g) ?? []).length).toBe(1) // the X
    expect((menu.match(/onClick=\{\(\) => onLink\(/g) ?? []).length).toBe(2) // each link, the sign-up button
    // focus back on the menu button: after the X or Escape, and on the next page after a link
    expect(menu).toMatch(/const close = useCallback\(\(\) => \{[\s\S]{0,200}buttonRef\.current\?\.focus\(\)/)
    expect(menu).toMatch(/if \(!focusButtonOnMount\) return[\s\S]{0,80}buttonRef\.current\?\.focus\(\)/)
  })
})

describe('T-155: the product frames and the social image', () => {
  it('frames fill their column (no h-full overflow) and keep the button under the content', () => {
    const strip = code('components/marketing/ProductStrip.tsx')
    expect(strip).not.toContain('h-full')
    expect(strip).toMatch(/<figure className="flex [^"]*flex-col/)
  })

  it('the social image has no yellow rule beside the button', () => {
    expect(code('app/opengraph-image.tsx')).not.toMatch(/#DCAF3E/i)
  })
})

describe('T-155: features promises match what is live (item 7 decision)', () => {
  // T-167: the Features page's words moved to features-copy.ts, and each step shows its real screen
  // in place of its four text boxes, so the boxes' lines ("Estimate page in your branding", …) are gone
  const features = code('app/features/page.tsx') + code('lib/marketing/features-copy.ts')

  it('T-187: one section per thing a business cares about (it was T-167’s five steps); no claim that is not live', () => {
    for (const id of ['photos', 'prices', 'services', 'approve', 'page', 'share', 'flags']) expect(features).toContain(`id: '${id}'`)
    // "Learn: your corrections improve the next estimate" was true only of confirmed photo measurements
    expect(features).not.toMatch(/Learns? from|corrections improve|which services win work and where requests stall/)
    // the chat form of the request is not offered to businesses (a WhatsApp chat is another thing, and is marked)
    expect(features).not.toMatch(/chat form|form or a chat|step-by-step form/i)
    expect(code('app/pricing/page.tsx')).not.toMatch(/AI chat/)
    // the price sentence matches Home's: two prices, no minimum
    expect(features).not.toMatch(/minimum job/i)
    // every section has its picture: one component draws a section, and it always draws the screen
    const page = code('app/features/page.tsx')
    expect((page.match(/testId="feature-screen"/g) ?? []).length).toBe(1)
    expect(page).toContain('{pictures[section.id]}')
    expect(page).toContain('{item.picture}')
  })

  it('no PDF, reminder, price-comparison or every-quantity claim on the marketing pages', () => {
    const pages = ['app/page.tsx', 'app/features/page.tsx', 'lib/marketing/features-copy.ts', 'lib/marketing/site-copy.ts', 'app/pricing/page.tsx', 'app/trades/page.tsx', 'app/painting/page.tsx', 'components/marketing/TradeLanding.tsx', 'components/marketing/ProductStrip.tsx', 'lib/marketing/home-copy.ts', 'lib/marketing/trades.ts']
    for (const f of pages) {
      expect(code(f), f).not.toMatch(/\bPDFs?\b|remind|price comparison|compare with similar|anonymi[sz]ed|every quantity was worked out|working visible/i)
    }
    expect(code('lib/marketing/trades.ts')).toContain('See the working behind every sent estimate.')
  })
})
