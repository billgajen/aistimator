# tickets/T-019-quotes-list-and-actions.md

## Goal
Dashboard quote management screen.

## In scope
- Quotes table list: status, created, viewed, accepted, paid
- Actions: view, download PDF, resend email, copy quote link
- Basic search/filter by status

## Out of scope
- Complex CRM pipeline stages
- Bulk actions

## Acceptance criteria
- [x] Dashboard lists quotes correctly
- [x] Actions work reliably

## Completed
**Date:** 2026-01-25

### Implementation Summary

**API Routes Created:**

1. `apps/web/src/app/api/quotes/route.ts`
   - `GET /api/quotes` - List quotes for current tenant
   - Supports search by customer name/email
   - Supports filter by status
   - Cursor-based pagination (50 items per page)
   - Returns: quoteId, serviceName, customerName, customerEmail, status, timestamps, total, currency

2. `apps/web/src/app/api/quotes/[quoteId]/resend/route.ts`
   - `POST /api/quotes/:quoteId/resend` - Resend quote email
   - Regenerates token (extends expiry)
   - Sends customer email via Postmark
   - Updates quote status to 'sent'

3. `apps/web/src/app/api/quotes/[quoteId]/link/route.ts`
   - `POST /api/quotes/:quoteId/link` - Generate new quote link
   - Regenerates token with 30-day expiry
   - Returns quote view URL

**Library Created:**

`apps/web/src/lib/postmark.ts` - Postmark client for web app
- `sendEmail()` - Send email via Postmark API
- `isPostmarkConfigured()` - Check configuration
- `generateCustomerEmailHtml()` - Generate branded customer email

**Dashboard Page Updated:**

`apps/web/src/app/(dashboard)/app/quotes/page.tsx` - Full quotes management:

**Features:**
- Quotes table with columns: Customer, Service, Total, Status, Created, Actions
- Search by customer name or email (debounced)
- Filter by status (all, queued, processing, sent, viewed, accepted, paid, expired, failed)
- Status badges with appropriate colors
- Timestamps showing viewed/accepted dates
- Cursor-based pagination ("Load more" button)

**Actions per quote:**
- **Copy Link** (clipboard icon) - Generates new token and copies URL
- **Download PDF** (document icon) - Downloads or generates PDF
- **Resend Email** (envelope icon) - Resends quote to customer

**Action availability by status:**
- Copy Link: sent, viewed, accepted, paid, expired
- Download PDF: sent, viewed, accepted, paid
- Resend Email: sent, viewed, expired

**UI Features:**
- Loading states for table and individual actions
- Error state display
- Toast notifications for action feedback
- Empty state with helpful message and CTA
- Responsive table design