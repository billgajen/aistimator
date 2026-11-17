/**
 * T-167: the site says only what the AI does today.
 *
 * `Docs/design/ai-capabilities.md` lists what the AI really does, from the
 * code and from what the pipeline has produced. Every marketing sentence that
 * says what the product reads, measures, notices or works out is written
 * through `says(…)` (lib/marketing/ai-claims.ts), naming the rows it rests on.
 * This test fails when:
 *   - a sentence in a marketing copy file reads like such a claim and was not
 *     written through `says`;
 *   - a claim names a row the inventory does not list as claimable;
 *   - a trade page claims something the inventory does not give that trade;
 *   - the word "AI" is typed on a public page outside the copy files;
 *   - a product screen shown on a marketing page says words the product does not.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { findConfidenceLanguage } from '@qolumns/shared'
import { CAPABILITIES, CLAIM_WORDS, NOT_YET_ON_A_PAGE, recordedClaims, type Capability } from '@/lib/marketing/ai-claims'
import * as homeCopy from '@/lib/marketing/home-copy'
import * as featuresCopy from '@/lib/marketing/features-copy'
import * as siteCopy from '@/lib/marketing/site-copy'
import * as tradesCopy from '@/lib/marketing/trades'
import { TRADES } from '@/lib/marketing/trades'
import { SCREEN_WORDS } from '@/lib/marketing/screen-words'
import { EXAMPLE_TRADES, marketingExample } from '@/lib/marketing/examples'
import { HERO_DEMO, MESSAGE_LINE, NOTICES } from '@/lib/marketing/home-copy'
import { DEMO_TIMELINE, DEMO_LENGTH_MS } from '@/components/marketing/home/HeroDemo'

const ROOT = join(__dirname, '..', '..', '..', '..')
const SRC = join(ROOT, 'apps/web/src')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
/** Source without comments: a rule written in a comment is not a claim */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

// ---------------------------------------------------------------------------
// The inventory, as written
// ---------------------------------------------------------------------------
const inventory = read('Docs/design/ai-capabilities.md')
const section = (number: number) => {
  const start = inventory.indexOf(`\n## ${number}. `)
  const end = inventory.indexOf('\n## ', start + 1)
  expect(start, `section ${number}`).toBeGreaterThan(0)
  return inventory.slice(start, end === -1 ? undefined : end)
}
const idsIn = (text: string) => [...text.matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1]!)
const claimable = [...idsIn(section(1)), ...idsIn(section(2)), ...idsIn(section(3))]
const doNotClaim = idsIn(section(4))
/** Section 5: which trade page may say it reads a label or measures from photos */
const byTrade = new Map(
  [...section(5).matchAll(/^\| ([A-Z][A-Za-z ]+) \| (yes|no)[^|]*\| (yes|no)[^|]*\|/gm)].map((m) => [m[1]!.trim(), { label: m[2] === 'yes', measure: m[3] === 'yes' }])
)

/** Every string a copy module exports, however deep */
function strings(value: unknown, into: string[] = []): string[] {
  if (typeof value === 'string') into.push(value)
  else if (Array.isArray(value)) for (const item of value) strings(item, into)
  else if (value && typeof value === 'object') for (const item of Object.values(value)) strings(item, into)
  return into
}
const COPY = { 'home-copy.ts': homeCopy, 'features-copy.ts': featuresCopy, 'site-copy.ts': siteCopy, 'trades.ts': tradesCopy }

/**
 * Sentences that match the claim words and are not claims about the product's
 * working. Each is here by name, with why.
 */
const NOT_CLAIMS = new Map<string, string>([
  ['Read the privacy policy', 'a link to a page'],
  ['Read the job', 'the name of step 02; its headline and body are the claims'],
  ['read', 'the id of step 02, not text on the page'],
  ['Does the AI decide my prices?', 'a question on Pricing; its answer is the claim'],
  ['Model and size, read from a photo', 'a heading (T-174, the owner’s words); the sentence under it is the claim'],
  ['Walls, measured from photos', 'a heading; the sentence under it is the claim'],
  ['What it notices', 'a section heading'],
  ['It reads the label', 'a step title; the sentence under it is the claim'],
  ['It reads the rating plate', 'a step title; the sentence under it is the claim'],
  ['It reads the panel label', 'a step title; the sentence under it is the claim'],
])
/** A screen-reader description of a picture describes the picture; the claim is the sentence beside it */
const isScreenDescription = (text: string) => /^(The |A |An |Part of )/.test(text) && /(screen|form|estimate|photo|question|breakdown|dashboard|page)/i.test(text) && !/\bAI\b/.test(text)

