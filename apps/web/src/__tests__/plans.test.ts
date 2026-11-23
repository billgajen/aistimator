import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  PLANS,
  appPlanLines,
  billingPagePlans,
  getPlan,
  offeredPlans,
  onsiteNotInPlan,
  planNamesFor,
  noSubscriptionLimit,
  stripePriceEnvKey,
  stripePriceIdFor,
  planForStripePrice,
  usageLevel,
} from '@qolumns/shared'
import { checkPlanLimit } from '@/lib/plan-limits'
import { getCurrentPeriod } from '@/lib/usage'
import { toPlanInfo } from '@/lib/plans-view'
import { leadHoldContent, leadHeldMessage } from '@/lib/lead-hold'
import { offeredPlanId } from '@/lib/signup-choices'
import { upgradeLine } from '@/lib/whatsapp-access'
import { helpFacts } from '@/lib/help/guide'
import type { SupabaseClient } from '@supabase/supabase-js'

const read = (path: string) => readFileSync(join(__dirname, '..', '..', '..', '..', path), 'utf8')

describe('plan definitions — one source (T-134)', () => {
  it('offers only the subscription-only US tiers, overage off', () => {
    const offered = offeredPlans()
    // T-200: Business is not offered (a business that holds it keeps it)
    expect(offered.map((p) => p.id)).toEqual(['plan_us_starter', 'plan_us_pro'])
    expect(offered.every((p) => p.overageEnabled === false)).toBe(true)
    expect(offered.map((p) => p.quoteLimit)).toEqual([50, 200])
  })

  it('T-200: Business is not offered; a business that holds it keeps it and sees it on its billing page', () => {
    const business = getPlan('plan_us_business')!
    const [starter, pro] = offeredPlans()
    expect(business.offered).toBe(false)
    // the plan itself is whole: its limit, channels and features are what the holder is given
    expect([business.quoteLimit, business.channels.includes('whatsapp'), business.features.multiple_users]).toEqual([600, true, true])
    // the billing page: the two on offer for everyone else; the holder's own plan after them
    expect(billingPagePlans(null).map((p) => p.id)).toEqual(['plan_us_starter', 'plan_us_pro'])
    expect(billingPagePlans(starter).map((p) => p.id)).toEqual(['plan_us_starter', 'plan_us_pro'])
    expect(billingPagePlans(pro).map((p) => p.id)).toEqual(['plan_us_starter', 'plan_us_pro'])
    expect(billingPagePlans(business).map((p) => p.id)).toEqual(['plan_us_starter', 'plan_us_pro', 'plan_us_business'])
    // it cannot be bought or picked at sign-up, and its Stripe price still maps to it (the webhook of a holder)
    expect(read('apps/web/src/app/api/billing/checkout/route.ts')).toContain("if (!plan || !plan.offered) return refuse(404, 'PLAN_NOT_FOUND', 'Plan not found')")
    expect(offeredPlanId('plan_us_business')).toBeNull()
    expect(offeredPlanId('plan_us_pro')).toBe('plan_us_pro')
    expect(planForStripePrice('price_business_monthly', { STRIPE_PRICE_US_BUSINESS_MONTHLY_USD: 'price_business_monthly' })?.plan.id).toBe('plan_us_business')
    // no line names it as a plan to choose: the site, the help guide's facts, the WhatsApp page, the app's screen
    const said = [planNamesFor('whatsapp'), planNamesFor('onsite_quotes'), planNamesFor('room_scan'), planNamesFor('no_badge'), planNamesFor('own_address'), appPlanLines().onsite, onsiteNotInPlan().heading, upgradeLine(), ...Object.values(helpFacts().tokens)].join(' | ')
    expect(said).not.toMatch(/\bBusiness\b/)
    expect(said).toContain('WhatsApp quoting is part of the Pro plan.')
    // the billing page centres the pair, and gives a holder's own plan a third card
    const page = read('apps/web/src/app/(dashboard)/app/settings/billing/page.tsx')
    expect(page).toContain("(data?.availablePlans.length ?? 0) > 2 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'mx-auto max-w-3xl sm:grid-cols-2'")
  })

  it('prices annual at 10 × monthly (two months free), and no plan has a trial (T-165: one free offer)', () => {
    for (const p of offeredPlans()) expect(p.annualPrice?.USD).toBe((p.monthlyPrice.USD ?? 0) * 10)
    expect(offeredPlans().filter((p) => p.trialDays).map((p) => [p.id, p.trialDays])).toEqual([])
  })

  it('keeps legacy plans (existing subscribers) with their limits and overage', () => {
    expect(getPlan('plan_starter')).toMatchObject({ quoteLimit: 200, overageEnabled: true, overagePriceCents: 50, offered: false })
    expect(getPlan('plan_pro')?.quoteLimit).toBe(3000)
    expect(getPlan('nope')).toBeNull()
  })

  it('has no free tier for US; GB keeps its legacy allowance', () => {
    expect(noSubscriptionLimit('US')).toBe(10)
    expect(noSubscriptionLimit('GB')).toBe(50)
    expect(noSubscriptionLimit(null)).toBe(50)
  })

  it('maps Stripe price ids through env both ways', () => {
    expect(stripePriceEnvKey('plan_us_pro', 'annual', 'usd')).toBe('STRIPE_PRICE_US_PRO_ANNUAL_USD')
    const env = { STRIPE_PRICE_US_PRO_MONTHLY_USD: 'price_pro_m', STRIPE_PRICE_US_PRO_ANNUAL_USD: 'price_pro_y' }
    expect(stripePriceIdFor('plan_us_pro', 'monthly', 'USD', env)).toBe('price_pro_m')
    expect(planForStripePrice('price_pro_y', env)).toMatchObject({ plan: { id: 'plan_us_pro' }, interval: 'annual' })
    expect(planForStripePrice('price_unknown', env)).toBeNull()
  })

  it('classifies usage for the 80% banner and 100% paywall', () => {
    expect(usageLevel(39, 50)).toBe('ok')
    expect(usageLevel(40, 50)).toBe('warning')
    expect(usageLevel(50, 50)).toBe('limit')
    expect(usageLevel(500, 0)).toBe('ok') // unlimited
  })

  it('maps a definition to the API shape without re-typing numbers', () => {
    const info = toPlanInfo(getPlan('plan_us_pro')!)
    expect(info).toMatchObject({ priceCents: 9900, annualPriceCents: 99000, monthlyEstimateLimit: 200, trialDays: null, overagePriceCents: null })
    expect(PLANS.length).toBeGreaterThan(3)
  })
})

