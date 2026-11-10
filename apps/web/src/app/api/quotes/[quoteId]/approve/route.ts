import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth-tenant'
import { approveQuote } from '@/lib/quote-approval'
import { bearerToken } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * POST /api/quotes/:quoteId/approve (T-146) — the business approves a quote
 * that is awaiting its review; the customer gets the quote page and email.
 * Works from the dashboard (cookie) and the mobile app (Bearer, AD-033).
 */
export async function POST(request: Request, { params }: { params: { quoteId: string } }) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const result = await approveQuote({
    supabase: auth.supabase,
    quoteId: params.quoteId,
    tenantId: auth.tenantId,
    userId: auth.userId,
    // T-156: the app signs in with a Bearer token, the dashboard with a cookie
    via: bearerToken(request.headers.get('authorization')) ? 'app' : 'dashboard',
  })
  if (!result.ok) {
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.httpStatus })
  }
  return NextResponse.json({
    status: result.status,
    emailed: result.emailed,
    ...(result.emailError && { emailError: result.emailError }),
  })
}
