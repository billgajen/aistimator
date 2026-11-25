/**
 * T-202 item 3: "Try it yourself", the test estimate a business makes from inside its dashboard.
 *   - a request is a test only when the body says so AND the session is that business's
 *   - nothing in a web address makes one; the old test link's code is refused
 *   - five in 24 hours, with the time the next one frees up; a deleted test still counts
 *   - only a test of the business's own can be deleted
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  TEST_ESTIMATES_PER_DAY,
  TRY_IT_COPY,
  TRY_IT_PATH,
  decideTestRequest,
  publicSource,
  releaseTestClaim,
  showTryItOnHome,
  testAllowance,
  tryItStateOf,
} from '@/lib/test-estimates'
import { limitLine, whenAvailable } from '@/lib/try-it-copy'
import { deletableAsTest } from '@/lib/test-estimate-delete'

const ROOT = path.resolve(__dirname, '../../../..')
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')
const HOUR = 60 * 60 * 1000
const NOW = Date.parse('2026-11-25T12:00:00Z')
const ago = (hours: number) => new Date(NOW - hours * HOUR).toISOString()

type Admin = Parameters<typeof decideTestRequest>[0]

/** A stand-in for the database: only `rpc` is used by the decision */
function db(answer: { data?: unknown; error?: { code: string } | null } = { data: [{ claimed: true, claimed_at: '2026-11-25T12:00:00.123+00:00', used: 1, available_at: null }] }) {
  const rpc = vi.fn(async () => ({ data: answer.data ?? null, error: answer.error ?? null }))
  return { supabase: { rpc } as unknown as Admin, rpc }
}
const session = (tenantId: string | null) => vi.fn(async () => tenantId)

describe('T-202: the day’s allowance (pure)', () => {
  it('is five in 24 hours', () => {
    expect(TEST_ESTIMATES_PER_DAY).toBe(5)
  })

  it('none or four made: one can be made, and there is no time to wait for', () => {
    expect(testAllowance([], NOW)).toEqual({ allowed: true, limit: 5, used: 0, availableAt: null })
    expect(testAllowance(null, NOW)).toMatchObject({ allowed: true, used: 0 })
    expect(testAllowance([ago(1), ago(2), ago(3), ago(4)], NOW)).toMatchObject({ allowed: true, used: 4, availableAt: null })
  })

  it('five made: no more, until 24 hours after the oldest of them', () => {
    const state = testAllowance([ago(1), ago(20), ago(3), ago(4), ago(2)], NOW)
    expect(state).toMatchObject({ allowed: false, used: 5 })
    expect(state.availableAt).toBe(new Date(NOW + 4 * HOUR).toISOString())
  })

  it('a test older than 24 hours no longer counts', () => {
    expect(testAllowance([ago(25), ago(30), ago(1), ago(2), ago(3), ago(4)], NOW)).toMatchObject({ allowed: true, used: 4 })
  })

  it('should more than five ever be noted, the place that frees first is the oldest of the newest five', () => {
    const state = testAllowance([ago(23), ago(10), ago(9), ago(8), ago(7), ago(6)], NOW)
    expect(state.allowed).toBe(false)
    expect(state.availableAt).toBe(new Date(NOW + 14 * HOUR).toISOString())
  })

  it('junk in the list is ignored', () => {
    expect(testAllowance(['not a date', 42, null, ago(1)], NOW)).toMatchObject({ allowed: true, used: 1 })
  })
})

