/**
 * T-158: quotes say whose turn it is and what to do next.
 *
 * The shared map (packages/shared/src/quote-turn.ts) is the only place the
 * business-facing status wording lives. These tests pin every status, both
 * pending_review cases, each detail line, the next step, the tracker and the
 * customer page's "quote"/"estimate" words.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  QUOTE_GROUP_STATUSES,
  QUOTE_GROUPS,
  QUOTE_LIST_TABS,
  QUOTE_TURN_COPY,
  SEND_AGAIN_AFTER_DAYS,
  canViewPricingTrace,
  customerDecisionWords,
  customerFirstName,
  daysSince,
  defaultQuoteListGroup,
  findConfidenceLanguage,
  quoteGroupOf,
  quoteTracker,
  quoteTurn,
  shortDate,
  whenWords,
} from '@estimator/shared'
import type { QuoteStatus, QuoteTurnInput } from '@estimator/shared'
import { waitingForYou } from '@/lib/home-numbers'

const ALL_STATUSES: QuoteStatus[] = [
  'queued',
  'generating',
  'pending_review',
  'awaiting_clarification',
  'sent',
  'viewed',
  'feedback_received',
  'revised',
  'accepted',
  'declined',
  'paid',
  'expired',
  'failed',
]

// Friday 13 Nov 2026, midday
const opts = { now: new Date('2026-11-13T12:00:00Z'), locale: 'en-GB', timeZone: 'UTC' }
const daysAgo = (n: number) => new Date(opts.now.getTime() - n * 24 * 60 * 60 * 1000).toISOString()

const turnOf = (input: Partial<QuoteTurnInput> & { status: string }) =>
  quoteTurn({ customerName: 'Morgan Field', hasEmail: true, total: 480, createdAt: daysAgo(2), ...input }, opts)

const src = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8')

describe('groups', () => {
  it('puts every status in exactly one group', () => {
    const grouped = QUOTE_GROUPS.flatMap((g) => QUOTE_GROUP_STATUSES[g])
    expect([...grouped].sort()).toEqual([...ALL_STATUSES].sort())
    expect(new Set(grouped).size).toBe(grouped.length)
  })

  it('groups each status the way the business reads it', () => {
    const expected: Record<QuoteStatus, string> = {
      pending_review: 'needs_you',
      feedback_received: 'needs_you',
      failed: 'needs_you',
      sent: 'waiting',
      viewed: 'waiting',
      revised: 'waiting',
      awaiting_clarification: 'waiting',
      accepted: 'accepted',
      paid: 'accepted',
      declined: 'closed',
      expired: 'closed',
      queued: 'working',
      generating: 'working',
    }
    for (const status of ALL_STATUSES) {
      expect(quoteGroupOf(status), status).toBe(expected[status])
      expect(turnOf({ status }).group, status).toBe(expected[status])
    }
  })

  it('has the six tabs in order, and opens on Needs you only when it has any', () => {
    expect(QUOTE_LIST_TABS.map((t) => QUOTE_TURN_COPY.tabs[t])).toEqual([
      'Needs you',
      'Waiting for customer',
      'Accepted',
      'Closed',
      'Unfinished',
      'All',
    ])
    expect(defaultQuoteListGroup({ needs_you: 2 })).toBe('needs_you')
    expect(defaultQuoteListGroup({ needs_you: 0 })).toBe('all')
  })
})

describe('labels', () => {
  it('never shows Sent, Viewed or Revised as a status', () => {
    for (const status of ALL_STATUSES) {
      expect(['Sent', 'Viewed', 'Revised', 'Feedback']).not.toContain(turnOf({ status }).label)
    }
    for (const status of ['sent', 'viewed', 'revised', 'awaiting_clarification']) {
      expect(turnOf({ status, sentAt: daysAgo(1), viewedAt: daysAgo(1) }).label).toBe('Waiting for customer')
    }
  })

  it('names who has to act for every other status', () => {
    expect(turnOf({ status: 'feedback_received' }).label).toBe('Customer asked a question')
    expect(turnOf({ status: 'failed' }).label).toBe('Could not be priced')
    expect(turnOf({ status: 'accepted' }).label).toBe('Customer accepted')
    expect(turnOf({ status: 'paid' }).label).toBe('Paid')
    expect(turnOf({ status: 'declined' }).label).toBe('Customer declined')
    expect(turnOf({ status: 'expired' }).label).toBe('Expired')
    expect(turnOf({ status: 'queued' }).label).toBe('Working out the price')
    expect(turnOf({ status: 'generating' }).label).toBe('Working out the price')
  })

  it('tells the pending_review cases apart: priced, held by the plan limit, and no price', () => {
    const priced = turnOf({ status: 'pending_review' })
    expect(priced).toMatchObject({ label: 'Needs your approval', detail: 'Received 2 days ago', action: 'approve', buttonLabel: 'Check and approve' })
    expect(priced.sentence).toBe('Check the price and approve. The customer can accept only after you approve.')

    const held = turnOf({ status: 'pending_review', held: true, total: 0 })
    expect(held).toMatchObject({ label: 'Saved, not priced yet', detail: 'Your plan limit was reached', action: 'price_request', buttonLabel: 'Price this request' })
    expect(held.sentence).toBe(
      'This request arrived after your plan limit was reached, so it has no price. Morgan was told you will send their estimate shortly. Upgrade your plan, then price it.'
    )
    // The plan hold wins even if a price is somehow there
    expect(turnOf({ status: 'pending_review', held: true, total: 480 }).label).toBe('Saved, not priced yet')

    const noPrice = turnOf({ status: 'pending_review', total: 0 })
    expect(noPrice).toMatchObject({ label: 'Needs your approval', detail: 'No price yet', action: 'add_price', buttonLabel: 'Add the price' })
    expect(noPrice.sentence).toBe('This quote has no price yet. Add the price, then send it to Morgan.')
    expect(turnOf({ status: 'pending_review', total: null }).action).toBe('add_price')
  })
})

describe('detail lines', () => {
  it('sent: when it went, and that it has not been opened', () => {
    expect(turnOf({ status: 'sent', sentAt: daysAgo(0) }).detail).toBe('Sent today, not opened yet')
    expect(turnOf({ status: 'sent', sentAt: daysAgo(1) }).detail).toBe('Sent yesterday, not opened yet')
    expect(turnOf({ status: 'sent', sentAt: daysAgo(2) }).detail).toBe('Sent 2 days ago, not opened yet')
    expect(turnOf({ status: 'sent', sentAt: daysAgo(9) }).detail).toBe('Sent on 4 Nov, not opened yet')
  })

  it('sent again after it was opened: "not opened since", never "not opened yet"', () => {
    expect(turnOf({ status: 'sent', sentAt: daysAgo(1), viewedAt: daysAgo(4) }).detail).toBe('Sent yesterday, not opened since')
  })

  it('viewed, revised and awaiting_clarification', () => {
    expect(turnOf({ status: 'viewed', sentAt: daysAgo(3), viewedAt: daysAgo(1) }).detail).toBe('Opened yesterday')
    expect(turnOf({ status: 'viewed', viewedAt: daysAgo(0) }).detail).toBe('Opened today')
    expect(turnOf({ status: 'revised', sentAt: daysAgo(1) }).detail).toBe('Updated quote sent yesterday')
    expect(turnOf({ status: 'revised' }).detail).toBe('Updated quote sent')
    expect(turnOf({ status: 'awaiting_clarification' }).detail).toBe('Waiting for their answers')
  })

  it('needs you, accepted, closed and working', () => {
    expect(turnOf({ status: 'feedback_received' }).detail).toBe('Waiting for your answer')
    expect(turnOf({ status: 'failed', createdAt: daysAgo(0) }).detail).toBe('Received today')
    expect(turnOf({ status: 'accepted', acceptedAt: daysAgo(1) }).detail).toBe('Accepted on 12 Nov')
    expect(turnOf({ status: 'paid', paidAt: daysAgo(0) }).detail).toBe('Paid on 13 Nov')
    expect(turnOf({ status: 'declined', declinedAt: daysAgo(1) }).detail).toBe('Declined on 12 Nov')
    expect(turnOf({ status: 'expired', expiresAt: daysAgo(3) }).detail).toBe('Expired on 10 Nov')
    expect(turnOf({ status: 'generating', createdAt: daysAgo(0) }).detail).toBe('Received today')
  })

  it('leaves the line empty rather than inventing a date', () => {
    expect(turnOf({ status: 'accepted' }).detail).toBe('')
    expect(turnOf({ status: 'declined', declinedAt: 'not a date' }).detail).toBe('')
    expect(turnOf({ status: 'queued', createdAt: null }).detail).toBe('')
  })
})

describe('next step', () => {
  it('customer question: answer it', () => {
    const t = turnOf({ status: 'feedback_received' })
    expect(t).toMatchObject({ action: 'answer_question', buttonLabel: 'Answer question' })
    expect(t.sentence).toBe('Morgan asked a question. Answer them, then mark it as answered, or edit the quote and send it again.')
  })

  it('could not be priced: contact the customer', () => {
    const t = turnOf({ status: 'failed' })
    expect(t).toMatchObject({ action: 'contact', buttonLabel: 'Contact customer' })
    expect(t.sentence).toBe('We could not work out a price for this request. Contact Morgan and quote it yourself.')
  })

  it('waiting for the customer: nothing to do while it is fresh', () => {
    const sent = turnOf({ status: 'sent', sentAt: daysAgo(1) })
    expect(sent).toMatchObject({ action: null, buttonLabel: null })
    expect(sent.sentence).toBe('Nothing for you to do. Waiting for Morgan. Sent yesterday, not opened yet.')

    const viewed = turnOf({ status: 'viewed', viewedAt: daysAgo(1) })
    expect(viewed.action).toBeNull()
    expect(viewed.sentence).toBe('Nothing for you to do. Waiting for Morgan. They opened it yesterday.')

    const revised = turnOf({ status: 'revised', sentAt: daysAgo(1) })
    expect(revised.action).toBeNull()
    expect(revised.sentence).toBe('Nothing for you to do. Waiting for Morgan. You sent the updated quote yesterday.')

    const clarifying = turnOf({ status: 'awaiting_clarification' })
    expect(clarifying.action).toBeNull()
    expect(clarifying.sentence).toBe('Nothing for you to do. Morgan was asked for more details. The price comes once they answer.')

    // an opened quote stays "nothing to do" however long ago
    expect(turnOf({ status: 'viewed', viewedAt: daysAgo(20) }).action).toBeNull()
  })

  it(`unopened for ${SEND_AGAIN_AFTER_DAYS} days: send again, by the T-157 rule`, () => {
    expect(turnOf({ status: 'sent', sentAt: daysAgo(SEND_AGAIN_AFTER_DAYS - 1) }).action).toBeNull()
    const t = turnOf({ status: 'sent', sentAt: daysAgo(4) })
    expect(t).toMatchObject({ action: 'send_again', buttonLabel: 'Send again' })
    expect(t.sentence).toBe('Morgan has not opened the quote, sent 4 days ago. Send it again.')

    // no email address: Send again would not work, so it is never offered
    const noEmail = turnOf({ status: 'sent', sentAt: daysAgo(4), hasEmail: false })
    expect(noEmail).toMatchObject({ action: 'contact', buttonLabel: 'Contact customer' })
    expect(noEmail.sentence).toBe(
      'Morgan has not opened the quote, sent 4 days ago. They gave no email address, so copy the link and send it another way.'
    )
  })

  it('accepted: contact them; paid and declined: nothing', () => {
    const accepted = turnOf({ status: 'accepted', acceptedAt: daysAgo(1) })
    expect(accepted).toMatchObject({ action: 'contact', buttonLabel: 'Contact customer' })
    expect(accepted.sentence).toBe('Morgan accepted on 12 Nov. Contact them to book the job.')

    const paid = turnOf({ status: 'paid', paidAt: daysAgo(0) })
    expect(paid.action).toBeNull()
    expect(paid.sentence).toBe('Morgan paid on 13 Nov. Nothing for you to do.')

    const declined = turnOf({ status: 'declined', declinedAt: daysAgo(1) })
    expect(declined.action).toBeNull()
    expect(declined.sentence).toBe('Morgan declined on 12 Nov. Nothing for you to do.')
  })

  it('expired: send again when there is an address, otherwise contact', () => {
    const t = turnOf({ status: 'expired', expiresAt: daysAgo(1) })
    expect(t).toMatchObject({ action: 'send_again', buttonLabel: 'Send again' })
    expect(t.sentence).toBe('This quote expired on 12 Nov without an answer. Send it again to give Morgan a new link.')

    const noEmail = turnOf({ status: 'expired', expiresAt: daysAgo(1), hasEmail: false })
    expect(noEmail.action).toBe('contact')
    expect(noEmail.sentence).toBe('This quote expired on 12 Nov without an answer. Contact Morgan if the job is still open.')
  })

  it('working: nothing yet', () => {
    const t = turnOf({ status: 'queued' })
    expect(t.action).toBeNull()
    expect(t.sentence).toBe('We are working out the price. Nothing for you to do yet.')
  })

  it('reads properly without a customer name', () => {
    expect(customerFirstName('  Morgan   Field ')).toBe('Morgan')
    expect(customerFirstName('')).toBeNull()
    expect(customerFirstName(null)).toBeNull()
    expect(turnOf({ status: 'feedback_received', customerName: '' }).sentence).toMatch(/^The customer asked a question\./)
    expect(turnOf({ status: 'viewed', customerName: null, viewedAt: daysAgo(1) }).sentence).toBe(
      'Nothing for you to do. Waiting for the customer. They opened it yesterday.'
    )
    expect(QUOTE_TURN_COPY.pageButtons.email('Morgan')).toBe('Email Morgan')
    expect(QUOTE_TURN_COPY.pageButtons.call(null)).toBe('Call customer')
  })

  it('every action has words for the list button, and no action means no button', () => {
    for (const status of ALL_STATUSES) {
      const t = turnOf({ status })
      if (t.action) expect(t.buttonLabel, status).toBe(QUOTE_TURN_COPY.listButtons[t.action])
      else expect(t.buttonLabel, status).toBeNull()
      expect(t.sentence.length, status).toBeGreaterThan(10)
    }
  })
})

describe('time words', () => {
  it('counts calendar days in the viewer’s time zone', () => {
    // 23:30 UTC on the 12th is already the 13th in Tokyo, still the 12th in UTC
    const late = '2026-11-12T23:30:00Z'
    expect(daysSince(late, opts)).toBe(1)
    expect(daysSince(late, { ...opts, timeZone: 'Asia/Tokyo' })).toBe(0)
    expect(whenWords(late, opts)).toBe('yesterday')
    expect(whenWords(late, { ...opts, timeZone: 'Asia/Tokyo' })).toBe('today')
  })

  it('today, yesterday, days ago up to 6, then the date', () => {
    expect(whenWords(daysAgo(0), opts)).toBe('today')
    expect(whenWords(daysAgo(1), opts)).toBe('yesterday')
    expect(whenWords(daysAgo(6), opts)).toBe('6 days ago')
    expect(whenWords(daysAgo(7), opts)).toBe('on 6 Nov')
    expect(shortDate('2026-11-12T09:00:00Z', opts)).toBe('12 Nov')
  })

  it('a date in the future (clock skew) reads as today; no date reads as nothing', () => {
    expect(whenWords(daysAgo(-1), opts)).toBe('today')
    expect(whenWords(null, opts)).toBeNull()
    expect(whenWords('nonsense', opts)).toBeNull()
    expect(shortDate(undefined, opts)).toBeNull()
  })
})

describe('tracker', () => {
  const base = { total: 480, createdAt: daysAgo(3) }
  const labels = (steps: ReturnType<typeof quoteTracker>) => steps.map((s) => s.label)

  it('waiting for approval: only the first step is done', () => {
    const steps = quoteTracker({ ...base, status: 'pending_review' }, opts)
    expect(labels(steps)).toEqual(['Request received', 'Waiting for your approval', 'Not opened yet', 'Not accepted yet'])
    expect(steps.map((s) => s.done)).toEqual([true, false, false, false])
    expect(steps[0]!.date).toBe('10 Nov')
    expect(steps[1]!.date).toBeNull()
  })

  it('approved by the business: "You approved" with its date', () => {
    const steps = quoteTracker({ ...base, status: 'viewed', approvedAt: daysAgo(2), sentAt: daysAgo(2), viewedAt: daysAgo(1) }, opts)
    expect(labels(steps)).toEqual(['Request received', 'You approved', 'Customer opened', 'Not accepted yet'])
    expect(steps.map((s) => s.date)).toEqual(['10 Nov', '11 Nov', '12 Nov', null])
  })

  it('a service that sends automatically: step two reads "Sent automatically"', () => {
    const steps = quoteTracker({ ...base, status: 'sent', sentAt: daysAgo(3) }, opts)
    expect(steps[1]).toMatchObject({ label: 'Sent automatically', done: true, date: '10 Nov' })
  })

  it('accepted, and paid as a second line', () => {
    const accepted = quoteTracker({ ...base, status: 'accepted', approvedAt: daysAgo(2), sentAt: daysAgo(2), viewedAt: daysAgo(1), acceptedAt: daysAgo(1) }, opts)
    expect(accepted[3]).toMatchObject({ label: 'Customer accepted', done: true, date: '12 Nov', note: null, ended: false })
    const paid = quoteTracker({ ...base, status: 'paid', approvedAt: daysAgo(2), sentAt: daysAgo(2), viewedAt: daysAgo(1), acceptedAt: daysAgo(1), paidAt: daysAgo(0) }, opts)
    expect(paid[3]).toMatchObject({ label: 'Customer accepted', date: '12 Nov', note: 'Paid 13 Nov' })
  })

  it('declined or expired is the final step', () => {
    const declined = quoteTracker({ ...base, status: 'declined', approvedAt: daysAgo(2), sentAt: daysAgo(2), declinedAt: daysAgo(1) }, opts)
    expect(declined[3]).toMatchObject({ label: 'Customer declined', done: true, date: '12 Nov', ended: true })
    expect(declined[2]).toMatchObject({ label: 'Not opened yet', done: false })
    const expired = quoteTracker({ ...base, status: 'expired', sentAt: daysAgo(3), expiresAt: daysAgo(0) }, opts)
    expect(expired[3]).toMatchObject({ label: 'Expired', done: true, date: '13 Nov', ended: true })
  })

  it('nothing to approve yet (held, no price, failed, still working): "Not sent yet"', () => {
    for (const input of [
      { status: 'pending_review', held: true, total: 0 },
      { status: 'pending_review', total: 0 },
      { status: 'failed', total: 0 },
      { status: 'generating', total: 0 },
    ]) {
      expect(quoteTracker({ createdAt: daysAgo(1), ...input }, opts)[1], input.status).toMatchObject({ label: 'Not sent yet', done: false })
    }
  })
})

describe('customer page words', () => {
  it('says "quote" once the business reviewed it', () => {
    expect(customerDecisionWords(true)).toEqual({
      noun: 'quote',
      accept: 'Accept this quote',
      accepted: 'Quote accepted',
      declined: 'Quote declined',
      declineLink: 'No longer need this? Decline this quote',
      declineTitle: 'Decline this quote',
      keep: 'Keep the quote',
      declineButton: 'Decline quote',
    })
  })

  it('keeps "estimate" on one that was sent automatically', () => {
    expect(customerDecisionWords(false)).toEqual({
      noun: 'estimate',
      accept: 'Accept this estimate',
      accepted: 'Estimate accepted',
      declined: 'Estimate declined',
      declineLink: 'No longer need this? Decline this estimate',
      declineTitle: 'Decline this estimate',
      keep: 'Keep the estimate',
      declineButton: 'Decline estimate',
    })
  })

  it('uses no grade or confidence word (T-146)', () => {
    for (const reviewed of [true, false]) {
      expect(findConfidenceLanguage(Object.values(customerDecisionWords(reviewed)).join(' '))).toEqual([])
    }
  })

  it('the customer page takes the words from the shared map', () => {
    const page = src('app/q/[quoteId]/page.tsx')
    expect(page).toContain('customerDecisionWords(isReviewedQuote)')
    for (const old of ['Accept this estimate', 'Estimate accepted', 'Estimate declined', 'Decline this estimate', 'Keep the estimate', 'Decline estimate']) {
      expect(page, old).not.toContain(old)
    }
  })
})

describe('one place for the wording', () => {
  it('both quote pages use the shared map and have no label table of their own', () => {
    const list = src('app/(dashboard)/app/quotes/page.tsx')
    const detail = src('app/(dashboard)/app/quotes/[quoteId]/page.tsx')
    for (const page of [list, detail]) {
      expect(page).toContain('quoteTurn(')
      expect(page).not.toMatch(/Record<QuoteStatus,\s*\{\s*label/)
      for (const old of ["label: 'Sent'", "label: 'Viewed'", "label: 'Revised'", "label: 'Feedback'", 'Awaiting your approval']) {
        expect(page, old).not.toContain(old)
      }
    }
    expect(detail).toContain('<NextStepBox')
    expect(detail).toContain('<QuoteTracker')
    expect(detail).not.toContain('TimelineEntry')
  })

  it('the list has no icon-only action: every action is a worded button or menu item', () => {
    const list = src('app/(dashboard)/app/quotes/page.tsx')
    expect(list).not.toMatch(/title="(Copy quote link|Download PDF|Send again|View pricing trace|View quote)"/)
    expect(list).toContain('<QuoteRowMenu')
    expect(list).toContain('<QuoteTabs')
    expect(Object.values(QUOTE_TURN_COPY.more)).toEqual(['More', 'Open quote', 'Send again', 'Copy link', 'Download PDF', 'Pricing trace'])
  })

  it('Home lists what waits for the owner with the same labels', () => {
    const home = src('app/(dashboard)/app/page.tsx')
    expect(home).toContain('waitingForYou(')
    expect(home).toContain('quoteTurn(')
    expect(QUOTE_TURN_COPY.home.count(1)).toBe('needs you')
    expect(QUOTE_TURN_COPY.home.count(3)).toBe('need you')
  })

  it('pricing trace keeps the rule the list had', () => {
    expect(ALL_STATUSES.filter((s) => canViewPricingTrace(s)).sort()).toEqual(['accepted', 'feedback_received', 'paid', 'revised', 'sent', 'viewed'])
  })
})

describe('Home: waiting for you', () => {
  const row = (id: string, status: string, extra: Partial<{ total: number; limitHold: boolean; is_test: boolean; created_at: string }> = {}) => ({
    id,
    status,
    created_at: extra.created_at ?? daysAgo(1),
    pricing_json: { total: extra.total ?? 0 },
    content_json: extra.limitHold ? { limitHold: true } : null,
    is_test: extra.is_test ?? false,
  })

  it('lists quotes to approve, customer questions and requests that could not be priced, newest first', () => {
    const rows = [
      row('approve', 'pending_review', { total: 300, created_at: daysAgo(3) }),
      row('question', 'feedback_received', { total: 300, created_at: daysAgo(1) }),
      row('failed', 'failed', { created_at: daysAgo(2) }),
    ]
    expect(waitingForYou(rows).map((r) => r.id)).toEqual(['question', 'failed', 'approve'])
  })

  it('leaves out tests, requests held by the plan limit, unpriced pending quotes and everything else', () => {
    const rows = [
      row('held', 'pending_review', { limitHold: true }),
      row('unpriced', 'pending_review'),
      row('test-approve', 'pending_review', { total: 300, is_test: true }),
      row('test-question', 'feedback_received', { total: 300, is_test: true }),
      row('test-failed', 'failed', { is_test: true }),
      row('sent', 'sent', { total: 300 }),
      row('accepted', 'accepted', { total: 300 }),
    ]
    expect(waitingForYou(rows)).toEqual([])
    expect(waitingForYou(null)).toEqual([])
  })
})

describe('list API', () => {
  const route = src('app/api/quotes/route.ts')

  it('accepts "declined" as a status filter (it was missing)', () => {
    const list = /const VALID_STATUSES[^=]*=\s*\[([\s\S]*?)\]/.exec(route)?.[1] ?? ''
    for (const status of ALL_STATUSES) expect(list, status).toContain(`'${status}'`)
  })

  it('filters by group with the shared statuses and scopes every query to the tenant', () => {
    expect(route).toContain('QUOTE_GROUP_STATUSES[group]')
    expect(route).toContain('defaultQuoteListGroup(counts)')
    // the list query and the quote counts filter by tenant directly; the
    // unfinished count goes through the shared rule (T-160), which does too
    expect(route.match(/\.eq\('tenant_id', tenantId\)/g)?.length).toBe(2)
    expect(route).toMatch(/unfinishedFilter\(\s*supabase\.from\('request_leads'\)[^)]*\),\s*tenantId\s*\)/)
    expect(route.match(/\.from\('(quotes|request_leads)'\)/g)?.length).toBe(3)
  })

  it('returns everything when no group is asked for (the mobile app’s call)', () => {
    expect(route).toContain('if (groupParam !== null)')
    expect(route).toContain("...(counts && group && { counts, group })")
  })
})
