import { NextResponse } from 'next/server'
import { parseRoomScan, scanAnswers, ROOM_SCAN_FIELD, type AppCreateQuoteRequest, type AppCreateQuoteResponse, type ExpectedSignalConfig, type QuoteStatus, type ServiceDraftConfig } from '@qolumns/shared'
import { requireTenant } from '@/lib/auth-tenant'
import { createAdminClient } from '@/lib/supabase/server'
import { createQuoteSubmission } from '@/lib/quote-intake'

export const maxDuration = 60

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** What the app may send as its own id for a quote it is sending: letters, digits, dashes */
const CLIENT_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/

/**
 * POST /api/app/quotes (T-137) — the business creates a quote on site.
 * Same intake as the website widget (validation, plan limits, queue), with
 * the tenant taken from the signed-in user instead of a public key, no bot
 * checks (it's an authenticated business user), and no AI service match
 * (the business picked the service).
 *
 * T-182:
 *   - Only the customer's name is required. On site the link goes by the
 *     phone's share sheet; an email address, when given, also gets the email.
 *   - `clientRequestId` makes a repeat safe. A phone that lost its signal
 *     cannot tell whether the quote was made, so it sends again with the same
 *     id; the quote that was already made is answered, and no second quote
 *     is made or counted on the plan.
 */
export async function POST(request: Request) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response

  let body: AppCreateQuoteRequest
  try {
    body = (await request.json()) as AppCreateQuoteRequest
  } catch {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON' } }, { status: 400 })
  }
  if (!body.serviceId) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'serviceId is required' } }, { status: 400 })
  }
  if (!body.customer?.name?.trim()) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'customer name is required' } }, { status: 400 })
  }
  const email = typeof body.customer.email === 'string' ? body.customer.email.trim() : ''
  if (email && !EMAIL.test(email)) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid email format' } }, { status: 400 })
  }
  const phone = typeof body.customer.phone === 'string' ? body.customer.phone.trim() : ''
  if (body.clientRequestId !== undefined && (typeof body.clientRequestId !== 'string' || !CLIENT_REQUEST_ID.test(body.clientRequestId))) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'clientRequestId is not valid' } }, { status: 400 })
  }

  // T-182: the same send again? Answer the quote it already made. Read with the
  // signed-in business's own access, and filtered by its tenant as well.
  if (body.clientRequestId) {
    const { data: earlier } = await auth.supabase
      .from('quote_requests')
      .select('id')
      .eq('tenant_id', auth.tenantId)
      .eq('source_json->>clientRequestId', body.clientRequestId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (earlier?.id) {
      const { data: made } = await auth.supabase
        .from('quotes')
        .select('id, status, content_json')
        .eq('tenant_id', auth.tenantId)
        .eq('quote_request_id', earlier.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (made?.id) {
        const held = made.status === 'pending_review' && (made.content_json as { limitHold?: boolean } | null)?.limitHold === true
        const replay: AppCreateQuoteResponse = { quoteId: made.id as string, status: held ? 'held' : (made.status as QuoteStatus), alreadyCreated: true }
        return NextResponse.json(replay)
      }
    }
  }

  // T-138: an on-site LiDAR scan. Validated here (untrusted input); the
  // quantities it maps are filled as answers so the form's required fields
  // pass, and the raw scan rides along for the worker's audit line
  let job = body.job
  if (body.scan !== undefined) {
    const parsed = parseRoomScan(body.scan)
    if (!parsed.ok) {
      return NextResponse.json({ error: { code: 'INVALID_SCAN', message: parsed.error } }, { status: 400 })
    }
    const { data: service } = await auth.supabase
      .from('services')
      .select('expected_signals, draft_config')
      .eq('id', body.serviceId)
      .eq('tenant_id', auth.tenantId)
      .single()
    const answers = [...(job?.answers || [])]
    const filled = scanAnswers({
      scan: parsed.scan,
      expectedSignals: ((service?.expected_signals as ExpectedSignalConfig[] | null) || []),
      fields: ((service?.draft_config as ServiceDraftConfig | null)?.suggestedFields || []),
      existingAnswers: answers,
    })
    job = {
      ...job,
      answers: [
        ...answers,
        ...filled,
        { fieldId: ROOM_SCAN_FIELD, value: parsed.scan as unknown as string },
      ],
    }
  }

  // Tenant ownership is proven by the session; the intake runs with the
  // admin client exactly as the widget route does (it writes several tables)
  const result = await createQuoteSubmission(createAdminClient(), {
    tenantId: auth.tenantId,
    serviceId: body.serviceId,
    customer: { name: body.customer.name.trim(), ...(email && { email }), ...(phone && { phone }) },
    job,
    assetIds: body.assetIds,
    source: { type: 'app', userId: auth.userId, ...(body.clientRequestId && { clientRequestId: body.clientRequestId }) },
    skipServiceMatch: true,
  })
  return NextResponse.json(result.json, { status: result.status })
}
