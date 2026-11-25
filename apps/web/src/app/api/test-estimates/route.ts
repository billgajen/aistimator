import { NextResponse } from 'next/server'
import { currentTenant } from '@/lib/current-tenant'
import { readTryItState } from '@/lib/try-it'
import { TRY_IT_PATH } from '@/lib/try-it-copy'

export const dynamic = 'force-dynamic'

/**
 * GET /api/test-estimates
 * T-202: may the signed-in business start a test estimate now ("Try it
 * yourself")? Answers how many of the day's five are used, when the next one
 * frees up if none is left, and the page that shows the business its own
 * request form in test mode. It changes nothing and gives out no code: the
 * page is inside the dashboard, and a request is marked as a test from the
 * business's own session when it is sent (lib/test-estimates.ts).
 *
 * `now` is the server's clock, for the caller that then waits for the test to
 * arrive (GET /api/onboarding/test-quote?since=).
 */
export async function GET() {
  const auth = await currentTenant()
  if (!auth.ok) return auth.response
  const state = await readTryItState(auth.tenantId)
  return NextResponse.json({
    canStart: state.canStart,
    reason: state.reason,
    limit: state.limit,
    used: state.used,
    availableAt: state.availableAt,
    url: TRY_IT_PATH,
    now: new Date().toISOString(),
  })
}
