import { NextResponse } from 'next/server'
import { currentTenant } from '@/lib/current-tenant'

/**
 * POST /api/tenant/share-event  { event: 'copied' }
 * T-149: the business copied its quote link (or a "Where to put it" text).
 * Ticks "Share your quote link" on the home checklist; only the first one is kept.
 */
export async function POST(request: Request) {
  const auth = await currentTenant()
  if (!auth.ok) return auth.response
  const body = (await request.json().catch(() => null)) as { event?: unknown } | null
  if (body?.event !== 'copied') {
    return NextResponse.json({ error: { code: 'INVALID_EVENT', message: 'event must be "copied"' } }, { status: 400 })
  }
  const { error } = await auth.supabase
    .from('tenants')
    .update({ quote_link_copied_at: new Date().toISOString() })
    .eq('id', auth.tenantId)
    .is('quote_link_copied_at', null)
  if (error) {
    console.error('[ShareEvent] update failed:', error.message)
    return NextResponse.json({ error: { code: 'DB_ERROR', message: 'Could not record the event' } }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
