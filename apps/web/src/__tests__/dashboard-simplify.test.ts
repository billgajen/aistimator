/**
 * T-152: simpler dashboard — five menu items, Home in the order of the work,
 * the setup checklist, WhatsApp on Share, and the free allowance in total.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  freeAllowance,
  freeOfferLabel,
  noSubscriptionLimit,
  listRegions,
  findConfidenceLanguage,
  PRODUCT_NAME,
  DEFAULT_PRIMARY_COLOR,
} from '@estimator/shared'
import { checkPlanLimit, evaluateLimit, usedForAllowance } from '@/lib/plan-limits'
import { getCurrentPeriod } from '@/lib/usage'
import { buildChecklist, hasCustomBranding } from '@/lib/setup-checklist'
import { homeNumbers, waitingForApproval } from '@/lib/home-numbers'
import { buildWhatsAppTexts, whatsAppSendMessage, whatsAppShareUrl } from '@/lib/share-texts'
import { generateLimitReachedEmailHtml, generateLeadHeldEmailHtml } from '@/lib/email-templates'
import { SETTINGS_TABS } from '@/components/settings/SettingsTabs'

const WEB = join(__dirname, '..', '..')
const ROOT = join(WEB, '..', '..')
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')

describe('T-152: the free allowance is 10 quotes in total', () => {
  it('US: 10 in total; legacy GB: 50 a month; unknown falls back to GB', () => {
    expect(freeAllowance('US')).toEqual({ quotes: 10, per: 'total' })
    expect(freeAllowance('GB')).toEqual({ quotes: 50, per: 'month' })
    expect(freeAllowance(null)).toEqual({ quotes: 50, per: 'month' })
    expect(noSubscriptionLimit('US')).toBe(10)
    expect(freeOfferLabel()).toBe('Try it free: 10 quotes, no card')
  })

  it('counts this month, or every month for an allowance that never resets', () => {
    const rows = [
      { period_yyyymm: '202609', estimates_created: 4 },
      { period_yyyymm: '202610', estimates_created: 5 },
      { period_yyyymm: '202611', estimates_created: 1 },
    ]
    expect(usedForAllowance(rows, 'month', '202611')).toBe(1)
    expect(usedForAllowance(rows, 'total', '202611')).toBe(10)
    expect(usedForAllowance(rows, 'month', '202612')).toBe(0) // a new month with no row yet
    expect(usedForAllowance(null, 'total', '202611')).toBe(0)
  })

  /** A fake Supabase for checkPlanLimit: subscription, every month's counters, region */
  function db(sub: Record<string, unknown> | null, counters: Array<[string, number]>, region: string) {
    const rows: Record<string, unknown> = {
      subscriptions: sub,
      usage_counters: counters.map(([period_yyyymm, estimates_created]) => ({ period_yyyymm, estimates_created })),
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
  const now = getCurrentPeriod()

  it('a new US business: quote 10 is priced, the 11th is held — and next month does not reset it', async () => {
    const nine = await checkPlanLimit(db(null, [['202609', 9]], 'US'), 't')
    expect(nine).toMatchObject({ allowed: true, used: 9, limit: 10, per: 'total' })
    // ten used last month, nothing yet this month: still at the limit
    const ten = await checkPlanLimit(db(null, [['202609', 6], ['202610', 4]], 'US'), 't')
    expect(ten).toMatchObject({ allowed: false, used: 10, limit: 10, per: 'total', overageAvailable: false })
  })

  it('legacy GB tenants keep 50 a month (only this month counts)', async () => {
    const s = await checkPlanLimit(db(null, [['202001', 50], [now, 3]], 'GB'), 't')
    expect(s).toMatchObject({ allowed: true, used: 3, limit: 50, per: 'month' })
  })

  it('subscribed tenants behave as before: the plan limit, this month only', async () => {
    const pro = await checkPlanLimit(db({ status: 'active', plan_id: 'plan_us_pro' }, [['202001', 999], [now, 199]], 'US'), 't')
    expect(pro).toMatchObject({ allowed: true, used: 199, limit: 200, per: 'month' })
    const cancelled = await checkPlanLimit(db({ status: 'canceled', plan_id: 'plan_us_pro' }, [['202001', 10]], 'US'), 't')
    expect(cancelled).toMatchObject({ allowed: false, limit: 10, per: 'total' })
  })

  it('evaluateLimit defaults to a monthly count', () => {
    expect(evaluateLimit(1, 50).per).toBe('month')
  })

  it('tests and unfinished requests never reach the counter', () => {
    const intake = read('apps/web/src/lib/quote-intake.ts')
    // the counter increment is skipped for test requests (T-150)…
    expect(intake).toMatch(/!isTest[\s\S]{0,200}incrementUsageCounter|incrementUsageCounter[\s\S]{0,40}isTest/)
    // …and the lead endpoints (T-151) never touch usage at all
    for (const f of ['apps/web/src/app/api/public/leads/route.ts', 'apps/web/src/app/api/public/leads/[leadId]/route.ts']) {
      expect(read(f)).not.toMatch(/incrementUsageCounter|usage_counters/)
    }
  })

  it('the limit emails say "free quotes" without promising a monthly reset', () => {
    const limit = generateLimitReachedEmailHtml({ businessName: 'Ace', used: 10, limit: 10, billingUrl: 'https://x.test/b', per: 'total' })
    expect(limit).toContain('free quotes')
    expect(limit).not.toMatch(/next month|this month/)
    const held = generateLeadHeldEmailHtml({ businessName: 'Ace', customerName: 'Sam', serviceName: 'Doors', used: 10, limit: 10, billingUrl: 'b', quoteUrl: 'q', per: 'total' })
    expect(held).toContain('your free quotes are used up')
    // a monthly plan keeps its old words
    expect(generateLimitReachedEmailHtml({ businessName: 'Ace', used: 50, limit: 50, billingUrl: 'b' })).toContain('next month')
    expect(limit).toContain(`Powered by ${PRODUCT_NAME}`)
  })

  it('analytics reads the same limit and count as enforcement', () => {
    const route = read('apps/web/src/app/api/analytics/route.ts')
    expect(route).toContain('checkPlanLimit(supabase, tenantId)')
    expect(route).not.toMatch(/monthly_estimate_limit|DEFAULT_TRIAL_LIMIT/)
  })

  it('pricing page, FAQ and billing page say it the same way', () => {
    const pricing = read('apps/web/src/app/pricing/page.tsx')
    expect(pricing).toContain('freeOfferLabel()')
    expect(pricing).toMatch(/Can I try it for free\?/)
    expect(pricing).toMatch(/don’t reset each month/)
    const billing = read('apps/web/src/app/(dashboard)/app/settings/billing/page.tsx')
    expect(billing).toMatch(/Free quotes used/)
    expect(billing).toMatch(/don’t reset each month/)
    for (const f of [
      'apps/web/src/app/page.tsx',
      'apps/web/src/app/features/page.tsx',
      'apps/web/src/components/marketing/SiteNav.tsx',
      'apps/web/src/components/marketing/SiteFooter.tsx',
      'apps/web/src/components/marketing/TradeLanding.tsx',
    ]) {
      expect(read(f)).not.toMatch(/Start free/)
      expect(read(f)).toContain('freeOfferLabel()')
    }
  })
})

