/**
 * T-181: small site fixes, and what Meta's app review needs from the site.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FREE_ALLOWANCE, SUPPORT_EMAIL, offeredPlans } from '@qolumns/shared'
import { HERO, NOTICES, PAGE_META } from '@/lib/marketing/home-copy'
import { marketingExample } from '@/lib/marketing/examples'
import { BILLED_IN_ADVANCE, PLAN_CHANNEL_LINES, PLAN_FEATURE_LINES, PLUS_TAX, PRICING_DESCRIPTION, planCards, planLines, sitePlans } from '@/lib/marketing/plan-claims'
import { DATA_DELETION, FOOTER } from '@/lib/marketing/site-copy'

const ROOT = join(__dirname, '..', '..', '..', '..')
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')

describe('T-181: the headline (already the owner’s words since T-173)', () => {
  // T-190: the social image is now the owner's wordmark picture, so the headline is in the page's title and description
  it('reads "Instant quotes for your customers, in your prices." on the page and in the title', () => {
    expect(HERO.headline).toBe('Instant quotes for your customers, in your prices.')
    expect(PAGE_META.title).toContain('Instant quotes for your customers, in your prices')
    expect(read('apps/web/src/app/layout.tsx')).toContain("description: 'Instant quotes for your customers, in your prices.',")
    expect(read('apps/web/src/app/page.tsx')).toContain('openGraph: { title: PAGE_META.title, description: PAGE_META.description')
  })
})

describe('T-181: "What it notices" prices the job the customer wrote about', () => {
  it('three bedrooms in the message, three rooms in the price breakdown, and a total that follows', () => {
    const words = NOTICES.examples[0]
    expect(words.message).toContain('three bedrooms')
    const painting = marketingExample('painting')
    expect(painting.answer).toBe('3')
    // the template's own rates: $75 visit and setup, $375 a room
    expect(painting.lines).toEqual([
      { label: 'Walls & ceilings, 3 rooms', amount: 1125 },
      { label: 'Visit and setup', amount: 75 },
    ])
    expect(painting.total).toBe(1200)
    // the card on Home adds the extra the customer asked for ("and the trim too")
    expect(painting.extra).toMatchObject({ label: 'Trim, doors & baseboards', amount: 200 })
    expect(painting.total + painting.extra!.amount).toBe(1400)
    expect(JSON.stringify(painting)).not.toContain('2 rooms')
  })
})

describe('T-181: plan cards say what the business gets', () => {
  const [starter, pro] = sitePlans()

  it('each line is a sentence about the business or its customers, not a feature’s name', () => {
    for (const plan of offeredPlans()) {
      for (const line of planLines(plan)) {
        // T-199: the own-address line is the owner's own wording, with the address as its example
        if (line !== PLAN_FEATURE_LINES.own_address) expect(line.label.split(' ').length, line.label).toBeGreaterThanOrEqual(5)
        expect(line.label, line.label).not.toMatch(/^(Website widget|Hosted estimate pages|Priority support|Multiple team members|WhatsApp quoting)$/)
      }
    }
    expect(planLines(starter!).filter((l) => l.live)).toHaveLength(2)
    expect(planLines(pro!).filter((l) => l.live)).toHaveLength(4)
  })

  it('no text-message line anywhere on the site; the plans themselves are unchanged', () => {
    for (const plan of offeredPlans()) expect(planLines(plan).map((l) => l.label).join(' | '), plan.id).not.toMatch(/\bSMS\b|text message|by text/i)
    expect(PLAN_CHANNEL_LINES.sms.shown).toBe(false)
    for (const file of ['app/page.tsx', 'app/pricing/page.tsx', 'app/features/page.tsx', 'lib/marketing/home-copy.ts', 'lib/marketing/site-copy.ts', 'lib/marketing/features-copy.ts', 'components/marketing/SiteFooter.tsx']) {
      expect(read(`apps/web/src/${file}`), file).not.toMatch(/\bSMS\b/)
    }
    // prices, limits and channels are as they were
    expect(offeredPlans().map((p) => [p.id, p.monthlyPrice.USD, p.annualPrice?.USD, p.quoteLimit])).toEqual([
      ['plan_us_starter', 4900, 49000, 50],
      ['plan_us_pro', 9900, 99000, 200],
      ['plan_us_business', 19900, 199000, 600],
    ])
    expect(offeredPlans().find((p) => p.id === 'plan_us_pro')!.channels).toContain('sms')
    expect(FREE_ALLOWANCE.US).toEqual({ quotes: 10, per: 'total' })
  })

  it('Home’s cards and Pricing’s are one list and one component; both keep "plus tax"; Pricing says how plans are billed', () => {
    // T-187: the same cards on both pages, from `planCards`. A card lists what a business can use today
    // first, then what is still to come, marked (T-181's Home cards listed the live lines only).
    const cards = read('apps/web/src/components/marketing/PlanCards.tsx')
    for (const page of ['apps/web/src/app/page.tsx', 'apps/web/src/app/pricing/page.tsx']) expect(read(page), page).toContain('<PlanCards')
    expect(cards).toContain('const cards = planCards()')
    expect(cards).toContain('a month, {PLUS_TAX}')
    for (const card of planCards()) {
      const firstLater = card.lines.findIndex((l) => !l.live)
      if (firstLater >= 0) expect(card.lines.slice(firstLater).every((l) => !l.live), card.id).toBe(true)
    }
    expect(read('apps/web/src/lib/marketing/pricing-copy.ts')).toContain('`${BILLED_IN_ADVANCE} Pay yearly and two months are free.`')
    expect(PLUS_TAX).toBe('plus tax')
    expect(BILLED_IN_ADVANCE).toBe('Billed in advance, monthly or yearly.')
  })
})

describe('T-181: the site is for any business', () => {
  it('nothing limits it to contractors or home-service businesses', () => {
    expect(HERO.smallLine).toBe('For any business that quotes for its work. No website? Use your quote link.')
    // T-187: the footer's line names no kind of business at all
    expect(FOOTER.line).toBe('Instant quotes for your customers, in your own prices.')
    expect(PRICING_DESCRIPTION).toContain('for businesses of any size')
    for (const file of ['lib/marketing/home-copy.ts', 'lib/marketing/site-copy.ts', 'lib/marketing/plan-claims.ts', 'lib/marketing/features-copy.ts', 'app/pricing/page.tsx', 'app/layout.tsx']) {
      expect(read(`apps/web/src/${file}`), file).not.toMatch(/contractors and home-service|home-service businesses|for service businesses/i)
    }
  })
})

describe('T-181: what Meta’s review needs from the site', () => {
  const page = read('apps/web/src/app/data-deletion/page.tsx')

  it('there is a data deletion page, linked from every page’s footer', () => {
    expect(DATA_DELETION).toEqual({ href: '/data-deletion', label: 'Delete your data' })
    expect(read('apps/web/src/components/marketing/SiteFooter.tsx')).toContain('<Link href={DATA_DELETION.href} className={FOOT_LINK}>{DATA_DELETION.label}</Link>')
    expect(page).toContain('Delete your data')
    expect(page).toContain('Last updated: 18 November 2026')
  })

  it('it says how each kind of person asks, and what Disconnect does, in the words the policy already uses', () => {
    expect(SUPPORT_EMAIL).toBe('hello@qolumns.com')
    expect(page.match(/\$\{SUPPORT_EMAIL\}/g)!.length).toBeGreaterThanOrEqual(4)
    expect(page).toContain('press Disconnect')
    expect(page).toContain('we delete the access token we hold for it')
    // the same promise as the Privacy Policy (section 5) and the Terms (section 9): 30 days, then deleted
    expect(page).toContain('stays available for export for 30 days and is then deleted')
    expect(read('apps/web/src/app/privacy/page.tsx')).toContain('Closed accounts are deleted after the 30-day export window.')
    // and what Disconnect really does
    const connect = read('apps/web/src/lib/whatsapp-connect.ts')
    expect(connect).toContain("await admin.from('whatsapp_configs').delete().eq('tenant_id', tenantId)")
    expect(connect).toContain('await unsubscribeApp(')
  })

  it('the Privacy Policy and the Terms are public pages (no sign-in in front of them), and so is this one', () => {
    const middleware = read('apps/web/src/middleware.ts')
    for (const path of ['/privacy', '/terms', '/data-deletion']) expect(middleware, path).not.toContain(`'${path}'`)
  })
})
