/**
 * POST /api/quotes/[quoteId]/process — price a lead that was held because the
 * plan limit was reached (T-134). The business picks a plan first; then this
 * claims a quote (the limit is checked and the quote counted in one step
 * inside the database, T-180) and runs the normal pipeline with a fresh token.
 * A suspended business cannot price a held lead until it is restored.
 *
 * T-201: it also prices again a request that could not be priced (status
 * `failed`), up to five times, without counting it a second time.
 */

import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth-tenant'
import { priceHeldRequest } from '@/lib/held-requests'
import { retryFailedQuote } from '@/lib/quote-retry'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(_request: Request, { params }: { params: { quoteId: string } }) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const { supabase, tenantId } = auth

  const { data: quote } = await supabase
    .from('quotes')
    .select('id, status, content_json, quote_request_id, tenant_id')
    .eq('id', params.quoteId)
    .eq('tenant_id', tenantId)
    .single()
  if (!quote) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Quote not found' } }, { status: 404 })

  // T-201: a request that could not be priced is tried again here too ("Try again" on the dashboard
  // quote page). It was counted when it arrived, so nothing is claimed: lib/quote-retry.ts.
  if (quote.status === 'failed') {
    return retryFailedQuote(createAdminClient(), {
      id: quote.id as string,
      status: quote.status as string,
      content_json: quote.content_json,
      quote_request_id: quote.quote_request_id as string,
      tenant_id: tenantId,
    })
  }

  const held =(quote.content_json as { limitHold?: boolean } | null)?.limitHold === true
  if (!held || quote.status !== 'pending_review') {
    return NextResponse.json(
      { error: { code: 'NOT_HELD', message: 'Only leads held by the plan limit can be priced here' } },
      { status: 400 }
    )
  }

  // The count is the server's record, so the claim uses the service role (T-173). Until
  // T-180 this route added one through the signed-in business's own client, which the
  // database refuses, so a lead priced here was never counted.
  // T-201: the steps themselves are lib/held-requests.ts, shared with the run after a purchase.
  const outcome = await priceHeldRequest(createAdminClient(), tenantId, { id: quote.id as string, quoteRequestId: quote.quote_request_id as string })
  if (outcome.priced) return NextResponse.json({ queued: true })

  switch (outcome.why) {
    case 'suspended':
      return NextResponse.json({ error: { code: 'ACCOUNT_PAUSED', message: 'Your account is paused, so this lead cannot be priced yet' } }, { status: 403 })
    case 'limit': {
      const { status } = outcome.claim
      return NextResponse.json(
        {
          error: {
            code: 'PLAN_LIMIT_REACHED',
            message:
              status.per === 'total'
                ? `Your ${status.limit} free quotes are used. Pick a plan to price this lead.`
                : `Monthly limit reached (${status.used}/${status.limit}). Upgrade to price this lead.`,
          },
        },
        { status: 402 }
      )
    }
    case 'not_held':
      // it was taken a moment ago (the run after a purchase, or a second press)
      return NextResponse.json({ error: { code: 'NOT_HELD', message: 'This request is already being priced' } }, { status: 400 })
    case 'queue_failed':
      return NextResponse.json({ error: { code: 'QUEUE_FAILED', message: 'Could not start pricing — try again' } }, { status: 502 })
    default:
      return NextResponse.json({ error: { code: 'UPDATE_FAILED', message: 'Could not start pricing — try again' } }, { status: 500 })
  }
}
