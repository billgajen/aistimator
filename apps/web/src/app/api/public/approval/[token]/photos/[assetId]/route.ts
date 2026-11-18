import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { hashApprovalToken, isApprovalTokenShape } from '@qolumns/shared'
import { createAdminClient } from '@/lib/supabase/server'
import { approvalPhotoKey } from '@/lib/approval-link'
import { generateDownloadUrl, isR2Configured } from '@/lib/r2'
import { DASHBOARD_PHOTO_URL_SECONDS } from '@/lib/quote-photos'
import { photoKeyToServe, photoSizeOf } from '@/lib/small-photo-server'
import { checkPublicRateLimit, getClientIp, rateLimitedResponse } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const notFound = () => NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Photo not found' } }, { status: 404 })

/**
 * GET /api/public/approval/:token/photos/:assetId (T-183)
 *
 * One of the customer's photos, for the approval page behind the review
 * email. No login: the approval link's token is the credential, and it can
 * show only the photos of its own quote, and only while it can still approve
 * (not used, replaced, expired or pressed too often). It answers with a
 * redirect to a signed address that lasts a few minutes; uploads stay
 * private and there is no public address.
 *
 * Every refusal is the same 404. Opening a photo is not a press: it counts
 * nothing against the link and changes nothing. `?size=small` serves the
 * small copy when the photo has one (T-172). Neither the token, the key nor
 * the signed address is logged.
 *
 * The link's state is read fresh on every call (see `noStore()` below): the
 * moment a link is used or replaced, its photos stop.
 */
export async function GET(request: Request, { params }: { params: { token: string; assetId: string } }) {
  // Every read below must be fresh. Without this, Next keeps the answer to a
  // database read made in a GET handler and gives it again: the link's row was
  // read once as open, and a link that had since been used still showed its
  // photos (found by verify-t183). `dynamic = 'force-dynamic'` alone does not
  // stop that here; the approval page is fresh because it reads the request's
  // headers before it reads the database.
  noStore()
  const { token, assetId } = params
  const keyPart = isApprovalTokenShape(token) ? (await hashApprovalToken(token)).slice(0, 32) : 'invalid'
  const limited = await checkPublicRateLimit('approval_photo', { ip: getClientIp(request), tenantKey: keyPart })
  if (!limited.allowed) return rateLimitedResponse(limited)

  try {
    const originalKey = await approvalPhotoKey(createAdminClient(), token, assetId)
    if (!originalKey) return notFound()
    if (!isR2Configured()) {
      return NextResponse.json({ error: { code: 'STORAGE_UNAVAILABLE', message: 'Photo storage is not set up' } }, { status: 503 })
    }
    const key = await photoKeyToServe(originalKey, photoSizeOf(new URL(request.url).searchParams.get('size')))
    const signedUrl = await generateDownloadUrl(key, DASHBOARD_PHOTO_URL_SECONDS)
    return NextResponse.redirect(signedUrl, {
      status: 302,
      headers: { 'Cache-Control': `private, max-age=${DASHBOARD_PHOTO_URL_SECONDS - 60}`, 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' },
    })
  } catch (error) {
    // The error's name only: a message could carry a key or an address
    console.error('[ApprovalLink] photo failed:', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, { status: 500 })
  }
}
