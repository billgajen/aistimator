/**
 * POST /api/quotes/[quoteId]/process — price a lead that was held because the
 * plan limit was reached (T-134). Re-checks the limit (the business upgrades
 * first), counts the quote, and runs the normal pipeline with a fresh token.
 */

import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth-tenant'
import { checkPlanLimit, maybeNotifyLimitReached } from '@/lib/plan-limits'
import { incrementUsageCounter } from '@/lib/usage'
import { enqueueQuoteJob } from '@/lib/queue'
import { generateQuoteToken, getTokenExpiry } from '@/lib/tokens'

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

  const limit = await checkPlanLimit(supabase, tenantId)
  if (!limit.allowed && !limit.overageAvailable) {
    return NextResponse.json(
      { error: { code: 'PLAN_LIMIT_REACHED', message: `Monthly limit reached (${limit.used}/${limit.limit}) — upgrade to price this lead` } },
      { status: 402 }
    )
  }

  const { token, hash } = generateQuoteToken()
  await supabase
    .from('quotes')
    .update({
      status: 'queued',
      content_json: {},
      quote_token_hash: hash,
      token_expires_at: getTokenExpiry(30).toISOString(),
    })
    .eq('id', quote.id)

  await incrementUsageCounter(supabase, tenantId, 'estimates_created')
  const { data: tenant } = await supabase.from('tenants').select('name').eq('id', tenantId).single()
  await maybeNotifyLimitReached(supabase, tenantId, (tenant as { name?: string } | null)?.name || 'Your business')

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
    await supabase.from('quotes').update({ status: 'failed' }).eq('id', quote.id)
    return NextResponse.json({ error: { code: 'QUEUE_FAILED', message: 'Could not start pricing — try again' } }, { status: 502 })
  }
  return NextResponse.json({ queued: true })
}
