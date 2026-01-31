import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { generatePdf, isDocRaptorConfigured } from '@/lib/docraptor'
import { generateQuotePdfHtml, type QuotePdfData } from '@/lib/pdf-template'
import { uploadToR2, generateDownloadUrl, isR2Configured } from '@/lib/r2'
import type {
  QuotePricing,
  QuoteContent,
  TenantBranding,
  TenantTemplate,
} from '@estimator/shared'

/**
 * POST /api/quotes/:quoteId/pdf
 * Generate a PDF for a quote (dashboard use, requires auth)
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

    // Fetch quote with tenant data
    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select(`
        *,
        tenants!tenant_id (
          id,
          name,
          branding_json,
          template_json
        )
      `)
      .eq('id', quoteId)
      .eq('tenant_id', profile.tenant_id)
      .single()

    if (quoteError || !quote) {
      return NextResponse.json(
        { error: { code: 'QUOTE_NOT_FOUND', message: 'Quote not found' } },
        { status: 404 }
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

    // Check DocRaptor configuration
    if (!isDocRaptorConfigured()) {
      return NextResponse.json(
        { error: { code: 'PDF_NOT_CONFIGURED', message: 'PDF generation is not configured' } },
        { status: 503 }
      )
    }

    // Extract data
    const tenant = quote.tenants as {
      id: string
      name: string
      branding_json: TenantBranding | null
      template_json: TenantTemplate | null
    }

    const branding: TenantBranding = {
      logoAssetId: null,
      primaryColor: '#2563eb',
      footerNotes: null,
      ...(tenant.branding_json || {}),
    }

    const template: TenantTemplate = {
      showLineItems: true,
      includeAssumptions: true,
      includeExclusions: true,
      validityDays: 30,
      ...(tenant.template_json || {}),
    }

    const pricing = quote.pricing_json as QuotePricing
    const content = quote.content_json as QuoteContent
    const customer = quote.customer_json as { name: string; email: string; phone?: string }

    // Calculate valid until date
    let validUntil: string | undefined
    if (template.validityDays && quote.created_at) {
      const createdDate = new Date(quote.created_at)
      createdDate.setDate(createdDate.getDate() + template.validityDays)
      validUntil = createdDate.toISOString()
    }

    // TODO: Get logo URL if logoAssetId exists
    let logoUrl: string | undefined
    if (branding.logoAssetId && isR2Configured()) {
      const { data: logoAsset } = await supabase
        .from('assets')
        .select('r2_key')
        .eq('id', branding.logoAssetId)
        .single()

      if (logoAsset) {
        logoUrl = await generateDownloadUrl(logoAsset.r2_key)
      }
    }

    // Prepare PDF data
    const pdfData: QuotePdfData = {
      quoteId: quote.id,
      businessName: tenant.name,
      logoUrl,
      branding,
      template,
      customer,
      pricing,
      content,
      createdAt: quote.created_at,
      validUntil,
    }

    // Generate HTML
    const html = generateQuotePdfHtml(pdfData)

    // Generate PDF via DocRaptor
    const result = await generatePdf({
      name: `Quote-${quoteId}`,
      html,
    })

    if (!result.success || !result.pdf) {
      console.error('PDF generation failed:', result.error)
      return NextResponse.json(
        { error: { code: 'PDF_GENERATION_FAILED', message: result.error || 'Failed to generate PDF' } },
        { status: 500 }
      )
    }

    // Store PDF in R2 and create asset record
    const timestamp = Date.now()
    const r2Key = `${profile.tenant_id}/pdfs/${quoteId}-${timestamp}.pdf`
    const fileName = `Quote-${quoteId}.pdf`

    let pdfAssetId: string | null = null
    let downloadUrl: string | null = null

    if (isR2Configured()) {
      // Upload to R2
      await uploadToR2(r2Key, result.pdf, 'application/pdf')

      // Create asset record
      const { data: asset, error: assetError } = await supabase
        .from('assets')
        .insert({
          tenant_id: profile.tenant_id,
          type: 'pdf',
          file_name: fileName,
          content_type: 'application/pdf',
          size_bytes: result.pdf.length,
          r2_key: r2Key,
        })
        .select()
        .single()

      if (assetError) {
        console.error('Failed to create PDF asset record:', assetError)
      } else {
        pdfAssetId = asset.id

        // Update quote with PDF asset ID
        await supabase
          .from('quotes')
          .update({ pdf_asset_id: pdfAssetId })
          .eq('id', quoteId)

        // Generate download URL
        downloadUrl = await generateDownloadUrl(r2Key)
      }
    } else {
      // Development fallback: return PDF as base64
      console.warn('[PDF] R2 not configured, returning PDF as base64')
    }

    return NextResponse.json({
      quoteId,
      pdfAssetId,
      downloadUrl,
      // Include base64 for development without R2
      ...(!isR2Configured() && { pdfBase64: result.pdf.toString('base64') }),
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
      .select('id, pdf_asset_id')
      .eq('id', quoteId)
      .eq('tenant_id', profile.tenant_id)
      .single()

    if (quoteError || !quote) {
      return NextResponse.json(
        { error: { code: 'QUOTE_NOT_FOUND', message: 'Quote not found' } },
        { status: 404 }
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
