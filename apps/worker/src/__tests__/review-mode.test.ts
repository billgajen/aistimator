/**
 * T-147: show, then confirm — the mode logic, the hold-kind flag, what counts
 * as "shown early", and the customer language guard on the new payload/email.
 */
import { describe, it, expect } from 'vitest'
import {
  reviewModeOf,
  reviewModeColumns,
  decideReviewHold,
  isShownEarly,
  customerEstimateRange,
  findConfidenceLanguage,
  findConfidenceLanguageInPayload,
  REVIEW_MODES,
} from '@estimator/shared'
import { customerQuoteEmail } from '../email/templates'

describe('T-147: service review mode', () => {
  it('defaults to show, then confirm (existing services included)', () => {
    expect(reviewModeOf({})).toBe('show_then_confirm')
    expect(reviewModeOf({ auto_send: false, hold_until_approved: false })).toBe('show_then_confirm')
    expect(reviewModeOf({ auto_send: null, hold_until_approved: null })).toBe('show_then_confirm')
  })

  it('reads the two columns, and auto_send wins if both are set', () => {
    expect(reviewModeOf({ hold_until_approved: true })).toBe('hold_until_approved')
    expect(reviewModeOf({ auto_send: true })).toBe('auto_send')
    expect(reviewModeOf({ auto_send: true, hold_until_approved: true })).toBe('auto_send')
  })

  it('round-trips every mode through the columns', () => {
    for (const mode of REVIEW_MODES) expect(reviewModeOf(reviewModeColumns(mode))).toBe(mode)
  })
})

describe('T-147: hold kind', () => {
  it('default service: held for review and shown to the customer', () => {
    expect(decideReviewHold({ statusAfterChecks: 'sent', mode: 'show_then_confirm' })).toEqual({
      status: 'pending_review',
      reviewHold: 'shown',
    })
  })

  it('hold until approved: held and hidden (T-146 behaviour)', () => {
    expect(decideReviewHold({ statusAfterChecks: 'sent', mode: 'hold_until_approved' })).toEqual({
      status: 'pending_review',
      reviewHold: 'held',
    })
  })

  it('send automatically: goes straight out', () => {
    expect(decideReviewHold({ statusAfterChecks: 'sent', mode: 'auto_send' })).toEqual({ status: 'sent', reviewHold: null })
  })

  it('a quote held by a check is never shown early, whatever the mode', () => {
    for (const mode of REVIEW_MODES) {
      expect(decideReviewHold({ statusAfterChecks: 'pending_review', mode })).toEqual({
        status: 'pending_review',
        reviewHold: 'check',
      })
    }
  })

  it('wording that trips the customer language guard is not shown early', () => {
    const wordingProblems = findConfidenceLanguageInPayload({ notes: 'We will confirm the exact dimensions before ordering.' })
    expect(wordingProblems.length).toBeGreaterThan(0)
    expect(decideReviewHold({ statusAfterChecks: 'sent', mode: 'show_then_confirm', wordingProblems })).toEqual({
      status: 'pending_review',
      reviewHold: 'check',
    })
    // The other modes are unchanged by it
    expect(decideReviewHold({ statusAfterChecks: 'sent', mode: 'hold_until_approved', wordingProblems }).reviewHold).toBe('held')
    expect(decideReviewHold({ statusAfterChecks: 'sent', mode: 'auto_send', wordingProblems }).status).toBe('sent')
    expect(decideReviewHold({ statusAfterChecks: 'sent', mode: 'show_then_confirm', wordingProblems: [] }).reviewHold).toBe('shown')
  })

  it('a quote the business created itself behaves as before: held, not shown', () => {
    expect(decideReviewHold({ statusAfterChecks: 'sent', mode: 'show_then_confirm', businessCreated: true }).reviewHold).toBe('held')
    expect(decideReviewHold({ statusAfterChecks: 'sent', mode: 'auto_send', businessCreated: true }).status).toBe('sent')
  })
})

