import { NextResponse } from 'next/server'
import type { AppCreateQuoteRequest } from '@estimator/shared'
import { requireTenant } from '@/lib/auth-tenant'
import { createAdminClient } from '@/lib/supabase/server'
import { createQuoteSubmission } from '@/lib/quote-intake'

export const maxDuration = 60

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * POST /api/app/quotes (T-137) — the business creates a quote on site.
 * Same intake as the website widget (validation, plan limits, queue), with
 * the tenant taken from the signed-in user instead of a public key, no bot
 * checks (it's an authenticated business user), and no AI service match
 * (the business picked the service).
 */
export async function POST(request: Request) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response

  let body: AppCreateQuoteRequest
  try {
    body = (await request.json()) as AppCreateQuoteRequest
  } catch {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON' } }, { status: 400 })
  }
  if (!body.serviceId) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'serviceId is required' } }, { status: 400 })
  }
  if (!body.customer?.name?.trim() || !body.customer?.email?.trim()) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'customer name and email are required' } }, { status: 400 })
  }
  if (!EMAIL.test(body.customer.email.trim())) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid email format' } }, { status: 400 })
  }

  // Tenant ownership is proven by the session; the intake runs with the
  // admin client exactly as the widget route does (it writes several tables)
  const result = await createQuoteSubmission(createAdminClient(), {
    tenantId: auth.tenantId,
    serviceId: body.serviceId,
    customer: { name: body.customer.name.trim(), email: body.customer.email.trim(), ...(body.customer.phone && { phone: body.customer.phone }) },
    job: body.job,
    assetIds: body.assetIds,
    source: { type: 'app', userId: auth.userId },
    skipServiceMatch: true,
  })
  return NextResponse.json(result.json, { status: result.status })
}
