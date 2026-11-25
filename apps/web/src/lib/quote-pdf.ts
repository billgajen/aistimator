/**
 * T-204: making a quote's PDF, in one place.
 *
 * Until now only the business could make one (Quotes → "Download PDF"), and
 * the customer's page offered a PDF only if the business happened to have made
 * it. The customer's own "Download PDF" needs the same document without that
 * step, so the making moved here: the dashboard's route and the customer's
 * public route both call `makeQuotePdf`.
 *
 * A PDF is made once and kept (`quotes.pdf_asset_id`). Anything that changes
 * the price clears that column (an edit saved in the dashboard, a service
 * added or removed), so the next download makes a new one.
 *
 * Who may have it is not decided here: the routes ask the shared rules
 * (`canDownloadQuotePdf`, `customerCanDownloadPdf`) before they call this.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getRegion, customerRoomScanView, resolveRegionContext, roomScanOfAnswers } from '@qolumns/shared'
import type { QuotePricing, QuoteContent, TenantBranding, TenantTemplate } from '@qolumns/shared'
import { generatePdf, isDocRaptorConfigured } from '@/lib/docraptor'
import { generateQuotePdfHtml, type QuotePdfData } from '@/lib/pdf-template'
import { customerTerms } from '@/lib/quote-terms'
import { uploadToR2, generateDownloadUrl, isR2Configured } from '@/lib/r2'

/** Can a PDF be made and kept here at all? (The customer's page offers the button only then.) */
export function quotePdfCanBeMade(): boolean {
  return isDocRaptorConfigured() && isR2Configured()
}

export type MadeQuotePdf =
  | { ok: true; pdf: Buffer; fileName: string; assetId: string | null; r2Key: string | null }
  | { ok: false; status: number; code: 'QUOTE_NOT_FOUND' | 'PDF_NOT_CONFIGURED' | 'PDF_GENERATION_FAILED'; message: string }

/** T-193: the scan stored with the quote's request, as the customer sees it */
function pdfRoomScan(quote: { quote_requests?: unknown; content_json?: unknown }, tenant: { region?: string | null; unit_system?: string | null }): Pick<QuotePdfData, 'roomScan'> {
  const request = ((r: unknown) => (Array.isArray(r) ? r[0] : r))(quote.quote_requests) as { job_answers?: unknown } | null
  const scan = roomScanOfAnswers(request?.job_answers)
  if (!scan) return {}
  const region = resolveRegionContext(tenant)
  return { roomScan: customerRoomScanView(scan, region.unitSystem, region.locale, { takeoff: (quote.content_json as { takeoff?: unknown } | null)?.takeoff ?? [] }) }
}

/** The file's name: what the business's and the customer's download are both called */
export function quotePdfFileName(quoteId: string): string {
  return `Quote-${quoteId}.pdf`
}

/**
 * Make the PDF for a quote, store it and record it on the quote.
 *
 * `supabase` decides what can be read: the signed-in business's client (its
 * own rows only) or the admin client after a quote link's token was checked.
 * `tenantId`, when given, must own the quote. With no storage configured
 * (a development machine) the document is still returned, unsaved.
 */
export async function makeQuotePdf(supabase: SupabaseClient, quoteId: string, tenantId?: string): Promise<MadeQuotePdf> {
  let query = supabase
    .from('quotes')
    .select(`
      *,
      tenants!tenant_id (
        id,
        name,
        region,
        unit_system,
        branding_json,
        template_json,
        default_terms_text
      ),
      services!service_id ( name ),
      quote_requests!quote_request_id ( job_answers )
    `)
    .eq('id', quoteId)
  if (tenantId) query = query.eq('tenant_id', tenantId)
  const { data: quote, error: quoteError } = await query.single()

  if (quoteError || !quote) return { ok: false, status: 404, code: 'QUOTE_NOT_FOUND', message: 'Quote not found' }
  if (!isDocRaptorConfigured()) return { ok: false, status: 503, code: 'PDF_NOT_CONFIGURED', message: 'PDF generation is not configured' }

  const tenant = quote.tenants as {
    id: string
    name: string
    region?: string | null
    unit_system?: string | null
    branding_json: TenantBranding | null
    template_json: TenantTemplate | null
    default_terms_text?: string | null
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

  let validUntil: string | undefined
  if (template.validityDays && quote.created_at) {
    const createdDate = new Date(quote.created_at)
    createdDate.setDate(createdDate.getDate() + template.validityDays)
    validUntil = createdDate.toISOString()
  }

  let logoUrl: string | undefined
  if (branding.logoAssetId && isR2Configured()) {
    const { data: logoAsset } = await supabase.from('assets').select('r2_key').eq('id', branding.logoAssetId).single()
    if (logoAsset) logoUrl = await generateDownloadUrl(logoAsset.r2_key)
  }

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
    locale: getRegion(tenant.region).locale, // T-133
    // T-179: the first section's heading on a combined quote
    serviceName: (quote.services as { name?: string } | null)?.name,
    // T-193: the room scan's sizes and floor plans, in the business's units
    ...pdfRoomScan(quote, tenant),
    // T-201: the business's "Default Terms & Conditions", when it has any
    terms: customerTerms(tenant.default_terms_text),
  }

  const result = await generatePdf({ name: `Quote-${quoteId}`, html: generateQuotePdfHtml(pdfData) })
  if (!result.success || !result.pdf) {
    console.error('PDF generation failed:', result.error)
    return { ok: false, status: 500, code: 'PDF_GENERATION_FAILED', message: result.error || 'Failed to generate PDF' }
  }

  const fileName = quotePdfFileName(quoteId)
  if (!isR2Configured()) {
    // Development without storage: the caller may still hand the document back
    console.warn('[PDF] R2 not configured: the PDF is not stored')
    return { ok: true, pdf: result.pdf, fileName, assetId: null, r2Key: null }
  }

  const ownerId = (quote.tenant_id as string | null) ?? tenant.id
  const r2Key = `${ownerId}/pdfs/${quoteId}-${Date.now()}.pdf`
  try {
    await uploadToR2(r2Key, result.pdf, 'application/pdf')
  } catch (error) {
    // made, but it could not be stored: nothing can be handed over, and nothing is recorded
    console.error('PDF storage failed:', error instanceof Error ? error.name : 'unknown error')
    return { ok: false, status: 500, code: 'PDF_GENERATION_FAILED', message: 'The PDF could not be stored' }
  }

  const { data: asset, error: assetError } = await supabase
    .from('assets')
    .insert({
      tenant_id: ownerId,
      type: 'pdf',
      file_name: fileName,
      content_type: 'application/pdf',
      size_bytes: result.pdf.length,
      r2_key: r2Key,
    })
    .select()
    .single()

  if (assetError || !asset) {
    // The document is in storage and can be handed over now; it is simply made again next time
    console.error('Failed to create PDF asset record:', assetError)
    return { ok: true, pdf: result.pdf, fileName, assetId: null, r2Key }
  }

  // Recorded only on the version it was made from: a price saved in the meantime keeps no stale PDF
  let record = supabase.from('quotes').update({ pdf_asset_id: asset.id }).eq('id', quoteId).eq('tenant_id', ownerId)
  if (typeof quote.version === 'number') record = record.eq('version', quote.version)
  await record
  return { ok: true, pdf: result.pdf, fileName, assetId: asset.id as string, r2Key }
}
