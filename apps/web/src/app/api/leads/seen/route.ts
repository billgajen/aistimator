import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth-tenant'
import { createAdminClient } from '@/lib/supabase/server'
import { unfinishedFilter } from '@/lib/unfinished-leads'

/**
 * POST /api/leads/seen  { asOf }
 * T-160: the business opened its Unfinished list. Every unfinished request of
 * its own that it had not seen, started up to `asOf` (the moment the list was
 * read), is marked seen, so the Home banner and the menu badge clear. Someone
 * who starts after that moment was not on the screen and stays new.
 *
 * The business cannot write to request_leads itself (no policy), so the write
 * uses the service role, filtered by the signed-in user's tenant.
 */
export async function POST(request: Request) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response

  const body = (await request.json().catch(() => null)) as { asOf?: unknown } | null
  const now = new Date()
  const given = typeof body?.asOf === 'string' ? new Date(body.asOf) : null
  // Never later than now: a made-up future time must not mark people who have not started yet
  const asOf = given && !Number.isNaN(given.getTime()) && given.getTime() < now.getTime() ? given : now

  const { data, error } = await unfinishedFilter(
    createAdminClient().from('request_leads').update({ seen_at: now.toISOString() }),
    auth.tenantId,
    { newOnly: true, now }
  )
    .lte('created_at', asOf.toISOString())
    .select('id')
  if (error) {
    console.error('[LeadsSeen] update failed:', error.message)
    return NextResponse.json({ error: { code: 'DB_ERROR', message: 'Could not save that. Please try again.' } }, { status: 500 })
  }
  return NextResponse.json({ marked: data?.length ?? 0 })
}
