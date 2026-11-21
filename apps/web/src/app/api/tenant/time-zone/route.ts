import { NextResponse } from 'next/server'
import { isTimeZone } from '@qolumns/shared'
import { requireTenant } from '@/lib/auth-tenant'
import { rememberTimeZone } from '@/lib/won'

/**
 * POST /api/tenant/time-zone  { timeZone: 'Europe/London' }
 * T-196: the dashboard reports the browser's time zone once, so "this month"
 * on Home starts at the business's own midnight. Only the first one is kept.
 */
export async function POST(request: Request) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const body = (await request.json().catch(() => null)) as { timeZone?: unknown } | null
  if (!isTimeZone(body?.timeZone)) {
    return NextResponse.json({ error: { code: 'INVALID_TIME_ZONE', message: 'timeZone must be a time zone name' } }, { status: 400 })
  }
  const { data: tenant } = await auth.supabase.from('tenants').select('time_zone').eq('id', auth.tenantId).single()
  const kept = await rememberTimeZone(auth.tenantId, (tenant as { time_zone?: string | null } | null)?.time_zone, body.timeZone)
  return NextResponse.json({ ok: true, kept })
}
