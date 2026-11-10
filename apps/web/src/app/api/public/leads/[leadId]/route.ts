import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { checkPublicRateLimit, getClientIp, rateLimitedResponse } from '@/lib/rate-limit'
import { cleanAnswers, cleanAssetIds, hashLeadToken, isLeadProgress, laterProgress, type LeadProgress } from '@/lib/request-leads'

/**
 * PATCH /api/public/leads/:leadId  { tenantKey, leadToken, progress, answers?, postcode?, assetIds? }
 * T-151: how far the customer got. Only the browser holding the lead's token
 * can update it, and only while it is unfinished. Progress never goes back.
 */
export async function PATCH(request: Request, { params }: { params: { leadId: string } }) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const tenantKey = typeof body?.tenantKey === 'string' ? body.tenantKey : ''
  const leadToken = typeof body?.leadToken === 'string' ? body.leadToken : ''
  if (!tenantKey || !leadToken || !isLeadProgress(body?.progress)) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'tenantKey, leadToken and progress are required' } }, { status: 400 })
  }
  const rate = await checkPublicRateLimit('leads', { ip: getClientIp(request), tenantKey })
  if (!rate.allowed) return rateLimitedResponse(rate)

  const supabase = createAdminClient()
  const { data: site } = await supabase.from('tenant_sites').select('tenant_id').eq('tenant_key', tenantKey).maybeSingle()
  const { data: lead } = site
    ? await supabase
        .from('request_leads')
        .select('id, progress')
        .eq('id', params.leadId)
        .eq('tenant_id', site.tenant_id)
        .eq('lead_token_hash', hashLeadToken(leadToken))
        .is('completed_at', null)
        .maybeSingle()
    : { data: null }
  if (!lead) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Request not found' } }, { status: 404 })

  const updates: Record<string, unknown> = { progress: laterProgress(lead.progress as LeadProgress, body!.progress as LeadProgress) }
  if (body!.answers !== undefined) updates.job_answers = cleanAnswers(body!.answers)
  if (typeof body!.postcode === 'string') updates.job_postcode = body!.postcode.trim().slice(0, 20) || null
  if (body!.assetIds !== undefined) updates.asset_ids = cleanAssetIds(body!.assetIds)
  const { error } = await supabase.from('request_leads').update(updates).eq('id', lead.id)
  if (error) return NextResponse.json({ error: { code: 'DB_ERROR', message: 'Could not save' } }, { status: 500 })
  return NextResponse.json({ ok: true })
}
