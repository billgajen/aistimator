import { NextResponse } from 'next/server'
import { currentTenant } from '@/lib/current-tenant'
import { LEAD_ROW_COLUMNS, UNFINISHED_READ_LIMIT, collapseLeads, unfinishedFilter, type LeadRow } from '@/lib/unfinished-leads'
import { PULSE_NEWEST_QUOTES, pulseRecentSince, pulseStamp, type PulseAnswer, type PulseParts } from '@/lib/dashboard-pulse'

export const dynamic = 'force-dynamic'

/**
 * GET /api/quotes/pulse
 * T-204: "has anything changed for this business?" The dashboard asks every few
 * seconds while its tab is on screen and reads its data again only when the
 * stamp differs (lib/dashboard-pulse.ts). Own tenant only: the signed-in
 * session's client, with the row rules, and an explicit tenant filter.
 *
 * It returns a stamp and the menu badge's count. No quote, no name, no figure.
 */
export async function GET() {
  const auth = await currentTenant()
  if (!auth.ok) return auth.response
  const { supabase, tenantId } = auth
  const since = pulseRecentSince()

  const [newest, recent, leads, questions] = await Promise.all([
    supabase.from('quotes').select('id, status, version').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(PULSE_NEWEST_QUOTES),
    supabase
      .from('quotes')
      .select('id, status, sent_at, viewed_at, accepted_at, declined_at, last_amended_at')
      .eq('tenant_id', tenantId)
      .or(['sent_at', 'viewed_at', 'accepted_at', 'declined_at', 'last_amended_at'].map((column) => `${column}.gte.${since}`).join(','))
      .limit(200),
    unfinishedFilter(supabase.from('request_leads').select(LEAD_ROW_COLUMNS), tenantId).limit(UNFINISHED_READ_LIMIT),
    supabase.from('quote_feedback').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'pending'),
  ])
  if (newest.error || recent.error || leads.error) {
    return NextResponse.json({ error: { code: 'DB_ERROR', message: 'Failed to load' } }, { status: 500 })
  }

  const entries = collapseLeads((leads.data ?? []) as LeadRow[])
  const parts: PulseParts = {
    newest: newest.data ?? [],
    recent: recent.data ?? [],
    unfinished: {
      listed: entries.length,
      fresh: entries.filter((entry) => entry.isNew).length,
      lastActiveAt: entries[0]?.lastActiveAt ?? null,
    },
    // A failed count is "none": it must not stop the rest of the answer
    questions: questions.count ?? 0,
  }
  const answer: PulseAnswer = { stamp: pulseStamp(parts), newUnfinished: parts.unfinished.fresh }
  return NextResponse.json(answer, { headers: { 'Cache-Control': 'no-store' } })
}
