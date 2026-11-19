/**
 * T-191: a refund or a lost dispute on a plan's payment ends the plan; nothing else does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'

const { syncSubscriptionFromStripe } = vi.hoisted(() => ({
  syncSubscriptionFromStripe: vi.fn(async (..._args: unknown[]): Promise<{ ok: boolean; why?: string }> => ({ ok: true })),
}))
vi.mock('@/lib/billing-sync', async (real) => ({ ...(await real<Record<string, unknown>>()), syncSubscriptionFromStripe }))

import { decideReversal, handleReversal, type ReversalFacts } from '@/lib/billing-reversals'

const facts = (over: Partial<ReversalFacts> = {}): ReversalFacts => ({ invoiceId: 'in_now', subscriptionId: 'sub_1', latestInvoiceId: 'in_now', subscriptionStatus: 'active', ...over })
const charge = (amount: number, refunded: number) => ({ amount, amount_refunded: refunded, refunded: refunded >= amount })

describe('T-191: which reversals end the plan (pure)', () => {
  it('a full refund of the current period ends it', () => {
    expect(decideReversal({ kind: 'refund', charge: charge(2900, 2900) }, facts())).toEqual({ end: true, why: 'refunded' })
  })
  it('a partial refund (goodwill) keeps it', () => {
    expect(decideReversal({ kind: 'refund', charge: charge(2900, 1000) }, facts())).toEqual({ end: false, why: 'partial_refund' })
  })
  it('a full refund of an earlier period keeps it (this period is paid)', () => {
    expect(decideReversal({ kind: 'refund', charge: charge(2900, 2900) }, facts({ invoiceId: 'in_old' }))).toEqual({ end: false, why: 'earlier_period' })
  })
  it('a lost dispute ends it, whatever the period', () => {
    expect(decideReversal({ kind: 'dispute', dispute: { status: 'lost' } }, facts({ invoiceId: 'in_old' }))).toEqual({ end: true, why: 'dispute_lost' })
  })
  it('a dispute that is won, or still open, keeps it', () => {
    for (const status of ['won', 'needs_response', 'under_review', 'warning_closed'] as const) {
      expect(decideReversal({ kind: 'dispute', dispute: { status } }, facts()).end, status).toBe(false)
    }
  })
  it('a subscription already ended is not ended again', () => {
    expect(decideReversal({ kind: 'dispute', dispute: { status: 'lost' } }, facts({ subscriptionStatus: 'canceled' }))).toEqual({ end: false, why: 'already_ended' })
  })
})

function fakeStripe(opts: { charge?: Partial<Stripe.Charge>; dispute?: Partial<Stripe.Dispute>; invoiceId?: string | null; subscriptionOnInvoice?: string | null; latest?: string; status?: Stripe.Subscription.Status }) {
  const cancel = vi.fn(async () => ({}))
  const stripe = {
    charges: { retrieve: vi.fn(async () => ({ id: 'ch_1', amount: 2900, amount_refunded: 2900, refunded: true, payment_intent: 'pi_1', ...opts.charge })) },
    disputes: { retrieve: vi.fn(async () => ({ id: 'dp_1', status: 'lost', payment_intent: 'pi_1', charge: 'ch_1', ...opts.dispute })) },
    invoicePayments: { list: vi.fn(async () => ({ data: opts.invoiceId === null ? [] : [{ invoice: opts.invoiceId ?? 'in_now' }] })) },
    invoices: { retrieve: vi.fn(async () => ({ id: opts.invoiceId ?? 'in_now', parent: opts.subscriptionOnInvoice === null ? null : { subscription_details: { subscription: opts.subscriptionOnInvoice ?? 'sub_1' } } })) },
    subscriptions: { retrieve: vi.fn(async () => ({ id: 'sub_1', status: opts.status ?? 'active', latest_invoice: opts.latest ?? 'in_now' })), cancel },
  }
  return { stripe: stripe as unknown as Stripe, cancel, raw: stripe }
}
const admin = {} as SupabaseClient

describe('T-191: handling a refund or a closed dispute', () => {
  beforeEach(() => syncSubscriptionFromStripe.mockClear())

  it('a full refund: reads the charge, its invoice and the subscription again, cancels at once, then syncs', async () => {
    const { stripe, cancel, raw } = fakeStripe({})
    const result = await handleReversal(admin, stripe, { kind: 'refund', chargeId: 'ch_1' })
    expect(result).toMatchObject({ handled: true, decision: { end: true, why: 'refunded' }, subscriptionId: 'sub_1' })
    expect(raw.charges.retrieve).toHaveBeenCalledWith('ch_1')
    expect(raw.invoicePayments.list).toHaveBeenCalledWith({ payment: { type: 'payment_intent', payment_intent: 'pi_1' }, limit: 1 })
    expect(cancel).toHaveBeenCalledWith('sub_1', { invoice_now: false, prorate: false })
    expect(syncSubscriptionFromStripe).toHaveBeenCalledWith(admin, stripe, 'sub_1')
  })

  it('a partial refund changes nothing at Stripe or here', async () => {
    const { stripe, cancel } = fakeStripe({ charge: { amount_refunded: 500, refunded: false } })
    expect(await handleReversal(admin, stripe, { kind: 'refund', chargeId: 'ch_1' })).toMatchObject({ decision: { end: false, why: 'partial_refund' } })
    expect(cancel).not.toHaveBeenCalled()
    expect(syncSubscriptionFromStripe).not.toHaveBeenCalled()
  })

  it('a lost dispute with no payment intent on it finds one through its charge', async () => {
    const { stripe, cancel, raw } = fakeStripe({ dispute: { payment_intent: null } })
    expect(await handleReversal(admin, stripe, { kind: 'dispute', disputeId: 'dp_1' })).toMatchObject({ decision: { end: true, why: 'dispute_lost' } })
    expect(raw.charges.retrieve).toHaveBeenCalledWith('ch_1')
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('a won dispute changes nothing', async () => {
    const { stripe, cancel } = fakeStripe({ dispute: { status: 'won' } })
    expect(await handleReversal(admin, stripe, { kind: 'dispute', disputeId: 'dp_1' })).toMatchObject({ decision: { end: false } })
    expect(cancel).not.toHaveBeenCalled()
  })

  it('money that was not a plan payment is left alone', async () => {
    const none = fakeStripe({ invoiceId: null })
    expect(await handleReversal(admin, none.stripe, { kind: 'refund', chargeId: 'ch_1' })).toEqual({ handled: false, why: 'not_a_plan_payment' })
    const noSub = fakeStripe({ subscriptionOnInvoice: null })
    expect(await handleReversal(admin, noSub.stripe, { kind: 'refund', chargeId: 'ch_1' })).toEqual({ handled: false, why: 'not_a_plan_payment' })
    expect(none.cancel).not.toHaveBeenCalled()
  })

  it('a retry after the cancel went through stores the ended plan without cancelling twice', async () => {
    const { stripe, cancel } = fakeStripe({ status: 'canceled' })
    expect(await handleReversal(admin, stripe, { kind: 'dispute', disputeId: 'dp_1' })).toMatchObject({ decision: { why: 'already_ended' } })
    expect(cancel).not.toHaveBeenCalled()
    expect(syncSubscriptionFromStripe).toHaveBeenCalledTimes(1)
  })

  it('a failed write throws, so Stripe sends the event again', async () => {
    syncSubscriptionFromStripe.mockResolvedValueOnce({ ok: false, why: 'write_failed' })
    const { stripe } = fakeStripe({})
    await expect(handleReversal(admin, stripe, { kind: 'refund', chargeId: 'ch_1' })).rejects.toThrow('write_failed')
  })
})
