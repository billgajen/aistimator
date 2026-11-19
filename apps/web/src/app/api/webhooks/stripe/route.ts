import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/server'
import { getStripeClient } from '@/lib/stripe'
import { invoiceSubscriptionId, syncSubscriptionFromStripe } from '@/lib/billing-sync'
import { isHandledStripeEvent } from '@/lib/stripe-events'
import { handleReversal } from '@/lib/billing-reversals'
import { sendMetaEvent } from '@/lib/meta-capi'

export const dynamic = 'force-dynamic'

type Admin = ReturnType<typeof createAdminClient>

/**
 * POST /api/webhooks/stripe (T-180, AD-062)
 *
 * The one Stripe endpoint. It handles only the events in
 * `STRIPE_WEBHOOK_EVENTS` (lib/stripe-events.ts), and each of them does the
 * same thing: read the subscription from Stripe again and store it
 * (lib/billing-sync.ts).
 *
 * THE SAME EVENT TWICE CHANGES NOTHING. Each event id is written to
 * `stripe_events` before it is handled and marked done after. A repeat of a
 * finished event is answered 200 without touching anything. A repeat of one
 * that did not finish (we answered 5xx, Stripe is retrying) is handled again,
 * which is safe because the handler stores what Stripe says now.
 *
 * Signature: `STRIPE_WEBHOOK_SECRET`. No signature or a wrong one: 400, and
 * nothing is read from the body.
 */
export async function POST(request: Request) {
  const stripe = getStripeClient()
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
  if (!stripe || !webhookSecret) {
    console.error('[Stripe Webhook] Not configured (STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET missing)')
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 })
  }

  const body = await request.text()
  const signature = request.headers.get('stripe-signature')
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch {
    console.error('[Stripe Webhook] Signature verification failed')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  if (!isHandledStripeEvent(event.type)) {
    // The endpoint is registered for the handled events only; anything else is acknowledged and ignored
    return NextResponse.json({ received: true, handled: false })
  }

  const admin = createAdminClient()
  const seen = await recordEvent(admin, event)
  if (seen === 'done') {
    console.log(`[Stripe Webhook] ${event.type} ${event.id} already handled`)
    return NextResponse.json({ received: true, duplicate: true })
  }

  try {
    await handle(admin, stripe, event)
  } catch (error) {
    console.error(`[Stripe Webhook] ${event.type} ${event.id} failed:`, error instanceof Error ? error.message : 'unknown')
    // not marked done: Stripe sends it again, and it is handled again
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }

  await admin.from('stripe_events').update({ processed_at: new Date().toISOString() }).eq('id', event.id)
  return NextResponse.json({ received: true })
}

/** Note the event. 'done' = it was already handled to the end; 'new' or 'unfinished' = handle it. */
async function recordEvent(admin: Admin, event: Stripe.Event): Promise<'new' | 'unfinished' | 'done'> {
  const { error } = await admin.from('stripe_events').insert({ id: event.id, type: event.type })
  if (!error) return 'new'
  if (error.code !== '23505') {
    // The ledger could not be written. Handle the event anyway: the handler is safe to repeat.
    console.error('[Stripe Webhook] Could not record the event:', error.code ?? error.message)
    return 'unfinished'
  }
  const { data } = await admin.from('stripe_events').select('processed_at').eq('id', event.id).maybeSingle()
  return (data as { processed_at?: string | null } | null)?.processed_at ? 'done' : 'unfinished'
}

async function handle(admin: Admin, stripe: Stripe, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object
      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
      if (session.mode !== 'subscription' || !subscriptionId) return
      const tenantId = session.client_reference_id || session.metadata?.tenant_id || null
      const result = await syncSubscriptionFromStripe(admin, stripe, subscriptionId, { tenantId })
      if (!result.ok) throw new Error(`checkout not stored: ${result.why}`)
      // T-144: server-side Subscribe for the ad funnel (no-op unless Meta is configured)
      await sendMetaEvent({
        eventName: session.amount_total === 0 ? 'StartTrial' : 'Subscribe',
        eventId: session.id,
        email: session.customer_details?.email ?? null,
        ...(session.amount_total !== null && session.currency && { value: session.amount_total / 100, currency: session.currency }),
      })
      return
    }

    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const result = await syncSubscriptionFromStripe(admin, stripe, event.data.object.id)
      // 'write_failed' and 'not_found' are worth a retry; the others are final answers
      if (!result.ok && (result.why === 'write_failed' || result.why === 'not_found')) throw new Error(`subscription not stored: ${result.why}`)
      return
    }

    case 'invoice.payment_failed':
    case 'invoice.paid': {
      const subscriptionId = invoiceSubscriptionId(event.data.object)
      if (!subscriptionId) return // not a subscription's invoice
      const result = await syncSubscriptionFromStripe(admin, stripe, subscriptionId)
      if (!result.ok && (result.why === 'write_failed' || result.why === 'not_found')) throw new Error(`invoice not stored: ${result.why}`)
      return
    }

    // T-191: money taken back. Read again from Stripe; a full refund of the current period or a lost dispute ends the plan.
    case 'charge.refunded': {
      await handleReversal(admin, stripe, { kind: 'refund', chargeId: event.data.object.id })
      return
    }
    case 'charge.dispute.closed': {
      await handleReversal(admin, stripe, { kind: 'dispute', disputeId: event.data.object.id })
      return
    }
  }
}
