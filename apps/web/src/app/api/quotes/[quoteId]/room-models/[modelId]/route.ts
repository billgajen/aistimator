import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth-tenant'
import { signedRoomModelUrl } from '@/lib/room-models'

export const dynamic = 'force-dynamic'

const notFound = () => NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Model not found' } }, { status: 404 })

/**
 * GET /api/quotes/:quoteId/room-models/:modelId (T-193) — the address of a
 * scanned room's 3D model, for the signed-in business that owns the quote
 * (the dashboard's viewer asks when it is opened). Answers { url }, signed
 * for a few minutes. The quote must be the caller's tenant's and the model
 * one of the rooms in its own scan; anything else is the same 404.
 */
export async function GET(_request: Request, { params }: { params: { quoteId: string; modelId: string } }) {
  const auth = await requireTenant()
  if (!auth.ok) return auth.response
  const { data: quote } = await auth.supabase
    .from('quotes')
    .select('id, tenant_id, quote_requests!quote_request_id (job_answers)')
    .eq('id', params.quoteId)
    .eq('tenant_id', auth.tenantId)
    .maybeSingle()
  if (!quote) return notFound()
  const request = ((r: unknown) => (Array.isArray(r) ? r[0] : r))((quote as { quote_requests?: unknown }).quote_requests) as { job_answers?: unknown } | null
  const url = await signedRoomModelUrl({ tenantId: auth.tenantId, jobAnswers: request?.job_answers }, params.modelId)
  if (!url) return notFound()
  return NextResponse.json({ url }, { headers: { 'Cache-Control': 'no-store' } })
}
