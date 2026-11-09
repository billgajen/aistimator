import { NextResponse } from 'next/server'
import { parseRoomScan, scanAnswers, ROOM_SCAN_FIELD, type AppCreateQuoteRequest, type ExpectedSignalConfig, type ServiceDraftConfig } from '@estimator/shared'
import { requireTenant } from '@/lib/auth-tenant'
import { createAdminClient } from '@/lib/supabase/server'
import { createQuoteSubmission } from '@/lib/quote-intake'

export const maxDuration = 60

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * POST /api/app/quotes (T-137) — the business creates a quote on site.
 * Same intake as the website widget (validation, plan limits, queue), with
 * the tenant taken from the signed-in user instead of a public key, no bot
 * checks (it's an authenticated business user), and no AI service match
 * (the business picked the service).
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
  if (!body.customer?.name?.trim() || !body.customer?.email?.trim()) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'customer name and email are required' } }, { status: 400 })
  }
  if (!EMAIL.test(body.customer.email.trim())) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid email format' } }, { status: 400 })
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
    customer: { name: body.customer.name.trim(), email: body.customer.email.trim(), ...(body.customer.phone && { phone: body.customer.phone }) },
    job,
    assetIds: body.assetIds,
    source: { type: 'app', userId: auth.userId },
    skipServiceMatch: true,
  })
  return NextResponse.json(result.json, { status: result.status })
}
