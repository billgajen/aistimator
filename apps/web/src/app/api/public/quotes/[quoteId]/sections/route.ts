import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { limitQuoteAction, limitQuoteAndBusinessActions } from '@/lib/quote-action-limit'
import { quoteTokenMatches } from '@/lib/tokens'
import { SECTION_QUOTE_COLUMNS, addSectionForCustomer, removeSectionForCustomer } from '@/lib/quote-sections-service'
import type { RawSectionAnswer, SectionQuoteRow } from '@/lib/quote-sections-service'
import { notifyRequestUpdated } from '@/lib/request-updated'

export const dynamic = 'force-dynamic'
// The worker prices the section while the customer waits (no AI: about a second)
export const maxDuration = 30

const fail = (status: number, code: string, message: string, extra?: Record<string, unknown>) =>
  NextResponse.json({ error: { code, message, ...extra } }, { status })

type Loaded = { quote: SectionQuoteRow; supabase: ReturnType<typeof createAdminClient> } | { response: NextResponse }

/**
 * The same door as /clarify (T-173, AD-055): counted by address before
 * anything is read; then the quote's link token is checked; then counted for
 * the quote and for the whole business. Every limit fails open.
 */
async function open(request: Request, quoteId: string, token: unknown): Promise<Loaded> {
  const limited = await limitQuoteAction(request)
  if (limited) return { response: limited }
  if (typeof token !== 'string' || !token) return { response: fail(401, 'MISSING_TOKEN', 'Token is required') }

  const supabase = createAdminClient()
  const { data } = await supabase.from('quotes').select(SECTION_QUOTE_COLUMNS).eq('id', quoteId).single()
  const quote = data as unknown as (SectionQuoteRow & { quote_token_hash?: string | null; previous_token_hash?: string | null; link_token_hashes?: string[] | null; token_expires_at?: string | null }) | null
  if (!quote) return { response: fail(404, 'NOT_FOUND', 'Quote not found') }
  if (!quoteTokenMatches(quote, createHash('sha256').update(token).digest('hex'))) return { response: fail(401, 'INVALID_TOKEN', 'Invalid token') }
  if (quote.token_expires_at && new Date(quote.token_expires_at) < new Date()) return { response: fail(401, 'TOKEN_EXPIRED', 'Token has expired') }

  const busy = await limitQuoteAndBusinessActions(quoteId, quote.tenant_id)
  if (busy) return { response: busy }
  return { quote, supabase }
}

// The page reads the quote afresh after a change. No figures are returned here:
// a part waiting for the business's approval has a price the customer may not see yet.
const view = (result: { status: string }) => NextResponse.json({ ok: true, status: result.status })

/**
 * POST /api/public/quotes/:quoteId/sections  { token, serviceId, answers? }
 * T-179: the customer adds another of the business's services, one they asked
 * for in their note, to their quote. Priced by the rules engine from that
 * service's own rules; no AI. 422 ANSWERS_NEEDED carries the questions still
 * to answer.
 */
export async function POST(request: Request, { params }: { params: { quoteId: string } }) {
  const body = (await request.json().catch(() => null)) as { token?: unknown; serviceId?: unknown; answers?: unknown } | null
  const loaded = await open(request, params.quoteId, body?.token)
  if ('response' in loaded) return loaded.response
  if (typeof body?.serviceId !== 'string' || !body.serviceId) return fail(400, 'INVALID_REQUEST', 'serviceId is required')
  const answers = Array.isArray(body.answers)
    ? (body.answers as RawSectionAnswer[]).filter((a) => a && typeof a.fieldId === 'string').slice(0, 40)
    : []

  const result = await addSectionForCustomer(loaded.supabase, loaded.quote, { serviceId: body.serviceId, answers })
  if (!result.ok) return fail(result.status, result.code, result.message, result.questions ? { questions: result.questions } : undefined)

  // One "request updated" notice to the business: the same quote, changed
  if (result.section && loaded.quote.is_demo !== true) {
    await notifyRequestUpdated(loaded.supabase, {
      quoteId: loaded.quote.id,
      tenantId: loaded.quote.tenant_id,
      mainServiceId: loaded.quote.service_id,
      customerName: loaded.quote.customer_json?.name ?? '',
      changedServiceName: result.section.serviceName,
      change: 'added',
      pricing: result.pricing,
      status: result.status,
      isTest: loaded.quote.is_test === true,
    })
  }
  return view(result)
}

/**
 * DELETE /api/public/quotes/:quoteId/sections  { token, serviceId }
 * The customer takes an added service off again, before accepting.
 */
export async function DELETE(request: Request, { params }: { params: { quoteId: string } }) {
  const body = (await request.json().catch(() => null)) as { token?: unknown; serviceId?: unknown } | null
  const loaded = await open(request, params.quoteId, body?.token)
  if ('response' in loaded) return loaded.response
  if (typeof body?.serviceId !== 'string' || !body.serviceId) return fail(400, 'INVALID_REQUEST', 'serviceId is required')

  const before = (loaded.quote.pricing_json?.sections ?? []).find((s) => s.serviceId === body.serviceId)
  const result = await removeSectionForCustomer(loaded.supabase, loaded.quote, body.serviceId)
  if (!result.ok) return fail(result.status, result.code, result.message)

  if (before && loaded.quote.is_demo !== true) {
    await notifyRequestUpdated(loaded.supabase, {
      quoteId: loaded.quote.id,
      tenantId: loaded.quote.tenant_id,
      mainServiceId: loaded.quote.service_id,
      customerName: loaded.quote.customer_json?.name ?? '',
      changedServiceName: before.serviceName,
      change: 'removed',
      pricing: result.pricing,
      status: result.status,
      isTest: loaded.quote.is_test === true,
    })
  }
  return view(result)
}
