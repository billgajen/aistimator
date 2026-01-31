# tickets/T-018-email-delivery.md

## Goal
Send quote link (and optionally PDF) to customer and notify business.

## In scope
- Email templates (minimal)
- Send customer email: quote link, summary, validity
- Send business email: new lead + link to dashboard quote
- Track sentAt in DB

## Out of scope
- Full email campaign automation
- Follow-up sequences (v2)

## Acceptance criteria
- [x] Customer receives email with working quote link
- [x] Business receives notification email
- [x] Quotes show `sentAt` timestamp

## Completed
**Date:** 2026-01-25

### Implementation Summary

**Worker Email Module Created:**

`apps/worker/src/email/` - Complete email service:

1. `postmark.ts` - Postmark API client
   - `sendEmail(config, message)` - Sends email via Postmark API
   - Auto-generates plain text version from HTML
   - Returns success/failure with message ID

2. `templates.ts` - HTML email templates
   - `customerQuoteEmail(data)` - Customer notification with:
     - Business branding (name, primary color)
     - Quote total prominently displayed
     - Scope summary preview
     - Validity date
     - "View Full Quote" CTA button
   - `businessNotificationEmail(data)` - Business notification with:
     - New lead alert
     - Customer details (name, email, phone)
     - Service and job location
     - Quote total
     - "View in Dashboard" CTA button

3. `index.ts` - Main email service
   - `sendQuoteEmails(config, data)` - Sends both customer and business emails
   - `isEmailConfigured()` - Check if email is configured
   - Handles formatting (currency, dates)

**Integration Points:**

1. `apps/worker/src/quote-processor.ts` - Updated to send emails
   - Sends emails after quote is successfully processed
   - Uses tenant branding (primary color)
   - Fetches business owner email from user_profiles
   - Non-blocking: email failure doesn't fail quote processing

2. `apps/worker/src/index.ts` - Updated Env interface
   - Added `POSTMARK_API_TOKEN`, `POSTMARK_FROM_EMAIL`, `APP_URL`

3. `apps/web/src/lib/queue.ts` - Updated job message
   - Added `quoteToken` field to pass plain-text token for email links

4. `apps/web/src/app/api/public/quotes/route.ts` - Updated
   - Passes `quoteToken` to queue job for email link generation

**Environment Variables (Worker):**
- `POSTMARK_API_TOKEN` - Postmark server token
- `POSTMARK_FROM_EMAIL` - From email address for quotes
- `APP_URL` - Base URL for quote links (e.g., https://app.example.com)

**Email Features:**
- Responsive HTML design with inline styles
- Mobile-friendly table-based layout
- Business branding (primary color in buttons/headings)
- Clear CTAs for viewing quote and dashboard
- Reply-to set to business owner email for customer emails
- Tagged emails for Postmark analytics (quote-customer, quote-business)

**sentAt Tracking:**
- Already implemented in quote processor (sets `sent_at` when status changes to 'sent')