describe('T-167: the inventory and the code agree on what may be claimed', () => {
  it('the claimable rows of ai-capabilities.md are the capabilities the copy may name', () => {
    expect([...claimable].sort()).toEqual([...CAPABILITIES].sort())
    expect(new Set(claimable).size).toBe(claimable.length)
  })

  it('nothing on the do-not-claim list is claimable', () => {
    expect(doNotClaim).toEqual(expect.arrayContaining(['checker', 'cross-service-suggestions', 'learning-from-edits', 'inventory-from-photos', 'chat-form', 'whatsapp-conversation']))
    for (const id of doNotClaim) expect(CAPABILITIES as readonly string[], id).not.toContain(id)
  })

  it('section 5 covers every trade page', () => {
    expect([...byTrade.keys()].sort()).toEqual(TRADES.map((t) => t.label).sort())
    expect(byTrade.get('Water heaters')).toEqual({ label: true, measure: false })
    expect(byTrade.get('Painting')).toEqual({ label: false, measure: true })
    expect(byTrade.get('Plumbing')).toEqual({ label: false, measure: false })
  })
})

describe('T-167: every marketing claim has a matching entry in the inventory', () => {
  const claims = recordedClaims()

  it.each(Object.keys(COPY))('%s: a sentence that says what the product reads, measures or works out is written through says()', (file) => {
    const unregistered = strings(COPY[file as keyof typeof COPY])
      .filter((text) => CLAIM_WORDS.test(text))
      .filter((text) => !claims.has(text) && !NOT_CLAIMS.has(text) && !isScreenDescription(text))
    expect(unregistered).toEqual([])
  })

  it('every claim names rows the inventory lists as claimable, and none it holds back', () => {
    expect(claims.size).toBeGreaterThan(20)
    for (const [text, capabilities] of claims) {
      expect(capabilities.length, text).toBeGreaterThan(0)
      for (const capability of capabilities) {
        expect(claimable, `${capability} ← ${text}`).toContain(capability)
        expect(NOT_YET_ON_A_PAGE, `${capability} ← ${text}`).not.toContain(capability)
      }
    }
  })

  it('a claim that says "AI" names something the AI does, not only the pricing engine', () => {
    const aiRows: Capability[] = idsIn(section(1)).concat(idsIn(section(2))) as Capability[]
    for (const [text, capabilities] of claims) {
      if (!/\bAI\b/.test(text)) continue
      // a sentence that says only what the AI does not do ("never from the AI") rests on the pricing engine alone
      if (/never (from )?the AI/.test(text)) continue
      expect(capabilities.some((c) => aiRows.includes(c)), text).toBe(true)
    }
  })

  it('the test would catch an unregistered claim', () => {
    const invented = 'The AI recognises every appliance from a single photo.'
    expect(CLAIM_WORDS.test(invented)).toBe(true)
    expect(claims.has(invented)).toBe(false)
    expect(NOT_CLAIMS.has(invented) || isScreenDescription(invented)).toBe(false)
  })
})

describe('T-167: each trade page claims only what the AI does for that trade', () => {
  const claims = recordedClaims()

  it.each(TRADES.map((t) => [t.label, t] as const))('%s', (label, trade) => {
    const allowed = byTrade.get(label)!
    const claimed = new Set(strings(trade).flatMap((text) => [...(claims.get(text) ?? [])]))
    expect(claimed.has('label-reading'), 'label-reading').toBe(allowed.label)
    expect(claimed.has('photo-measurement'), 'photo-measurement').toBe(allowed.measure)
    // a reading can only be confirmed where there is a reading
    if (claimed.has('confirm-question')) expect(allowed.label || allowed.measure).toBe(true)
    // the page shows the reading only where its template reads a label, and the measurement only where it measures
    const example = marketingExample(trade.slug)
    expect(Boolean(example.reading), 'the template reads a label').toBe(allowed.label)
    expect(Boolean(example.measured), 'the template measures from photos').toBe(allowed.measure)
    const shows = trade.howPriced.map((step) => step.shows)
    expect(shows.includes('question') || shows.includes('label')).toBe(allowed.label)
    expect(shows.includes('takeoff')).toBe(allowed.measure)
    // and never the other trades' words
    const words = strings(trade).join(' ')
    if (!allowed.label) expect(words).not.toMatch(/rating plate|tank label|panel label|\bread(s)? (off|from)\b/i)
    if (!allowed.measure) expect(words).not.toMatch(/wall area|from (the |their |your customer’s )?photos/i)
  })

  it('what each label trade reads comes from its own template', () => {
    expect(marketingExample('water-heaters').reading).toEqual({ value: '50 gal', readFrom: 'the tank\'s rating label' })
    expect(marketingExample('hvac').reading?.value).toBe('3 ton')
    expect(marketingExample('hvac').reading?.readFrom).toMatch(/rating plate/)
    expect(marketingExample('electrical').reading?.value).toBe('200 A')
    expect(marketingExample('electrical').reading?.readFrom).toMatch(/panel/)
    for (const trade of EXAMPLE_TRADES) {
      const example = marketingExample(trade)
      expect(example.form.question.length, trade).toBeGreaterThan(5)
      expect(example.priceList.length, trade).toBeGreaterThan(0)
    }
  })

  it('painting: the measured wall and the extra are the template’s own, at its prices', () => {
    const painting = marketingExample('painting')
    expect(painting.measured).toEqual({ item: 'Exterior walls', quantity: 920, unit: 'sqft', rate: 2.5, amount: 2300 })
    expect(painting.extra).toEqual({ label: 'Trim, doors & baseboards', amount: 200, phrase: 'and the trim too', service: 'Interior Painting' })
  })
})

