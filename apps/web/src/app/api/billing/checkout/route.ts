import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth-tenant'
import { createAdminClient } from '@/lib/supabase/server'
import { getPlan, isFreeTestAccount, stripePriceIdFor, stripePriceEnvKey, subscriptionLive, type PlanInterval } from '@qolumns/shared'
import { getStripeClient, createCheckoutSession } from '@/lib/stripe'
import type { CreateCheckoutRequest, CreateCheckoutResponse } from '@qolumns/shared'

export const dynamic = 'force-dynamic'

const refuse = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status })

/**
 * POST /api/billing/checkout (T-134, T-180)
 * Start Stripe Checkout for a plan: the business's first purchase, or its next
 * one after a plan ended. Stripe is the seller (Managed Payments, AD-062).
 *
 * Refused, with nothing created on Stripe:
 *   - a free test account (T-177): it has its plan without paying, and must
 *     never be sold one by accident;
 *   - a business that already has a paid plan: it changes plan in the portal,
 *     so it can never end up with two subscriptions.
 */
export async function POST(request: Request) {
  try {
    const stripe = getStripeClient()
    if (!stripe) return refuse(503, 'STRIPE_NOT_CONFIGURED', 'Stripe is not configured')

    const body = (await request.json().catch(() => null)) as CreateCheckoutRequest | null
    if (!body?.planId) return refuse(400, 'VALIDATION_ERROR', 'planId is required')

    const auth = await requireTenant()
    if (!auth.ok) return auth.response
    const { supabase, tenantId } = auth
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // T-134: plans come from the shared definitions; only offered plans are purchasable
    const plan = getPlan(body.planId)
    if (!plan || !plan.offered) return refuse(404, 'PLAN_NOT_FOUND', 'Plan not found')
    const interval: PlanInterval = body.interval === 'annual' ? 'annual' : 'monthly'
    const currency = 'USD'
    // Stripe price ids are account-specific → env (STRIPE_PRICE_<PLAN>_<INTERVAL>_<CURRENCY>)
    const stripePriceId = stripePriceIdFor(plan.id, interval, currency, process.env)
    if (!stripePriceId) {
      console.error(`[Checkout] Missing env ${stripePriceEnvKey(plan.id, interval, currency)}`)
      return refuse(400, 'NO_STRIPE_PRICE', 'This plan is not available for checkout yet')
    }

    // The subscription row is read with the service role: it is the server's record (T-173)
    const { data: subscription } = await createAdminClient()
      .from('subscriptions')
      .select('status, stripe_customer_id, stripe_subscription_id')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    const row = subscription as { status: string; stripe_customer_id: string | null; stripe_subscription_id: string | null } | null

    if (isFreeTestAccount(row)) {
      return refuse(409, 'TEST_ACCOUNT', 'This is a test account. It has its plan without paying, so there is nothing to buy.')
    }
    if (row && subscriptionLive(row.status) && row.stripe_subscription_id) {
      return refuse(409, 'ALREADY_SUBSCRIBED', 'You already have a plan. Change it from "Manage billing".')
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const session = await createCheckoutSession(stripe, {
      priceId: stripePriceId,
      tenantId,
      // {CHECKOUT_SESSION_ID} is filled in by Stripe: the billing page confirms it, so the plan
      // shows at once without waiting for the webhook
      successUrl: `${appUrl}/app/settings/billing?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${appUrl}/app/settings/billing?canceled=true`,
      customerId: row?.stripe_customer_id ?? null,
      customerEmail: user?.email ?? null,
      // No plan has a trial (AD-047). If one ever does: once per business.
      trialDays: plan.trialDays && !row?.stripe_customer_id ? plan.trialDays : undefined,
    })

    if (!session.url) return refuse(500, 'CHECKOUT_FAILED', 'Failed to create checkout session')
    const response: CreateCheckoutResponse = { checkoutUrl: session.url }
    return NextResponse.json(response)
  } catch (error) {
    console.error('Checkout error:', error instanceof Error ? error.message : 'unknown')
    return refuse(500, 'INTERNAL_ERROR', 'Internal server error')
  }
}
