import { NextResponse } from 'next/server'
import type { AppQuoteView, ClarificationQuestion, QuoteStatus } from '@estimator/shared'
import { requireTenant } from '@/lib/auth-tenant'

type Estimate = NonNullable<AppQuoteView['pricing']['estimate']>

/**
 * GET /api/app/quotes/:quoteId (T-137) — the compact view the business app
 * shows: status, price (range while provisional), grade, takeoff and any
 * open confirmation questions. Tenant-scoped by RLS and an explicit filter.
 */
export async function GET(_request: Request, { params }: { params: { quoteId: string } }) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const { supabase, tenantId } = auth

  const { data: quote } = await supabase
    .from('quotes')
    .select('id, status, created_at, customer_json, pricing_json, content_json, clarification_questions_json, service_id')
    .eq('id', params.quoteId)
    .eq('tenant_id', tenantId)
    .single()
  if (!quote) {
    return NextResponse.json({ error: { code: 'QUOTE_NOT_FOUND', message: 'Quote not found' } }, { status: 404 })
  }
  const [{ data: service }, { data: tenant }] = await Promise.all([
    supabase.from('services').select('name').eq('id', quote.service_id).single(),
    supabase.from('tenants').select('name').eq('id', tenantId).single(),
  ])

  const pricing = (quote.pricing_json || {}) as { total?: number; currency?: string; estimate?: Estimate }
  const content = (quote.content_json || {}) as { takeoff?: AppQuoteView['takeoff'] }
  const status = quote.status as QuoteStatus
  const questions =
    status === 'awaiting_clarification'
      ? ((quote.clarification_questions_json || []) as ClarificationQuestion[]).map((q) => ({
          id: q.id,
          question: q.question,
          ...(q.type && { type: q.type }),
          ...(q.aiValue !== undefined && { aiValue: q.aiValue }),
          ...(q.evidence && { evidence: q.evidence }),
          ...(q.options && { options: q.options }),
        }))
      : []

  const body: AppQuoteView = {
    id: quote.id as string,
    status,
    businessName: (tenant?.name as string) || '',
    serviceName: (service?.name as string) || '',
    customerName: ((quote.customer_json as { name?: string } | null)?.name) || '',
    createdAt: quote.created_at as string,
    pricing: { total: pricing.total ?? 0, currency: pricing.currency || 'USD', ...(pricing.estimate && { estimate: pricing.estimate }) },
    takeoff: content.takeoff || [],
    questions,
  }
  return NextResponse.json(body)
}
