/**
 * T-153: the public demo — the example business's services, its limits, its
 * exclusions from every count, the 24-hour clean-up, and the flag nobody can set.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { DEMO_SLUG, DEMO_MAX_PHOTOS, DEMO_CONTACT, demoDailyCap, DEFAULT_DEMO_DAILY_CAP, findConfidenceLanguage } from '@estimator/shared'
import { demoServiceBodies, DEMO_SERVICE_PICKS } from '@/lib/demo/demo-services'
import { decideDemo, demoIpHash, demoIpLimit, DEFAULT_DEMO_IP_LIMIT_PER_HOUR } from '@/lib/demo/demo-guard'
import { cleanUpDemoRequests, demoCutoff } from '@/lib/demo/demo-cleanup'
import { RECORDED_EXAMPLE } from '@/lib/demo/recorded-example'
import { serviceInsertRow, pricingRulesRow, widgetConfigRow } from '@/lib/service-rows'
import { slugProblem } from '@/lib/tenant-slug'
import { garageDoorsPackUS } from '@/lib/vertical-packs/garage-doors-us'

const ROOT = join(__dirname, '..', '..', '..', '..')
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')

describe('T-153: the demo business’s services', () => {
  const bodies = demoServiceBodies({ maxPhotos: DEMO_MAX_PHOTOS })

  it('three services from the packs; at least two need no photo', () => {
    expect(bodies.map((b) => b.name)).toEqual(['Garage Door Spring Replacement', 'Water Heater Replacement', 'Interior Painting'])
    expect(bodies.filter((b) => b.mediaConfig?.minPhotos === 0).length).toBeGreaterThanOrEqual(2)
  })

  it('every service sends automatically and takes one photo at most', () => {
    for (const b of bodies) {
      expect(b.autoSend).toBe(true)
      expect(b.holdUntilApproved).toBe(false)
      expect(b.mediaConfig!.maxPhotos).toBeLessThanOrEqual(1)
      expect((b.mediaConfig!.requiredAngles ?? []).length).toBeLessThanOrEqual(1)
      expect(b.draftConfig!.media.maxPhotos).toBe(b.mediaConfig!.maxPhotos)
    }
    const heater = bodies.find((b) => b.name === 'Water Heater Replacement')!
    expect(heater.mediaConfig!.minPhotos).toBe(1)
    expect(heater.mediaConfig!.requiredAngles!.map((a) => a.id)).toEqual(['rating_label'])
  })

  it('AD-001: the prices are the packs’ own, unchanged', () => {
    for (const [i, pick] of DEMO_SERVICE_PICKS.entries()) {
      const svc = pick.pack.services.find((s) => s.name === pick.name)!
      expect(bodies[i]!.pricingRules!.workSteps).toEqual(svc.draft.pricing.workSteps)
      expect(bodies[i]!.pricingRules!.addons).toEqual(svc.addons ?? [])
      expect(bodies[i]!.pricingRules!.baseFee).toBe(svc.draft.pricing.baseFee)
    }
  })

  it('the seed writes the same rows as POST /api/services', () => {
    const row = serviceInsertRow('tnt_x', bodies[0]!)
    expect(row).toMatchObject({ tenant_id: 'tnt_x', auto_send: true, hold_until_approved: false, active: true })
    expect(pricingRulesRow('tnt_x', 'svc_1', bodies[0]!).rules_json.workSteps).toEqual(bodies[0]!.workSteps)
    expect(widgetConfigRow('tnt_x', 'svc_1', bodies[0]!)?.config_json.fields.map((f) => f.fieldId)).toEqual(['spring_count'])
    const route = read('apps/web/src/app/api/services/route.ts')
    for (const fn of ['serviceInsertRow(', 'pricingRulesRow(', 'widgetConfigRow(']) expect(route).toContain(fn)
    const seed = read('scripts/seed-demo-tenant.mts')
    for (const fn of ['serviceInsertRow(', 'pricingRulesRow(', 'widgetConfigRow(', 'demoServiceBodies(']) expect(seed).toContain(fn)
  })

  it('the recorded example still matches what the demo would charge', () => {
    const spring = garageDoorsPackUS.services.find((s) => s.name === 'Garage Door Spring Replacement')!
    const pair = spring.draft.pricing.workSteps.find((s) => s.name === 'Torsion spring replacement (pair)')!
    expect(RECORDED_EXAMPLE.lines).toEqual([{ label: pair.name, amount: pair.defaultCost }])
    expect(RECORDED_EXAMPLE.total).toBe(pair.defaultCost)
    expect(findConfidenceLanguage(JSON.stringify(RECORDED_EXAMPLE))).toEqual([])
  })
})

describe('T-153: the demo’s limits', () => {
  const limits = { dailyCap: 200, ipPerHour: 5 }

  it('the global daily cap, then the per-IP limit', () => {
    expect(decideDemo({ last24h: 0, ipLastHour: 0 }, limits)).toBe('ok')
    expect(decideDemo({ last24h: 200, ipLastHour: 0 }, limits)).toBe('daily_cap')
    expect(decideDemo({ last24h: 10, ipLastHour: 5 }, limits)).toBe('ip_limit')
    expect(decideDemo({ last24h: 10, ipLastHour: 4 }, limits)).toBe('ok')
  })

  it('both come from env, with safe defaults', () => {
    expect(demoDailyCap({})).toBe(DEFAULT_DEMO_DAILY_CAP)
    expect(demoDailyCap({ DEMO_DAILY_CAP: '25' })).toBe(25)
    expect(demoDailyCap({ DEMO_DAILY_CAP: '0' })).toBe(0) // 0 turns live demo runs off
    expect(demoDailyCap({ DEMO_DAILY_CAP: 'lots' })).toBe(DEFAULT_DEMO_DAILY_CAP)
    expect(demoIpLimit({})).toBe(DEFAULT_DEMO_IP_LIMIT_PER_HOUR)
    expect(demoIpLimit({ DEMO_IP_LIMIT_PER_HOUR: '2' })).toBe(2)
  })

  it('the IP is stored only as a salted hash', () => {
    const env = { SUPABASE_SERVICE_ROLE_KEY: 'k' }
    const h = demoIpHash('203.0.113.7', env)
    expect(h).toMatch(/^[a-f0-9]{32}$/)
    expect(h).not.toContain('203')
    expect(demoIpHash('203.0.113.7', env)).toBe(h)
    expect(demoIpHash('203.0.113.8', env)).not.toBe(h)
    expect(demoIpHash('203.0.113.7', { SUPABASE_SERVICE_ROLE_KEY: 'other' })).not.toBe(h)
  })

  it('the public route checks the demo limits before any record is made, and the widget shows the example', () => {
    const route = read('apps/web/src/app/api/public/quotes/route.ts')
    expect(route.indexOf('checkDemoAllowance(')).toBeGreaterThan(0)
    expect(route.indexOf('checkDemoAllowance(')).toBeLessThan(route.indexOf('createQuoteSubmission('))
    expect(route).toMatch(/demoBusyResponse/)
    // Turnstile, honeypot and the normal quotes rate limit run first, as for real requests
    expect(route.indexOf("checkPublicRateLimit('quotes'")).toBeLessThan(route.indexOf('checkDemoAllowance('))
    expect(route.indexOf('verifyTurnstileToken(')).toBeLessThan(route.indexOf('checkDemoAllowance('))
    const widget = read('apps/web/src/components/embed/EstimateWidget.tsx')
    expect(widget).toMatch(/demo && response\.status === 429[\s\S]{0,300}demo\.onBusy\(\)/)
    // the demo never promises an email (none is sent)
    expect(widget).toContain("hasEmail={!demo && (")
  })
})

describe('T-153: demo requests count toward nothing and email no one', () => {
  it('intake: outside any plan, never usage', () => {
    const intake = read('apps/web/src/lib/quote-intake.ts')
    expect(intake).toContain("const outsidePlan = isTest || input.isDemo === true")
    expect(intake).toMatch(/if \(!outsidePlan\) \{\s*\n\s*await incrementUsageCounter/)
    // a demo quote is not a "test" quote (no Test badge, no test semantics)
    expect(intake).toContain('is_test: isTest,')
  })

  it('worker: no emails, no usage, no adjudication, one photo — and the flag is in its projection', () => {
    const worker = read('apps/worker/src/quote-processor.ts')
    expect(worker).toContain('is_demo: quote.is_demo === true')
    expect(worker).toMatch(/const emailOn = quoteData\.quote\.is_demo !== true && isEmailConfigured/)
    expect((worker.match(/isEmailConfigured\(/g) ?? []).length).toBe(1)
    expect(worker).toContain("quoteData.quote.is_test !== true && quoteData.quote.is_demo !== true")
    expect(worker).toMatch(/decision\.shouldAdjudicate && quoteData\.quote\.is_demo === true/)
    expect(worker).toMatch(/is_demo === true \? Math\.min\(DEMO_PHOTO_CAP/)
    expect(worker).toContain('const DEMO_PHOTO_CAP = 1')
    expect(DEMO_MAX_PHOTOS).toBe(1)
  })

  it('no unfinished lead, no reminder, no calibration, no benchmark, not in the admin tenant list', () => {
    expect(read('apps/web/src/app/api/public/leads/route.ts')).toMatch(/is_demo\) return NextResponse\.json\(\{ skipped: true \}\)/)
    expect(read('apps/web/src/app/api/cron/lifecycle/route.ts')).toContain(".eq('is_demo', false)")
    expect(read('apps/web/src/lib/measurement-memory.ts')).toContain('if (quote.is_demo) return')
    expect(read('apps/web/src/app/api/learning/benchmarks/route.ts')).toContain(".eq('is_demo', false)")
    expect(read('apps/web/src/app/api/admin/tenants/route.ts')).toContain(".eq('is_demo', false)")
    for (const r of ['accept', 'decline', 'feedback']) {
      expect(read(`apps/web/src/app/api/public/quotes/[quoteId]/${r}/route.ts`)).toMatch(/isPostmarkConfigured\(\) && !\(quote as \{ is_demo\?: boolean \}\)\.is_demo/)
    }
  })

  it('the pre-filled contact details are reserved, undeliverable examples', () => {
    expect(DEMO_CONTACT.email.endsWith('@example.com')).toBe(true)
    expect(DEMO_CONTACT.phone).toMatch(/555\) 010-01\d\d/)
  })
})

describe('T-153: the demo flag', () => {
  const migration = read('supabase/migrations/00000000000036_public_demo.sql')

  it('only the service role can set or change it; quotes copy it from their tenant', () => {
    expect(migration).toMatch(/CREATE TRIGGER tenants_demo_guard\s+BEFORE INSERT OR UPDATE OF is_demo ON tenants/)
    expect(migration).toMatch(/coalesce\(auth\.jwt\(\) ->> 'role', 'service_role'\) <> 'service_role'/)
    expect(migration).toMatch(/NEW\.is_demo := coalesce\(\(SELECT t\.is_demo FROM tenants t WHERE t\.id = NEW\.tenant_id\), false\)/)
    expect(migration).toMatch(/NEW\.is_demo := OLD\.is_demo/)
  })

  it('no tenant or public API accepts or returns it', () => {
    for (const f of [
      'apps/web/src/app/api/tenant/route.ts',
      'apps/web/src/app/api/tenant/branding/route.ts',
      'apps/web/src/app/api/quotes/[quoteId]/route.ts',
      'apps/web/src/app/api/quotes/route.ts',
      'apps/web/src/app/api/public/quotes/[quoteId]/route.ts',
    ]) {
      expect(read(f)).not.toMatch(/is_demo|isDemo/)
    }
    const config = read('apps/web/src/app/api/public/widget/config/route.ts')
    expect(config).not.toMatch(/isDemo\s*:|is_demo\s*:/)
  })

  it('the demo slug is reserved for everyone else', () => {
    expect(slugProblem(DEMO_SLUG)).toBe('reserved')
    expect(migration).toContain(`('${DEMO_SLUG}')`)
  })
})

describe('T-153: clean-up after 24 hours', () => {
  it('the cut-off is the retention period ago', () => {
    expect(demoCutoff(new Date('2026-11-10T12:00:00Z'), 24)).toBe('2026-11-09T12:00:00.000Z')
  })

  /** A fake Supabase that records every query and its filters */
  function fake(rows: Record<string, Array<Record<string, unknown>>>) {
    const log: Array<{ table: string; op: string; filters: Array<[string, string, unknown]> }> = []
    const from = (table: string) => {
      const entry = { table, op: 'select', filters: [] as Array<[string, string, unknown]> }
      log.push(entry)
      const chain = {
        select: () => chain,
        delete: () => ((entry.op = 'delete'), chain),
        eq: (c: string, v: unknown) => (entry.filters.push(['eq', c, v]), chain),
        in: (c: string, v: unknown) => (entry.filters.push(['in', c, v]), chain),
        lt: (c: string, v: unknown) => (entry.filters.push(['lt', c, v]), chain),
        limit: () => chain,
        then: (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: entry.op === 'delete' ? null : rows[table] ?? [], error: null }),
      }
      return chain
    }
    return { supabase: { from } as never, log }
  }
  const rows = {
    tenants: [{ id: 'tnt_demo' }],
    assets: [{ id: 'ast_1', r2_key: 'tnt_demo/req/1.png' }],
    quotes: [{ id: 'qte_1', quote_request_id: 'qr_1' }],
    quote_requests: [{ id: 'qr_1', quotes: [] }, { id: 'qr_2', quotes: [{ id: 'qte_keep' }] }],
  }

  it('deletes objects, then assets, quotes and requests — only the demo tenant’s, only older than the cut-off', async () => {
    const deleted: string[][] = []
    const { supabase, log } = fake(rows)
    const out = await cleanUpDemoRequests(supabase, { now: new Date('2026-11-10T12:00:00Z'), retentionHours: 24, deleteObjects: async (k) => (deleted.push(k), k.length) })
    expect(out).toEqual({ quotes: 1, requests: 1, assets: 1, objects: 1 })
    expect(deleted).toEqual([['tnt_demo/req/1.png']])
    expect(log[0]).toMatchObject({ table: 'tenants', filters: [['eq', 'is_demo', true]] })
    const deletes = log.filter((l) => l.op === 'delete').map((l) => l.table)
    expect(deletes).toEqual(['assets', 'quotes', 'quote_requests'])
    for (const l of log.filter((l) => l.op === 'select' && l.table !== 'tenants')) {
      expect(l.filters).toContainEqual(['in', 'tenant_id', ['tnt_demo']])
      expect(l.filters).toContainEqual(['lt', 'created_at', '2026-11-09T12:00:00.000Z'])
    }
    // a request that still has a quote is kept
    expect(log.find((l) => l.op === 'delete' && l.table === 'quote_requests')!.filters).toContainEqual(['in', 'id', ['qr_1']])
  })

  it('keeps the rows when the object store fails, so the next run retries', async () => {
    const { supabase, log } = fake(rows)
    const out = await cleanUpDemoRequests(supabase, { retentionHours: 24, deleteObjects: async () => { throw new Error('R2 down') } })
    expect(out).toEqual({ quotes: 0, requests: 0, assets: 0, objects: 0 })
    expect(log.some((l) => l.op === 'delete')).toBe(false)
  })

  it('does nothing without a demo tenant', async () => {
    const { supabase, log } = fake({ ...rows, tenants: [] })
    await cleanUpDemoRequests(supabase, { retentionHours: 24, deleteObjects: null })
    expect(log).toHaveLength(1)
  })

  it('runs in the daily lifecycle cron', () => {
    const cron = read('apps/web/src/app/api/cron/lifecycle/route.ts')
    expect(cron).toContain('cleanUpDemoRequests(supabase')
    expect(cron).toContain('retentionHours: DEMO_RETENTION_HOURS')
  })
})

