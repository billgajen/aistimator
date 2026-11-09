import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth-tenant'
import { enqueueQuoteJob, repriceQuoteNow } from '@/lib/queue'
import { createAdminClient } from '@/lib/supabase/server'
import { recordMeasurementExamples } from '@/lib/measurement-memory'

/**
 * POST /api/app/quotes/:quoteId/answers (T-137) — the business confirms the
 * open questions on site. Same effect as the customer's clarification
 * (answers merge as confirmed form answers, deterministic reprice), but
 * authorised by the signed-in business instead of the quote token.
 *
 * `quoteToken` is optional: the device that created the quote keeps it, and
 * the worker needs the raw token to email the customer their link. It is
 * only passed on when it matches the stored hash.
 */
export async function POST(request: Request, { params }: { params: { quoteId: string } }) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const { supabase, tenantId } = auth

  let body: { answers?: Array<{ questionId: string; answer: string }>; quoteToken?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON' } }, { status: 400 })
  }
  const answers = (body.answers || []).filter(
    (a) => a && typeof a.questionId === 'string' && typeof a.answer === 'string' && a.answer.trim() !== ''
  )
  if (answers.length === 0) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'answers are required' } }, { status: 400 })
  }

  const { data: quote } = await supabase
    .from('quotes')
    .select('id, tenant_id, service_id, status, quote_request_id, quote_token_hash, clarification_questions_json, signals_json')
    .eq('id', params.quoteId)
    .eq('tenant_id', tenantId)
    .single()
  if (!quote) {
    return NextResponse.json({ error: { code: 'QUOTE_NOT_FOUND', message: 'Quote not found' } }, { status: 404 })
  }
  if (quote.status !== 'awaiting_clarification') {
    return NextResponse.json(
      { error: { code: 'INVALID_STATUS', message: `Quote is not awaiting confirmation (status: ${quote.status})` } },
      { status: 400 }
    )
  }
  const known = new Set(((quote.clarification_questions_json || []) as Array<{ id: string }>).map((q) => q.id))
  const valid = answers.filter((a) => known.has(a.questionId))
  if (valid.length === 0) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'No answer matches an open question' } }, { status: 400 })
  }

  const { error: updateError } = await supabase
    .from('quotes')
    .update({ clarification_answers_json: valid, clarification_count: 1, status: 'queued' })
    .eq('id', quote.id)
    .eq('tenant_id', tenantId)
  if (updateError) {
    console.error('[AppAnswers] Failed to save answers:', updateError.message)
    return NextResponse.json({ error: { code: 'UPDATE_FAILED', message: 'Failed to save answers' } }, { status: 500 })
  }

  // T-123: a measurement confirmed on site is the best calibration example
  await recordMeasurementExamples(createAdminClient(), quote, valid)

  const tokenMatches =
    typeof body.quoteToken === 'string' &&
    quote.quote_token_hash === createHash('sha256').update(body.quoteToken).digest('hex')
  const job = {
    quoteId: quote.id as string,
    quoteRequestId: quote.quote_request_id as string,
    tenantId,
    timestamp: Date.now(),
    ...(tokenMatches && { quoteToken: body.quoteToken }),
  }
  try {
    if (!(await repriceQuoteNow(job))) await enqueueQuoteJob(job)
  } catch (queueError) {
    console.error('[AppAnswers] Failed to dispatch reprice:', queueError)
  }
  return NextResponse.json({ success: true })
}
