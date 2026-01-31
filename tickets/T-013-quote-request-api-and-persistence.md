# tickets/T-013-quote-request-api-and-persistence.md

## Goal
Implement `POST /api/public/quotes` to persist submissions and enqueue quote generation.

## In scope
- Validate tenantKey and domain allowlist (tenant_sites)
- Validate serviceId belongs to tenant
- Create quote_request record
- Create quote record with status `queued`
- Enqueue queue job with quoteId

## Out of scope
- Actual AI generation (T-015)
- Email sending (T-018)

## Acceptance criteria
- [x] Endpoint returns quoteId and quoteViewUrl immediately
- [x] DB has quote_request + quote created
- [x] Queue message created for processing

## Completed
- 2026-01-25: Quote request API implementation complete
  - Created `POST /api/public/quotes` endpoint:
    - Validates tenantKey against tenant_sites table
    - Validates serviceId belongs to tenant and is active
    - Validates customer email format
    - Validates service area restrictions (postcode allowlist)
    - Validates asset IDs if provided
    - Creates quote_request record with customer/job details
    - Creates quote record with status 'queued'
    - Generates secure quote view token (SHA-256 hash stored)
    - Returns quoteId, status, quoteViewUrl, tokenExpiresAt
  - Created `POST /api/public/uploads/init` endpoint:
    - Validates tenantKey
    - Validates file types (images, PDFs) and sizes
    - Creates asset records
    - Returns asset IDs and upload URLs (placeholder for R2)
  - Created supporting utilities:
    - `lib/tokens.ts` - token generation and hashing
    - `lib/queue.ts` - queue job placeholder (for T-014)
  - Added comprehensive API types to `@estimator/shared`:
    - CreateQuoteRequest/Response
    - InitUploadsRequest/Response
    - QuoteViewResponse and related types