describe('T-152: the setup checklist ticks only on real actions', () => {
  const none = { hasService: false, pricesCheckedAt: null, quoteLinkCopiedAt: null, quoteLinkFirstVisitAt: null, hasRealRequest: false }

  it('four steps, ending at "First real request received"', () => {
    const c = buildChecklist(none)
    expect(c.steps.map((s) => s.label)).toEqual([
      'Add a service',
      'Check your prices',
      'Share your quote link',
      'First real request received',
    ])
    expect(c).toMatchObject({ done: 0, complete: false })
    expect(c.steps.some((s) => /brand/i.test(s.label))).toBe(false)
  })

  it('a service alone does not tick "Check your prices"', () => {
    const c = buildChecklist({ ...none, hasService: true })
    expect(c.steps.find((s) => s.id === 'prices')!.completed).toBe(false)
    expect(buildChecklist({ ...none, hasService: true, pricesCheckedAt: '2026-11-10T10:00:00Z' }).done).toBe(2)
  })

  it('sharing ticks on a copy or the first visit; complete hides it', () => {
    expect(buildChecklist({ ...none, quoteLinkFirstVisitAt: '2026-11-10T10:00:00Z' }).steps[2]!.completed).toBe(true)
    const all = buildChecklist({ hasService: true, pricesCheckedAt: 'x', quoteLinkCopiedAt: 'x', quoteLinkFirstVisitAt: null, hasRealRequest: true })
    expect(all).toMatchObject({ done: 4, complete: true })
  })

  it('branding is "set" only for a real logo or a non-default colour', () => {
    // the old check ticked this one (undefined !== null)
    expect(hasCustomBranding({ primaryColor: DEFAULT_PRIMARY_COLOR })).toBe(false)
    expect(hasCustomBranding({ logoAssetId: null, primaryColor: '#2563EB' })).toBe(false)
    expect(hasCustomBranding({ logoAssetId: '', primaryColor: '#2563eb' })).toBe(false)
    expect(hasCustomBranding(null)).toBe(false)
    expect(hasCustomBranding({ logoAssetId: 'ast_logo1', primaryColor: '#2563eb' })).toBe(true)
    expect(hasCustomBranding({ logoAssetId: null, primaryColor: '#1E3A5F' })).toBe(true)
  })

  it('the first real request excludes setup tests and the business’s own app quotes', () => {
    const home = read('apps/web/src/app/(dashboard)/app/page.tsx')
    expect(home).toMatch(/quote_requests!quote_request_id!inner[\s\S]{0,200}\.eq\('is_test', false\)\s*\n\s*\.or\('source_json->>type\.is\.null,source_json->>type\.neq\.app', \{ referencedTable: 'quote_requests' \}\)/)
  })
})

