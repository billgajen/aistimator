import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth-tenant'
import { createAdminClient } from '@/lib/supabase/server'
import { getStripeClient } from '@/lib/stripe'
import { pendingPlanChange } from '@/lib/billing-pending'
import { subscriptionLive } from '@qolumns/shared'

export const dynamic = 'force-dynamic'

/**
 * GET /api/billing/pending (T-180)
 * → { pending: null | { planId, planName, interval, at } }
 *
 * A plan change that is waiting for the end of the paid period (a downgrade
 * asked for in Stripe's portal). The billing page shows it as "Changes to
 * <plan> on <date>". Read from Stripe when asked and never stored (see
 * lib/billing-pending.ts). Any trouble reading it is "nothing waiting": the
 * page's other data does not depend on this.
 */
export async function GET() {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  try {
    const { data } = await createAdminClient().from('subscriptions').select('status, stripe_subscription_id').eq('tenant_id', auth.tenantId).maybeSingle()
    const row = data as { status: string; stripe_subscription_id: string | null } | null
    const stripe = getStripeClient()
    if (!stripe || !row?.stripe_subscription_id || !subscriptionLive(row.status)) return NextResponse.json({ pending: null })
    const subscription = await stripe.subscriptions.retrieve(row.stripe_subscription_id, { expand: ['schedule'] })
    return NextResponse.json({ pending: pendingPlanChange(subscription, process.env) })
  } catch (error) {
    console.error('[Billing] Could not read a waiting plan change:', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({ pending: null })
  }
}
