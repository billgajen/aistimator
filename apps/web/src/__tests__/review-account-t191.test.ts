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
