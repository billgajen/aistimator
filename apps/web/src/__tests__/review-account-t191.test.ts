/**
 * T-191: the App Store reviewer's test business (scripts/create-review-account.mts).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REVIEW_ACCOUNT, getPlan, reviewAccountQuotes, reviewLabel } from '@qolumns/shared'

const ROOT = join(__dirname, '..', '..', '..', '..')
const script = readFileSync(join(ROOT, 'scripts/create-review-account.mts'), 'utf8')

describe('T-191: the review account', () => {
  it('three invented customers on example.com, one at each stage', () => {
    const quotes = reviewAccountQuotes(new Date('2026-11-19T12:00:00Z'))
    expect(quotes.map((q) => q.status)).toEqual(['pending_review', 'sent', 'accepted'])
    for (const q of quotes) expect(q.customer.email.endsWith('@example.com')).toBe(true)
    expect(JSON.stringify(quotes).toLowerCase()).not.toContain('claude')
    const accepted = quotes[2]!
    expect(Date.parse(accepted.createdAt) < Date.parse(accepted.sentAt!) && Date.parse(accepted.sentAt!) < Date.parse(accepted.acceptedAt!)).toBe(true)
  })

  it('a sample line is labelled as the engine labels a priced line', () => {
    expect(reviewLabel('Walls', '1,100 sq ft × $2 = $2,200')).toBe('Walls  $2 × 1,100 sq ft')
    expect(reviewLabel('Base Fee', 'Fixed: $95')).toBe('Base Fee')
  })

  it('its plan is a real plan, given as a free test plan (no Stripe customer)', () => {
    expect(getPlan(REVIEW_ACCOUNT.planId)).toBeTruthy()
    expect(script).toContain('stripe_customer_id: null, stripe_subscription_id: null')
  })

  it('the script prints the password once and never the service key; production only with --prod', () => {
    expect(script).not.toMatch(/console\.log\([^)]*\bkey\b/)
    expect(script.split('password  ${secret}')).toHaveLength(2)
    expect(script).toContain("process.argv.includes('--prod')")
    expect(script).toMatch(/runs on the local database only/)
    // no model, no worker, no email
    expect(script).not.toMatch(/\/api\/|QUOTE_JOBS|sendEmail|postmark/i)
  })
})

/**
 * T-206: the reviewer could not start a quote in the app. The script made a business without its site row
 * (the dashboard makes that row the first time one of its pages is opened, and nobody opens the dashboard for
 * this account), and the app's first call answered "Set up your website widget first".
 */
describe('T-206: the review account has its site row, and the app never asks for one', () => {
  const bootstrap = readFileSync(join(ROOT, 'apps/web/src/app/api/app/bootstrap/route.ts'), 'utf8')

  it('the script makes the site row for a new account, in the shape the dashboard makes it', () => {
    expect(script).toContain('console.log(`  site row ${await ensureSite(tenantId)}`)')
    expect(script).toContain("domain: 'localhost'")
    expect(script).toContain('`${ID_PREFIXES.tenantKey}${randomBytes(12).toString(\'hex\')}`')
  })

  it('a second run repairs an account that exists, before it stops, and leaves the password alone', () => {
    const existing = script.slice(script.indexOf('if (existing) {'), script.indexOf('// 1. The user'))
    expect(existing.indexOf('await ensureSite(itsTenant)')).toBeGreaterThan(-1)
    expect(existing.indexOf('await ensureSite(itsTenant)')).toBeLessThan(existing.indexOf('if (!newPassword)'))
    // a row that is off is turned on rather than doubled
    expect(script).toMatch(/PATCH', `tenant_sites\?id=eq\.\$\{sites\[0\]\.id as string\}`, \{ is_active: true \}/)
  })

  it('the app’s first call makes the row with the dashboard’s own helper and never refuses for want of one', () => {
    expect(bootstrap).toContain("import { getOrCreateTenantKey } from '@/lib/tenant-site'")
    expect(bootstrap).toContain('await getOrCreateTenantKey(supabase, tenantId)')
    const code = bootstrap.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    expect(code).not.toMatch(/NO_SITE|widget first/i)
  })
})