describe('T-153: the /demo page and links', () => {
  it('the example business by default; the developer view only with ?tenantKey=', () => {
    const page = read('apps/web/src/app/demo/page.tsx')
    expect(page).toMatch(/if \(searchParams\.tenantKey\) return <DeveloperDemo \/>/)
    expect(page).toContain('Try it as a customer')
    expect(page).toContain('example business with example prices')
    expect(read('apps/web/src/components/share/EmbedCodeCard.tsx')).toContain('/demo?tenantKey=')
  })

  it('one widget: the demo passes options to EstimateWidget, no second implementation', () => {
    const exp = read('apps/web/src/components/demo/DemoExperience.tsx')
    expect(exp).toContain('<EstimateWidget')
    expect(exp).toContain('samplePhotoUrl: DEMO_SAMPLE_PHOTO_PATH')
    expect(exp).toContain('What the business sees')
    expect(exp).toContain('freeOfferLabel()')
  })

  it('every marketing demo link goes to /demo and says "Try it as a customer"', () => {
    for (const f of ['apps/web/src/app/page.tsx', 'apps/web/src/components/marketing/TradeLanding.tsx', 'apps/web/src/components/marketing/SiteFooter.tsx']) {
      const s = read(f)
      expect(s).not.toMatch(/live demo|Widget demo/i)
      expect(s).toMatch(/href="\/demo"[\s\S]{0,400}Try it as a customer/)
    }
  })

  it('the logo and sample photo are our own drawings, shipped in the repo', () => {
    for (const f of ['example-home-services-logo.svg', 'sample-water-heater-label.svg', 'sample-water-heater-label.png']) {
      expect(existsSync(join(ROOT, 'apps/web/public/demo', f))).toBe(true)
    }
    expect(read('apps/web/public/demo/example-home-services-logo.svg')).toMatch(/Drawn for the Aistimator demo/)
    expect(read('apps/web/public/demo/sample-water-heater-label.svg')).toMatch(/invented; no real product or photo/)
  })
})
