/**
 * T-154: the home page rewrite — every claim true of the live product, the
 * statistics as sourced, no grades or engine words anywhere on the marketing
 * site, the phone menu, the founder slot, and visuals priced from the packs.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SUPPORT_EMAIL, PRODUCT_NAME } from '@estimator/shared'
import { HERO, TRADES_HEADING, STATISTICS, FAQ, ADD_IT, CONTROL, HOW_IT_WORKS } from '@/lib/marketing/home-copy'
import { FOUNDER, founderReady } from '@/lib/marketing/founder'
import { FounderNote } from '@/components/marketing/FounderNote'
import { NAV_LINKS } from '@/lib/marketing/nav'
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
  'app/opengraph-image.tsx',
  'components/marketing/TradeLanding.tsx',
  'components/marketing/ProductStrip.tsx',
  'components/marketing/SiteNav.tsx',
  'components/marketing/SiteFooter.tsx',
  'lib/marketing/home-copy.ts',
  'lib/marketing/trades.ts',
  '../../../packages/shared/src/plans.ts',
]

describe('T-154: no grades, seals or engine words on the marketing site', () => {
  const banned =
    /\bgrades?\b|grade-seal|Confirmed \/ Measured \/ Concept|determinist|escalat|stronger model|senior model|against references|reference-anchored|\bexact(ly)?\b|60 seconds|under a minute|deposit|firm price|firm replacement|Start free/i

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
    expect(HERO.headline).toBe('Instant quotes on your website, in your prices.')
    expect(HERO.subline).toBe('Customers answer a few questions and send photos. They see an estimate from your prices straight away. You get the lead, and you confirm it.')
    expect(TRADES_HEADING).toBe('Ready-made templates for your trade')
  })

  it('the FAQ answers as approved', () => {
    const a = (q: string) => FAQ.find((f) => f.q === q)!.a
    expect(a('Can it quote the wrong price?')).toBe(
      'Every price comes from the prices you set. A photo or an answer can still be misread, so your customer sees an estimate, or a range and one quick question, and by default cannot accept until you have confirmed it.'
    )
    expect(a('Is my data private?')).toBe(
      'Your customers’ details and photos are visible to you and never to other businesses. Photos are stored privately and used only to prepare the estimate. Our privacy policy has the details.'
    )
    expect(a('Does it work with WordPress, Wix or Squarespace?')).toContain('a short piece of code')
    expect(ADD_IT.ways.find((w) => w.title === 'Your website')!.text).toContain('a short piece of code')
    expect(JSON.stringify({ FAQ, ADD_IT })).not.toMatch(/one line of code/i)
    expect(FAQ.map((f) => f.q)).toEqual([
      'What if I have no website?',
      'Can it quote the wrong price?',
      'Can I approve before the customer accepts?',
      'Does it work with WordPress, Wix or Squarespace?',
      'What does the customer see?',
      'What happens after 10 free quotes?',
      'Is my data private?',
    ])
  })

  it('whenever the owner confirms "every" estimate, it says "by default" (a service can send on its own)', () => {
    const texts = [...FAQ.map((f) => f.a), ...CONTROL.points.map((p) => p.text), ...HOW_IT_WORKS.map((s) => s.text), ...TRADES.flatMap((t) => [t.lede, ...t.features.map((f) => f.text), ...t.howPriced.map((h) => h.text)])]
    for (const t of texts) {
      if (/\b(check|confirm|approve)s?\b[^.]*\bevery\b|\bevery (estimate|quote)\b[^.]*\b(check|confirm|approve)/i.test(t)) expect(t).toMatch(/by default/)
    }
    // the three sending choices are stated wherever confirming is promised
    expect(CONTROL.points.map((p) => p.text).join(' ')).toMatch(/send automatically/i)
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
    expect(SUPPORT_EMAIL).toBe('')
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
    expect(marketingExample().total).toBe(375) // the home page: the demo's spring pair
    expect(marketingExample('water-heaters').total).toBe(2150)
    expect(marketingExample('painting').total).toBe(825)
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
    for (const f of ['app/page.tsx', 'components/marketing/TradeLanding.tsx']) {
      const hrefs = [...code(f).matchAll(/<Link href="([^"]+)"[^>]*min-h-\[48px\]/g)].map((m) => m[1])
      expect(hrefs.length).toBeGreaterThanOrEqual(2)
      for (const h of hrefs) expect(['/signup', '/demo']).toContain(h)
    }
    const home = code('app/page.tsx')
    expect(home).toMatch(/href="\/signup" className=\{primaryButton\}/)
    expect(home).toMatch(/href="\/demo" className=\{secondaryButton\}/)
  })

  it('the page title, description and social image carry the new message', () => {
    expect(code('app/page.tsx')).toMatch(/title: PAGE_META\.title/)
    expect(existsSync(join(ROOT, WEB, 'app/opengraph-image.tsx'))).toBe(true)
    expect(code('app/opengraph-image.tsx')).toContain('HERO.headline')
    expect(PRODUCT_NAME).toBe('Aistimator')
  })
})
