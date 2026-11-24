import { createAdminClient } from '@/lib/supabase/server'
import { quoteTokenFilter } from '@/lib/tokens'
import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { generateDownloadUrl, isR2Configured } from '@/lib/r2'
import { customerSeesNoFigure, isShownEarly, sectionsAwaitingApproval } from '@qolumns/shared'

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
      .select('id, status, pricing_json, content_json, review_hold, quote_token_hash, token_expires_at, pdf_asset_id')
      .eq('id', quoteId)
      .or(quoteTokenFilter(tokenHash))
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

    // T-201: no PDF while the customer may see no price: a quote held until the
    // business approves it, or one whose details the customer is still
    // confirming. A PDF carries every price. (The page's own answer leaves the
    // PDF link out for these; this refuses the address itself.)
    const shownEarly = isShownEarly({
      status: quote.status as string,
      review_hold: (quote as { review_hold?: string | null }).review_hold,
      total: (quote.pricing_json as { total?: number } | null)?.total,
      limitHold: (quote.content_json as { limitHold?: boolean } | null)?.limitHold,
    })
    const priceWithheld = quote.status === 'awaiting_clarification' || customerSeesNoFigure({ status: quote.status as string, shownEarly })

    // Check if PDF exists. (T-179: none is given while a part the customer added
    // waits for the business's approval: a PDF carries every price.)
    if (!quote.pdf_asset_id || priceWithheld || sectionsAwaitingApproval(quote.pricing_json as object | null, quote.status as string).length > 0) {
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
