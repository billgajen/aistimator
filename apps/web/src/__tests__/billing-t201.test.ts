/**
 * T-201, items 29 and 31 to 34:
 *   29  "County/State" service areas are checked (they were saved and never read)
 *   31  the badge stays off while a payment is being retried
 *   32  requests saved without a price are priced when a plan is bought
 *   33  the free quotes count only what was priced on the free start
 *   34  customer emails carry the business's logo, and "Powered by" follows the plan
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  FREE_ALLOWANCE,
  PRODUCT_NAME,
  US_REGION,
  GB_REGION,
  areaOfPostalCode,
  businessAccess,
  businessLogoBlock,
  businessLogoUrl,
  canUse,
  freeQuotesUsed,
  getPlan,
  poweredByRow,
  readAreaEntry,
  serviceAreaVerdict,
  withinServiceArea,
} from '@qolumns/shared'
import { areaInputHint, formatAreaInput, parseAreaInput } from '@/lib/service-area-input'
import { inServiceArea } from '@/lib/whatsapp-assistant-rules'
import { usedForAllowance } from '@/lib/plan-limits'
import type * as PlanLimits from '@/lib/plan-limits'
import { planJustStarted } from '@/lib/billing-sync'
import { freeQuotesLeftEmail } from '@/lib/billing-emails'
import { generateLeadHeldEmailHtml, generateLimitReachedEmailHtml, generateQuoteReminderEmailHtml, generateRevisedQuoteEmailHtml } from '@/lib/email-templates'
import { generateCustomerEmailHtml } from '@/lib/postmark'
import { customerEmailBrand } from '@/lib/customer-email-brand'
import { loadAccess } from '@/lib/access'

const ROOT = join(__dirname, '..', '..', '..', '..')
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')
const US = US_REGION.areas!

// ---------------------------------------------------------------------------
describe('T-201 (29): which state a ZIP code is in', () => {
  it('reads the state from the first three digits', () => {
    const cases: Array<[string, string]> = [
      ['77002', 'TX'], ['90210', 'CA'], ['10001', 'NY'], ['63021', 'MO'], ['60601', 'IL'], ['33101', 'FL'], ['98101', 'WA'],
      ['02108', 'MA'], ['30301', 'GA'], ['85001', 'AZ'], ['80202', 'CO'], ['96813', 'HI'], ['99501', 'AK'], ['20500', 'DC'],
      ['19801', 'DE'], ['04101', 'ME'], ['05401', 'VT'], ['03101', 'NH'], ['02903', 'RI'], ['06103', 'CT'], ['07102', 'NJ'],
      ['15222', 'PA'], ['21201', 'MD'], ['23219', 'VA'], ['25301', 'WV'], ['27601', 'NC'], ['29201', 'SC'], ['35203', 'AL'],
      ['37203', 'TN'], ['39201', 'MS'], ['40202', 'KY'], ['43215', 'OH'], ['46204', 'IN'], ['48226', 'MI'], ['50309', 'IA'],
      ['53202', 'WI'], ['55401', 'MN'], ['57501', 'SD'], ['58501', 'ND'], ['59601', 'MT'], ['65101', 'MO'], ['66603', 'KS'],
      ['68508', 'NE'], ['70112', 'LA'], ['72201', 'AR'], ['73102', 'OK'], ['82001', 'WY'], ['83702', 'ID'], ['84111', 'UT'],
      ['87501', 'NM'], ['89501', 'NV'], ['97201', 'OR'], ['00901', 'PR'],
    ]
    for (const [zip, state] of cases) expect(areaOfPostalCode(zip, US), zip).toBe(state)
    expect(areaOfPostalCode('77002-1234', US)).toBe('TX')
  })

  it('knows the single sorting areas that sit inside another state\'s run', () => {
    expect(areaOfPostalCode('05501', US)).toBe('MA')
    expect(areaOfPostalCode('20101', US)).toBe('VA')
    expect(areaOfPostalCode('73301', US)).toBe('TX')
    expect(areaOfPostalCode('88510', US)).toBe('TX')
    expect(areaOfPostalCode('00501', US)).toBe('NY')
    expect(areaOfPostalCode('56901', US)).toBe('DC')
  })

  it('says nothing for a code it cannot place: military mail, a number never given out, a short or foreign code, a region with no table', () => {
    for (const zip of ['09012', '34002', '96201', '00100', '99', '', 'SW1A 1AA', 'abcde']) expect(areaOfPostalCode(zip, US), zip).toBeNull()
    expect(areaOfPostalCode('77002', GB_REGION.areas)).toBeNull()
    expect(GB_REGION.areas).toBeUndefined()
  })

  it('the table is sound: every range names a listed state, every state has a range, and ranges run forwards', () => {
    const codes = new Set(US.areas.map((a) => a.code))
    expect(codes.size).toBe(US.areas.length)
    expect(codes.size).toBe(52) // fifty states, the District of Columbia, Puerto Rico
    for (const [from, to, code] of US.prefixRanges) {
      expect(codes.has(code), code).toBe(true)
      expect(from).toBeLessThanOrEqual(to)
      expect(from).toBeGreaterThanOrEqual(0)
      expect(to).toBeLessThanOrEqual(999)
    }
    for (const code of codes) expect(US.prefixRanges.some((r) => r[2] === code), code).toBe(true)
  })
})

describe('T-201 (29): one rule for where a business works', () => {
  const area = (values: string[], postcode?: string, address?: string) => serviceAreaVerdict({ mode: 'county_state', values, postcode, address, areas: US })

  it('reads an entry: a state by name or code, a county with its state, a county alone', () => {
    expect(readAreaEntry('Texas', US)).toMatchObject({ area: 'TX', whole: true })
    expect(readAreaEntry(' tx ', US)).toMatchObject({ area: 'TX', whole: true })
    expect(readAreaEntry('Harris County, TX', US)).toMatchObject({ area: 'TX', whole: false })
    expect(readAreaEntry('Harris County, Texas', US)).toMatchObject({ area: 'TX', whole: false })
    expect(readAreaEntry('Harris County', US)).toMatchObject({ area: null, whole: false })
    expect(readAreaEntry('  ', US)).toBeNull()
    expect(readAreaEntry(42, US)).toBeNull()
  })

  it('a state on the list: a ZIP code in it is inside, one in another state is outside', () => {
    expect(area(['Texas'], '77002')).toBe('inside')
    expect(area(['TX', 'Oklahoma'], '73102')).toBe('inside')
    expect(area(['Texas'], '90210')).toBe('outside')
    expect(area(['California', 'Texas', 'New York'], '63021')).toBe('outside')
  })

  it('a county with its state: the right state is let in, another state is turned away', () => {
    expect(area(['Harris County, TX'], '77002')).toBe('inside')
    expect(area(['Harris County, TX'], '75201')).toBe('inside') // Dallas: the ZIP code cannot place a county
    expect(area(['Harris County, TX'], '90210')).toBe('outside')
  })

  it('a county with no state is never a reason to turn a customer away', () => {
    expect(area(['Harris County'], '77002')).toBe('not_checked')
    expect(area(['Harris County'], '90210')).toBe('not_checked')
    expect(area(['Texas', 'Orange County'], '90210')).toBe('not_checked')
    expect(withinServiceArea({ mode: 'county_state', values: ['Harris County'], postcode: '90210', areas: US })).toBe(true)
  })

  it('no ZIP code and no address, a code that cannot be placed, an empty list: not checked, so not blocked', () => {
    expect(area(['Texas'])).toBe('not_checked')
    expect(area(['Texas'], '')).toBe('not_checked')
    expect(area(['Texas'], '09012')).toBe('not_checked')
    expect(area([], '90210')).toBe('not_checked')
    expect(serviceAreaVerdict({ mode: 'county_state', values: ['Kent'], postcode: 'SW1A 1AA', areas: GB_REGION.areas })).toBe('not_checked')
    expect(serviceAreaVerdict({ mode: 'county_state', values: null, postcode: '90210', areas: US })).toBe('not_checked')
  })

  it('an address that names an entry is inside, whatever the ZIP code says', () => {
    expect(area(['Harris County'], undefined, '12 Main St, Houston, Harris County')).toBe('inside')
    expect(area(['Harris County, TX'], '90210', 'we are in harris county')).toBe('inside')
    expect(area(['Texas'], undefined, '12 Main St, Houston, TX 77002')).toBe('inside')
    expect(area(['Texas'], undefined, 'somewhere in texas')).toBe('inside')
    // a state's two letters count only in capitals and as a word of their own
    expect(area(['Oregon'], undefined, 'this or that street')).toBe('not_checked')
    expect(area(['Indiana'], undefined, 'in the back garden')).toBe('not_checked')
    expect(area(['Kent'], undefined, 'Kentish Town Road')).toBe('not_checked')
  })

  it('the postcode list works as it always has: a prefix, and no code given is not checked', () => {
    const list = (postcode?: string) => serviceAreaVerdict({ mode: 'postcode_allowlist', values: ['630', 'sw1'], postcode })
    expect(list('63021')).toBe('inside')
    expect(list('sw1a 1aa')).toBe('inside')
    expect(list('90210')).toBe('outside')
    expect(list()).toBe('not_checked')
    expect(serviceAreaVerdict({ mode: 'postcode_allowlist', values: [], postcode: '90210' })).toBe('outside')
    expect(serviceAreaVerdict({ mode: 'none', values: ['630'], postcode: '90210' })).toBe('not_checked')
    expect(serviceAreaVerdict({ mode: null, values: null, postcode: '90210' })).toBe('not_checked')
  })

  it('the request form and the WhatsApp assistant ask this rule, with the business\'s region', () => {
    const intake = read('apps/web/src/lib/quote-intake.ts')
    expect(intake).toContain('withinServiceArea({')
    expect(intake).toMatch(/areas: getRegion\(\(tenant as \{ region\?: string \| null \}\)\.region\)\.areas/)
    expect(intake).toContain("'id, name, region, currency, tax_enabled, tax_label, tax_rate, service_area_mode, service_area_values'")
    expect(intake).not.toContain('skip for now')
    expect(read('apps/web/src/lib/whatsapp-assistant.ts')).toContain('{ address: text, areas: getRegion(business.region).areas }')
    expect(inServiceArea('90210', 'county_state', ['Texas'], { areas: US })).toBe(false)
    expect(inServiceArea('77002', 'county_state', ['Texas'], { areas: US })).toBe(true)
    expect(inServiceArea('90210', 'county_state', ['Texas'], { address: 'Job is in Austin, TX', areas: US })).toBe(true)
    // no place is named in the rule itself: the states are the region's data
    const rule = read('packages/shared/src/service-area.ts')
    for (const state of US.areas) expect(rule.includes(`'${state.name}'`), state.name).toBe(false)
  })

  it('Settings keeps "Harris County, TX" as one entry', () => {
    expect(parseAreaInput('Texas\nHarris County, TX\n\n  Orange County,  CA ; Nevada', 'county_state')).toEqual(['Texas', 'Harris County, TX', 'Orange County, CA', 'Nevada'])
    expect(parseAreaInput('SW1A, W1\n10001,90210', 'postcode_allowlist')).toEqual(['SW1A', 'W1', '10001', '90210'])
    expect(formatAreaInput(['Texas', 'Harris County, TX'], 'county_state')).toBe('Texas\nHarris County, TX')
    expect(formatAreaInput(['630', '631'], 'postcode_allowlist')).toBe('630, 631')
    expect(formatAreaInput(null, 'county_state')).toBe('')
    expect(areaInputHint('county_state')).toContain('"Harris County, TX"')
    const page = read('apps/web/src/app/(dashboard)/app/settings/page.tsx')
    expect(page).toContain('parseAreaInput(serviceAreaInput, serviceAreaMode)')
    expect(page).toContain('formatAreaInput(tenant.serviceAreaValues, tenant.serviceAreaMode)')
    // the server keeps a state or county as written; postal codes stay in capitals
    expect(read('apps/web/src/app/api/tenant/route.ts')).toContain("const asWritten = serviceAreaMode === 'county_state'")
  })
})

// ---------------------------------------------------------------------------
describe('T-201 (31): the badge while a payment is being retried', () => {
  const PRO = 'plan_us_pro'
  const access = (subscription: { plan_id: string; status: string } | null, quotesUsed: number | null = 0) => businessAccess({ subscription, region: 'US', quotesUsed })

  it('a plan that removes the badge keeps it off while its payment is retried, and puts it back when the plan ends', () => {
    expect(canUse(access({ plan_id: PRO, status: 'active' }), 'no_badge')).toBe(true)
    expect(canUse(access({ plan_id: PRO, status: 'past_due' }), 'no_badge')).toBe(true)
    expect(canUse(access({ plan_id: PRO, status: 'canceled' }), 'no_badge')).toBe(false)
    expect(canUse(access({ plan_id: 'plan_us_starter', status: 'active' }), 'no_badge')).toBe(false)
    expect(canUse(access({ plan_id: 'plan_us_starter', status: 'past_due' }), 'no_badge')).toBe(false)
  })

  it('every place the badge shows asks the one rule, and none reads a subscription status itself', () => {
    expect(read('apps/web/src/lib/plan-features.ts')).toContain("return businessCan(supabase, tenantId, 'no_badge')")
    for (const file of ['apps/web/src/app/api/public/quotes/[quoteId]/route.ts', 'apps/web/src/app/api/public/widget/config/route.ts']) {
      const src = read(file)
      expect(src, file).toMatch(/const whiteLabel = await hasCustomBranding\(/)
      expect(src, file).toContain('showPoweredBy: !whiteLabel')
      expect(src, file).not.toMatch(/\['active', 'trialing'\]/)
    }
    // the emails (item 34) go through the same function on the web, and the same rule in the worker
    expect(read('apps/web/src/lib/customer-email-brand.ts')).toContain('showPoweredBy: !(await hasCustomBranding(db, tenantId))')
    expect(read('apps/worker/src/customer-email-brand.ts')).toContain("showPoweredBy: !canUse(await loadAccess(db, tenantId), 'no_badge')")
  })
})

// ---------------------------------------------------------------------------
describe('T-201 (33): the free quotes count only what was priced on the free start', () => {
  it('a quote priced on a plan is not a free quote', () => {
    expect(freeQuotesUsed([{ estimates_created: 4 }])).toBe(4)
    expect(freeQuotesUsed([{ estimates_created: 4, plan_estimates_created: 0 }, { estimates_created: 120, plan_estimates_created: 120 }])).toBe(4)
    expect(freeQuotesUsed([{ estimates_created: 30, plan_estimates_created: 26 }, { estimates_created: 3 }])).toBe(7)
    // never below nothing, whatever a row says
    expect(freeQuotesUsed([{ estimates_created: 2, plan_estimates_created: 5 }])).toBe(0)
    expect(freeQuotesUsed(null)).toBe(0)
    expect(freeQuotesUsed([{ estimates_created: null, plan_estimates_created: null }])).toBe(0)
  })

  it('the allowance that never resets uses that count; a month\'s limit still counts the whole month', () => {
    const rows = [
      { period_yyyymm: '202609', estimates_created: 4, plan_estimates_created: 0 },
      { period_yyyymm: '202610', estimates_created: 150, plan_estimates_created: 150 },
      { period_yyyymm: '202611', estimates_created: 12, plan_estimates_created: 9 },
    ]
    expect(usedForAllowance(rows, 'total', '202611')).toBe(7)
    expect(usedForAllowance(rows, 'month', '202611')).toBe(12)
    expect(usedForAllowance(rows, 'month', '202612')).toBe(0)
    // rows written before the column existed read as free quotes, which is what was counted then
    expect(usedForAllowance([{ period_yyyymm: '202601', estimates_created: 15 }], 'total', '202611')).toBe(15)
  })

  it('a business whose plan ended has the free quotes it never used: 4 used before the plan, 6 left after it', async () => {
    const db = usageDb({ subscription: { plan_id: 'plan_us_pro', status: 'canceled', stripe_customer_id: 'cus_1' }, rows: [{ period_yyyymm: '202609', estimates_created: 4, plan_estimates_created: 0 }, { period_yyyymm: '202610', estimates_created: 150, plan_estimates_created: 150 }] })
    const { checkPlanLimit } = await import('@/lib/plan-limits')
    const status = await checkPlanLimit(db, 'tnt_a')
    expect(status).toMatchObject({ per: 'total', used: 4, limit: FREE_ALLOWANCE.US!.quotes, allowed: true })
    // its features are a different question (the one rule): a plan that ended lends nothing
    expect((await loadAccess(db, 'tnt_a')).basis).toBe('none')
  })

  it('the free start reads the same count: a business that never had a plan row and used 3 has 7 left', async () => {
    const db = usageDb({ subscription: null, rows: [{ period_yyyymm: '202611', estimates_created: 5, plan_estimates_created: 2 }] })
    expect(await loadAccess(db, 'tnt_a')).toMatchObject({ basis: 'free_start', freeLeft: 7 })
  })

  it('the database counts the same way, and a claim given back says which kind it was', () => {
    const migration = read('supabase/migrations/00000000000050_t201.sql')
    expect(migration).toContain('ADD COLUMN plan_estimates_created INTEGER NOT NULL DEFAULT 0')
    expect(migration).toContain("IF p_per = 'total' THEN")
    expect(migration).toContain('sum(greatest(uc.estimates_created - uc.plan_estimates_created, 0))')
    expect(migration).toContain('plan_estimates_created = usage_counters.plan_estimates_created + v_plan')
    expect(migration).toContain('DROP FUNCTION IF EXISTS public.release_plan_quote(TEXT, TEXT);')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.release_plan_quote(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;')
    expect(migration).toContain('pg_advisory_xact_lock(hashtextextended(\'plan_usage:\' || p_tenant_id, 0))')
    expect(read('apps/web/src/lib/plan-limits.ts')).toContain("supabase.rpc('release_plan_quote', { p_tenant_id: tenantId, p_period: claim.period, p_per: claim.status.per })")
    // every reader of the free count: the limit, the billing page, the access rule's loaders
    expect(read('apps/web/src/lib/plan-limits.ts')).toContain("if (per === 'total') return freeQuotesUsed(list)")
    expect(read('apps/web/src/app/api/billing/route.ts')).toContain("'period_yyyymm, estimates_created, estimates_sent, plan_estimates_created'")
    expect(read('apps/web/src/lib/access.ts')).toContain('quotesUsed: freeQuotesUsed(')
    expect(read('apps/worker/src/customer-email-brand.ts')).toContain('quotesUsed: freeQuotesUsed(')
  })
})

/** A fake database for the readers of the plan and the count */
function usageDb(opts: { subscription: Record<string, unknown> | null; rows: Array<Record<string, unknown>>; region?: string; fail?: boolean }): SupabaseClient {
  const table = (name: string) => {
    const result = opts.fail
      ? { data: null, error: { code: 'XX000' } }
      : name === 'subscriptions'
        ? { data: opts.subscription ? { ...opts.subscription, plans: { stripe_metered_price_id: null } } : null, error: null }
        : name === 'usage_counters'
          ? { data: opts.rows, error: null }
          : { data: { region: opts.region ?? 'US', suspended_at: null }, error: null }
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = () => chain
    chain.single = async () => result
    chain.maybeSingle = async () => result
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
    return chain
  }
  return { from: table } as unknown as SupabaseClient
}

