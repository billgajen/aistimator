/**
 * T-150: deciding whether a submission is the owner's test request.
 * Only a valid server-issued token for THIS tenant makes it one; anything a
 * client sends in `source` is ignored. Capped per day so a test link can't be
 * passed around as a way to get uncounted quotes.
 */
import type { createAdminClient } from '@/lib/supabase/server'
import { verifyTestToken, TEST_QUOTES_PER_DAY } from '@/lib/test-quote-token'

type Admin = ReturnType<typeof createAdminClient>

const TEST_KEYS = new Set(['test', 'isTest', 'is_test'])

export type TestRequestDecision =
  | { kind: 'normal' }
  | { kind: 'test' }
  | { kind: 'refused'; status: number; code: string; message: string }

/** Remove any test marker a client put in `source` (only the server sets it). */
export function publicSource(source: Record<string, unknown> | undefined): Record<string, unknown> {
  const rest = Object.fromEntries(
    Object.entries(source ?? { type: 'widget' }).filter(([key]) => !TEST_KEYS.has(key))
  )
  return Object.keys(rest).length > 0 ? rest : { type: 'widget' }
}

export async function decideTestRequest(supabase: Admin, tenantId: string, testToken: unknown): Promise<TestRequestDecision> {
  if (testToken === undefined || testToken === null || testToken === '') return { kind: 'normal' }
  const check = typeof testToken === 'string' ? verifyTestToken(testToken, tenantId) : { ok: false as const, reason: 'malformed' as const }
  if (!check.ok) {
    return {
      kind: 'refused',
      status: 403,
      code: 'TEST_LINK_INVALID',
      message: 'This test link has expired or is not valid. Start a new test from setup.',
    }
  }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count } = await supabase
    .from('quotes')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('is_test', true)
    .gte('created_at', since)
  if ((count ?? 0) >= TEST_QUOTES_PER_DAY) {
    return {
      kind: 'refused',
      status: 429,
      code: 'TEST_LIMIT_REACHED',
      message: `You've made ${TEST_QUOTES_PER_DAY} test requests today. Try again tomorrow, or share your link with a real customer.`,
    }
  }
  return { kind: 'test' }
}
