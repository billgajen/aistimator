/**
 * T-156: the "Review and approve" email with a one-tap Approve & send link,
 * and how the worker issues that link.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { buildReviewRequestEmail, type ReviewRequestEmailData } from '../email'
import { issueApprovalLink } from '../approval-link'

const APP = 'https://app.example.com'
const base: ReviewRequestEmailData = {
  quoteId: 'qte_123',
  ownerEmail: 'owner@example.com',
  businessName: 'Acme Doors',
  customerName: 'Jordan M.',
  customerEmail: 'jordan@example.com',
  serviceName: 'Spring Replacement',
  total: 1400,
  currency: 'USD',
  locale: 'en-US',
  reviewHold: 'shown',
  approveUrl: `${APP}/approve/${'a'.repeat(43)}`,
}

describe('T-156: the review email', () => {
  it('subject carries customer, service and price', () => {
    expect(buildReviewRequestEmail(APP, base).subject).toBe('Review and approve: Jordan M. - Spring Replacement - $1,400.00')
  })

  it('a measured range is the price; money follows the region', () => {
    const { subject, html } = buildReviewRequestEmail(APP, { ...base, currency: 'GBP', locale: 'en-GB', range: { low: 1250, high: 1550 } })
    expect(subject).toMatch(/£1,250\.00 – £1,550\.00$/)
    expect(html).toContain('£1,250.00 – £1,550.00')
  })

  it('a big Approve & send button, then a smaller dashboard link for editing', () => {
    const { html } = buildReviewRequestEmail(APP, base)
    const approve = html.indexOf('data-role="approve"')
    const dashboard = html.indexOf('data-role="dashboard"')
    expect(approve).toBeGreaterThan(-1)
    expect(dashboard).toBeGreaterThan(approve)
    expect(html).toContain(`href="${base.approveUrl}"`)
    expect(html).toMatch(/Approve &amp; send/)
    expect(html).toContain(`href="${APP}/app/quotes/qte_123"`)
    expect(html).toContain('Open in dashboard to edit')
  })

  it('says whether the customer can already see it, and why a check held it', () => {
    expect(buildReviewRequestEmail(APP, base).html).toContain('Your customer can already see this estimate.')
    expect(buildReviewRequestEmail(APP, { ...base, reviewHold: 'held' }).html).toContain('It’s held until you approve it.')
    const check = buildReviewRequestEmail(APP, { ...base, reviewHold: 'check', reason: 'The photos didn’t show the springs' }).html
    expect(check).toContain('Held for a check')
    expect(check).toContain('Why: The photos didn’t show the springs')
  })

  it('a test request is marked in the subject and at the top, and still has the button', () => {
    const { subject, html } = buildReviewRequestEmail(APP, { ...base, isTest: true })
    expect(subject).toMatch(/^\[Test\] Review and approve: /)
    expect(html.indexOf('TEST REQUEST')).toBeGreaterThan(-1)
    expect(html.indexOf('TEST REQUEST')).toBeLessThan(html.indexOf('Estimate ready for your approval'))
    expect(html).toContain('counts toward nothing')
    expect(html).toContain('data-role="approve"')
    expect(buildReviewRequestEmail(APP, base).html).not.toContain('TEST REQUEST')
  })

  it('without a link (it couldn’t be issued) the dashboard button stands in', () => {
    const { html } = buildReviewRequestEmail(APP, { ...base, approveUrl: undefined })
    expect(html).not.toContain('data-role="approve"')
    expect(html).toContain('Review and approve')
    expect(html).toContain(`href="${APP}/app/quotes/qte_123"`)
  })

  it('escapes what customers typed', () => {
    const { html } = buildReviewRequestEmail(APP, { ...base, customerName: '<b>x</b>' })
    expect(html).not.toContain('<b>x</b>')
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
  })
})

describe('T-156: issuing the link', () => {
  function fakeSupabase(fail?: 'update' | 'insert') {
    const calls: Array<{ op: string; values?: Record<string, unknown>; filters: string[] }> = []
    return {
      calls,
      from: (table: string) => {
        expect(table).toBe('quote_approval_tokens')
        const filters: string[] = []
        const chain = {
          eq: (c: string, v: unknown) => (filters.push(`${c}=${v}`), chain),
          is: (c: string, v: unknown) => (filters.push(`${c} is ${v}`), chain),
          then: (r: (v: { error: unknown }) => unknown) => r({ error: fail === 'update' ? { message: 'down' } : null }),
        }
        return {
          update: (values: Record<string, unknown>) => (calls.push({ op: 'update', values, filters }), chain),
          insert: (values: Record<string, unknown>) => {
            calls.push({ op: 'insert', values, filters })
            return Promise.resolve({ error: fail === 'insert' ? { message: 'down' } : null })
          },
        }
      },
    }
  }

  it('replaces the open link, stores only the hash, expires in 72 h, and returns the URL', async () => {
    const sb = fakeSupabase()
    const now = new Date('2026-11-10T12:00:00Z')
    const url = await issueApprovalLink(sb as never, { quoteId: 'qte_1', tenantId: 'tnt_1', appUrl: APP, now })
    expect(url).toMatch(new RegExp(`^${APP}/approve/[A-Za-z0-9_-]{43}$`))
    const token = url!.split('/').pop()!
    const [replace, insert] = sb.calls
    expect(replace).toMatchObject({ op: 'update', values: { invalidated_reason: 'replaced' } })
    expect(replace!.filters).toEqual(['quote_id=qte_1', 'used_at is null', 'invalidated_at is null'])
    expect(insert!.values).toEqual({
      tenant_id: 'tnt_1',
      quote_id: 'qte_1',
      token_hash: createHash('sha256').update(token).digest('hex'),
      expires_at: '2026-11-13T12:00:00.000Z',
    })
    expect(JSON.stringify(insert!.values)).not.toContain(token)
  })

  it('a database failure never blocks the email: no link, the dashboard button instead', async () => {
    expect(await issueApprovalLink(fakeSupabase('insert') as never, { quoteId: 'q', tenantId: 't', appUrl: APP })).toBeUndefined()
    expect(await issueApprovalLink(fakeSupabase('update') as never, { quoteId: 'q', tenantId: 't', appUrl: APP })).toBeUndefined()
  })

  it('the worker issues it only inside the review-email branch, which demo requests never reach; test requests are marked', () => {
    const src = readFileSync(join(__dirname, '..', 'quote-processor.ts'), 'utf8')
    expect(src).toMatch(/const emailOn = quoteData\.quote\.is_demo !== true && isEmailConfigured/)
    const branch = src.slice(src.indexOf("quoteRequest.source_json?.type !== 'app' &&"), src.indexOf('Review request email error'))
    expect(branch).toContain('emailOn')
    expect(branch).toContain('issueApprovalLink(supabase')
    expect(branch).toContain('isTest: quoteData.quote.is_test === true')
    expect(branch).toContain('reviewHold: reviewDecision.reviewHold')
    expect(src.match(/issueApprovalLink\(/g)).toHaveLength(1)
  })

  it('logs no customer details', () => {
    const email = readFileSync(join(__dirname, '..', 'email', 'index.ts'), 'utf8')
    expect(email).toMatch(/\[Email\] Review request \$\{result\.success \? 'sent' : 'failed'\} for \$\{data\.quoteId\}/)
  })
})