describe('T-147: isShownEarly fails closed', () => {
  const shown = { status: 'pending_review', review_hold: 'shown', total: 1400 }

  it('a priced default-review hold is shown', () => {
    expect(isShownEarly(shown)).toBe(true)
  })

  it('held, check-held and older rows (no flag) stay hidden', () => {
    expect(isShownEarly({ ...shown, review_hold: 'held' })).toBe(false)
    expect(isShownEarly({ ...shown, review_hold: 'check' })).toBe(false)
    expect(isShownEarly({ ...shown, review_hold: null })).toBe(false)
    expect(isShownEarly({ status: 'pending_review', total: 1400 })).toBe(false)
  })

  it('no price, a plan-limit lead hold, or another status is never "shown early"', () => {
    expect(isShownEarly({ ...shown, total: 0 })).toBe(false)
    expect(isShownEarly({ ...shown, total: null })).toBe(false)
    expect(isShownEarly({ ...shown, limitHold: true })).toBe(false)
    expect(isShownEarly({ ...shown, status: 'sent' })).toBe(false)
    expect(isShownEarly({ ...shown, status: 'awaiting_clarification' })).toBe(false)
  })
})

describe('T-147: the customer range is only ever a measured one', () => {
  it('returns the measured range without its grade or label', () => {
    expect(customerEstimateRange({ grade: 'B', rangeLow: 4200, rangeHigh: 5100 })).toEqual({ low: 4200, high: 5100 })
  })

  it('never invents a range around a flat price', () => {
    expect(customerEstimateRange(undefined)).toBeUndefined()
    expect(customerEstimateRange({ grade: 'A', rangeLow: 1400, rangeHigh: 1400 })).toBeUndefined()
    expect(customerEstimateRange({ grade: 'A', rangeLow: 1300, rangeHigh: 1500 })).toBeUndefined()
    expect(customerEstimateRange({ grade: 'B' })).toBeUndefined()
    expect(customerEstimateRange({ grade: 'C', rangeLow: 900, rangeHigh: 900 })).toBeUndefined()
  })
})

describe('T-147: customer language guard on the new surfaces', () => {
  it('a shown-early public payload passes the guard', () => {
    const payload = {
      status: 'pending_review',
      review: { state: 'estimate', confirmationPending: true },
      estimateRange: { low: 4200, high: 5100 },
      pricing: {
        currency: 'USD',
        subtotal: 4650,
        taxAmount: 0,
        total: 4650,
        breakdown: [{ label: 'Wall painting', amount: 4650 }],
        notes: ['Estimated from your photos and details'],
      },
      takeoff: [{ item: 'Wall painting', quantity: 646.2, unit: 'sqft', amount: 4650, method: 'From your photos' }],
      notes: { scopeSummary: 'Two coats to all walls.', assumptions: ['Walls are in sound condition'], exclusions: ['Ceilings'] },
      acceptQuoteEnabled: false,
    }
    expect(findConfidenceLanguageInPayload(payload)).toEqual([])
  })

  it('the guard still catches a grade leaking into a shown-early payload', () => {
    const leaked = { review: { state: 'estimate', confirmationPending: true }, pricing: { total: 1400, estimate: { grade: 'B', label: 'Measured' } } }
    expect(findConfidenceLanguageInPayload(leaked).length).toBeGreaterThan(0)
  })

  it('the estimate email says the business will confirm, in plain words', () => {
    const html = customerQuoteEmail({
      customerName: 'Sam',
      businessName: 'Example Co',
      serviceName: 'Garage door',
      quoteViewUrl: 'https://example.test/q/qte_1?token=t',
      total: '$1,400.00',
      currency: 'USD',
      awaitingConfirmation: true,
    })
    expect(html).toContain('Your estimate for Garage door')
    expect(html).toContain('Example Co will review and confirm this estimate')
    expect(html).not.toContain('Quoted Total')
    expect(findConfidenceLanguage(html)).toEqual([])
  })

  it('the approved-quote email is unchanged', () => {
    const html = customerQuoteEmail({
      customerName: 'Sam',
      businessName: 'Example Co',
      serviceName: 'Garage door',
      quoteViewUrl: 'https://example.test/q/qte_1?token=t',
      total: '$1,400.00',
      currency: 'USD',
    })
    expect(html).toContain('Your quote for Garage door')
    expect(html).toContain('Quoted Total')
    expect(html).toContain('View Full Quote')
  })
})