describe('T-202: is this request the business’s own test?', () => {
  it('an ordinary request is ordinary: nobody is asked who is signed in, and nothing is counted', async () => {
    for (const ownTest of [undefined, null, false]) {
      const { supabase, rpc } = db()
      const signedIn = session('tnt_a')
      expect(await decideTestRequest(supabase, 'tnt_a', { ownTest, oldToken: undefined, signedInTenantId: signedIn })).toEqual({ kind: 'normal' })
      expect(signedIn).not.toHaveBeenCalled()
      expect(rpc).not.toHaveBeenCalled()
    }
  })

  it('the body says "test" and the session is that business’s: a test, counted once against the five', async () => {
    const { supabase, rpc } = db()
    const decision = await decideTestRequest(supabase, 'tnt_a', { ownTest: true, oldToken: undefined, signedInTenantId: session('tnt_a') })
    expect(decision).toEqual({ kind: 'test', claimedAt: '2026-11-25T12:00:00.123+00:00' })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('claim_test_estimate', { p_tenant_id: 'tnt_a', p_limit: 5 })
  })

  it('the body says "test" with NO session (any customer could send that): refused, never taken as a real request', async () => {
    const { supabase, rpc } = db()
    const decision = await decideTestRequest(supabase, 'tnt_a', { ownTest: true, oldToken: undefined, signedInTenantId: session(null) })
    expect(decision).toEqual({ kind: 'refused', status: 403, code: 'TEST_NOT_SIGNED_IN', message: TRY_IT_COPY.notSignedIn })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('signed in to ANOTHER business: refused (a business cannot make a test on someone else’s form)', async () => {
    const { supabase, rpc } = db()
    const decision = await decideTestRequest(supabase, 'tnt_a', { ownTest: true, oldToken: undefined, signedInTenantId: session('tnt_b') })
    expect(decision).toMatchObject({ kind: 'refused', status: 403, code: 'TEST_NOT_SIGNED_IN' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('anything but `true` in the body is an attempt, and is refused without looking at the session', async () => {
    for (const ownTest of ['true', 1, 'yes', {}, []]) {
      const { supabase, rpc } = db()
      const signedIn = session('tnt_a')
      expect(await decideTestRequest(supabase, 'tnt_a', { ownTest, oldToken: undefined, signedInTenantId: signedIn })).toMatchObject({ kind: 'refused', status: 403 })
      expect(signedIn).not.toHaveBeenCalled()
      expect(rpc).not.toHaveBeenCalled()
    }
  })

  it('the session cannot be read: refused, not guessed', async () => {
    const { supabase } = db()
    const broken = vi.fn(async () => {
      throw new Error('no session store')
    })
    expect(await decideTestRequest(supabase, 'tnt_a', { ownTest: true, oldToken: undefined, signedInTenantId: broken })).toMatchObject({ kind: 'refused', code: 'TEST_NOT_SIGNED_IN' })
  })

  it('a code from the old test link is refused, with or without a session: start again from the dashboard', async () => {
    for (const ownTest of [undefined, true]) {
      const { supabase, rpc } = db()
      const decision = await decideTestRequest(supabase, 'tnt_a', { ownTest, oldToken: 'eyJ0Ijoi.abc', signedInTenantId: session('tnt_a') })
      expect(decision).toEqual({ kind: 'refused', status: 403, code: 'TEST_LINK_INVALID', message: TRY_IT_COPY.oldLink })
      expect(rpc).not.toHaveBeenCalled()
    }
    expect(TRY_IT_COPY.oldLink).toMatch(/from your dashboard/)
  })

  it('the sixth of the day is refused with the time the next one frees up', async () => {
    const { supabase } = db({ data: [{ claimed: false, claimed_at: null, used: 5, available_at: '2026-11-26T09:05:00+00:00' }] })
    const decision = await decideTestRequest(supabase, 'tnt_a', { ownTest: true, oldToken: undefined, signedInTenantId: session('tnt_a') })
    expect(decision).toEqual({ kind: 'refused', status: 429, code: 'TEST_LIMIT_REACHED', message: TRY_IT_COPY.limitPlain, availableAt: '2026-11-26T09:05:00.000Z' })
  })

  it('the count cannot be read: the test is not started (it is never let through uncounted)', async () => {
    const { supabase } = db({ data: null, error: { code: 'PGRST202' } })
    expect(await decideTestRequest(supabase, 'tnt_a', { ownTest: true, oldToken: undefined, signedInTenantId: session('tnt_a') })).toMatchObject({ kind: 'refused', status: 503, code: 'TEST_NOT_STARTED' })
  })

  it('an unfinished request (nothing is priced) is recognised as a test without using one of the five', async () => {
    const { supabase, rpc } = db()
    expect(await decideTestRequest(supabase, 'tnt_a', { ownTest: true, oldToken: undefined, signedInTenantId: session('tnt_a') }, { claim: false })).toEqual({ kind: 'test', claimedAt: '' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('a test that was not saved gives its place back, by the moment it was noted', async () => {
    const { supabase, rpc } = db({ data: null })
    await releaseTestClaim(supabase, 'tnt_a', '2026-11-25T12:00:00.123+00:00')
    expect(rpc).toHaveBeenCalledWith('release_test_estimate', { p_tenant_id: 'tnt_a', p_claimed_at: '2026-11-25T12:00:00.123+00:00' })
    rpc.mockClear()
    await releaseTestClaim(supabase, 'tnt_a', '')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('a client still cannot mark its request through `source`', () => {
    expect(publicSource({ type: 'widget', ownTest: true, test: true, isTest: true, is_test: true, pageUrl: 'x' })).toEqual({ type: 'widget', pageUrl: 'x' })
  })
})

describe('T-202: nothing in a web address makes a test', () => {
  const page = read('apps/web/src/app/quote/[slug]/page.tsx')
  const widget = read('apps/web/src/components/embed/EstimateWidget.tsx')

  it('the public quote page reads nothing from its address and has no test mode', () => {
    expect(page).not.toContain('searchParams')
    expect(page).not.toMatch(/ownTest|testToken/)
    expect(page).toContain('<EstimateWidget tenantKey={result.tenantKey} hosted />')
  })

  it('the embed page does not put the form in test mode either', () => {
    for (const file of ['apps/web/src/app/embed', 'apps/web/src/app/demo']) {
      const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(path.join(dir, name)).isDirectory() ? walk(path.join(dir, name)) : [path.join(dir, name)]))
      for (const source of walk(path.join(ROOT, file))) expect(readFileSync(source, 'utf8'), source).not.toMatch(/ownTest/)
    }
  })

  it('the only page that asks for test mode is inside the dashboard, and takes nothing from its address', () => {
    expect(TRY_IT_PATH).toBe('/app/try-it')
    const tryIt = read('apps/web/src/app/(try)/app/try-it/page.tsx')
    expect(tryIt).toContain('<EstimateWidget tenantKey={tenantKey} hosted ownTest />')
    expect(tryIt).not.toMatch(/searchParams|params\b/)
    expect(tryIt).toContain('const auth = await currentTenant()')
    // the form shown is the signed-in business's own
    expect(tryIt).toMatch(/\.eq\('tenant_id', auth\.tenantId\)/)
    // /app/... is behind the sign-in guard
    expect(read('apps/web/src/middleware.ts')).toMatch(/PROTECTED_ROUTES = \['\/app', '\/setup'\]/)
  })

  it('the form sends the intent in the body, never a code', () => {
    expect(widget.match(/\.\.\.\(ownTest && \{ ownTest: true \}\)/g)?.length).toBe(2)
    expect(widget).not.toContain('testToken')
    expect(read('apps/web/src/components/embed/useUnfinishedLead.ts')).toContain('...(ownTest && { ownTest: true })')
  })

  it('both public routes decide through the one rule, with the request’s own session', () => {
    for (const file of ['apps/web/src/app/api/public/quotes/route.ts', 'apps/web/src/app/api/public/leads/route.ts']) {
      const source = read(file)
      expect(source, file).toContain("from '@/lib/test-estimates'")
      expect(source, file).toContain('ownTest: body.ownTest,')
      expect(source, file).toContain('oldToken: body.testToken,')
      expect(source, file).toMatch(/const auth = await currentTenant\(\)\s+return auth\.ok \? auth\.tenantId : null/)
    }
    const quotes = read('apps/web/src/app/api/public/quotes/route.ts')
    expect(quotes).toContain("isTest: test.kind === 'test',")
    // a test that is not saved gives its place back
    expect(quotes).toContain("if (test.kind === 'test' && result.status !== 200) await releaseTestClaim(supabase, tenantId, test.claimedAt)")
    // the unfinished-request route never counts
    expect(read('apps/web/src/app/api/public/leads/route.ts')).toContain('{ claim: false }')
  })

  it('the old signed code is gone from the app', () => {
    expect(existsSync(path.join(ROOT, 'apps/web/src/lib/test-quote-token.ts'))).toBe(false)
    expect(existsSync(path.join(ROOT, 'apps/web/src/lib/test-quotes.ts'))).toBe(false)
    expect(existsSync(path.join(ROOT, 'apps/web/src/app/api/onboarding/test-link'))).toBe(false)
    expect(read('apps/web/src/app/api/test-estimates/route.ts')).not.toMatch(/token/i)
  })
})

describe('T-202: where "Try it yourself" is offered', () => {
  it('it can start with a service switched on and one of the day’s tests left', () => {
    const room = testAllowance([], NOW)
    const full = testAllowance([ago(1), ago(2), ago(3), ago(4), ago(5)], NOW)
    expect(tryItStateOf(room, true)).toMatchObject({ canStart: true, reason: null })
    expect(tryItStateOf(room, false)).toMatchObject({ canStart: false, reason: 'no_service' })
    expect(tryItStateOf(full, true)).toMatchObject({ canStart: false, reason: 'limit', availableAt: new Date(NOW + 19 * HOUR).toISOString() })
    // no service is said first: the limit does not matter until there is something to try
    expect(tryItStateOf(full, false).reason).toBe('no_service')
  })

  it('Home offers it until the first real request, while a service is switched on', () => {
    expect(showTryItOnHome({ hasRealRequest: false, hasActiveService: true })).toBe(true)
    expect(showTryItOnHome({ hasRealRequest: true, hasActiveService: true })).toBe(false)
    expect(showTryItOnHome({ hasRealRequest: false, hasActiveService: false })).toBe(false)
  })

  it('Home and setup’s last step use the same button, under the owner’s words', () => {
    expect(TRY_IT_COPY.title).toBe('Try it yourself')
    expect(TRY_IT_COPY.line).toBe('See what your customers see')
    const home = read('apps/web/src/app/(dashboard)/app/page.tsx')
    expect(home).toContain('{offerTryIt && <HomeTryIt />}')
    expect(home).toContain('showTryItOnHome({ hasRealRequest, hasActiveService: services.any && !services.allOff })')
    expect(read('apps/web/src/components/home/HomeTryIt.tsx')).toContain('<TryItButton />')
    const step = read('apps/web/src/components/onboarding/TestQuoteStep.tsx')
    expect(step).toContain('<TryItButton label={since ? TRY_IT_COPY.again : TRY_IT_COPY.button} onStarted={testStarted} />')
    expect(step).toContain('{TRY_IT_COPY.title}</h1>')
    expect(step).not.toMatch(/Now try it as your customer|test-link/)
  })

  it('the button asks the server before it opens the form, and says the limit or the missing service there', () => {
    const button = read('apps/web/src/components/try-it/TryItButton.tsx')
    expect(button).toContain("fetch('/api/test-estimates', { cache: 'no-store' })")
    expect(button).toContain('<LimitLine availableAt={stop.availableAt}')
    expect(button).toContain('{TRY_IT_COPY.noService}')
  })
})

describe('T-202: saying when the next test can be made', () => {
  const at = { locale: 'en-US', timeZone: 'America/Chicago' }
  const now = new Date('2026-11-25T18:00:00Z') // noon in Chicago

  it('later today, tomorrow, or a named day, in the reader’s own time', () => {
    expect(whenAvailable('2026-11-25T21:40:00Z', now, at)).toBe('3:40 PM today')
    expect(whenAvailable('2026-11-26T15:05:00Z', now, at)).toBe('9:05 AM tomorrow')
    expect(whenAvailable('2026-11-28T15:05:00Z', now, at)).toBe('Sat 9:05 AM')
  })

  it('the same moment reads differently in another zone', () => {
    expect(whenAvailable('2026-11-26T03:30:00Z', now, at)).toBe('9:30 PM today')
    expect(whenAvailable('2026-11-26T03:30:00Z', now, { locale: 'en-GB', timeZone: 'Europe/London' })).toMatch(/^0?3:30 tomorrow$/)
  })

  it('the whole line, and what is said when the time is not known', () => {
    expect(limitLine('2026-11-26T15:05:00Z', now, at)).toBe('You have made 5 test estimates in the last 24 hours. You can make another after 9:05 AM tomorrow.')
    expect(limitLine(null, now, at)).toBe('You have made 5 test estimates in the last 24 hours. Try again tomorrow.')
    expect(whenAvailable('junk', now, at)).toBe('tomorrow')
  })
})

describe('T-202: deleting a test', () => {
  it('only the business’s own test can be deleted', () => {
    expect(deletableAsTest({ tenant_id: 'tnt_a', is_test: true }, 'tnt_a')).toBe('yes')
    expect(deletableAsTest({ tenant_id: 'tnt_a', is_test: false }, 'tnt_a')).toBe('not_a_test')
    expect(deletableAsTest({ tenant_id: 'tnt_a', is_test: null }, 'tnt_a')).toBe('not_a_test')
    expect(deletableAsTest({ tenant_id: 'tnt_b', is_test: true }, 'tnt_a')).toBe('not_found')
    expect(deletableAsTest(null, 'tnt_a')).toBe('not_found')
    // the public demo's rows are not anyone's test
    expect(deletableAsTest({ tenant_id: 'tnt_a', is_test: true, is_demo: true }, 'tnt_a')).toBe('not_a_test')
  })

  it('the delete itself repeats both conditions, and never touches the day’s count', () => {
    const lib = read('apps/web/src/lib/test-estimate-delete.ts')
    expect(lib).toMatch(/\.from\('quotes'\)\s+\.delete\(\)\s+\.eq\('id', quoteId\)\s+\.eq\('tenant_id', tenantId\)\s+\.eq\('is_test', true\)/)
    // it only reads and deletes: no update and no database function, so the count on the business is left alone
    expect(lib).not.toMatch(/\.update\(|\.rpc\(/)
  })

  it('the route answers 409 for a real quote and 404 for someone else’s', () => {
    const route = read('apps/web/src/app/api/quotes/[quoteId]/route.ts')
    expect(route).toContain('export async function DELETE(')
    expect(route).toMatch(/code: 'NOT_A_TEST', message: TRY_IT_COPY\.delete\.notATest \} \}, \{ status: 409 \}/)
    expect(route).toMatch(/code: 'NOT_FOUND', message: 'Quote not found' \} \}, \{ status: 404 \}/)
  })

  it('the page asks first, says what goes and that the day’s count stays, and only a test has the button', () => {
    const D = TRY_IT_COPY.delete
    expect(D.body).toMatch(/test request, its estimate, its photos and its page/)
    expect(D.counted).toBe('It still counts as one of your 5 test estimates for the day.')
    const box = read('apps/web/src/components/try-it/DeleteTestEstimate.tsx')
    expect(box).toContain('role="alertdialog"')
    expect(box).toMatch(/method: 'DELETE'/)
    expect(read('apps/web/src/app/(dashboard)/app/quotes/[quoteId]/page.tsx')).toContain('{(quote as { is_test?: boolean }).is_test === true && <DeleteTestEstimate quoteId={quote.id} />}')
  })
})

describe('T-202: migration 51', () => {
  const sql = read('supabase/migrations/00000000000051_t202.sql')

  it('adds one column, deletes nothing and changes no existing row', () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS test_estimate_times TIMESTAMPTZ[] NOT NULL DEFAULT '{}'")
    expect(sql).not.toMatch(/\bDROP (TABLE|COLUMN)\b|\bDELETE FROM\b|\bTRUNCATE\b/i)
    // the only UPDATEs are inside the two functions
    expect(sql.match(/^\s*UPDATE tenants/gm)?.length).toBe(2)
  })

  it('a business cannot write its own count, and only the server may claim or give back', () => {
    expect(sql).toContain('BEFORE INSERT OR UPDATE OF test_estimate_times ON tenants')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.claim_test_estimate(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.release_test_estimate(TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;')
    expect(sql).toContain('FOR UPDATE')
  })
})
