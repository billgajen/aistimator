import { NextResponse } from 'next/server'
import { hashApprovalToken, isApprovalTokenShape, approvalOutcomeCopy, type ApprovalOutcome } from '@estimator/shared'
import { createAdminClient } from '@/lib/supabase/server'
import { approveByLink } from '@/lib/approval-link'
import { checkPublicRateLimit, getClientIp, rateLimitedResponse } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const STATUS: Record<ApprovalOutcome, number> = {
  approved: 200,
  ready: 200,
  already_approved: 409,
  link_expired: 410,
  not_awaiting: 409,
  wording_needs_edit: 400,
  not_priced: 400,
  too_many: 429,
  not_found: 404,
}

/**
 * POST /api/public/approval/:token (T-156) — the one-tap Approve & send from
 * the review email. No login: the token is the only credential, and it can
 * approve its own quote and nothing else. Opening the page (GET) never
 * approves; only this POST does, once.
 *
 * Response: { outcome, title, body, dashboardPath, emailed? }. No customer
 * details beyond what the page already shows; none are logged.
 */
export async function POST(request: Request, { params }: { params: { token: string } }) {
  const token = params.token
  const keyPart = isApprovalTokenShape(token) ? (await hashApprovalToken(token)).slice(0, 32) : 'invalid'
  const limited = await checkPublicRateLimit('approval_link', { ip: getClientIp(request), tenantKey: keyPart })
  if (!limited.allowed) return rateLimitedResponse(limited)

  try {
    const result = await approveByLink(createAdminClient(), token)
    const copy = approvalOutcomeCopy(result.outcome, { customerName: result.summary?.customerName, businessName: result.summary?.businessName, emailed: result.emailed })
    return NextResponse.json(
      {
        outcome: result.outcome,
        ...copy,
        ...(result.summary && { dashboardPath: `/app/quotes/${result.summary.quoteId}` }),
        ...(result.emailed !== undefined && { emailed: result.emailed }),
      },
      { status: STATUS[result.outcome] }
    )
  } catch (e) {
    console.error('[ApprovalLink] approve failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ outcome: 'error', title: 'Something went wrong', body: 'Nothing was sent. Try again, or open the quote in your dashboard.' }, { status: 500 })
  }
}
