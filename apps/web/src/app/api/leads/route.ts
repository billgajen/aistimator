import { NextResponse } from 'next/server'
import { currentTenant } from '@/lib/current-tenant'
import { PROGRESS_WORDS, isLeadProgress } from '@/lib/request-leads'
import { UNFINISHED_WINDOW_DAYS, unfinishedFilter } from '@/lib/unfinished-leads'

/**
 * GET /api/leads[?days=30]
 * T-151: requests that were started but not finished (contact details given,
 * never submitted), newest first. Own tenant only (RLS + explicit filter).
 * T-160: people the business marked "Done" are left out; each item says
 * whether it is new (not seen before), and `asOf` is the moment the list was
 * read, for POST /api/leads/seen. Reading the list changes nothing.
 */
export async function GET(request: Request) {
  const auth = await currentTenant()
  if (!auth.ok) return auth.response
  const days = Math.min(90, Math.max(1, Number(new URL(request.url).searchParams.get('days')) || UNFINISHED_WINDOW_DAYS))
  const asOf = new Date()
  const { data, error } = await unfinishedFilter(
    auth.supabase
      .from('request_leads')
      .select('id, customer_name, customer_email, customer_phone, progress, job_answers, asset_ids, job_postcode, created_at, updated_at, seen_at, services!service_id ( name )'),
    auth.tenantId,
    { days, now: asOf }
  )
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ error: { code: 'DB_ERROR', message: 'Failed to load' } }, { status: 500 })
  return NextResponse.json({
    asOf: asOf.toISOString(),
    items: (data || []).map((l) => ({
      leadId: l.id,
      customerName: l.customer_name,
      customerEmail: l.customer_email,
      customerPhone: l.customer_phone,
      serviceName: (l.services as unknown as { name?: string } | null)?.name ?? null,
      progress: l.progress,
      progressLabel: isLeadProgress(l.progress) ? PROGRESS_WORDS[l.progress] : l.progress,
      answerCount: Array.isArray(l.job_answers) ? l.job_answers.length : 0,
      photoCount: Array.isArray(l.asset_ids) ? l.asset_ids.length : 0,
      postcode: l.job_postcode,
      createdAt: l.created_at,
      lastActiveAt: l.updated_at,
      isNew: !(l as { seen_at?: string | null }).seen_at,
    })),
  })
}
