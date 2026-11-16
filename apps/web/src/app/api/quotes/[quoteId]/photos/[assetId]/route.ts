import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { generateDownloadUrl, isR2Configured } from '@/lib/r2'
import { assetIdsOf, DASHBOARD_PHOTO_URL_SECONDS } from '@/lib/quote-photos'

export const dynamic = 'force-dynamic'

const notFound = () => NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Photo not found' } }, { status: 404 })

/**
 * GET /api/quotes/:quoteId/photos/:assetId (T-169)
 *
 * One of the customer's photos, for the signed-in business that owns the
 * quote. It answers with a redirect to a signed URL that lasts a few minutes
 * (uploads are private; there is no public URL).
 *
 * Tenant isolation: the quote must belong to the caller's tenant, the photo
 * must be one of that quote's request's assets, and the asset row must belong
 * to the same tenant. Anything else is 404, the same answer as a photo that
 * does not exist. Neither the key nor the signed URL is logged.
 */
export async function GET(_request: Request, { params }: { params: { quoteId: string; assetId: string } }) {
  try {
    const { quoteId, assetId } = params
    const supabase = await createClient()

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }, { status: 401 })
    }

    const { data: profile } = await supabase.from('user_profiles').select('tenant_id').eq('id', user.id).single()
    if (!profile?.tenant_id) return notFound()

    const { data: quote } = await supabase
      .from('quotes')
      .select('id, quote_requests!quote_request_id (asset_ids)')
      .eq('id', quoteId)
      .eq('tenant_id', profile.tenant_id)
      .maybeSingle()
    if (!quote || !assetIdsOf((quote as { quote_requests?: unknown }).quote_requests).includes(assetId)) return notFound()

    const { data: asset } = await supabase
      .from('assets')
      .select('id, r2_key')
      .eq('id', assetId)
      .eq('tenant_id', profile.tenant_id)
      .eq('type', 'image')
      .maybeSingle()
    if (!asset?.r2_key) return notFound()

    if (!isR2Configured()) {
      return NextResponse.json({ error: { code: 'STORAGE_UNAVAILABLE', message: 'Photo storage is not set up' } }, { status: 503 })
    }

    const signedUrl = await generateDownloadUrl(asset.r2_key, DASHBOARD_PHOTO_URL_SECONDS)
    // The browser may reuse the answer for a little less than the signed URL lasts; nothing shared may keep it
    return NextResponse.redirect(signedUrl, {
      status: 302,
      headers: { 'Cache-Control': `private, max-age=${DASHBOARD_PHOTO_URL_SECONDS - 60}` },
    })
  } catch (error) {
    // The error's name only: a message could carry a key or a URL
    console.error('Quote photo error:', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, { status: 500 })
  }
}
