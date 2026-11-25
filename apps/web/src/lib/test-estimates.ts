/**
 * T-202: the test estimate a business makes from its own dashboard ("Try it
 * yourself"), and how the server decides that a request is one.
 *
 * A request is a test only when BOTH hold:
 *   1. the form says so in the request body (`ownTest: true`: the form shown
 *      inside the dashboard, /app/try-it), and
 *   2. the request carries the signed-in session of a user of the business
 *      the form belongs to.
 * Nothing in a web address can make one, so a customer cannot (before T-202 a
 * signed code in the address did, T-150). A request that says it is a test
 * without that session is refused: it is never quietly taken as a real,
 * counted request.
 *
 * A business may make TEST_ESTIMATES_PER_DAY in 24 hours. The count lives on
 * the business (`tenants.test_estimate_times`, migration 51), so deleting a
 * test does not hand one back.
 */
import type { createAdminClient } from '@/lib/supabase/server'
import { TEST_ESTIMATES_PER_DAY, TRY_IT_COPY } from '@/lib/try-it-copy'

type Admin = ReturnType<typeof createAdminClient>

export { TEST_ESTIMATES_PER_DAY, TRY_IT_COPY, TRY_IT_PATH } from '@/lib/try-it-copy'

const DAY_MS = 24 * 60 * 60 * 1000

const TEST_KEYS = new Set(['test', 'isTest', 'is_test', 'ownTest'])

/** Remove any test marker a client put in `source` (only the server sets it). */
export function publicSource(source: Record<string, unknown> | undefined): Record<string, unknown> {
  const rest = Object.fromEntries(Object.entries(source ?? { type: 'widget' }).filter(([key]) => !TEST_KEYS.has(key)))
  return Object.keys(rest).length > 0 ? rest : { type: 'widget' }
}

export interface TestAllowance {
  allowed: boolean
  limit: number
  used: number
  /** when the next test can be made (ISO); null while there is room */
  availableAt: string | null
}

/**
 * Pure: the day's allowance from the times stored on the business. Only the
 * last 24 hours count. At the limit, the place that frees first is the oldest
 * of the newest `limit`.
 */
export function testAllowance(times: readonly unknown[] | null | undefined, now: number = Date.now(), limit: number = TEST_ESTIMATES_PER_DAY): TestAllowance {
  const recent = (times ?? [])
    .map((value) => (typeof value === 'string' || value instanceof Date ? new Date(value).getTime() : NaN))
    .filter((time) => Number.isFinite(time) && time > now - DAY_MS)
    .sort((a, b) => a - b)
  const used = recent.length
  if (used < limit) return { allowed: true, limit, used, availableAt: null }
  return { allowed: false, limit, used, availableAt: new Date(recent[used - limit]! + DAY_MS).toISOString() }
}

/** Read the day's allowance of one business (it changes nothing) */
export async function readTestAllowance(supabase: Admin, tenantId: string, now: number = Date.now()): Promise<TestAllowance> {
  const { data } = await supabase.from('tenants').select('test_estimate_times').eq('id', tenantId).maybeSingle()
  return testAllowance((data as { test_estimate_times?: unknown[] | null } | null)?.test_estimate_times, now)
}

export type TestRequestDecision =
  | { kind: 'normal' }
  /** `claimedAt`: the moment noted against the day's limit, to give back if the request is not saved */
  | { kind: 'test'; claimedAt: string }
  | { kind: 'refused'; status: number; code: string; message: string; availableAt?: string }

export interface TestIntent {
  /** `ownTest` from the request body */
  ownTest: unknown
  /** a code from the old test link (T-150), sent by a tab left open: always refused */
  oldToken: unknown
  /** The business the request's own session is signed in to, or null. Only asked when the body says "test". */
  signedInTenantId: () => Promise<string | null>
}

/**
 * Is this request the business's own test? See the top of this file for the
 * rule. With `claim: false` nothing is counted (an unfinished request, which a
 * test never saves).
 */
export async function decideTestRequest(supabase: Admin, tenantId: string, intent: TestIntent, options: { claim?: boolean } = {}): Promise<TestRequestDecision> {
  if (intent.oldToken !== undefined && intent.oldToken !== null && intent.oldToken !== '') {
    return { kind: 'refused', status: 403, code: 'TEST_LINK_INVALID', message: TRY_IT_COPY.oldLink }
  }
  if (intent.ownTest === undefined || intent.ownTest === null || intent.ownTest === false) return { kind: 'normal' }
  // anything else in `ownTest` is an attempt at a test: it needs the session, or it is refused
  const signedIn = intent.ownTest === true ? await intent.signedInTenantId().catch(() => null) : null
  if (!signedIn || signedIn !== tenantId) {
    return { kind: 'refused', status: 403, code: 'TEST_NOT_SIGNED_IN', message: TRY_IT_COPY.notSignedIn }
  }
  if (options.claim === false) return { kind: 'test', claimedAt: '' }

  const { data, error } = await supabase.rpc('claim_test_estimate', { p_tenant_id: tenantId, p_limit: TEST_ESTIMATES_PER_DAY })
  const row = (Array.isArray(data) ? data[0] : data) as { claimed?: boolean; claimed_at?: string | null; available_at?: string | null } | null
  if (error || !row) {
    // the count could not be read: a test is not worth guessing at
    console.error('[TestEstimate] claim failed:', error?.code ?? 'no answer')
    return { kind: 'refused', status: 503, code: 'TEST_NOT_STARTED', message: TRY_IT_COPY.notStarted }
  }
  if (!row.claimed) {
    return {
      kind: 'refused',
      status: 429,
      code: 'TEST_LIMIT_REACHED',
      message: TRY_IT_COPY.limitPlain,
      ...(row.available_at && { availableAt: new Date(row.available_at).toISOString() }),
    }
  }
  return { kind: 'test', claimedAt: row.claimed_at ?? '' }
}

/** Give a claim back: the request it was taken for was not saved */
export async function releaseTestClaim(supabase: Admin, tenantId: string, claimedAt: string): Promise<void> {
  if (!claimedAt) return
  const { error } = await supabase.rpc('release_test_estimate', { p_tenant_id: tenantId, p_claimed_at: claimedAt })
  if (error) console.error('[TestEstimate] release failed:', error.code)
}

export interface TryItState extends TestAllowance {
  /** false: no service is switched on, so there is nothing for a customer to ask about */
  hasActiveService: boolean
  /** may a test be started now */
  canStart: boolean
  /** why not, when it cannot */
  reason: 'limit' | 'no_service' | null
}

/** Pure: may "Try it yourself" start? It needs a service switched on and one of the day's tests left. */
export function tryItStateOf(allowance: TestAllowance, hasActiveService: boolean): TryItState {
  const reason = !hasActiveService ? 'no_service' : !allowance.allowed ? 'limit' : null
  return { ...allowance, hasActiveService, canStart: reason === null, reason }
}

/**
 * Pure: does Home offer "Try it yourself"? Until the first real customer
 * request arrives (a test, a quote the business made itself and the demo are
 * not real requests: Home's own rule), and only while a service is switched
 * on, since a customer needs one to ask about.
 */
export function showTryItOnHome(facts: { hasRealRequest: boolean; hasActiveService: boolean }): boolean {
  return !facts.hasRealRequest && facts.hasActiveService
}
