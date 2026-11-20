/**
 * T-195: "Trades" becomes "Who it's for" (the URL stays /trades), the template order is one list, and
 * the HVAC page gains the mini-split.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listPacks, getPack } from '@/lib/vertical-packs'
import { NAV_LINKS } from '@/lib/marketing/nav'
import { FOOTER } from '@/lib/marketing/site-copy'
import { OTHER_TRADES, SETUP } from '@/lib/marketing/home-copy'
import { TRADES, getTrade, templateTrades } from '@/lib/marketing/trades'
import { TEMPLATE_CARDS, WHO_CLOSING, WHO_FITS, WHO_HERO, WHO_META, WHO_OTHER, WHO_TEMPLATES } from '@/lib/marketing/who-its-for'

const ROOT = join(__dirname, '../../../..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const usIds = () => listPacks('US').filter((p) => p.region === 'US').map((p) => p.id)
const questions = (packId: string) => getPack(packId)!.services.flatMap((s) => s.draft.suggestedFields.map((f) => `${f.label} ${(f.options ?? []).join(' ')}`.toLowerCase()))
const angles = (packId: string) => getPack(packId)!.services.flatMap((s) => (s.draft.media.requiredAngles ?? []).map((a) => `${a.label} ${a.guidance}`.toLowerCase()))

describe('T-195: the page', () => {
  it('its title, description and words are the ticket’s', () => {
    expect(WHO_META.title).toBe('Instant Estimates for Any Business That Prices Jobs | Qolumns')
    expect(WHO_META.description).toBe('Your customer fills in a short form, adds photos and sees an estimate in your prices. Start from a ready-made template or add your own services and prices.')
    expect(WHO_HERO.heading).toBe('For any business that prices jobs.')
    expect(WHO_FITS.points).toHaveLength(3)
    expect(WHO_OTHER.id).toBe('other')
    expect(WHO_OTHER.like).toHaveLength(10)
    expect(WHO_CLOSING.heading).toBe('Never lose a lead to a slower quote.')
    for (const text of [WHO_HERO.lede, WHO_TEMPLATES.lede, WHO_OTHER.text, ...TEMPLATE_CARDS.map((c) => c.customer)]) expect(text).not.toMatch(/\bexact/i)
  })

  it('nine cards, in the one template order, each a US template', () => {
    expect(TEMPLATE_CARDS.map((c) => c.packId)).toEqual(usIds())
    expect(TEMPLATE_CARDS).toHaveLength(9)
  })

  it('a card links to its trade page when there is one, otherwise to sign-up', () => {
    const page = read('apps/web/src/app/trades/page.tsx')
    expect(page).toContain('TRADES.find((t) => t.packId === card.packId)')
    expect(page).toContain('href="/signup"')
    const withPage = TEMPLATE_CARDS.filter((c) => TRADES.some((t) => t.packId === c.packId)).map((c) => c.label)
    expect(withPage).toEqual(['Water heaters', 'HVAC', 'Electrical', 'Plumbing', 'Garage doors', 'Painting'])
  })

  it('each customer line matches its template’s own questions and photos', () => {
    const q = (id: string) => questions(id).join(' | ')
    const a = (id: string) => angles(id).join(' | ')
    expect(a('water-heater-us')).toMatch(/label/)
    expect(q('water-heater-us')).toMatch(/where is the water heater/)
    expect(a('hvac-replacement-us')).toMatch(/rating plate|data label/)
    expect(q('hvac-replacement-us')).toMatch(/how many rooms/)
    expect(a('electrical-us')).toMatch(/panel label/)
    expect(q('electrical-us')).toMatch(/how far is the charger spot from the electrical panel/)
    expect(q('plumbing-fixtures-us')).toMatch(/toilets.*faucets.*garbage disposals/s)
    expect(q('garage-doors-us')).toMatch(/door size/)
    expect(q('garage-doors-us')).toMatch(/door style/)
    expect(q('garage-doors-us')).toMatch(/how many springs/)
    expect(q('painting-decorating-us')).toMatch(/how many rooms/)
    expect(q('fencing-us')).toMatch(/how long.*\|.*material.*\|.*how tall/s)
    expect(a('junk-removal-us')).toMatch(/the whole pile/)
    expect(q('junk-removal-us')).toMatch(/how much is there\? a few items quarter truck/)
    expect(q('pressure-washing-us')).toMatch(/driveway none 1-car/)
  })

  it('the ways to add a business are setup’s, in setup’s order and words', () => {
    const step = read('apps/web/src/components/onboarding/TradeStep.tsx')
    const flow = read('apps/web/src/components/onboarding/OnboardingFlow.tsx')
    expect(WHO_OTHER.ways.map((w) => w.title)).toEqual(['Start from a template', 'Read my website', 'I’ll describe it'])
    expect(step).toContain('Something else')
    expect(flow).toContain('Read my website')
    expect(flow).toContain('I&apos;ll describe it')
    expect(flow.indexOf('Read my website')).toBeLessThan(flow.indexOf('I&apos;ll describe it'))
  })

  it('pills are plain, not links; one yellow button per screen, to sign-up', () => {
    const page = read('apps/web/src/app/trades/page.tsx')
    expect(page).toMatch(/data-testid="business-pills"[\s\S]*?<li key=\{b\}/)
    expect(page.match(/data-cta="main"/g)).toHaveLength(2)
  })
})

describe('T-195: "Trades" becomes "Who it’s for"', () => {
  it('in the nav, the footer and home’s step 1', () => {
    expect(NAV_LINKS.find((l) => l.href === '/trades')!.label).toBe('Who it’s for')
    expect(FOOTER.columns.trades).toBe('Who it’s for')
    expect(FOOTER.links.allTrades).toBe('Any other business')
    expect(read('apps/web/src/components/marketing/SiteFooter.tsx')).toContain('href="/trades#other"')
    expect(OTHER_TRADES).toBe('Any other business: add your own services and prices')
    expect(SETUP.steps[0]!.text).toContain('Any other business: add your own services and prices.')
  })

  it('the footer lists only the trades with a page, in the template order', () => {
    expect(templateTrades(listPacks().map((p) => p.id)).map((t) => t.label)).toEqual(['Water heaters', 'HVAC', 'Electrical', 'Plumbing', 'Garage doors', 'Painting'])
  })
})

describe('T-195: the HVAC page', () => {
  it('its title and the mini-split feature', () => {
    const hvac = getTrade('hvac')!
    expect(hvac.metaTitle).toBe('Instant AC, Heat Pump, Furnace & Mini-Split Estimates | Qolumns')
    expect(hvac.features).toContainEqual({ title: 'Mini-splits by the room', text: 'The customer says how many rooms. Your per-room prices set the estimate.' })
    const caps = read('Docs/design/ai-capabilities.md')
    expect(caps).toContain('Mini-splits are priced from the customer’s answers.')
    for (const row of ['Fence installation', 'Junk removal', 'Pressure washing']) expect(caps).toMatch(new RegExp(`\\| ${row} \\| no \\| no \\|`))
  })
})
