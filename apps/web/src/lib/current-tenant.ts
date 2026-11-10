/**
 * The signed-in user's tenant id (dashboard cookie or app bearer, AD-033).
 * Returns a ready error response when there is none, so routes stay short.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type UserClient = Awaited<ReturnType<typeof createClient>>

export async function currentTenant(): Promise<
  { ok: true; supabase: UserClient; tenantId: string } | { ok: false; response: NextResponse }
> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }, { status: 401 }) }
  }
  const { data: profile } = await supabase.from('user_profiles').select('tenant_id').eq('id', user.id).single()
  if (!profile?.tenant_id) {
    return { ok: false, response: NextResponse.json({ error: { code: 'NO_TENANT', message: 'User has no tenant' } }, { status: 404 }) }
  }
  return { ok: true, supabase, tenantId: profile.tenant_id as string }
}
