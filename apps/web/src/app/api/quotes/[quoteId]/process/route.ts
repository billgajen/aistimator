/**
 * POST /api/quotes/[quoteId]/process — price a lead that was held because the
 * plan limit was reached (T-134). The business picks a plan first; then this
 * claims a quote (the limit is checked and the quote counted in one step
 * inside the database, T-180) and runs the normal pipeline with a fresh token.
 * A suspended business cannot price a held lead until it is restored.
 */

import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth-tenant'
import { claimPlanQuote, maybeNotifyLimitReached, maybeWarnFreeQuotesLeft, recordOverageQuote, releasePlanQuote } from '@/lib/plan-limits'
import { enqueueQuoteJob } from '@/lib/queue'
import { generateQuoteToken, getTokenExpiry } from '@/lib/tokens'
import { markQuoteFailed } from '@/lib/failed-quote'
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

  const held = (quote.content_json as { limitHold?: boolean } | null)?.limitHold === true
  if (!held || quote.status !== 'pending_review') {
    return NextResponse.json(
      { error: { code: 'NOT_HELD', message: 'Only leads held by the plan limit can be priced here' } },
      { status: 400 }
    )
  }

  // The count is the server's record, so the claim uses the service role (T-173). Until
  // T-180 this route added one through the signed-in business's own client, which the
  // database refuses, so a lead priced here was never counted.
  const admin = createAdminClient()
  const claim = await claimPlanQuote(admin, tenantId)
  if (!claim.claimed) {
    return NextResponse.json(
      claim.reason === 'suspended'
        ? { error: { code: 'ACCOUNT_PAUSED', message: 'Your account is paused, so this lead cannot be priced yet' } }
        : {
            error: {
              code: 'PLAN_LIMIT_REACHED',
              message:
                claim.status.per === 'total'
                  ? `Your ${claim.status.limit} free quotes are used. Pick a plan to price this lead.`
                  : `Monthly limit reached (${claim.status.used}/${claim.status.limit}). Upgrade to price this lead.`,
            },
          },
      { status: claim.reason === 'suspended' ? 403 : 402 }
    )
  }

  const { token, hash } = generateQuoteToken()
  const { error: updateError } = await supabase
    .from('quotes')
    .update({
      status: 'queued',
      content_json: {},
      quote_token_hash: hash,
      token_expires_at: getTokenExpiry(30).toISOString(),
    })
    .eq('id', quote.id)
  if (updateError) {
    // counted but not started: give the count back
    await releasePlanQuote(admin, tenantId, claim)
    return NextResponse.json({ error: { code: 'UPDATE_FAILED', message: 'Could not start pricing — try again' } }, { status: 500 })
  }

  const { data: tenant } = await supabase.from('tenants').select('name').eq('id', tenantId).single()
  const businessName = (tenant as { name?: string } | null)?.name || 'Your business'
  await maybeWarnFreeQuotesLeft(admin, tenantId, businessName, claim.status)
  await maybeNotifyLimitReached(admin, tenantId, businessName)
  if (claim.overage) await recordOverageQuote(claim.status, quote.id)

  try {
    await enqueueQuoteJob({
      quoteId: quote.id,
      quoteRequestId: quote.quote_request_id as string,
      tenantId,
      timestamp: Date.now(),
      quoteToken: token,
    })
  } catch (error) {
    console.error('[Process] Failed to enqueue held lead:', error)
    await markQuoteFailed(admin, quote.id, 'The request could not be handed to the pricing worker')
    return NextResponse.json({ error: { code: 'QUEUE_FAILED', message: 'Could not start pricing — try again' } }, { status: 502 })
  }
  return NextResponse.json({ queued: true })
}