describe('T-167: the message, the demo beat and "What it notices"', () => {
  it('the message line, as the owner wrote it', () => {
    expect(MESSAGE_LINE).toBe('The AI works out the job. Your prices work out the cost.')
    expect(code('apps/web/src/app/page.tsx')).toContain('{MESSAGE_LINE}')
    expect(featuresCopy.FEATURES_HERO.headline).toBe(MESSAGE_LINE)
    expect(siteCopy.TRADE_SMALL_LINE.startsWith(MESSAGE_LINE)).toBe(true)
  })

  it('four examples, each beside a real screen, before "Your prices"', () => {
    // T-173 (the owner's order): what the customer wrote, what the photos show (the walls and the
    // label are its two examples), an extra they mention, then the question
    expect(NOTICES.examples.map((e) => e.id)).toEqual(['words', 'photos', 'extra', 'range'])
    expect(NOTICES.examples.map((e) => e.title)).toEqual([
      'What your customer wrote',
      'What the photos show',
      'Something extra they mention',
      'When it can’t tell, it asks',
    ])
    const photos = NOTICES.examples[1]
    expect(photos.parts.map((p) => p.title)).toEqual(['Walls, measured from photos', 'Model and size, read from a photo'])
    expect(photos.parts[0].note).toBe('It’s an estimate. Your customer checks it and you confirm the price.')
    expect(NOTICES.examples[2].text).toBe('When they mention something extra, it adds your line for it, at your price.')
    expect(NOTICES.examples[3].text).toBe('Your customer sees a range and one quick question. Their answer sets the estimate, from your prices.')
    // no accuracy figure anywhere in the section
    expect(JSON.stringify(NOTICES)).not.toMatch(/\d\s?%|accurate|accuracy|never wrong/i)
    const section = code('apps/web/src/components/marketing/home/WhatItNotices.tsx')
    for (const screen of ['<UnderstoodScreen', '<QuestionScreen', '<TakeoffScreen', '<LedgerScreen', '<RangeScreen']) expect(section).toContain(screen)
    // no icon stands in for a screen
    expect(section).not.toMatch(/<svg|lucide|Icon\b/)
    const home = code('apps/web/src/app/page.tsx')
    expect(home.indexOf('data-testid="notices"')).toBeLessThan(home.indexOf('data-testid="control"'))
    // Home keeps its one moment (the price sentence): this section does not move
    expect(section).not.toMatch(/demo-in|animate-|useEffect|IntersectionObserver/)
  })

  // T-168: the label-reading step left the hero demo (three frames of one height again). The AI's reading is
  // shown in "What it notices", which is where the question and the customer's "Yes" now live.
  it('the reading is shown in "What it notices", not in the hero demo', () => {
    const T = DEMO_TIMELINE
    expect(Object.keys(T)).toEqual(['answer', 'ask', 'tape', 'lines', 'total', 'lead'])
    expect(T.tape).toBeLessThan(T.total)
    // system.md: the whole run is under six seconds
    expect(DEMO_LENGTH_MS).toBeLessThan(6000)
    const demo = code('apps/web/src/components/marketing/home/HeroDemo.tsx')
    expect(demo).not.toContain('QuestionScreen')
    expect(code('apps/web/src/components/marketing/home/WhatItNotices.tsx')).toContain('<QuestionScreen')
    // the owner left the "What we saw" detail line out of the marketing screens
    expect(code('apps/web/src/components/marketing/screens/ProductScreens.tsx')).not.toMatch(/What we saw/)
    // the reading is the water heater template's own, and the range is what the product returned for the sample label
    expect(marketingExample(HERO_DEMO.trade).reading?.value).toBe('50 gal')
    expect(HERO_DEMO.rangeBeforeConfirming).toEqual({ low: 1890, high: 2410 })
    const total = marketingExample(HERO_DEMO.trade).total
    expect(total).toBe(2150)
    expect(total).toBeGreaterThan(HERO_DEMO.rangeBeforeConfirming.low)
    expect(total).toBeLessThan(HERO_DEMO.rangeBeforeConfirming.high)
    expect(inventory).toContain('$1,890 to $2,410')
    expect(inventory).toContain('we read 50 gal from the tank\'s rating label. Is that right?')
  })
})

