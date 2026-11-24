/**
 * T-201 (item 34): the worker's emails to a customer carry the business's
 * logo when it has one, and "Powered by" follows the plan by the same rule as
 * the estimate page. (Item 31: a payment being retried keeps the badge off.)
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PRODUCT_NAME } from '@qolumns/shared'
import { businessNotificationEmail, customerQuoteEmail, reviewRequestEmail } from '../email/templates'
import { customerEmailBrand, loadAccess } from '../customer-email-brand'

const ROOT = join(__dirname, '..', '..', '..', '..')
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')
const LOGO = 'https://qolumns.example/api/public/logo/ast_0123456789abcdef'

const customer = (brand?: { logoUrl?: string | null; showPoweredBy?: boolean }, awaitingConfirmation = false) =>
  customerQuoteEmail({
    customerName: 'Dev Raman',
    businessName: 'Harlow & Sons Painting',
    serviceName: 'Interior Painting',
    quoteViewUrl: 'https://qolumns.example/q/qte_1?token=t',
    total: '$450.00',
    currency: 'USD',
    awaitingConfirmation,
    brand,
  })

/** The three rows the access rule reads */
function db(opts: { subscription: Record<string, unknown> | null; used?: number; onPlan?: number; region?: string; fail?: boolean }): SupabaseClient {
  const table = (name: string) => {
    const result = opts.fail
      ? { data: null, error: { code: 'XX000' } }
      : name === 'subscriptions'
        ? { data: opts.subscription, error: null }
        : name === 'usage_counters'
          ? { data: [{ estimates_created: opts.used ?? 0, plan_estimates_created: opts.onPlan ?? 0 }], error: null }
          : { data: { region: opts.region ?? 'US' }, error: null }
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = () => chain
    chain.maybeSingle = async () => result
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
    return chain
  }
  return { from: table } as unknown as SupabaseClient
}

describe('T-201: the customer\'s email from the worker', () => {
  it('shows the business\'s logo above its name when there is one, in both the quote and the estimate email', () => {
    for (const html of [customer({ logoUrl: LOGO, showPoweredBy: true }), customer({ logoUrl: LOGO, showPoweredBy: true }, true)]) {
      expect(html).toContain(`<img src="${LOGO}"`)
      expect(html).toContain('alt="Harlow &amp; Sons Painting"')
      expect(html.indexOf('data-role="business-logo"')).toBeLessThan(html.indexOf('<h1'))
    }
    expect(customer({ logoUrl: null })).not.toContain('<img')
    expect(customer()).not.toContain('<img')
  })

  it('"Powered by" stays unless the plan removes it', () => {
    expect(customer({ showPoweredBy: true })).toContain(`Powered by ${PRODUCT_NAME}`)
    expect(customer()).toContain(`Powered by ${PRODUCT_NAME}`)
    expect(customer({ showPoweredBy: false })).not.toContain('Powered by')
    expect(customer({ showPoweredBy: false }, true)).not.toContain('Powered by')
  })

  it('emails to the business are the product\'s own: never the business\'s logo row, never "Powered by"', () => {
    const toBusiness = businessNotificationEmail({
      businessName: 'Harlow & Sons Painting',
      customerName: 'Dev Raman',
      customerEmail: 'dev.raman@example.com',
      serviceName: 'Interior Painting',
      quoteId: 'qte_1',
      dashboardUrl: 'https://qolumns.example/app/quotes/qte_1',
      total: '$450.00',
      currency: 'USD',
    })
    const review = reviewRequestEmail({
      businessName: 'Harlow & Sons Painting',
      customerName: 'Dev Raman',
      serviceName: 'Interior Painting',
      quoteId: 'qte_1',
      total: '$450.00',
      dashboardUrl: 'https://qolumns.example/app/quotes/qte_1',
      holdLine: 'It is waiting for you to approve it.',
    })
    for (const html of [toBusiness, review]) {
      expect(html).not.toContain('Powered by')
      expect(html).not.toContain('data-role="business-logo"')
      expect(html).toContain('data-role="product-logo"')
    }
  })
})

describe('T-201: the rule is the estimate page\'s own', () => {
  it('Pro removes the line, a payment being retried keeps it removed, Starter and an ended plan show it', async () => {
    const brand = (subscription: Record<string, unknown> | null, used = 0, onPlan = 0) =>
      customerEmailBrand(db({ subscription, used, onPlan }), 'https://qolumns.example', 'tnt_a', { logoAssetId: 'ast_0123456789abcdef', primaryColor: '#205E56' })
    expect(await brand({ plan_id: 'plan_us_pro', status: 'active' })).toEqual({ logoUrl: LOGO, showPoweredBy: false })
    expect(await brand({ plan_id: 'plan_us_pro', status: 'past_due' })).toEqual({ logoUrl: LOGO, showPoweredBy: false })
    expect(await brand({ plan_id: 'plan_us_starter', status: 'active' })).toEqual({ logoUrl: LOGO, showPoweredBy: true })
    expect(await brand({ plan_id: 'plan_us_pro', status: 'canceled' })).toEqual({ logoUrl: LOGO, showPoweredBy: true })
    // no plan: the free start works like the plan that removes it, until the free quotes are used
    expect(await brand(null, 3)).toEqual({ logoUrl: LOGO, showPoweredBy: false })
    expect(await brand(null, 10)).toEqual({ logoUrl: LOGO, showPoweredBy: true })
    // quotes priced on a plan are not free quotes (item 33): 14 priced, 12 of them on a plan
    expect(await brand(null, 14, 12)).toEqual({ logoUrl: LOGO, showPoweredBy: false })
  })

  it('no logo set, no web address, or a read that fails: no picture, and the line shows', async () => {
    expect(await customerEmailBrand(db({ subscription: null, fail: true }), 'https://qolumns.example', 'tnt_a', {})).toEqual({ logoUrl: null, showPoweredBy: true })
    expect(await customerEmailBrand(db({ subscription: { plan_id: 'plan_us_pro', status: 'active' } }), undefined, 'tnt_a', { logoAssetId: 'ast_0123456789abcdef' })).toEqual({ logoUrl: null, showPoweredBy: false })
    expect((await loadAccess(db({ subscription: null, fail: true }), 'tnt_a')).basis).toBe('none')
    const throwing = { from: () => { throw new Error('down') } } as unknown as SupabaseClient
    expect((await loadAccess(throwing, 'tnt_a')).basis).toBe('none')
  })

  it('the processor reads it once and hands it to both customer emails', () => {
    const processor = read('apps/worker/src/quote-processor.ts')
    expect(processor).toContain('const emailBrand = emailOn ? await customerEmailBrand(supabase, env.APP_URL, tenant.id, tenant.branding_json) : undefined')
    expect(processor.split('brand: emailBrand,').length - 1).toBe(2)
    const loader = read('apps/worker/src/customer-email-brand.ts')
    expect(loader).toContain("showPoweredBy: !canUse(await loadAccess(db, tenantId), 'no_badge')")
    // the worker has one reader of the access rule, and it decides nothing itself
    expect(loader).not.toMatch(/status === |\['active'/)
  })
})
