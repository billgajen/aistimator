/**
 * T-199: what a business can use.
 *   1. The one rule (packages/shared/src/access.ts): the free start works like
 *      Pro while free quotes are left; a plan gives its own features; nothing
 *      else gives any.
 *   2. Each switch-off when a business ends up without Pro features, and that
 *      nothing is deleted.
 *   3. The on-site quote route refuses without the capability.
 *   4. Nothing but the rule decides: no plan check is written inline.
 *   5. The words: Home's line, the tags, the free offer, the site's app lines.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CAPABILITIES,
  FREE_ALLOWANCE,
  FREE_START_PLAN_ID,
  NO_ACCESS,
  PLANS,
  appPlanLines,
  businessAccess,
  canUse,
  freeOfferLabel,
  freeStartLine,
  freeStartTag,
  getPlan,
  onsiteNotInPlan,
  planNameFor,
  planNamesFor,
  plansWith,
  whyNot,
  type Capability,
} from '@qolumns/shared'
import { memoryDb, type MemRow } from '../../../../packages/shared/src/testing/memory-db'
import { businessCan, loadAccess } from '@/lib/access'
import { accessView, whatsappAccess, whatsappAccessFor, whatsappAccessWithTag } from '@/lib/whatsapp-access'
import { SCAN_NOT_IN_PLAN, planHasRoomScan } from '@/lib/room-scan-intake'
import { hasCustomBranding } from '@/lib/plan-features'
import { PLAN_APP, PLAN_CHANNEL_LINES, PLAN_FEATURE_LINES, appPlanSentence, planCards, planLines, sitePlans } from '@/lib/marketing/plan-claims'
import { compareGroups } from '@/lib/marketing/pricing-copy'

const ROOT = join(__dirname, '../../../..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const ALL: Capability[] = Object.keys(CAPABILITIES) as Capability[]
const FREE = FREE_ALLOWANCE.US!.quotes
const PRO = getPlan('plan_us_pro')!
const STARTER = getPlan('plan_us_starter')!
const BUSINESS = getPlan('plan_us_business')!

const row = (plan_id: string, status = 'active') => ({ plan_id, status })
const access = (subscription: { plan_id: string; status: string } | null, quotesUsed: number | null = 0, region = 'US') => businessAccess({ subscription, region, quotesUsed })
const uses = (a: ReturnType<typeof businessAccess>) => ALL.filter((c) => canUse(a, c))

function db(tables: Record<string, MemRow[]>, fail: string[] = []) {
  return memoryDb(tables, { keys: { subscriptions: 'tenant_id' }, fail: new Set(fail) }) as unknown as SupabaseClient & { tables: Record<string, MemRow[]> }
}
const business = (over: { subscription?: MemRow | null; used?: number; region?: string } = {}) =>
  db({
    tenants: [{ id: 'tnt_a', region: over.region ?? 'US', suspended_at: null, slug: 'megan-grant-painting', own_address: 'megan' }],
    subscriptions: over.subscription ? [{ tenant_id: 'tnt_a', ...over.subscription }] : [],
    usage_counters: over.used === undefined ? [] : [{ id: 'u1', tenant_id: 'tnt_a', period_yyyymm: '202611', estimates_created: over.used }],
    whatsapp_connections: [{ id: 'w1', tenant_id: 'tnt_a', phone_number_id: 'kept' }],
  })

afterEach(() => vi.restoreAllMocks())

describe('T-199: the one rule', () => {
  it('the free start works like Pro: every feature and channel of it, while free quotes are left', () => {
    expect(FREE_START_PLAN_ID).toBe(PRO.id)
    for (const used of [0, 1, FREE - 1]) {
      const a = access(null, used)
      expect(a.basis, String(used)).toBe('free_start')
      expect(a.plan?.id).toBe(PRO.id)
      expect(a.freeLeft).toBe(FREE - used)
      expect(uses(a)).toEqual(uses(access(row(PRO.id))))
    }
    // what the owner listed: WhatsApp, on-site quotes, room scan, no badge, calibration insights, its own address
    expect(uses(access(null, 0)).sort()).toEqual(['calibration_insights', 'no_badge', 'onsite_quotes', 'own_address', 'room_scan', 'whatsapp'])
  })

  it('the allowance itself is unchanged: 10 priced quotes in total, and the free start ends with the last one', () => {
    expect(FREE_ALLOWANCE.US).toEqual({ quotes: 10, per: 'total' })
    for (const used of [FREE, FREE + 1, 250]) {
      const a = access(null, used)
      expect(a, String(used)).toEqual(NO_ACCESS)
      expect(uses(a)).toEqual([])
    }
  })

  it('a plan gives its own features: Starter gets Starter’s only, Pro and Business theirs', () => {
    const starter = access(row(STARTER.id), 3)
    expect(starter.basis).toBe('plan')
    // Pro-only things are off from the moment Starter starts, free quotes left or not
    expect(uses(starter)).toEqual([])
    expect(uses(access(row(PRO.id))).sort()).toEqual(['calibration_insights', 'no_badge', 'onsite_quotes', 'own_address', 'room_scan', 'whatsapp'])
    expect(uses(access(row(BUSINESS.id))).sort()).toEqual(['calibration_insights', 'no_badge', 'onsite_quotes', 'own_address', 'room_scan', 'whatsapp'])
    expect(access(row(PRO.id)).freeLeft).toBeNull()
  })

  it('every capability is read from the plan definitions, for every plan', () => {
    for (const plan of PLANS) {
      const a = access(row(plan.id))
      expect(canUse(a, 'whatsapp'), plan.id).toBe(plan.channels.includes('whatsapp'))
      expect(canUse(a, 'onsite_quotes'), plan.id).toBe(plan.channels.includes('mobile_app'))
      expect(canUse(a, 'room_scan'), plan.id).toBe(plan.features.lidar_scanning)
      expect(canUse(a, 'no_badge'), plan.id).toBe(plan.features.custom_branding)
      expect(canUse(a, 'own_address'), plan.id).toBe(plan.features.own_address)
    }
  })

  it('a payment being retried keeps the plan (the same grace as the quote limit); anything else that is not live gives nothing', () => {
    expect(uses(access(row(PRO.id, 'past_due'))).length).toBe(6)
    expect(uses(access(row(PRO.id, 'trialing'))).length).toBe(6)
    for (const status of ['canceled', 'unpaid', 'incomplete', 'paused', '']) {
      const a = access(row(PRO.id, status), 0)
      expect(a.basis, status).toBe('none')
      expect(uses(a), status).toEqual([])
      // the plan it held is remembered, so a page can say "paused" rather than "not in your plan"
      expect(a.lapsedPlan?.id).toBe(PRO.id)
      expect(whyNot(a, 'whatsapp')).toBe('subscription')
    }
  })

  it('cancelled gets none: a business that has had a subscription is never back on the free start, whatever it used', () => {
    expect(access(row(PRO.id, 'canceled'), 0)).toMatchObject({ basis: 'none', freeLeft: null })
    expect(access(row(STARTER.id, 'canceled'), 2).basis).toBe('none')
  })

  it('what could not be read gives nothing, and so does a plan nobody knows', () => {
    expect(access(null, null)).toEqual(NO_ACCESS)
    expect(access(null, Number.NaN)).toEqual(NO_ACCESS)
    expect(access(row('plan_made_up'))).toEqual(NO_ACCESS)
  })

  it('the free start is for the allowance that never resets: the older monthly allowance is not Pro for ever', () => {
    expect(FREE_ALLOWANCE.GB?.per).toBe('month')
    expect(access(null, 0, 'GB')).toEqual(NO_ACCESS)
  })

  it('names come from the plan definitions', () => {
    expect(planNameFor('onsite_quotes')).toBe(PRO.name)
    // T-200: Business is not offered, so no line names it as a plan to choose; the rule still joins two names
    expect(planNamesFor('own_address')).toBe(PRO.name)
    expect(plansWith('whatsapp').map((p) => p.id)).toEqual([PRO.id])
    expect(planNamesFor('own_address', [PRO, BUSINESS])).toBe(`${PRO.name} and ${BUSINESS.name}`)
  })
})

describe('T-199: the web app reads the rule in one place', () => {
  it('loadAccess: no subscription and free quotes left is the free start; every month’s quotes count', async () => {
    expect((await loadAccess(business(), 'tnt_a')).basis).toBe('free_start')
    expect((await loadAccess(business({ used: 4 }), 'tnt_a')).freeLeft).toBe(FREE - 4)
    const twoMonths = business({ used: 6 })
    twoMonths.tables.usage_counters!.push({ id: 'u2', tenant_id: 'tnt_a', period_yyyymm: '202610', estimates_created: 4 })
    expect(await loadAccess(twoMonths, 'tnt_a')).toEqual(NO_ACCESS)
  })

  it('another business’s quotes never count against this one', async () => {
    const d = business({ used: 2 })
    d.tables.usage_counters!.push({ id: 'u9', tenant_id: 'tnt_b', period_yyyymm: '202611', estimates_created: 50 })
    expect((await loadAccess(d, 'tnt_a')).freeLeft).toBe(FREE - 2)
  })

  it('any read that fails answers "nothing": a feature that needs a plan stays off', async () => {
    for (const table of ['subscriptions', 'usage_counters', 'tenants']) {
      expect(await loadAccess(business({ subscription: row(PRO.id) }), 'tnt_a').then((a) => a.basis)).toBe('plan')
      const broken = db({ tenants: [{ id: 'tnt_a', region: 'US' }], subscriptions: [{ tenant_id: 'tnt_a', ...row(PRO.id) }], usage_counters: [] }, [table])
      expect(await loadAccess(broken, 'tnt_a'), table).toEqual(NO_ACCESS)
    }
    expect(await loadAccess(db({ tenants: [], subscriptions: [], usage_counters: [] }), 'tnt_gone')).toEqual(NO_ACCESS)
  })

  it('no plan check is written inline: the old helpers are gone and nothing outside the rule reads a plan’s channels or features to decide', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(join(ROOT, dir))) {
        const path = `${dir}/${name}`
        if (name === 'node_modules' || name === '__tests__' || name === 'ios' || name === 'dist') continue
        if (statSync(join(ROOT, path)).isDirectory()) walk(path)
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) files.push(path)
      }
    }
    for (const dir of ['apps/web/src', 'apps/worker/src', 'apps/mobile/app', 'apps/mobile/src']) walk(dir)
    // the pages that DESCRIBE plans (Pricing's cards and table, the billing page's mapping) read the definitions; they decide nothing
    const describesPlans = ['apps/web/src/lib/marketing/plan-claims.ts', 'apps/web/src/lib/marketing/pricing-copy.ts', 'apps/web/src/lib/plans-view.ts']
    const inline = /\.channels\.includes\(|\.features\.(?:custom_branding|lidar_scanning|calibration_insights|own_address|multiple_users|priority_support|api_access)|plan\w*\.features\[|planHasChannel\(|hasPlanFeature|hasPlanChannel|getActivePlan|offeredPlansWithChannel/
    const found = files.filter((f) => !describesPlans.includes(f) && inline.test(read(f)))
    expect(found).toEqual([])
    // and the gates ask the rule
    expect(read('apps/web/src/lib/plan-features.ts')).toContain("businessCan(supabase, tenantId, 'no_badge')")
    expect(read('apps/web/src/lib/room-scan-intake.ts')).toContain("businessCan(supabase, tenantId, 'room_scan')")
    expect(read('apps/web/src/lib/whatsapp-access.ts')).toContain("canUse(access, 'whatsapp')")
    expect(read('apps/web/src/app/api/app/quotes/route.ts')).toContain("canUse(access, 'onsite_quotes')")
    expect(read('apps/web/src/lib/own-address.ts')).toContain("canUse(access, 'own_address')")
  })
})

describe('T-199: what switches off without Pro features, and nothing is deleted', () => {
  const without = [
    { name: 'free quotes used up', make: () => business({ used: FREE }) },
    { name: 'picks Starter', make: () => business({ subscription: row(STARTER.id), used: 2 }) },
    { name: 'cancels', make: () => business({ subscription: row(PRO.id, 'canceled'), used: 2 }) },
    { name: 'drops from Pro to Starter', make: () => business({ subscription: row(STARTER.id), used: 40 }) },
  ]

  it('WhatsApp: the assistant stops, exactly as for a business without the plan; on the free start and on Pro it speaks', async () => {
    expect(whatsappAccessFor(access(null, 0))).toEqual({ allowed: true })
    expect(whatsappAccessFor(access(row(PRO.id)))).toEqual({ allowed: true })
    expect(whatsappAccessFor(access(null, FREE))).toEqual({ allowed: false, why: 'plan' })
    expect(whatsappAccessFor(access(row(STARTER.id)))).toEqual({ allowed: false, why: 'plan' })
    expect(whatsappAccessFor(access(row(PRO.id, 'canceled')))).toEqual({ allowed: false, why: 'subscription' })
    expect(whatsappAccessFor(access(row(PRO.id)), true)).toEqual({ allowed: false, why: 'suspended' })
    for (const { name, make } of without) {
      const d = make()
      expect((await whatsappAccess(d as never, 'tnt_a')).allowed, name).toBe(false)
      // the business's own WhatsApp is untouched: its connection row is still there
      expect(d.tables.whatsapp_connections, name).toHaveLength(1)
    }
    expect((await whatsappAccess(business() as never, 'tnt_a')).allowed).toBe(true)
  })

  it('room scan: refused with the existing line', async () => {
    expect(SCAN_NOT_IN_PLAN).toEqual({ code: 'ROOM_SCAN_NOT_IN_PLAN', message: 'Room scan is part of Pro.' })
    for (const { name, make } of without) expect(await planHasRoomScan(make(), 'tnt_a'), name).toBe(false)
    expect(await planHasRoomScan(business(), 'tnt_a')).toBe(true)
    expect(await planHasRoomScan(business({ subscription: row(PRO.id) }), 'tnt_a')).toBe(true)
  })

  it('branding: the "Prepared with" badge returns', async () => {
    for (const { name, make } of without) expect(await hasCustomBranding(make(), 'tnt_a'), name).toBe(false)
    expect(await hasCustomBranding(business(), 'tnt_a')).toBe(true)
    expect(await hasCustomBranding(business({ subscription: row(BUSINESS.id) }), 'tnt_a')).toBe(true)
  })

  it('on-site quotes and its own address go too, and come back on moving up', async () => {
    for (const { name, make } of without) {
      const d = make()
      expect(await businessCan(d, 'tnt_a', 'onsite_quotes'), name).toBe(false)
      expect(await businessCan(d, 'tnt_a', 'own_address'), name).toBe(false)
      // the address is still the business's own: nothing was written or removed by asking
      expect(d.tables.tenants![0]!.own_address, name).toBe('megan')
      // moving up to Pro: everything is back, from the same rows
      d.tables.subscriptions!.splice(0, 1, { tenant_id: 'tnt_a', ...row(PRO.id) })
      expect(await businessCan(d, 'tnt_a', 'onsite_quotes'), name).toBe(true)
      expect(await businessCan(d, 'tnt_a', 'own_address'), name).toBe(true)
      expect((await whatsappAccess(d as never, 'tnt_a')).allowed, name).toBe(true)
    }
  })

  it('asking what a business can use never writes or deletes anything', async () => {
    const d = business({ used: FREE }) as unknown as ReturnType<typeof memoryDb>
    const client = d as unknown as SupabaseClient
    await loadAccess(client, 'tnt_a')
    await whatsappAccessWithTag(client as never, 'tnt_a')
    await planHasRoomScan(client, 'tnt_a')
    await hasCustomBranding(client, 'tnt_a')
    expect(d.log.filter((entry) => entry.op !== 'select')).toEqual([])
    for (const file of ['apps/web/src/lib/access.ts', 'apps/web/src/lib/plan-features.ts', 'packages/shared/src/access.ts']) {
      expect(read(file), file).not.toMatch(/\.(delete|update|insert|upsert)\(/)
    }
  })
})

describe('T-199: the on-site quote route', () => {
  const route = read('apps/web/src/app/api/app/quotes/route.ts')

  it('refuses a business without on-site quotes, in the screen’s own words, before anything is made', () => {
    const words = onsiteNotInPlan()
    expect(words).toEqual({
      code: 'ONSITE_QUOTES_NOT_IN_PLAN',
      heading: 'On-site quotes are part of Pro',
      text: 'Your plan includes everything else in the app. To add on-site quotes, change your plan in your Qolumns account.',
      button: 'OK',
    })
    const refusal = route.indexOf("canUse(access, 'onsite_quotes')")
    expect(refusal).toBeGreaterThan(0)
    expect(route.slice(refusal, refusal + 400)).toMatch(/status: 403/)
    // decided before the intake that saves a request and counts it on the plan
    expect(refusal).toBeLessThan(route.indexOf('createQuoteSubmission('))
    // but after the answer for a send that already made its quote: nothing made is refused
    expect(refusal).toBeGreaterThan(route.indexOf('alreadyCreated: true'))
  })

  it('the app is open to everyone: no other app route asks about on-site quotes', () => {
    for (const file of ['apps/web/src/app/api/app/account/route.ts', 'apps/web/src/app/api/app/push-token/route.ts', 'apps/web/src/app/api/app/quotes/[quoteId]/route.ts']) {
      expect(read(file), file).not.toMatch(/onsite_quotes|ONSITE_QUOTES/)
    }
    // the app is told, so it can show the screen without starting anything
    const boot = read('apps/web/src/app/api/app/bootstrap/route.ts')
    expect(boot).toContain("onsiteQuotes: canUse(access, 'onsite_quotes')")
    expect(boot).toContain("roomScan: canUse(access, 'room_scan')")
  })

  it('the words carry no price, no link and no way to buy (the App Store rule)', () => {
    const { heading, text, button } = onsiteNotInPlan()
    expect(`${heading} ${text} ${button}`).not.toMatch(/[$£€]|\d+\s?(a|per) month|https?:|www\.|\.com|upgrade|\bbuy\b|purchase|subscribe|website|pay\b/i)
  })
})

describe('T-199: the words', () => {
  it('Home, on the free start: one line, with what is left', () => {
    expect(freeStartLine(access(null, 3))).toBe("You're trying everything in Pro. 7 free quotes left.")
    expect(freeStartLine(access(null, FREE - 1))).toBe("You're trying everything in Pro. 1 free quote left.")
    for (const a of [access(null, FREE), access(row(PRO.id)), access(row(STARTER.id)), NO_ACCESS]) expect(freeStartLine(a)).toBeNull()
    const home = read('apps/web/src/app/(dashboard)/app/page.tsx')
    expect(home).toContain('freeStartLine(access)')
    expect(home).not.toMatch(/trying everything/)
  })

  it('the small tag names the plan that keeps a feature, only on the free start', () => {
    const trying = access(null, 2)
    for (const capability of ['whatsapp', 'room_scan', 'own_address'] as const) expect(freeStartTag(trying, capability)).toBe('Pro')
    for (const a of [access(row(PRO.id)), access(row(STARTER.id)), access(null, FREE)]) expect(freeStartTag(a, 'whatsapp')).toBeNull()
    expect(accessView({ allowed: true }, 'Pro')).toMatchObject({ allowed: true, tag: 'Pro' })
    // where it shows: the WhatsApp page, the Quote link page's cards, the room scan card
    expect(read('apps/web/src/app/(dashboard)/app/whatsapp/page.tsx')).toContain('<PlanTag name={data?.access?.tag} />')
    expect(read('apps/web/src/components/share/OwnAddressCard.tsx')).toContain('<PlanTag name={view.tag} />')
    expect(read('apps/web/src/components/room-scan/RoomScanCard.tsx')).toContain('<PlanTag name={tag}')
    // the tag is never yellow and never types a plan's name
    const tag = read('apps/web/src/components/dashboard/PlanTag.tsx')
    expect(tag).not.toMatch(/accent|>Pro</)
  })

  it('the free offer reads "Try every Pro feature free: 10 quotes, no card", built from the plan definitions', () => {
    expect(freeOfferLabel()).toBe('Try every Pro feature free: 10 quotes, no card')
    expect(freeOfferLabel()).toBe(`Try every ${PRO.name} feature free: ${FREE} quotes, no card`)
  })

  it('the site: the mobile app is on every plan, on-site quotes in it on the plans that have them', () => {
    expect(appPlanLines()).toEqual({ everyPlan: 'Mobile app: every plan', onsite: 'On-site quotes in the app: Pro' })
    // the public pages name only the plans they show
    expect(appPlanSentence()).toBe(`Mobile app: every plan. On-site quotes in the app: ${planNamesFor('onsite_quotes', sitePlans())}.`)
    for (const plan of PLANS.filter((p) => p.offered)) {
      const labels = planLines(plan).map((l) => l.label)
      expect(labels, plan.id).toContain(PLAN_APP.label)
      expect(labels.includes(PLAN_CHANNEL_LINES.mobile_app.label), plan.id).toBe(plan.channels.includes('mobile_app'))
      expect(labels.includes(PLAN_FEATURE_LINES.own_address!.label), plan.id).toBe(plan.features.own_address)
    }
    // one flag for both app lines: the app is released or it is not
    expect(PLAN_APP.live).toBe(PLAN_CHANNEL_LINES.mobile_app.live)
    expect(PLAN_CHANNEL_LINES.mobile_app.label).toMatch(/^On-site quotes in the app/)
    // Starter's card has the app; Pro's adds on-site quotes and its own address
    const [starter, pro] = planCards()
    expect(starter!.lines.map((l) => l.label)).toContain(PLAN_APP.label)
    expect(pro!.lines.map((l) => l.label)).toEqual(expect.arrayContaining([PLAN_CHANNEL_LINES.mobile_app.label, PLAN_FEATURE_LINES.own_address!.label]))
    expect(pro!.lines.map((l) => l.label)).not.toContain(PLAN_APP.label)
    // the compare table: the app for every shown plan, on-site quotes only where the plan has them
    const rows = compareGroups().flatMap((g) => g.rows)
    const appRow = rows.find((r) => r.label === PLAN_APP.label)!
    const onsiteRow = rows.find((r) => r.label === PLAN_CHANNEL_LINES.mobile_app.label)!
    expect(appRow.cells.every((cell) => cell !== false)).toBe(true)
    expect(onsiteRow.cells.map((cell) => cell !== false)).toEqual(sitePlans().map((p) => p.channels.includes('mobile_app')))
  })

  it('own address: "Your own address: yourname.qolumns.com", coming soon until it is switched on', () => {
    const line = PLAN_FEATURE_LINES.own_address!
    expect(line.label).toBe('Your own address: yourname.qolumns.com')
    // this test runs without NEXT_PUBLIC_OWN_ADDRESS_HOST: the feature is off
    expect(process.env.NEXT_PUBLIC_OWN_ADDRESS_HOST ?? '').toBe('')
    expect(line.live).toBe(false)
    expect(read('apps/web/src/lib/marketing/plan-claims.ts')).toContain('live: ownAddressLive()')
  })
})
