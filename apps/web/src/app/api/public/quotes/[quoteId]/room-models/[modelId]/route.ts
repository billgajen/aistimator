import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { checkPublicRateLimit, getClientIp, rateLimitedResponse } from '@/lib/rate-limit'
import { signedRoomModelUrl } from '@/lib/room-models'
import { quoteTokenFilter } from '@/lib/tokens'

export const dynamic = 'force-dynamic'

const notFound = () => NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Model not found' } }, { status: 404 })

/**
 * GET /api/public/quotes/:quoteId/room-models/:modelId?token= (T-193) — the
 * address of a scanned room's 3D model for the customer's quote page. The
 * quote's own token is the credential (the same check as the page itself,
 * expiry included), and the model must be one of the rooms in that quote's
 * scan. Answers { url }, signed for a few minutes; asked for only when the
 * customer opens the viewer. Every refusal is the same 404. Neither the
 * token, the key nor the address is logged.
 */
export async function GET(request: Request, { params }: { params: { quoteId: string; modelId: string } }) {
  const token = new URL(request.url).searchParams.get('token')
  if (!token) return notFound()
  const limited = await checkPublicRateLimit('room_model', { ip: getClientIp(request), tenantKey: params.quoteId })
  if (!limited.allowed) return rateLimitedResponse(limited)

  const tokenHash = createHash('sha256').update(token).digest('hex')
  const { data: quote } = await createAdminClient()
    .from('quotes')
    .select('id, tenant_id, token_expires_at, quote_requests!quote_request_id (job_answers)')
    .eq('id', params.quoteId)
    .or(quoteTokenFilter(tokenHash))
    .maybeSingle()
  if (!quote) return notFound()
  if (quote.token_expires_at && new Date(quote.token_expires_at as string) < new Date()) return notFound()
  const requestRow = ((r: unknown) => (Array.isArray(r) ? r[0] : r))((quote as { quote_requests?: unknown }).quote_requests) as { job_answers?: unknown } | null
  const url = await signedRoomModelUrl({ tenantId: quote.tenant_id as string, jobAnswers: requestRow?.job_answers }, params.modelId)
  if (!url) return notFound()
  return NextResponse.json({ url }, { headers: { 'Cache-Control': 'no-store' } })
}
