import { NextResponse } from 'next/server'
import { canScanAgain, parseRoomScan, roomScanOfAnswers, type AppRescanRequest, type ExpectedSignalConfig, type ServiceDraftConfig } from '@qolumns/shared'
import { requireTenant } from '@/lib/auth-tenant'
import { enqueueQuoteJob, repriceQuoteNow } from '@/lib/queue'
import { createAdminClient } from '@/lib/supabase/server'
import { answersWithNewScan, planHasRoomScan, SCAN_NOT_IN_PLAN } from '@/lib/room-scan-intake'

/**
 * POST /api/app/quotes/:quoteId/scan (T-194) — the business scans an area
 * again, or adds one, on a quote it made, until the quote is approved. The
 * app sends the one area (`index` is the area it replaces; none adds it); the
 * stored scan is changed and checked again, and the quote is priced again through the same path as an answer given on site
 * (the deterministic reprice, or the queue when the quote has no reprice
 * snapshot). What the business typed still wins over the scan (AD-028).
 *
 * Only a quote of the signed-in business, made in the app, not yet approved,
 * on a plan with room scan.
 */
export async function POST(request: Request, { params }: { params: { quoteId: string } }) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const { tenantId } = auth

  let body: AppRescanRequest
  try {
    body = (await request.json()) as AppRescanRequest
  } catch {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON' } }, { status: 400 })
  }
  if (!body || typeof body.area !== 'object' || body.area === null) {
    return NextResponse.json({ error: { code: 'INVALID_SCAN', message: 'area is required' } }, { status: 400 })
  }

  const admin = createAdminClient()
  if (!(await planHasRoomScan(admin, tenantId))) return NextResponse.json({ error: SCAN_NOT_IN_PLAN }, { status: 403 })

  const { data: quote } = await admin
    .from('quotes')
    .select('id, tenant_id, service_id, status, approved_at, quote_request_id')
    .eq('id', params.quoteId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!quote) return NextResponse.json({ error: { code: 'QUOTE_NOT_FOUND', message: 'Quote not found' } }, { status: 404 })
  if (!canScanAgain({ status: quote.status as string, approvedAt: quote.approved_at as string | null })) {
    return NextResponse.json({ error: { code: 'INVALID_STATUS', message: 'This quote has been approved, so its scan can no longer change.' } }, { status: 409 })
  }

  const { data: requestRow } = await admin
    .from('quote_requests')
    .select('id, job_answers, source_json')
    .eq('id', quote.quote_request_id as string)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  // a scan is only ever made by the business on site: a customer's request keeps its answers as they are
  if (!requestRow || (requestRow.source_json as { type?: string } | null)?.type !== 'app') {
    return NextResponse.json({ error: { code: 'NOT_AN_APP_QUOTE', message: 'Only a quote made in the app can be scanned.' } }, { status: 409 })
  }

  const { data: service } = await admin
    .from('services')
    .select('expected_signals, draft_config')
    .eq('id', quote.service_id as string)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const jobAnswers = (Array.isArray(requestRow.job_answers) ? requestRow.job_answers : []) as Array<{ fieldId: string; value: unknown }>
  const oldScan = roomScanOfAnswers(jobAnswers)
  const rooms: unknown[] = [...(oldScan?.rooms ?? [])]
  const index = body.index
  if (index !== undefined && (!Number.isInteger(index) || index < 0 || index >= rooms.length)) {
    return NextResponse.json({ error: { code: 'INVALID_SCAN', message: 'No such area on this quote' } }, { status: 400 })
  }
  if (index === undefined) rooms.push(body.area)
  else rooms[index] = body.area
  const parsed = parseRoomScan({ ...(oldScan ?? {}), version: 1, rooms })
  if (!parsed.ok) return NextResponse.json({ error: { code: 'INVALID_SCAN', message: parsed.error } }, { status: 400 })
  const answers = answersWithNewScan(jobAnswers, oldScan, parsed.scan, {
    expected_signals: service?.expected_signals as ExpectedSignalConfig[] | null,
    draft_config: service?.draft_config as ServiceDraftConfig | null,
  })

  const { error: requestError } = await admin.from('quote_requests').update({ job_answers: answers }).eq('id', requestRow.id as string).eq('tenant_id', tenantId)
  if (requestError) {
    console.error('[AppRescan] Failed to save the scan:', requestError.message)
    return NextResponse.json({ error: { code: 'UPDATE_FAILED', message: 'The scan could not be saved. Try again.' } }, { status: 500 })
  }
  const { error: quoteError } = await admin.from('quotes').update({ status: 'queued' }).eq('id', quote.id as string).eq('tenant_id', tenantId)
  if (quoteError) console.error('[AppRescan] Failed to queue the quote:', quoteError.message)

  const job = { quoteId: quote.id as string, quoteRequestId: requestRow.id as string, tenantId, timestamp: Date.now() }
  try {
    if (!(await repriceQuoteNow(job))) await enqueueQuoteJob(job)
  } catch (queueError) {
    console.error('[AppRescan] Failed to dispatch reprice:', queueError)
  }
  return NextResponse.json({ success: true })
}
