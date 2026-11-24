/**
 * T-201, Analytics (items 22 to 25):
 *   22. "Total Quotes" leaves out setup tests
 *   23. "Conversion Rate" is accepted ÷ sent, declined quotes counted in what was sent
 *   24. "Quotes Viewed" counts every quote that was opened, those declined later too
 *   25. nothing says "Paid" until payments exist; the data stays
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PAYMENTS_LIVE, quoteTracker, quoteTurn } from '@qolumns/shared'
import { analyticsMetrics, type AnalyticsQuoteRow } from '@/lib/analytics-metrics'

const ROOT = path.resolve(__dirname, '../../../..')
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')
const AT = '2026-11-12T09:00:00Z'
const q = (status: string, over: Partial<AnalyticsQuoteRow> = {}): AnalyticsQuoteRow => ({ status, is_test: false, sent_at: null, viewed_at: null, accepted_at: null, ...over })

describe('T-201 item 22: "Total Quotes" leaves out setup tests', () => {
  it('a setup test is in no figure', () => {
    const metrics = analyticsMetrics([q('pending_review'), q('sent', { sent_at: AT }), q('accepted', { is_test: true, sent_at: AT, viewed_at: AT, accepted_at: AT })])
    expect(metrics).toMatchObject({ totalQuotes: 2, quotesSent: 1, quotesViewed: 0, quotesAccepted: 0, conversionRate: 0 })
  })

  it('every other quote counts, whatever its status', () => {
    const statuses = ['queued', 'generating', 'pending_review', 'awaiting_clarification', 'failed', 'sent', 'viewed', 'accepted', 'declined', 'expired']
    expect(analyticsMetrics(statuses.map((s) => q(s))).totalQuotes).toBe(statuses.length)
  })

  it('no quotes: zeros, and no division by nothing', () => {
    expect(analyticsMetrics([])).toEqual({ totalQuotes: 0, quotesSent: 0, quotesViewed: 0, quotesAccepted: 0, quotesPaid: 0, conversionRate: 0 })
    expect(analyticsMetrics(null).conversionRate).toBe(0)
  })
})

describe('T-201 item 23: "Conversion Rate" is accepted ÷ sent', () => {
  it('a declined quote was sent: it is in what the rate divides by', () => {
    // 1 accepted, 1 declined, 2 still waiting: 1 of 4 sent
    const metrics = analyticsMetrics([
      q('accepted', { sent_at: AT, viewed_at: AT, accepted_at: AT }),
      q('declined', { sent_at: AT, viewed_at: AT }),
      q('sent', { sent_at: AT }),
      q('viewed', { sent_at: AT, viewed_at: AT }),
      // never sent: not in the sum
      q('pending_review'),
      q('failed'),
    ])
    expect(metrics.quotesSent).toBe(4)
    expect(metrics.quotesAccepted).toBe(1)
    expect(metrics.conversionRate).toBe(25)
  })

  it('before T-201 the same quotes read 33%: the declined one was left out', () => {
    const old = (rows: AnalyticsQuoteRow[]) => {
      const sent = rows.filter((r) => ['sent', 'viewed', 'accepted', 'paid', 'expired'].includes(r.status)).length
      return Math.round((rows.filter((r) => ['accepted', 'paid'].includes(r.status)).length / sent) * 100)
    }
    const rows = [q('accepted', { sent_at: AT }), q('declined', { sent_at: AT }), q('sent', { sent_at: AT }), q('viewed', { sent_at: AT })]
    expect(old(rows)).toBe(33)
    expect(analyticsMetrics(rows).conversionRate).toBe(25)
  })

  it('a quote with a question, a revised one and an expired one were sent too; an older row with no date counts by its status', () => {
    expect(analyticsMetrics([q('feedback_received'), q('revised'), q('expired'), q('declined')]).quotesSent).toBe(4)
  })
})

describe('T-201 item 24: "Quotes Viewed" counts every quote that was opened', () => {
  it('opened and then declined, or expired, still counts as opened', () => {
    const metrics = analyticsMetrics([
      q('declined', { sent_at: AT, viewed_at: AT }),
      q('expired', { sent_at: AT, viewed_at: AT }),
      q('viewed', { sent_at: AT, viewed_at: AT }),
      q('accepted', { sent_at: AT, viewed_at: AT, accepted_at: AT }),
      // declined without ever being opened, and one never opened
      q('declined', { sent_at: AT }),
      q('sent', { sent_at: AT }),
    ])
    expect(metrics.quotesViewed).toBe(4)
  })

  it('an accepted quote with no open recorded was opened all the same', () => {
    expect(analyticsMetrics([q('accepted', { sent_at: AT, accepted_at: AT })]).quotesViewed).toBe(1)
  })

  it('the route reads the dates it needs and uses the one rule', () => {
    const route = read('apps/web/src/app/api/analytics/route.ts')
    expect(route).toContain(".select('status, is_test, sent_at, viewed_at, accepted_at')")
    expect(route).toContain('analyticsMetrics(')
  })
})

describe('T-201 item 25: nothing says "Paid" until payments exist', () => {
  it('payments are not live', () => {
    expect(PAYMENTS_LIVE).toBe(false)
  })

  it('the Analytics funnel and the admin filter show "Paid" only behind the switch', () => {
    const analytics = read('apps/web/src/app/(dashboard)/app/analytics/page.tsx')
    const paidRow = analytics.indexOf('label="Paid"')
    expect(paidRow).toBeGreaterThan(0)
    expect(analytics.slice(paidRow - 120, paidRow)).toContain('{PAYMENTS_LIVE && (')
    const admin = read('apps/web/src/app/admin/quotes/page.tsx')
    expect(admin).toContain('{PAYMENTS_LIVE && <option value="paid">Paid</option>}')
    expect(admin.match(/<option value="paid">/g)).toHaveLength(1)
  })

  it('a quote that carries the status reads as the accepted quote it is, in lists and on its page', () => {
    const now = new Date('2026-11-13T12:00:00Z')
    const turn = quoteTurn({ status: 'paid', customerName: 'Morgan Hale', hasEmail: true, total: 300, acceptedAt: '2026-11-12T09:00:00Z', paidAt: '2026-11-13T09:00:00Z' }, { now, locale: 'en-GB' })
    expect(turn.label).toBe('Customer accepted')
    expect(`${turn.label} ${turn.detail} ${turn.sentence}`).not.toMatch(/paid/i)
    const steps = quoteTracker({ status: 'paid', total: 300, createdAt: '2026-11-10T09:00:00Z', sentAt: '2026-11-10T09:05:00Z', viewedAt: '2026-11-11T09:00:00Z', acceptedAt: '2026-11-12T09:00:00Z', paidAt: '2026-11-13T09:00:00Z' }, { locale: 'en-GB' })
    expect(JSON.stringify(steps)).not.toMatch(/paid/i)
  })

  it('the data is kept: the figure is still in the answer, and the status still counts as accepted', () => {
    const metrics = analyticsMetrics([q('paid', { sent_at: AT, viewed_at: AT, accepted_at: AT })])
    expect(metrics).toMatchObject({ quotesPaid: 1, quotesAccepted: 1, quotesViewed: 1, quotesSent: 1, conversionRate: 100 })
  })
})
