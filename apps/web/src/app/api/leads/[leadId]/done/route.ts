import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth-tenant'
import { createAdminClient } from '@/lib/supabase/server'
import { LEAD_ID } from '@/lib/unfinished-leads'

const notFound = () => NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Request not found' } }, { status: 404 })

/**
 * POST /api/leads/:leadId/done
 * T-160: the business has dealt with this unfinished request. It leaves the
 * Unfinished list and every count. Pressing it twice is fine.
 *
 * Another business's request, a finished one and a made-up id all answer 404:
 * the row is looked up by id AND the signed-in user's tenant. The write uses
 * the service role (the business has no write policy on request_leads) with
 * the same two filters.
 */
export async function POST(_request: Request, { params }: { params: { leadId: string } }) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const { leadId } = params
  if (!LEAD_ID.test(leadId)) return notFound()

  const admin = createAdminClient()
  const { data: lead } = await admin
    .from('request_leads')
    .select('id, handled_at, seen_at')
    .eq('id', leadId)
    .eq('tenant_id', auth.tenantId)
    .is('completed_at', null)
    .maybeSingle()
  if (!lead) return notFound()

  if (!lead.handled_at) {
    const now = new Date().toISOString()
    const { error } = await admin
      .from('request_leads')
      // Dealing with someone is seeing them too
      .update({ handled_at: now, ...(!lead.seen_at && { seen_at: now }) })
      .eq('id', leadId)
      .eq('tenant_id', auth.tenantId)
      .is('handled_at', null)
    if (error) {
      console.error('[LeadDone] update failed:', error.message)
      return NextResponse.json({ error: { code: 'DB_ERROR', message: 'Could not save that. Please try again.' } }, { status: 500 })
    }
  }
  return NextResponse.json({ ok: true })
}