// ---------------------------------------------------------------------------
describe('T-201 (32): requests saved without a price are priced when a plan is bought', () => {
  it('a plan has "just started" when it is live now and was not the plan held a moment ago', () => {
    const pro = { plan_id: 'plan_us_pro', status: 'active' }
    expect(planJustStarted(null, pro)).toBe(true)
    expect(planJustStarted({ plan_id: 'plan_us_pro', status: 'canceled' }, pro)).toBe(true)
    expect(planJustStarted({ plan_id: 'plan_us_starter', status: 'active' }, pro)).toBe(true)
    // the same facts stored again (Stripe sends an event twice; the return from Checkout and the webhook)
    expect(planJustStarted(pro, pro)).toBe(false)
    expect(planJustStarted(pro, { plan_id: 'plan_us_pro', status: 'past_due' })).toBe(false)
    // a plan that ends starts nothing
    expect(planJustStarted(pro, { plan_id: 'plan_us_pro', status: 'canceled' })).toBe(false)
    expect(planJustStarted(null, { plan_id: 'plan_us_pro', status: 'canceled' })).toBe(false)
  })

  it('the purchase event prices them, and so does a change of plan; the return from Checkout does not make the business wait', () => {
    const webhook = read('apps/web/src/app/api/webhooks/stripe/route.ts')
    expect(webhook).toContain('if (subscriptionLive(result.status)) await priceHeldRequestsForPlan(admin, result.tenantId)')
    expect(webhook).toContain('if (result.ok && result.planStarted) await priceHeldRequestsForPlan(admin, result.tenantId)')
    expect(webhook).toContain('export const maxDuration = 60')
    expect(read('apps/web/src/app/api/billing/confirm/route.ts')).not.toContain('priceHeldRequests')
    // "Price this request" goes the same way
    expect(read('apps/web/src/app/api/quotes/[quoteId]/process/route.ts')).toContain('await priceHeldRequest(createAdminClient(), tenantId,')
  })

  it('the emails say what now happens', () => {
    const left = freeQuotesLeftEmail({ businessName: 'Harlow Painting', used: 8, limit: 10, billingUrl: 'https://example.test/billing' })!
    expect(left.html).toContain('When you pick a plan, the requests saved in the last 30 days are priced for you')
    expect(left.html).not.toContain('priced as soon as you pick a plan')
    const limit = generateLimitReachedEmailHtml({ businessName: 'Harlow Painting', used: 10, limit: 10, billingUrl: 'u', per: 'total' })
    expect(limit).toContain('requests saved in the last 30 days are priced for you')
    const held = generateLeadHeldEmailHtml({ businessName: 'Harlow Painting', customerName: 'Dev Raman', serviceName: 'Interior Painting', used: 10, limit: 10, billingUrl: 'u', quoteUrl: 'q', per: 'total' })
    expect(held).toContain('Upgrade and it is priced for you')
  })
})

