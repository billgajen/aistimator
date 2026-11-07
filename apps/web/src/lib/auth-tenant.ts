/**
 * Shared dashboard-route auth: signed-in user → tenant id (T-136 helper).
 */

import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export type AuthedTenant =
  | { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; tenantId: string; userId: string }
  | { ok: false; response: NextResponse }

export async function requireTenant(): Promise<AuthedTenant> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }, { status: 401 }),
    }
  }
  const { data: profile } = await supabase.from('user_profiles').select('tenant_id').eq('id', user.id).single()
  if (!profile?.tenant_id) {
    return {
      ok: false,
      response: NextResponse.json({ error: { code: 'NO_TENANT', message: 'User has no tenant' } }, { status: 404 }),
    }
  }
  return { ok: true, supabase, tenantId: profile.tenant_id as string, userId: user.id }
}
