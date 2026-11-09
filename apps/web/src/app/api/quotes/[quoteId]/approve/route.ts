import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth-tenant'
import { approveQuote } from '@/lib/quote-approval'

export const dynamic = 'force-dynamic'

/**
 * POST /api/quotes/:quoteId/approve (T-146) — the business approves a quote
 * that is awaiting its review; the customer gets the quote page and email.
 * Works from the dashboard (cookie) and the mobile app (Bearer, AD-033).
 */
export async function POST(_request: Request, { params }: { params: { quoteId: string } }) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const result = await approveQuote({
    supabase: auth.supabase,
    quoteId: params.quoteId,
    tenantId: auth.tenantId,
    userId: auth.userId,
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