describe('T-167: the screens on marketing pages say the product’s own words', () => {
  const clarify = read('apps/web/src/app/q/[quoteId]/clarify/page.tsx')
  const quote = read('apps/web/src/app/q/[quoteId]/page.tsx')

  it('the question screen', () => {
    expect(clarify).toContain('✓ Yes, {String(q.aiValue)} is right')
    expect(SCREEN_WORDS.question.yes('50 gal')).toBe('✓ Yes, 50 gal is right')
    expect(clarify).toContain(SCREEN_WORDS.question.no)
    // the product's question ends the way the marketing screen's does
    const worker = read('apps/worker/src/ai/identification.ts')
    expect(worker).toMatch(/we read \$\{[^}]+\} from \$\{[^}]+\}\. Is that right\?/)
    // T-171: the customer's page asks it as one plain sentence about their own label, and the marketing
    // screens use the same function
    expect(SCREEN_WORDS.question.ask('50 gal', 'the tank\'s rating label')).toBe('We read 50 gal from your tank\'s rating label. Is that right?')
    expect(clarify).toContain('readingQuestion(String(q.aiValue), reading.where)')
  })

  it('the estimate: breakdown, the added line, the measurement block, the range', () => {
    expect(quote).toContain(`<SectionLabel>${SCREEN_WORDS.estimate.breakdown}</SectionLabel>`)
    expect(quote).toContain('Added for you{item.recommendationReason ? ` — ${item.recommendationReason.toLowerCase()}`')
    expect(SCREEN_WORDS.estimate.added).toBe('Added for you — detected from your description')
    expect(read('apps/worker/src/ai/signals.ts') + read('apps/worker/src/pricing/rules-engine.ts') + read('apps/worker/src/quote-processor.ts')).toContain('Detected from your description')
    expect(quote).toContain('Measurement &amp; takeoff')
    expect(quote).toContain(SCREEN_WORDS.estimate.takeoffLead)
    expect(read('apps/worker/src/takeoff.ts')).toContain(`photos: '${SCREEN_WORDS.estimate.fromPhotos}'`)
    expect(quote).toContain(SCREEN_WORDS.estimate.rangeLead)
    expect(quote).toContain(SCREEN_WORDS.estimate.rangeButton)
    expect(quote).toContain('`Estimate for ${customer.name}`')
  })

  it('setup’s price check', () => {
    const step = read('apps/web/src/components/onboarding/CheckPricesStep.tsx')
    for (const words of Object.values(SCREEN_WORDS.prices)) expect(step).toContain(words)
  })
})

describe('T-167: honest words only', () => {
  const allCopy = Object.values(COPY).flatMap((module) => strings(module))

  it('no banned customer word, no slogan, no promise of accuracy in any copy file', () => {
    for (const text of allCopy) {
      expect(findConfidenceLanguage(text), text).toEqual([])
      expect(text).not.toMatch(/AI[- ]powered|powered by AI|\baccura\w+|\bprecis\w+|never wrong|100%|smart pricing|\bmagic\w*|revolution\w*|cutting[- ]edge/i)
      // never that the AI sets, picks or decides a price (saying that it does not is the point)
      expect(text).not.toMatch(/AI (sets|prices|quotes|decides (the|your) price|calculates)/i)
    }
  })

  it('"to firm this up" is gone from /demo', () => {
    expect(code('apps/web/src/components/demo/DemoExperience.tsx')).not.toMatch(/\bfirm\b/i)
    expect(siteCopy.DEMO_QUESTION_NOTE).toBe('The business would ask you one quick question to settle it.')
  })

  it('the word "AI" is typed only in the copy files, never in a public page or component', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (/\.tsx?$/.test(name)) files.push(full.slice(ROOT.length + 1))
      }
    }
    for (const dir of ['components/marketing', 'app/trades', 'app/features', 'app/pricing', 'app/painting']) walk(join(SRC, dir))
    files.push('apps/web/src/app/page.tsx', 'apps/web/src/components/demo/DemoExperience.tsx')
    const typed = files.filter((file) => /\bAI\b/.test(code(file)))
    expect(typed).toEqual([])
  })

  it('Pricing links its two shown-not-told lines to the live demo', () => {
    const pricing = code('apps/web/src/app/pricing/page.tsx')
    expect(pricing).toContain('PRICING_DEMO_LINKS.hostedPages')
    expect(pricing).toContain('<Link href={PRICING_DEMO_LINKS.href}')
    expect(siteCopy.PRICING_DEMO_LINKS).toEqual({ href: '/demo', hostedPages: 'Hosted estimate pages', branding: 'Your branding on every estimate' })
  })
})
