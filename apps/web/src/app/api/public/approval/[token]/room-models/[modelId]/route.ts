import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { hashApprovalToken, isApprovalTokenShape } from '@qolumns/shared'
import { createAdminClient } from '@/lib/supabase/server'
import { approvalQuoteScan } from '@/lib/approval-link'
import { checkPublicRateLimit, getClientIp, rateLimitedResponse } from '@/lib/rate-limit'
import { signedRoomModelUrl } from '@/lib/room-models'

export const dynamic = 'force-dynamic'

const notFound = () => NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Model not found' } }, { status: 404 })

/**
 * GET /api/public/approval/:token/room-models/:modelId (T-193) — the address
 * of a scanned room's 3D model for the approval page. The approval link is
 * the credential, as for its photos (T-183): only while it can still approve,
 * and only a model of its own quote's scan. Answers { url }, signed for a few
 * minutes. Opening it is not a press and counts nothing against the link.
 */
export async function GET(request: Request, { params }: { params: { token: string; modelId: string } }) {
  // fresh reads, as for the link's photos (a used link must stop at once)
  noStore()
  const keyPart = isApprovalTokenShape(params.token) ? (await hashApprovalToken(params.token)).slice(0, 32) : 'invalid'
  const limited = await checkPublicRateLimit('room_model', { ip: getClientIp(request), tenantKey: keyPart })
  if (!limited.allowed) return rateLimitedResponse(limited)
  const quote = await approvalQuoteScan(createAdminClient(), params.token)
  if (!quote) return notFound()
  const url = await signedRoomModelUrl(quote, params.modelId)
  if (!url) return notFound()
  return NextResponse.json({ url }, { headers: { 'Cache-Control': 'no-store' } })
}
