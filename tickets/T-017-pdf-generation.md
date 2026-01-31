# tickets/T-017-pdf-generation.md

## Goal
Generate a professional PDF via DocRaptor API and store it as an asset in R2.

## In scope
- Generate HTML template from quote data (simple, branded)
- Send HTML to DocRaptor API for PDF conversion
- Store returned PDF in R2, link pdf_asset_id on quote
- Download link from dashboard and quote page (optional toggle)

## Out of scope
- Multiple PDF themes
- Complex proposal formatting
- Server-side PDF generation libraries (using DocRaptor instead)

## Acceptance criteria
- [x] PDF renders consistently with branding via DocRaptor
- [x] PDF stored privately in R2 and downloadable via controlled URL
- [x] PDF generation is optional (tenant toggle)

## Implementation notes
- DocRaptor API key stored in env vars: `DOCRAPTOR_API_KEY`
- Use DocRaptor test mode during development (free, watermarked)
- HTML template uses inline styles for consistent rendering

## Completed
**Date:** 2026-01-25

### Implementation Summary

**Libraries Created:**

1. `apps/web/src/lib/docraptor.ts` - DocRaptor API client
   - `generatePdf(options)` - Converts HTML to PDF via DocRaptor API
   - `isDocRaptorConfigured()` - Check if API is configured
   - Supports test mode (free, watermarked) via `DOCRAPTOR_TEST_MODE=true`

2. `apps/web/src/lib/pdf-template.ts` - Quote HTML template generator
   - `generateQuotePdfHtml(data)` - Generates branded HTML for PDF conversion
   - Inline styles for consistent cross-platform rendering
   - Respects template settings (showLineItems, includeAssumptions, includeExclusions)
   - Uses tenant branding (primary color, footer notes, logo)

3. `apps/web/src/lib/r2.ts` - Extended with server-side upload
   - Added `uploadToR2(key, buffer, contentType)` for direct server-side uploads

**API Routes Created:**

1. `apps/web/src/app/api/quotes/[quoteId]/pdf/route.ts` (Dashboard)
   - `POST /api/quotes/:quoteId/pdf` - Generate PDF for a quote
     - Requires authentication
     - Generates HTML, sends to DocRaptor, stores PDF in R2
     - Creates asset record and updates quote with pdf_asset_id
     - Returns download URL
   - `GET /api/quotes/:quoteId/pdf` - Get download URL for existing PDF
     - Requires authentication
     - Returns signed R2 download URL (5 min expiry)

2. `apps/web/src/app/api/public/quotes/[quoteId]/pdf/route.ts` (Public)
   - `GET /api/public/quotes/:quoteId/pdf?token=xxx` - Download PDF
     - Requires valid quote token
     - Redirects to signed R2 URL for direct download

**Frontend Updates:**

1. `apps/web/src/app/q/[quoteId]/page.tsx` - Hosted quote page
   - Added "Download PDF" button in header when PDF is available
   - Links to public PDF download endpoint

2. `packages/shared/src/api.types.ts`
   - Added `pdfUrl` to `QuoteViewActions` interface

3. `apps/web/src/app/api/public/quotes/[quoteId]/route.ts`
   - Returns `actions.pdfUrl` when quote has a PDF

**Environment Variables:**
- `DOCRAPTOR_API_KEY` - DocRaptor API key
- `DOCRAPTOR_TEST_MODE` - Set to 'true' for test mode (free, watermarked)

**PDF Template Features:**
- Business branding (logo, primary color)
- Quote reference and dates
- Customer details
- Scope of work summary
- Line items breakdown (optional via template setting)
- Pricing totals with tax
- Assumptions (optional via template setting)
- Exclusions (optional via template setting)
- Additional notes
- Footer notes from branding settings
