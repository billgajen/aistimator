import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth-tenant'
import { billingNotice } from '@/lib/billing-notice'

export const dynamic = 'force-dynamic'

/**
 * GET /api/billing/notice (T-180)
 * The one line the dashboard shows on EVERY page when the business must act
 * on its account: a payment that failed, or an account that is paused. Null
 * when there is nothing to say. Read by the dashboard layout.
 */
export async function GET() {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const [{ data: subscription }, { data: tenant }] = await Promise.all([
    auth.supabase.from('subscriptions').select('status, stripe_customer_id').eq('tenant_id', auth.tenantId).maybeSingle(),
    auth.supabase.from('tenants').select('suspended_at').eq('id', auth.tenantId).single(),
  ])
  return NextResponse.json({
    notice: billingNotice({
      status: (subscription as { status?: string } | null)?.status ?? null,
      hasStripeCustomer: Boolean((subscription as { stripe_customer_id?: string | null } | null)?.stripe_customer_id),
      suspended: Boolean((tenant as { suspended_at?: string | null } | null)?.suspended_at),
    }),
  })
}