describe('T-152: Home leads with the work waiting', () => {
  it('waiting = priced, awaiting approval, not a test, not a held lead — newest first', () => {
    const base = { status: 'pending_review', pricing_json: { total: 100 }, content_json: null, is_test: false }
    const rows = [
      { ...base, id: 'old', created_at: '2026-11-01T10:00:00Z' },
      { ...base, id: 'new', created_at: '2026-11-09T10:00:00Z' },
      { ...base, id: 'test', created_at: '2026-11-09T11:00:00Z', is_test: true },
      { ...base, id: 'lead', created_at: '2026-11-09T12:00:00Z', content_json: { limitHold: true }, pricing_json: null },
      { ...base, id: 'zero', created_at: '2026-11-09T13:00:00Z', pricing_json: { total: 0 } },
      { ...base, id: 'sent', created_at: '2026-11-09T14:00:00Z', status: 'sent' },
    ]
    expect(waitingForApproval(rows).map((r) => r.id)).toEqual(['new', 'old'])
  })

  it('four numbers for the last 30 days; tests never count, app quotes are not requests', () => {
    const since = new Date('2026-10-11T00:00:00Z')
    const n = homeNumbers(
      [
        { status: 'accepted', created_at: '2026-10-20T00:00:00Z', sent_at: '2026-10-20T01:00:00Z', accepted_at: '2026-10-21T00:00:00Z', pricing_json: { total: 1200 } },
        { status: 'paid', created_at: '2026-09-01T00:00:00Z', sent_at: '2026-09-01T00:00:00Z', accepted_at: '2026-10-15T00:00:00Z', pricing_json: { total: 300 } },
        { status: 'sent', created_at: '2026-11-01T00:00:00Z', sent_at: '2026-11-02T00:00:00Z', accepted_at: null, pricing_json: { total: 80 }, source_type: 'app' },
        { status: 'pending_review', created_at: '2026-11-03T00:00:00Z', sent_at: null, accepted_at: null, pricing_json: null },
        { status: 'accepted', created_at: '2026-11-04T00:00:00Z', sent_at: '2026-11-04T00:00:00Z', accepted_at: '2026-11-04T00:00:00Z', pricing_json: { total: 999 }, is_test: true },
      ],
      since
    )
    expect(n).toEqual({ requests: 2, sent: 2, accepted: 2, valueAccepted: 1500 })
  })

  it('order on the page: waiting, unfinished, checklist, numbers; no Quick Actions', () => {
    const home = read('apps/web/src/app/(dashboard)/app/page.tsx')
    const at = (s: string) => home.indexOf(s)
    expect(at('<WaitingForYou')).toBeGreaterThan(0)
    expect(at('<WaitingForYou')).toBeLessThan(at('data-testid="unfinished-count"'))
    expect(at('data-testid="unfinished-count"')).toBeLessThan(at('data-testid="setup-checklist"'))
    expect(at('data-testid="setup-checklist"')).toBeLessThan(at('data-testid="home-numbers"'))
    expect(home).toContain('See all numbers')
    expect(home).not.toMatch(/Quick Actions|QuickAction/)
  })
})

