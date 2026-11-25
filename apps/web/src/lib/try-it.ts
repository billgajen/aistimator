/**
 * T-202: what "Try it yourself" needs to know before it starts (server only):
 * is a service switched on, and is one of the day's test estimates left. Read
 * for the signed-in business only; it changes nothing (the count is taken when
 * the test request is sent: lib/test-estimates.ts, where the rules are).
 */
import { createAdminClient } from '@/lib/supabase/server'
import { readTestAllowance, tryItStateOf, type TryItState } from '@/lib/test-estimates'

export async function readTryItState(tenantId: string, now: number = Date.now()): Promise<TryItState> {
  const admin = createAdminClient()
  const [allowance, { count }] = await Promise.all([
    readTestAllowance(admin, tenantId, now),
    admin.from('services').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('active', true),
  ])
  return tryItStateOf(allowance, (count ?? 0) > 0)
}
