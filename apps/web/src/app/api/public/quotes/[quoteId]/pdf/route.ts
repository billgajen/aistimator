import { createAdminClient } from '@/lib/supabase/server'
import { quoteTokenFilter } from '@/lib/tokens'
import { NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { createHash } from 'crypto'
import { generateDownloadUrl, isR2Configured } from '@/lib/r2'
import { checkRateLimit, getClientIp, rateLimitedResponse } from '@/lib/rate-limit'
import { makeQuotePdf, quotePdfFileName } from '@/lib/quote-pdf'
import { PDF_FAILED_LINE } from '@/lib/customer-pdf'
import { customerCanDownloadPdf, customerSeesNoFigure, isShownEarly, sectionsAwaitingApproval } from '@qolumns/shared'

// T-204: the first download makes the document while the customer waits (a few seconds)
export const maxDuration = 60

/**
 * GET /api/public/quotes/:quoteId/pdf?token=…
 * The customer's "Download PDF" (public, requires the quote link's token).
 *
 * T-204: the customer no longer depends on the business having made the PDF.
 * When the quote has none yet (it is new, or its price changed since the last
 * one), it is made here, kept, and handed over. `&format=json` answers
 * `{ downloadUrl, fileName }` for the page's button; without it the answer is
 * a redirect to the file, as before.
 *
 * Limits (T-173, AD-055, AD-060: every one fails open): the caller's address
 * is counted before anything is read; making a document is counted for the
 * quote once its token has been checked. A PDF already made is never refused
 * for the count.
 */
export async function GET(
  request: Request,
  { params }: { params: { quoteId: string } }
) {
  // The quote is read fresh on every call. Without this a built web app keeps and reuses the read
  // (T-183: `dynamic = 'force-dynamic'` alone does not stop it), and a quote that was held when its
  // PDF was first asked for stayed "held" here after the business approved it: the customer's
  // button answered 404 on a quote that was theirs to download. (Found by verify-t204.)
  noStore()
  try {
    const url = new URL(request.url)
    const byAddress = await checkRateLimit('quote_pdf', { ip: getClientIp(request) })
    if (!byAddress.allowed) return rateLimitedResponse(byAddress)

    const { quoteId } = params
    const token = url.searchParams.get('token')
    const asJson = url.searchParams.get('format') === 'json'

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
      .select('id, tenant_id, status, pricing_json, content_json, review_hold, quote_token_hash, token_expires_at, pdf_asset_id')
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

    // T-204: a PDF only once the quote has gone to the customer as final: never while it waits
    // for the business (an estimate shown early included), and never with no document.
    // (T-179: nor while a part the customer added waits for the business's approval.)
    if (!customerCanDownloadPdf(quote.status as string) || priceWithheld || sectionsAwaitingApproval(quote.pricing_json as object | null, quote.status as string).length > 0) {
      return NextResponse.json(
        { error: { code: 'PDF_NOT_FOUND', message: 'PDF is not available for this quote' } },
        { status: 404 }
      )
    }

    if (!isR2Configured()) {
      return NextResponse.json(
        { error: { code: 'R2_NOT_CONFIGURED', message: 'Storage is not configured' } },
        { status: 503 }
      )
    }

    // The document already made for this price, or a new one
    let r2Key: string | null = null
    if (quote.pdf_asset_id) {
      const { data: asset } = await supabase
        .from('assets')
        .select('r2_key')
        .eq('id', quote.pdf_asset_id)
        .single()
      r2Key = (asset as { r2_key?: string } | null)?.r2_key ?? null
    }
    if (!r2Key) {
      const making = await checkRateLimit('quote_pdf', { key: quoteId })
      if (!making.allowed) return rateLimitedResponse(making)
      const made = await makeQuotePdf(supabase, quoteId, (quote as { tenant_id?: string | null }).tenant_id ?? undefined)
      if (!made.ok || !made.r2Key) {
        const code = made.ok ? 'PDF_GENERATION_FAILED' : made.code
        return NextResponse.json(
          // the customer is never shown the PDF service's own words
          { error: { code, message: PDF_FAILED_LINE } },
          { status: made.ok ? 500 : made.status === 404 ? 404 : 503 }
        )
      }
      r2Key = made.r2Key
    }

    const fileName = quotePdfFileName(quoteId)
    const downloadUrl = await generateDownloadUrl(r2Key, 300, fileName) // 5 minute expiry, saved under its name

    if (asJson) return NextResponse.json({ downloadUrl, fileName })
    return NextResponse.redirect(downloadUrl)
  } catch (error) {
    console.error('Public PDF download error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
