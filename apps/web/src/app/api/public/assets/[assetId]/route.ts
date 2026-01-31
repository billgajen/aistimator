import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { generateDownloadUrl, isR2Configured } from '@/lib/r2'

/**
 * GET /api/public/assets/:assetId
 * Returns asset file for viewing in quote page.
 * Requires valid token that matches the quote containing this asset.
 *
 * If R2 is configured, redirects to a signed download URL.
 * Otherwise returns asset metadata (for development).
 */
export async function GET(
  request: Request,
  { params }: { params: { assetId: string } }
) {
  try {
    const { assetId } = params
    const url = new URL(request.url)
    const token = url.searchParams.get('token')

    if (!token) {
      return NextResponse.json(
        { error: { code: 'MISSING_TOKEN', message: 'Token is required' } },
        { status: 401 }
      )
    }

    // Hash the token to compare with stored hash
    const tokenHash = createHash('sha256').update(token).digest('hex')

    const supabase = createAdminClient()

    // Fetch asset
    const { data: asset, error: assetError } = await supabase
      .from('assets')
      .select('id, tenant_id, quote_request_id, type, file_name, content_type, r2_key')
      .eq('id', assetId)
      .single()

    if (assetError || !asset) {
      return NextResponse.json(
        { error: { code: 'ASSET_NOT_FOUND', message: 'Asset not found' } },
        { status: 404 }
      )
    }

    // Validate token by checking if there's a quote with this token that references this asset
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select('id, quote_request_id')
      .eq('quote_token_hash', tokenHash)
      .eq('quote_request_id', asset.quote_request_id)
      .single()

    if (quoteError || !quote) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Invalid token for this asset' } },
        { status: 403 }
      )
    }

    // If R2 is configured, redirect to signed download URL
    if (isR2Configured()) {
      const downloadUrl = await generateDownloadUrl(asset.r2_key, 3600) // 1 hour expiry
      return NextResponse.redirect(downloadUrl)
    }

    // Fallback for development: return asset metadata
    return NextResponse.json({
      assetId: asset.id,
      fileName: asset.file_name,
      contentType: asset.content_type,
      r2Key: asset.r2_key,
      message: 'R2 not configured - configure R2 environment variables to serve files',
    })
  } catch (error) {
    console.error('Asset view error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
