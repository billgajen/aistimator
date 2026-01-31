# tickets/T-016-hosted-quote-page-and-public-get.md

## Goal
Build hosted quote page and `GET /api/public/quotes/:quoteId` API.

## In scope
- Public GET endpoint returns quote view DTO from spec
- Quote page renders:
  - business branding
  - totals + optional breakdown
  - photos/docs section (optional)
  - validity date
  - accept and pay CTAs if enabled
- Token-based access

## Out of scope
- Multi-language
- Customer accounts

## Acceptance criteria
- [x] Quote page loads without login using unguessable token
- [x] Optional sections toggle correctly
- [x] Assets display via controlled URLs

## Completed
- 2026-01-25: Hosted quote page and public APIs complete
  - Created `GET /api/public/quotes/[quoteId]` endpoint:
    - Token-based authentication via SHA-256 hash comparison
    - Token expiry validation
    - Updates quote status to 'viewed' on first view
    - Returns full QuoteViewResponse DTO
    - Includes business branding, pricing breakdown, notes, assets
  - Created `POST /api/public/quotes/[quoteId]/accept` endpoint:
    - Validates token and quote status
    - Prevents double-acceptance
    - Updates quote status to 'accepted'
  - Created `GET /api/public/assets/[assetId]` endpoint:
    - Token-validated asset access
    - Verifies asset belongs to quote
    - Returns asset metadata (R2 streaming pending T-012)
  - Created hosted quote page at `/q/[quoteId]`:
    - Responsive design with Tailwind CSS
    - Business branding header
    - Status badge (Processing, Viewed, Accepted, etc.)
    - Scope of work section
    - Pricing breakdown with subtotal, tax, total
    - Assumptions and exclusions lists
    - Additional notes section
    - Photo gallery for attached images
    - Accept quote CTA with confirmation
    - Graceful error handling for invalid/expired tokens
  - All endpoints properly handle:
    - Missing token (401)
    - Invalid token (404)
    - Expired token (410)
    - Already accepted (409)