import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth-tenant'
import { createAdminClient } from '@/lib/supabase/server'
import { REPORT_COLUMNS, myReportOf, threadOf } from '@/lib/support'

export const dynamic = 'force-dynamic'

const isId = (value: string) => /^[0-9a-f-]{36}$/i.test(value)

/**
 * GET /api/support/reports/:reportId
 * T-197: one of the business's own reports with its thread. Opening it marks
 * our reply as read (the dot on the Help item goes). Another business's
 * report is not found: the read is through the user's own client.
 */
export async function GET(_request: Request, { params }: { params: { reportId: string } }) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const notFound = NextResponse.json({ error: { code: 'NOT_FOUND', message: 'That report could not be found.' } }, { status: 404 })
  if (!isId(params.reportId)) return notFound
  const { data } = await auth.supabase.from('support_reports').select(REPORT_COLUMNS).eq('id', params.reportId).eq('tenant_id', auth.tenantId).maybeSingle()
  if (!data) return notFound
  const report = myReportOf(data)
  const messages = await threadOf(auth.supabase, report.id, auth.tenantId)
  if (report.unread) {
    // The business cannot change a report itself; the server marks it read, for this business's own row only
    try {
      await createAdminClient().from('support_reports').update({ reply_unread: false }).eq('id', report.id).eq('tenant_id', auth.tenantId)
    } catch {
      // the report still opens; the dot stays until next time
    }
  }
  return NextResponse.json({ report: { ...report, unread: false }, messages })
}