describe('T-152: five menu items; old URLs still work', () => {
  it('Home, Quotes, Prices, Share, Settings — nothing else', () => {
    const layout = read('apps/web/src/app/(dashboard)/layout.tsx')
    const labels = [...layout.matchAll(/\{ href: '[^']+', label: '([^']+)'/g)].map((m) => m[1])
    expect(labels).toEqual(['Home', 'Quotes', 'Prices', 'Share', 'Settings'])
  })

  it('renamed pages redirect, and every old page still exists or redirects', async () => {
    const config = (await import(join(WEB, 'next.config.js'))).default as { redirects: () => Promise<Array<{ source: string; destination: string }>> }
    const redirects = Object.fromEntries((await config.redirects()).map((r) => [r.source, r.destination]))
    expect(redirects).toEqual({
      '/app/services': '/app/prices',
      '/app/branding': '/app/settings/branding',
      '/app/billing': '/app/settings/billing',
    })
    const app = 'apps/web/src/app/(dashboard)/app'
    for (const page of ['prices', 'settings', 'settings/branding', 'settings/billing', 'settings/notifications', 'analytics', 'sms', 'whatsapp', 'widget', 'share', 'quotes']) {
      expect(existsSync(join(ROOT, app, page, 'page.tsx'))).toBe(true)
    }
    for (const moved of Object.keys(redirects)) expect(existsSync(join(ROOT, app, moved.replace('/app/', ''), 'page.tsx'))).toBe(false)
  })

  it('Settings tabs: Business, Branding, Billing, Notifications', () => {
    expect(SETTINGS_TABS.map((t) => t.label)).toEqual(['Business', 'Branding', 'Billing', 'Notifications'])
  })

  it('Stripe returns and emails point at the new billing URL', () => {
    expect(read('apps/web/src/app/api/billing/checkout/route.ts')).toContain('/app/settings/billing?success=true')
    expect(read('apps/web/src/app/api/billing/portal/route.ts')).toContain('/app/settings/billing')
    expect(read('apps/web/src/lib/plan-limits.ts')).toContain('/app/settings/billing')
  })
})

describe('T-152: Use it on WhatsApp (Share)', () => {
  const opts = { businessName: 'Gateway Doors', link: 'https://aistimator.test/quote/gateway-doors', region: 'US' }

  it('greeting, away and quick reply — each with the link and two lines on where to paste it', () => {
    const texts = buildWhatsAppTexts(opts)
    expect(texts.map((t) => t.id)).toEqual(['greeting', 'away', 'quick_reply'])
    for (const t of texts) {
      expect(t.text).toContain(opts.link)
      expect(t.steps).toHaveLength(2)
      expect(t.steps[0]).toMatch(/WhatsApp Business/)
      expect(findConfidenceLanguage(t.text)).toEqual([])
    }
    expect(texts[0]!.text).toContain('Gateway Doors')
  })

  it('"Send on WhatsApp" opens wa.me with the message and link', () => {
    const msg = whatsAppSendMessage(opts)
    expect(msg).toContain(opts.link)
    const url = whatsAppShareUrl(msg)
    expect(url.startsWith('https://wa.me/?text=')).toBe(true)
    expect(decodeURIComponent(url.split('text=')[1]!)).toBe(msg)
  })

  it('links to the existing WhatsApp page; no "coming soon" anywhere', () => {
    const section = read('apps/web/src/components/share/UseItOnWhatsApp.tsx')
    expect(section).toContain('href="/app/whatsapp"')
    expect(section).toContain('Connect your WhatsApp number for full in-chat quoting (advanced)')
    expect(read('apps/web/src/components/share/SharePageClient.tsx')).toContain('<UseItOnWhatsApp')
    for (const f of ['apps/web/src/components/share/UseItOnWhatsApp.tsx', 'apps/web/src/components/share/SharePageClient.tsx', 'apps/web/src/lib/share-texts.ts']) {
      expect(read(f)).not.toMatch(/coming soon/i)
    }
  })
})

describe('T-152: clean-up', () => {
  it('Branding placeholders come from the region (no hardcoded UK number)', () => {
    const branding = read('apps/web/src/app/(dashboard)/app/settings/branding/page.tsx')
    expect(branding).not.toMatch(/7700 900|\+44/)
    expect(branding).toContain('regionCopy.phoneExample')
    expect(branding).toContain('regionCopy.emailExample')
    for (const r of listRegions()) {
      expect(r.copy.emailExample).toMatch(/@/)
      expect(r.copy.websiteExample).toBeTruthy()
    }
  })

  it('no leftover "Estimator" product name in customer-facing or dashboard text', () => {
    for (const f of [
      'apps/web/src/lib/email-templates.ts',
      'apps/web/src/lib/postmark.ts',
      'apps/worker/src/email/templates.ts',
      'apps/web/src/app/(auth)/layout.tsx',
      'apps/web/src/lib/embed-snippet.ts',
      'apps/web/src/app/demo/page.tsx',
    ]) {
      expect(read(f)).not.toMatch(/Powered by Estimator|>Estimator<|'Estimator |Estimator Widget|the Estimator widget/)
    }
    expect(PRODUCT_NAME).toBe('Aistimator')
  })

  it('setup offers an optional logo using the same upload as Branding', () => {
    const flow = read('apps/web/src/components/onboarding/OnboardingFlow.tsx')
    expect(flow).toContain('<LogoUpload')
    expect(flow).toMatch(/Your logo <span[^>]*>\(optional\)/)
    expect(read('apps/web/src/app/(dashboard)/app/settings/branding/page.tsx')).toContain('<LogoUpload')
    expect(read('apps/web/src/components/settings/LogoUpload.tsx')).toContain("'/api/tenant/logo'")
  })
})
