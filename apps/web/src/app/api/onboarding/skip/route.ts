import { NextResponse } from 'next/server'
import { currentTenant } from '@/lib/current-tenant'

/**
 * POST /api/onboarding/skip
 * T-150: the business chose to set up by hand; the dashboard stops sending it to setup.
 */
export async function POST() {
  const auth = await currentTenant()
  if (!auth.ok) return auth.response
  const { error } = await auth.supabase
    .from('tenants')
    .update({ onboarding_skipped_at: new Date().toISOString() })
    .eq('id', auth.tenantId)
    .is('onboarding_skipped_at', null)
  if (error) return NextResponse.json({ error: { code: 'DB_ERROR', message: 'Could not save' } }, { status: 500 })
  return NextResponse.json({ ok: true })
}