describe('limit enforcement reads the config (T-134)', () => {
  function db(sub: Record<string, unknown> | null, used: number, region = 'US') {
    const rows: Record<string, unknown> = {
      subscriptions: sub,
      // T-152: checkPlanLimit reads every month's counter row
      usage_counters: [{ period_yyyymm: getCurrentPeriod(), estimates_created: used }],
      tenants: { region },
    }
    return {
      from: (table: string) => {
        const api = {
          select: () => api,
          eq: () => api,
          single: async () => ({ data: rows[table] ?? null }),
          then: (resolve: (v: { data: unknown }) => void) => resolve({ data: rows[table] ?? null }),
        }
        return api
      },
    } as unknown as SupabaseClient
  }

  it('Starter quote #51 is over the limit and NOT billable (held as a lead)', async () => {
    const s = await checkPlanLimit(db({ status: 'active', plan_id: 'plan_us_starter', stripe_customer_id: 'cus_1', plans: { stripe_metered_price_id: 'price_meter' } }, 50), 't')
    expect(s.allowed).toBe(false)
    expect(s.overageAvailable).toBe(false) // overage off → caller captures a lead
    expect(s.limit).toBe(50)
  })

  it('legacy overage plans still meter beyond the limit', async () => {
    const s = await checkPlanLimit(db({ status: 'active', plan_id: 'plan_starter', stripe_customer_id: 'cus_1', plans: { stripe_metered_price_id: 'price_meter' } }, 200, 'GB'), 't')
    expect(s.allowed).toBe(false)
    expect(s.overageAvailable).toBe(true)
    expect(s.overagePriceCents).toBe(50)
  })

  it('trialing Pro gets the Pro limit; no subscription gets the region allowance', async () => {
    expect((await checkPlanLimit(db({ status: 'trialing', plan_id: 'plan_us_pro' }, 0), 't')).limit).toBe(200)
    expect((await checkPlanLimit(db(null, 0, 'US'), 't')).limit).toBe(10)
    expect((await checkPlanLimit(db({ status: 'canceled', plan_id: 'plan_us_pro' }, 0, 'GB'), 't')).limit).toBe(50)
  })

  it('held leads carry the dashboard flag and a billing-neutral customer message', () => {
    expect(leadHoldContent('Ace Painting')).toMatchObject({ limitHold: true })
    expect(leadHeldMessage('Ace Painting')).toBe('Thanks — Ace Painting has your request and will send your estimate shortly.')
    expect(leadHeldMessage('Ace Painting')).not.toMatch(/limit|plan|upgrade/i)
  })
})
