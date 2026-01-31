import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { generateDownloadUrl, isR2Configured } from '@/lib/r2'

/**
 * GET /api/public/quotes/:quoteId/pdf
 * Download the PDF for a quote (public, requires valid token)
 */
export async function GET(
  request: Request,
  { params }: { params: { quoteId: string } }
) {
  try {
    const { quoteId } = params
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

    // Fetch quote with token validation
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select('id, quote_token_hash, token_expires_at, pdf_asset_id')
      .eq('id', quoteId)
      .eq('quote_token_hash', tokenHash)
      .single()

    if (quoteError || !quote) {
      return NextResponse.json(
        { error: { code: 'QUOTE_NOT_FOUND', message: 'Quote not found or invalid token' } },
        { status: 404 }
      )
    }

    // Check token expiry
    if (quote.token_expires_at && new Date(quote.token_expires_at) < new Date()) {
      return NextResponse.json(
        { error: { code: 'TOKEN_EXPIRED', message: 'Quote link has expired' } },
        { status: 410 }
      )
    }

    // Check if PDF exists
    if (!quote.pdf_asset_id) {
      return NextResponse.json(
        { error: { code: 'PDF_NOT_FOUND', message: 'PDF is not available for this quote' } },
        { status: 404 }
      )
    }

    // Get asset and generate download URL
    const { data: asset } = await supabase
      .from('assets')
      .select('r2_key, file_name')
      .eq('id', quote.pdf_asset_id)
      .single()

    if (!asset) {
      return NextResponse.json(
        { error: { code: 'ASSET_NOT_FOUND', message: 'PDF asset not found' } },
        { status: 404 }
      )
    }

    if (!isR2Configured()) {
      return NextResponse.json(
        { error: { code: 'R2_NOT_CONFIGURED', message: 'Storage is not configured' } },
        { status: 503 }
      )
    }

    const downloadUrl = await generateDownloadUrl(asset.r2_key, 300) // 5 minute expiry

    // Option 1: Return JSON with download URL
    // return NextResponse.json({ downloadUrl, fileName: asset.file_name })

    // Option 2: Redirect to the signed URL for direct download
    return NextResponse.redirect(downloadUrl)
  } catch (error) {
    console.error('Public PDF download error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