// The run itself, against a fake database, with the claim and the queue stood in for.
const claimMock = vi.fn()
const releaseMock = vi.fn()
const enqueueMock = vi.fn()
const failedMock = vi.fn()
const overageMock = vi.fn()
vi.mock('@/lib/plan-limits', async (original) => ({
  ...(await original<typeof PlanLimits>()),
  claimPlanQuote: (...args: unknown[]) => claimMock(...args),
  releasePlanQuote: (...args: unknown[]) => releaseMock(...args),
  maybeWarnFreeQuotesLeft: async () => undefined,
  maybeNotifyLimitReached: async () => undefined,
  recordOverageQuote: (...args: unknown[]) => overageMock(...args),
}))
vi.mock('@/lib/queue', () => ({ enqueueQuoteJob: (...args: unknown[]) => enqueueMock(...args) }))
vi.mock('@/lib/failed-quote', () => ({ markQuoteFailed: (...args: unknown[]) => failedMock(...args) }))

describe('T-201 (32): the run after a purchase', () => {
  type Held = { id: string; quote_request_id: string; status: string; content_json: Record<string, unknown>; created_at: string; is_test: boolean; tenant_id: string }
  const NOW = new Date('2026-11-24T12:00:00Z')
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()
  const held = (id: string, age: number, over: Partial<Held> = {}): Held => ({ id, quote_request_id: `qr_${id}`, status: 'pending_review', content_json: { limitHold: true }, created_at: daysAgo(age), is_test: false, tenant_id: 'tnt_a', ...over })
  const okClaim = (per: 'month' | 'total' = 'month') => ({ claimed: true, reason: 'ok', counted: true, overage: false, status: { per, used: 1, limit: 50 }, period: '202611' })

  /** The quotes table: the list (with its filters applied here, as the database would) and the conditional write */
  function quotesDb(rows: Held[]) {
    const filters: string[] = []
    const from = (name: string) => {
      if (name !== 'quotes') {
        const chain: Record<string, unknown> = {}
        chain.select = () => chain
        chain.eq = () => chain
        chain.single = async () => ({ data: { name: 'Harlow Painting' } })
        return chain
      }
      let mode: 'select' | 'update' = 'select'
      let patch: Record<string, unknown> = {}
      const where: Array<(r: Held) => boolean> = []
      let limit = Infinity
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.update = (body: Record<string, unknown>) => {
        mode = 'update'
        patch = body
        return chain
      }
      chain.eq = (column: string, value: unknown) => {
        filters.push(`${mode}:${column}=${String(value)}`)
        where.push((r) => (column === 'content_json->>limitHold' ? String(r.content_json.limitHold ?? '') === value : (r as unknown as Record<string, unknown>)[column] === value))
        return chain
      }
      chain.gte = (column: string, value: string) => {
        filters.push(`${mode}:${column}>=`)
        where.push((r) => (r as unknown as Record<string, string>)[column]! >= value)
        return chain
      }
      chain.order = () => chain
      chain.limit = (n: number) => {
        limit = n
        return chain
      }
      chain.then = (resolve: (v: unknown) => unknown) => {
        const matched = rows.filter((r) => where.every((test) => test(r)))
        if (mode === 'update') {
          for (const r of matched) Object.assign(r, patch)
          return Promise.resolve({ data: matched.map((r) => ({ id: r.id })), error: null }).then(resolve)
        }
        const listed = [...matched].sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, limit)
        return Promise.resolve({ data: listed.map((r) => ({ id: r.id, quote_request_id: r.quote_request_id })), error: null }).then(resolve)
      }
      return chain
    }
    return { db: { from } as unknown as SupabaseClient, filters }
  }

  beforeEach(() => {
    for (const mock of [claimMock, releaseMock, enqueueMock, failedMock, overageMock]) mock.mockReset()
    claimMock.mockResolvedValue(okClaim())
    enqueueMock.mockResolvedValue(undefined)
  })

  it('prices the held requests oldest first, each claimed against the plan and handed to the worker as an ordinary job', async () => {
    const { priceHeldRequestsForPlan } = await import('@/lib/held-requests')
    const rows = [held('b', 2), held('a', 9), held('c', 1)]
    const { db, filters } = quotesDb(rows)
    const result = await priceHeldRequestsForPlan(db, 'tnt_a', { now: NOW })
    expect(result).toEqual({ found: 3, priced: 3, stopped: null })
    expect(enqueueMock.mock.calls.map((call) => (call[0] as { quoteId: string }).quoteId)).toEqual(['a', 'b', 'c'])
    expect(enqueueMock.mock.calls[0]![0]).toMatchObject({ quoteId: 'a', quoteRequestId: 'qr_a', tenantId: 'tnt_a' })
    expect(typeof (enqueueMock.mock.calls[0]![0] as { quoteToken?: string }).quoteToken).toBe('string')
    // counted once each, never as paid overage
    expect(claimMock).toHaveBeenCalledTimes(3)
    expect(claimMock.mock.calls.every((call) => (call[2] as { overage?: boolean }).overage === false)).toBe(true)
    // each is an ordinary queued request now: the worker and the business's review setting take it from here
    expect(rows.every((r) => r.status === 'queued' && r.content_json.limitHold === undefined)).toBe(true)
    // only this business's held, real requests are read
    expect(filters).toEqual(expect.arrayContaining(['select:tenant_id=tnt_a', 'select:status=pending_review', 'select:content_json->>limitHold=true', 'select:is_test=false', 'select:created_at>=']))
  })

  it('never past the plan\'s limit: it stops at the first request the plan has no room for', async () => {
    const { priceHeldRequestsForPlan } = await import('@/lib/held-requests')
    const rows = [held('a', 5), held('b', 4), held('c', 3)]
    claimMock.mockResolvedValueOnce(okClaim()).mockResolvedValue({ claimed: false, reason: 'limit', counted: false, overage: false, status: { per: 'month', used: 50, limit: 50 }, period: '202611' })
    const result = await priceHeldRequestsForPlan(quotesDb(rows).db, 'tnt_a', { now: NOW })
    expect(result).toEqual({ found: 3, priced: 1, stopped: 'limit' })
    expect(claimMock).toHaveBeenCalledTimes(2)
    expect(rows.map((r) => r.status)).toEqual(['queued', 'pending_review', 'pending_review'])
    expect(rows[1]!.content_json.limitHold).toBe(true)
  })

  it('leaves alone: a request older than 30 days, a test, another business\'s, one not held, one already priced', async () => {
    const { priceHeldRequestsForPlan } = await import('@/lib/held-requests')
    const rows = [
      held('old', 31),
      held('test', 2, { is_test: true }),
      held('theirs', 2, { tenant_id: 'tnt_b' }),
      held('review', 2, { content_json: {} }),
      held('sent', 2, { status: 'sent', content_json: {} }),
      held('mine', 2),
    ]
    const result = await priceHeldRequestsForPlan(quotesDb(rows).db, 'tnt_a', { now: NOW })
    expect(result).toEqual({ found: 1, priced: 1, stopped: null })
    expect(enqueueMock.mock.calls.map((call) => (call[0] as { quoteId: string }).quoteId)).toEqual(['mine'])
  })

  it('at most 20 in one run; the rest keep "Price this request"', async () => {
    const { priceHeldRequestsForPlan, HELD_AUTO_MAX, HELD_AUTO_DAYS } = await import('@/lib/held-requests')
    expect([HELD_AUTO_MAX, HELD_AUTO_DAYS]).toEqual([20, 30])
    const rows = Array.from({ length: 26 }, (_, i) => held(`q${String(i).padStart(2, '0')}`, 20 - i * 0.5))
    const result = await priceHeldRequestsForPlan(quotesDb(rows).db, 'tnt_a', { now: NOW })
    expect(result).toEqual({ found: 20, priced: 20, stopped: null })
    expect(rows.filter((r) => r.status === 'pending_review').length).toBe(6)
  })

  it('a request taken by another run a moment ago is not priced twice: the claim is given back', async () => {
    const { priceHeldRequest } = await import('@/lib/held-requests')
    const rows = [held('a', 2)]
    const { db } = quotesDb(rows)
    // the other run takes it between this run's claim and its write
    claimMock.mockImplementationOnce(async () => {
      rows[0]!.status = 'queued'
      rows[0]!.content_json = {}
      return okClaim()
    })
    const outcome = await priceHeldRequest(db, 'tnt_a', { id: 'a', quoteRequestId: 'qr_a' }, { automatic: true })
    expect(outcome).toEqual({ priced: false, why: 'not_held' })
    expect(releaseMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('the same purchase event twice prices each request once', async () => {
    const { priceHeldRequestsForPlan } = await import('@/lib/held-requests')
    const rows = [held('a', 3), held('b', 2)]
    const { db } = quotesDb(rows)
    await priceHeldRequestsForPlan(db, 'tnt_a', { now: NOW })
    const again = await priceHeldRequestsForPlan(db, 'tnt_a', { now: NOW })
    expect(again).toEqual({ found: 0, priced: 0, stopped: null })
    expect(claimMock).toHaveBeenCalledTimes(2)
    expect(enqueueMock).toHaveBeenCalledTimes(2)
  })

  it('nothing is priced uncounted, nothing for a suspended business, and a fault never reaches the purchase', async () => {
    const { priceHeldRequestsForPlan } = await import('@/lib/held-requests')
    // the count could not be written (the claim fails open for a customer's own request; not for a batch we start)
    claimMock.mockResolvedValue({ ...okClaim(), counted: false })
    let rows = [held('a', 2), held('b', 1)]
    expect(await priceHeldRequestsForPlan(quotesDb(rows).db, 'tnt_a', { now: NOW })).toEqual({ found: 2, priced: 0, stopped: 'not_counted' })
    expect(rows.every((r) => r.status === 'pending_review')).toBe(true)
    expect(enqueueMock).not.toHaveBeenCalled()

    claimMock.mockResolvedValue({ claimed: false, reason: 'suspended', counted: false, overage: false, status: { per: 'month', used: 0, limit: 50 }, period: '202611' })
    rows = [held('a', 2)]
    expect(await priceHeldRequestsForPlan(quotesDb(rows).db, 'tnt_a', { now: NOW })).toEqual({ found: 1, priced: 0, stopped: 'suspended' })

    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const broken = { from: () => { throw new Error('down') } } as unknown as SupabaseClient
    expect(await priceHeldRequestsForPlan(broken, 'tnt_a', { now: NOW })).toEqual({ found: 0, priced: 0, stopped: null })
    log.mockRestore()
  })

  it('a request the worker cannot be handed is marked failed (the business is told), and the run carries on', async () => {
    const { priceHeldRequestsForPlan } = await import('@/lib/held-requests')
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const rows = [held('a', 3), held('b', 2)]
    enqueueMock.mockRejectedValueOnce(new Error('worker down'))
    const result = await priceHeldRequestsForPlan(quotesDb(rows).db, 'tnt_a', { now: NOW })
    expect(result).toEqual({ found: 2, priced: 1, stopped: null })
    expect(failedMock).toHaveBeenCalledTimes(1)
    expect(failedMock.mock.calls[0]![1]).toBe('a')
    log.mockRestore()
  })

  it('"Price this request" may still use a plan\'s paid overage; the run after a purchase may not', async () => {
    const { priceHeldRequest } = await import('@/lib/held-requests')
    const rows = [held('a', 2), held('b', 2)]
    const { db } = quotesDb(rows)
    claimMock.mockResolvedValue({ ...okClaim(), overage: true })
    await priceHeldRequest(db, 'tnt_a', { id: 'a', quoteRequestId: 'qr_a' })
    expect((claimMock.mock.calls[0]![2] as { overage?: boolean }).overage).toBe(true)
    expect(overageMock).toHaveBeenCalledTimes(1)
    await priceHeldRequest(db, 'tnt_a', { id: 'b', quoteRequestId: 'qr_b' }, { automatic: true })
    expect((claimMock.mock.calls[1]![2] as { overage?: boolean }).overage).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('T-201 (34): customer emails carry the logo, and "Powered by" follows the plan', () => {
  const LOGO = 'https://qolumns.example/api/public/logo/ast_0123456789abcdef'
  const common = { customerName: 'Dev Raman', businessName: 'Harlow & Sons Painting', serviceName: 'Interior Painting' }
  const emails = (brand?: { logoUrl?: string | null; showPoweredBy?: boolean }) => ({
    quote: generateCustomerEmailHtml({ ...common, quoteViewUrl: 'u', total: '$450.00', brand }),
    revised: generateRevisedQuoteEmailHtml({ ...common, quoteViewUrl: 'u', total: '$450.00', brand }),
    reminder: generateQuoteReminderEmailHtml({ ...common, totalFormatted: '$450.00', quoteViewUrl: 'u', brand }),
  })

  it('the logo\'s address is the web app\'s own, and only for a real asset id', () => {
    expect(businessLogoUrl('https://qolumns.example/', 'ast_0123456789abcdef')).toBe(LOGO)
    expect(businessLogoUrl('https://qolumns.example', null)).toBeNull()
    expect(businessLogoUrl('https://qolumns.example', '')).toBeNull()
    expect(businessLogoUrl('https://qolumns.example', '../etc')).toBeNull()
    expect(businessLogoUrl('', 'ast_0123456789abcdef')).toBeNull()
    expect(businessLogoUrl(undefined, 'ast_0123456789abcdef')).toBeNull()
  })

  it('the logo block: a fixed height, the business\'s name when pictures are blocked, nothing when there is no logo', () => {
    const block = businessLogoBlock(LOGO, 'Harlow & Sons <Painting>')
    expect(block).toContain(`src="${LOGO}"`)
    expect(block).toContain('height="48"')
    expect(block).toContain('alt="Harlow &amp; Sons &lt;Painting&gt;"')
    expect(block).toContain('data-role="business-logo"')
    expect(businessLogoBlock(null, 'Harlow')).toBe('')
    expect(businessLogoBlock(undefined, 'Harlow')).toBe('')
  })

  it('"Powered by" shows unless the plan removes it', () => {
    expect(poweredByRow(true)).toContain(`Powered by ${PRODUCT_NAME}`)
    expect(poweredByRow(undefined)).toContain(`Powered by ${PRODUCT_NAME}`)
    expect(poweredByRow(false)).toBe('')
  })

  it('every email the web app sends to a customer: the logo above the business\'s name when there is one', () => {
    for (const [name, html] of Object.entries(emails({ logoUrl: LOGO, showPoweredBy: true }))) {
      expect(html, name).toContain(`<img src="${LOGO}"`)
      expect(html.indexOf('data-role="business-logo"'), name).toBeLessThan(html.indexOf('<h1'))
      expect(html, name).toContain('Harlow &amp; Sons Painting')
    }
    for (const [name, html] of Object.entries(emails({ logoUrl: null, showPoweredBy: true }))) expect(html, name).not.toContain('<img')
    for (const [name, html] of Object.entries(emails())) expect(html, name).not.toContain('<img')
  })

  it('…and "Powered by" stays on Starter and goes on Pro', () => {
    for (const [name, html] of Object.entries(emails({ showPoweredBy: true }))) expect(html, name).toContain(`Powered by ${PRODUCT_NAME}`)
    for (const [name, html] of Object.entries(emails())) expect(html, name).toContain(`Powered by ${PRODUCT_NAME}`)
    for (const [name, html] of Object.entries(emails({ showPoweredBy: false }))) expect(html, name).not.toContain('Powered by')
  })

  it('the rule is the estimate page\'s own: Pro and a payment being retried remove it, Starter and no plan keep it', async () => {
    const env = process.env.NEXT_PUBLIC_APP_URL
    process.env.NEXT_PUBLIC_APP_URL = 'https://qolumns.example'
    const brand = (subscription: Record<string, unknown> | null, used = 0, branding: unknown = { logoAssetId: 'ast_0123456789abcdef' }) =>
      customerEmailBrand(usageDb({ subscription, rows: [{ period_yyyymm: '202611', estimates_created: used, plan_estimates_created: 0 }] }), 'tnt_a', branding)
    expect(await brand({ plan_id: 'plan_us_pro', status: 'active' })).toEqual({ logoUrl: LOGO, showPoweredBy: false })
    expect(await brand({ plan_id: 'plan_us_pro', status: 'past_due' })).toEqual({ logoUrl: LOGO, showPoweredBy: false })
    expect(await brand({ plan_id: 'plan_us_starter', status: 'active' })).toEqual({ logoUrl: LOGO, showPoweredBy: true })
    expect(await brand({ plan_id: 'plan_us_pro', status: 'canceled' })).toEqual({ logoUrl: LOGO, showPoweredBy: true })
    // no plan and the free quotes used up: shown
    expect(await brand(null, 10)).toEqual({ logoUrl: LOGO, showPoweredBy: true })
    // the free start works like the plan that removes it (T-199), on the estimate page and so here
    expect(getPlan('plan_us_pro')!.features.custom_branding).toBe(true)
    expect(await brand(null, 3)).toEqual({ logoUrl: LOGO, showPoweredBy: false })
    // no logo set; and a read that fails shows the line
    expect(await brand({ plan_id: 'plan_us_starter', status: 'active' }, 0, {})).toEqual({ logoUrl: null, showPoweredBy: true })
    expect(await customerEmailBrand(usageDb({ subscription: null, rows: [], fail: true }), 'tnt_a', null)).toEqual({ logoUrl: null, showPoweredBy: true })
    expect(await customerEmailBrand(usageDb({ subscription: null, rows: [] }), null, null)).toEqual({ logoUrl: null, showPoweredBy: true })
    process.env.NEXT_PUBLIC_APP_URL = env
  })

  it('all five places the web app emails a customer pass it, and emails to the business are untouched', () => {
    const sites: Array<[string, number]> = [
      ['apps/web/src/app/api/quotes/[quoteId]/route.ts', 2],
      ['apps/web/src/app/api/quotes/[quoteId]/resend/route.ts', 1],
      ['apps/web/src/lib/quote-approval.ts', 1],
      ['apps/web/src/app/api/cron/lifecycle/route.ts', 1],
    ]
    for (const [file, count] of sites) expect(read(file).split('brand: await customerEmailBrand(').length - 1, file).toBe(count)
    // one piece of HTML for the line and the logo, in the shared package; no email file writes its own
    for (const file of ['apps/web/src/lib/postmark.ts', 'apps/web/src/lib/email-templates.ts', 'apps/worker/src/email/templates.ts']) {
      expect(read(file), file).not.toMatch(/Powered by \$\{PRODUCT_NAME\}/)
      expect(read(file), file).toContain('poweredByRow(')
      expect(read(file), file).toContain('businessLogoBlock(')
    }
    const templates = read('apps/web/src/lib/email-templates.ts')
    expect(templates.split('poweredByRow(data.brand?.showPoweredBy)').length - 1).toBe(2)
  })
})

describe('T-201 (34): the address an email\'s logo is served from', () => {
  const route = read('apps/web/src/app/api/public/logo/[assetId]/route.ts')

  it('serves a picture only when it is a business\'s logo today, by sending the reader on to it', () => {
    expect(route).toContain("if (!row || row.type !== 'image' || !row.r2_key) return notFound()")
    expect(route).toContain('if (current !== row.id) return notFound()')
    expect(route).toContain('NextResponse.redirect(url, { status: 302')
    // it reads no cookie and takes nothing but the id; the id is checked before the database is asked
    expect(route).not.toMatch(/cookies\(|createClient\(/)
    expect(route).toMatch(/if \(!\/\^\[A-Za-z0-9_-\]\{6,80\}\$\/\.test\(assetId\) \|\| !isR2Configured\(\)\) return notFound\(\)/)
    // every call looks the row up afresh in a built app (the rule for a GET route that reads the database)
    expect(route).toContain('requestHeaders()')
  })
})
