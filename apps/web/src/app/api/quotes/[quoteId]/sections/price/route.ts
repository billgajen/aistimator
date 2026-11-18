import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth-tenant'
import { priceSectionNow } from '@/lib/quote-sections-service'
import type { RawSectionAnswer } from '@/lib/quote-sections-service'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const fail = (status: number, code: string, message: string, extra?: Record<string, unknown>) =>
  NextResponse.json({ error: { code, message, ...extra } }, { status })

/**
 * POST /api/quotes/:quoteId/sections/price  { serviceId, answers? }
 * T-179: the quote editor asks what one of the business's other services
 * costs as a section of this quote. The price comes from that service's
 * rules (the worker's rules engine, no AI). Nothing is saved here: the
 * section goes into the editor, and is stored when the business saves.
 *
 * 200 { section }  ·  422 ANSWERS_NEEDED { questions }  ·  404 not one of
 * the business's priced services.
 */
export async function POST(request: Request, { params }: { params: { quoteId: string } }) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const body = (await request.json().catch(() => null)) as { serviceId?: unknown; answers?: unknown } | null
  if (typeof body?.serviceId !== 'string' || !body.serviceId) return fail(400, 'INVALID_REQUEST', 'serviceId is required')

  // The quote and the service must both be this business's
  const [{ data: quote }, { data: service }] = await Promise.all([
    auth.supabase.from('quotes').select('id, service_id').eq('id', params.quoteId).eq('tenant_id', auth.tenantId).single(),
    auth.supabase.from('services').select('id').eq('id', body.serviceId).eq('tenant_id', auth.tenantId).eq('active', true).single(),
  ])
  if (!quote) return fail(404, 'NOT_FOUND', 'Quote not found')
  if (!service || (quote as { service_id?: string }).service_id === body.serviceId) return fail(404, 'NOT_A_SERVICE', 'Choose another of your active services')

  const answers = Array.isArray(body.answers) ? (body.answers as RawSectionAnswer[]).filter((a) => a && typeof a.fieldId === 'string').slice(0, 40) : []
  const priced = await priceSectionNow({ quoteId: params.quoteId, serviceId: body.serviceId, answers })
  if (!priced.success) {
    return priced.reason === 'no_price'
      ? fail(404, 'NO_PRICE', 'That service has no price set up yet, so it cannot be added')
      : priced.reason === 'not_a_service'
        ? fail(404, 'NOT_A_SERVICE', 'Choose another of your active services')
        : fail(503, 'TRY_AGAIN', 'The price could not be worked out just now. Try again.')
  }
  if (!priced.ready) return fail(422, 'ANSWERS_NEEDED', 'A few answers are needed to price this service', { questions: priced.questions, serviceName: priced.serviceName })
  return NextResponse.json({ section: priced.section })
}
