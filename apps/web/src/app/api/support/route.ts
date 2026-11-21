import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth-tenant'
import { myReports, myRequests, planName } from '@/lib/support'

export const dynamic = 'force-dynamic'

/**
 * GET /api/support            the business's own reports and feature requests, newest first, and its plan
 * GET /api/support?quoteId=…  only the reports on one of its estimates (the quote page's "Reported on …")
 *
 * T-197. Own business only: every read is through the signed-in user's own
 * client, so the database's row-level rules decide what comes back.
 */
export async function GET(request: Request) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const quoteId = new URL(request.url).searchParams.get('quoteId')
  if (quoteId) {
    return NextResponse.json({ reports: await myReports(auth.supabase, auth.tenantId, quoteId) })
  }
  const [reports, requests, plan] = await Promise.all([myReports(auth.supabase, auth.tenantId), myRequests(auth.supabase, auth.tenantId), planName(auth.supabase, auth.tenantId)])
  return NextResponse.json({ plan, reports, requests, unread: reports.filter((r) => r.unread).length })
}
