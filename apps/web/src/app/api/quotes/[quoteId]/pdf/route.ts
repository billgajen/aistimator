import { createClient } from '@/lib/supabase/server'
import { canDownloadQuotePdf } from '@qolumns/shared'
import { NextResponse } from 'next/server'
import { generateDownloadUrl, isR2Configured } from '@/lib/r2'
import { makeQuotePdf } from '@/lib/quote-pdf'

/**
 * POST /api/quotes/:quoteId/pdf
 * Generate a PDF for a quote (dashboard use, requires auth).
 * T-204: the making itself is lib/quote-pdf.ts, shared with the customer's own download.
 */
export async function POST(
  _request: Request,
  { params }: { params: { quoteId: string } }
) {
  try {
    const { quoteId } = params
    const supabase = await createClient()

    // Verify authentication
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
        { status: 401 }
      )
    }

    // Get user's tenant
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (!profile?.tenant_id) {
      return NextResponse.json(
        { error: { code: 'NO_TENANT', message: 'User has no tenant' } },
        { status: 404 }
      )
    }

    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select('id, status, pdf_asset_id')
      .eq('id', quoteId)
      .eq('tenant_id', profile.tenant_id)
      .single()

    if (quoteError || !quote) {
      return NextResponse.json(
        { error: { code: 'QUOTE_NOT_FOUND', message: 'Quote not found' } },
        { status: 404 }
      )
    }

    // T-157: the rule the Download PDF button reads
    if (!canDownloadQuotePdf(quote.status)) {
      return NextResponse.json(
        { error: { code: 'INVALID_STATUS', message: `Quote is still ${quote.status}` } },
        { status: 400 }
      )
    }

    // Check if PDF already exists
    if (quote.pdf_asset_id) {
      // Return existing PDF download URL
      const { data: existingAsset } = await supabase
        .from('assets')
        .select('r2_key')
        .eq('id', quote.pdf_asset_id)
        .single()

      if (existingAsset && isR2Configured()) {
        const downloadUrl = await generateDownloadUrl(existingAsset.r2_key)
        return NextResponse.json({
          quoteId,
          pdfAssetId: quote.pdf_asset_id,
          downloadUrl,
          message: 'PDF already exists',
        })
      }
    }

    const made = await makeQuotePdf(supabase, quoteId, profile.tenant_id)
    if (!made.ok) {
      return NextResponse.json({ error: { code: made.code, message: made.message } }, { status: made.status })
    }

    return NextResponse.json({
      quoteId,
      pdfAssetId: made.assetId,
      downloadUrl: made.r2Key ? await generateDownloadUrl(made.r2Key) : null,
      // Include base64 for development without R2
      ...(!isR2Configured() && { pdfBase64: made.pdf.toString('base64') }),
      message: 'PDF generated successfully',
    })
  } catch (error) {
    console.error('PDF generation error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}

/**
 * GET /api/quotes/:quoteId/pdf
 * Download the PDF for a quote (dashboard use, requires auth)
 */
export async function GET(
  _request: Request,
  { params }: { params: { quoteId: string } }
) {
  try {
    const { quoteId } = params
    const supabase = await createClient()

    // Verify authentication
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
        { status: 401 }
      )
    }

    // Get user's tenant
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single()

    if (!profile?.tenant_id) {
      return NextResponse.json(
        { error: { code: 'NO_TENANT', message: 'User has no tenant' } },
        { status: 404 }
      )
    }

    // Fetch quote
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select('id, status, pdf_asset_id')
      .eq('id', quoteId)
      .eq('tenant_id', profile.tenant_id)
      .single()

    if (quoteError || !quote) {
      return NextResponse.json(
        { error: { code: 'QUOTE_NOT_FOUND', message: 'Quote not found' } },
        { status: 404 }
      )
    }

    // T-157: the rule the Download PDF button reads
    if (!canDownloadQuotePdf(quote.status)) {
      return NextResponse.json(
        { error: { code: 'INVALID_STATUS', message: `Quote is still ${quote.status}` } },
        { status: 400 }
      )
    }

    if (!quote.pdf_asset_id) {
      return NextResponse.json(
        { error: { code: 'PDF_NOT_FOUND', message: 'PDF has not been generated for this quote' } },
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

    return NextResponse.json({
      quoteId,
      pdfAssetId: quote.pdf_asset_id,
      fileName: asset.file_name,
      downloadUrl,
    })
  } catch (error) {
    console.error('PDF download error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
