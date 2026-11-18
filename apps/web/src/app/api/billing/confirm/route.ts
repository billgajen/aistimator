import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth-tenant'
import { createAdminClient } from '@/lib/supabase/server'
import { getStripeClient } from '@/lib/stripe'
import { syncSubscriptionFromStripe } from '@/lib/billing-sync'

export const dynamic = 'force-dynamic'

const refuse = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status })

/**
 * POST /api/billing/confirm { sessionId } (T-180)
 * The business has just come back from Checkout. Store its plan now, from
 * Stripe, so the billing page shows it without waiting for the webhook (which
 * may be a few seconds behind). It does what the webhook does, through the
 * same function, so doing both changes nothing.
 *
 * The session must be this business's own (Stripe's record of who it was
 * created for), so a session id from somewhere else stores nothing.
 */
export async function POST(request: Request) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const stripe = getStripeClient()
  if (!stripe) return refuse(503, 'STRIPE_NOT_CONFIGURED', 'Stripe is not configured')

  const body = (await request.json().catch(() => null)) as { sessionId?: unknown } | null
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
  if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(sessionId)) return refuse(400, 'VALIDATION_ERROR', 'sessionId is required')

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    const owner = session.client_reference_id || session.metadata?.tenant_id
    if (owner !== auth.tenantId) return refuse(404, 'NOT_FOUND', 'Checkout session not found')
    const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
    if (session.status !== 'complete' || !subscriptionId) return NextResponse.json({ confirmed: false })

    const result = await syncSubscriptionFromStripe(createAdminClient(), stripe, subscriptionId, { tenantId: auth.tenantId })
    return NextResponse.json({ confirmed: result.ok })
  } catch (error) {
    console.error('[Billing] Confirm failed:', error instanceof Error ? error.message : 'unknown')
    // The webhook will still store the plan; the page reads again
    return NextResponse.json({ confirmed: false })
  }
}
