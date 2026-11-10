# /docs/02-api-contracts.md

## Conventions
- Base prefix: `/api`
- Hosting: All API routes run on Vercel (Next.js API routes), except the queue consumer which runs on Cloudflare Workers
- JSON only. `Content-Type: application/json`
- Auth (dashboard APIs): Supabase session cookie, or `Authorization: Bearer <supabase access token>` (T-137: the business app). A bearer is accepted only when its JWT role is `authenticated`; service-role/anon keys are ignored. Row-level security applies either way.
- Public widget APIs: `tenantKey` (public) + server-side domain allowlist checks
- Standard error envelope (example):
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid input", "details": [] } }

- HTTP status usage:
  - 400 validation
  - 401 unauth
  - 403 forbidden
  - 404 not found
  - 409 conflict (idempotency)
  - 429 rate limited
  - 500 server error

## Security notes
- Quote view tokens have an expiry (`tokenExpiresAt`). Expired tokens return 403.
- Future hardening: Consider HMAC-signed tokens for quote view URLs to prevent enumeration.

⸻

Public APIs (Widget + Quote View)

POST /api/public/uploads/init

Create upload intent and get signed upload URL(s) for direct upload (PUT).
Request:

{
  "tenantKey": "tnt_abc123",
  "files": [
    { "fileName": "kitchen.jpg", "contentType": "image/jpeg", "sizeBytes": 234234 },
    { "fileName": "spec.pdf", "contentType": "application/pdf", "sizeBytes": 734234 }
  ]
}

Response:

{
  "uploads": [
    { "assetId": "ast_1", "uploadUrl": "https://...", "method": "PUT" },
    { "assetId": "ast_2", "uploadUrl": "https://...", "method": "PUT" }
  ]
}

POST /api/public/quotes

Create quote request (widget submission). Stores submission and enqueues job.
Request:

{
  "tenantKey": "tnt_abc123",
  "serviceId": "svc_cleaning",
  "customer": { "name": "Sam", "email": "sam@email.com", "phone": "+44..." },
  "job": {
    "address": "Optional",
    "postcodeOrZip": "SE1 1AA",
    "answers": [
      { "fieldId": "rooms", "value": 3 },
      { "fieldId": "urgency", "value": "standard" }
    ]
  },
  "assetIds": ["ast_1", "ast_2"],
  "source": { "type": "widget", "pageUrl": "https://client.com/quote" }
}

Response:

{
  "quoteId": "qte_123",
  "status": "queued",
  "quoteViewUrl": "https://app.yourdomain.com/q/qte_123?token=...",
  "tokenExpiresAt": "2026-02-25T12:00:00Z"
}

GET /api/public/quotes/:quoteId

Returns data for hosted quote view page (no auth, token required).
Query or header should include token, v1 uses query for simplicity:
	•	GET /api/public/quotes/qte_123?token=...
Response:

{
  "quoteId": "qte_123",
  "status": "sent",
  "documentType": "instant_estimate",
  "business": { "name": "Acme Services", "logoUrl": "https://..." },
  "customer": { "name": "Sam" },
  "pricing": { "currency": "GBP", "total": 180, "taxLabel": "VAT", "taxAmount": 30 },
  "breakdown": [{ "label": "Base service", "amount": 150 }],
  "notes": { "assumptions": [], "exclusions": [] },
  "validUntil": "2026-02-10",
  "assets": [{ "assetId": "ast_1", "type": "image", "viewUrl": "https://..." }],
  "actions": {
    "acceptUrl": "https://app.yourdomain.com/q/qte_123/accept?token=...",
    "payUrl": "https://app.yourdomain.com/q/qte_123/pay?token=..."
  }
}

T-146 additions to this response:
	•	`review`: `{ "state": "estimate" }` until the business approves, then `{ "state": "quote", "approvedAt": "…" }`. The page reads "This is an estimate based on your photos and details. {business} will review and confirm it." or "Reviewed and confirmed by {business}."
	•	`estimateRange`: `{ "low", "high" }` only on an unreviewed estimate with uncertain quantities. No label.
	•	`provisional` while `pending_review`: only when the engine measured a range. A flat price shows no number until it is approved.
	•	`pricing` NEVER carries `estimate` (grade/label/description), and `takeoff[]` rows carry no `evidence`. Both are business-only (`GET /api/quotes/:id`).
	•	The token may be the current link or the one issued before approval (`quotes.previous_token_hash`). The same applies to accept, decline, feedback, pdf and asset routes.

POST /api/quotes/:quoteId/approve (T-146, dashboard cookie or app Bearer)
The business approves a quote awaiting its review. The quote is marked approved (`approved_at`/`approved_by`) and sent, and the customer is emailed a fresh link. The link they already hold keeps working.
200: `{ "status": "sent", "emailed": true|false, "emailError?" }`
400 `INVALID_STATUS` (not `pending_review`), 400 `NOT_PRICED` (lead held at the plan limit, price it first), 400 `WORDING_NEEDS_EDIT` (T-148: the unedited generated wording has banned customer words that only deleting the scope would remove; edit it first), 409 `ALREADY_SENT` (a second tap), 404 for another tenant's quote.
T-148: approving an unedited quote (`version` 1) first removes banned customer words from its generated wording and saves the result (`content_json`, plus `pricing_trace_json.wordingRepair`). An edited quote is sent as written.
`PATCH /api/quotes/:id` with `sendToCustomer: true` also counts as approval. A held quote's first send emails "Your quote from …", not "Updated quote".

Services: `POST /api/services` and `PATCH /api/services/:id` accept `autoSend: boolean` ("Send automatically", default false) and, from T-147, `holdUntilApproved: boolean` ("Hold until I approve", default false). Both off is the default mode, "Show the estimate, then I confirm it". Setting one clears the other. Unless auto-send is on, the worker holds every quote that would have been sent (`pending_review`) and emails the business "Review and approve: …". Quotes created in the business's own app send no such email.

T-148 customer wording repair:
	•	Every AI-generated text in the public payload (`notes.scopeSummary`, `notes.assumptions[]`, `notes.exclusions[]`, `notes.notes`, `signalRecommendations[].workDescription|costBreakdown|evidence`, `crossServicePricing[].reason|note|extractedDetails[]`) passes `shared/customer-language.ts`. The worker repairs it before storing: one rewrite call when the guard trips, then removal. Text the business typed is kept as written.
	•	`pricing_trace_json.wordingRepair` (`WordingRepairRecord`: path, found, rewriteCalled, rewriteError?, rewritten[], removed[], unresolved[]) is business-only: `GET /api/quotes/:id` and the trace page. The public API never returns it.

T-147 show, then confirm (supersedes the T-146 default; AD-035):
	•	The worker records why a `pending_review` quote is waiting in `quotes.review_hold`: `shown` (default mode: the customer already sees the estimate), `held` (service set to hold, or a quote the business created in its app), `check` (validation, quality gate, send-guard, the service's own review rule, or, from T-148, generated wording the repair could not clean). `NULL` on older rows and plan-limit lead holds. Only `shown` with a price above zero is shown early (`isShownEarly`, `shared/review-mode.ts`).
	•	`GET /api/public/quotes/:quoteId` for a shown-early quote: `status` stays `pending_review`; `review` is `{ "state": "estimate", "confirmationPending": true }`; `pricing`, `breakdown`, `takeoff` and `notes` (scope, assumptions, exclusions) carry the real figures; `estimateRange` is present only when the engine measured a range; no `provisional`; `acceptQuoteEnabled` is `false`. Every other `pending_review` quote is returned exactly as under T-146 (pricing zeroed, `provisional` only for a measured range).
	•	Viewing never moves a quote off `pending_review`. The first view after approval still records `sent` → `viewed`, even if the customer opened the estimate earlier.
	•	`POST /api/public/quotes/:quoteId/accept` returns 400 `INVALID_STATUS` until the business approves.
	•	`POST /api/public/quotes/:quoteId/feedback` accepts `feedbackType: "feedback"` (Ask a question) on a shown-early quote and leaves the status at `pending_review`. `approval_request` is still 400 there.
	•	After `POST /api/quotes/:quoteId/approve` the same link returns `review.state = "quote"` with `acceptQuoteEnabled` back to the tenant setting.
	•	Emails: a shown-early quote sends the customer "Your estimate from {business}" at once (worker, Postmark tag `estimate-customer`), saying the business will confirm. "Your quote from {business}" still goes on approval. The business "Review and approve" email is unchanged.

POST /api/public/quotes/:quoteId/accept

Marks quote accepted.
Request:

{ "token": "..." }

Response:

{ "status": "accepted", "acceptedAt": "2026-01-25T12:00:00Z" }

POST /api/public/quotes/:quoteId/pay/init

Creates Stripe checkout session if enabled and returns Checkout URL.
Request:

{ "token": "..." }

Response:

{ "checkoutUrl": "https://checkout.stripe.com/..." }


⸻

Dashboard APIs (Tenant + Config + Quotes)

GET /api/me

Returns current user and tenant context.
Response:

{ "userId": "usr_1", "tenantId": "tnt_1", "role": "admin" }

GET /api/tenant

Tenant settings summary.
Response:

{
  "tenantId": "tnt_1",
  "name": "Acme Services",
  "currency": "GBP",
  "tax": { "enabled": true, "label": "VAT", "rate": 0.2 },
  "serviceArea": { "mode": "postcode_allowlist", "values": ["SE1", "SE2"] }
}

PUT /api/tenant

Update tenant settings (currency, tax, service area).
Request:

{
  "currency": "GBP",
  "tax": { "enabled": true, "label": "VAT", "rate": 0.2 },
  "serviceArea": { "mode": "county_state", "values": ["Kent"] }
}

Response:

{ "ok": true }

T-152 simpler dashboard:
	•	`PUT /api/tenant` accepts `pricesChecked: true` (the business confirmed its prices: setup's "These are my prices", or saving a service on Prices). It stamps `tenants.prices_checked_at`, which ticks "Check your prices" on Home. Nothing else sets it.
	•	`GET /api/billing` `usage.per`: `month` (a live plan, or the legacy GB 50 a month) or `total` (the free allowance: 10 priced quotes in total, never resets). With `total`, `estimatesCreated` is the sum over every month and `heldLeads` counts all held leads, not just this month's. Other fields unchanged.
	•	The plan limit (`checkPlanLimit`, used by `POST /api/public/quotes`, the WhatsApp/SMS intake and `POST /api/quotes/:id/process`) reads the same rule; its result carries `per`. Tests (T-150) and unfinished requests (T-151) still never increment the counters. Over the allowance → the T-134 lead hold.
	•	`GET /api/tenant/branding` also returns `region` (for the Branding placeholders).
	•	Dashboard URLs: `/app/services` → `/app/prices`, `/app/branding` → `/app/settings/branding`, `/app/billing` → `/app/settings/billing` (307, query kept). Stripe checkout and portal now return to `/app/settings/billing`. The mobile app API (`/api/app/*`) is unchanged.

T-151 customer flow:
	•	Contact rules (`lib/contact-rules.ts`, per business `tenants.contact_requirement`: `email` (default; phone optional) | `phone` (email optional) | `both`). A name is always required. Enforced by `POST /api/public/leads`, `POST /api/public/quotes` (replaces the old "name and email are required"; 400 `VALIDATION_ERROR` with `fields`) and the chat completion check. `PUT /api/tenant` accepts `contactRequirement`; `GET /api/tenant` returns it. `GET /api/public/widget/config` returns `contactRequirement` and `region.phoneExample` / `region.phoneHint`.
	•	`POST /api/public/leads` `{ tenantKey, serviceId, customer{name,email?,phone?}, turnstileToken?, website?, testToken?, source? }` → `{ leadId, leadToken }`: an unfinished request, saved when the contact step is done. Rate limit scope `leads` (20/min/IP, 300/min/tenant), Turnstile and honeypot as for submission. No AI, no usage. A valid `testToken` → `{ skipped: true }` and no row; an invalid one → 403.
	•	`PATCH /api/public/leads/:leadId` `{ tenantKey, leadToken, progress: contact|questions|photos|details, answers?, postcode?, assetIds? }` → `{ ok: true }`. Only the token holder, only while unfinished (404 otherwise); progress never moves back; answers are bounded plain values.
	•	`POST /api/public/quotes` accepts `leadId` + `leadToken`. On success the lead is closed (`quote_id`, `completed_at`), and so is any other open lead for the same customer (email or phone) and service from the last 24 h, so a reload can't leave a duplicate. A service with no questions of its own needs a non-empty `_project_description` (400 "Please describe the job."); with questions it is optional. WhatsApp/SMS intake don't apply this rule.
	•	`GET /api/leads?days=30` (dashboard) → `{ items: [{ leadId, customerName, customerEmail, customerPhone, serviceName, progress, progressLabel, answerCount, photoCount, postcode, createdAt, lastActiveAt }] }`: unfinished only, own tenant.
	•	`POST /api/public/quotes/:quoteId/accept` accepts `details: { timing: asap|two_weeks|flexible, timingNote?, address, phone }` (all but the note required when `details` is sent; 400 with `fields`). Saved as `quotes.acceptance_json` and included in the business's acceptance email. A request without `details` (a page opened before T-151) accepts as before.
	•	`GET /api/public/quotes/:quoteId` returns `customer.phone` (the link holder's own number, to confirm on accept). `GET /api/quotes/:quoteId` now also returns `review_hold`, `is_test` and `acceptance_json`.
	•	`quote_requests.customer_email` is nullable (phone-only requests). Customer emails (worker estimate/quote emails, approve, edit-and-send, reminders) are skipped when there is no address; `POST /api/quotes/:id/resend` → 400 `NO_EMAIL` ("Text them the link instead").

T-150 setup and test requests (dashboard cookie or app Bearer; tenant from the signed-in user):
	•	`PUT /api/tenant` also accepts `trade` (a vertical pack id, `"other"`, or null) and `tradeOther` (≤ 200 chars, kept only when `trade` is `"other"`). An unknown trade → 400 `INVALID_INPUT`.
	•	`POST /api/onboarding/test-link` → `{ "url": "<origin>/quote/<slug>?test=<token>", "issuedAt", "expiresAt" }`. The token is an HMAC over the tenant id and a 2-hour expiry (key: `TEST_QUOTE_SECRET`, else derived from the service-role key). 401 when logged out.
	•	`GET /api/onboarding/test-quote?since=<ISO>` → `{ "quote": null }` or `{ "quote": { id, status, serviceName, currency, subtotal, taxAmount, taxLabel, total, lines[{label, amount}], scopeSummary } }`: the tenant's latest test request since the link was issued.
	•	`POST /api/onboarding/skip` → `{ "ok": true }`. Sets `tenants.onboarding_skipped_at`; `/app` stops redirecting to setup.
	•	`POST /api/public/quotes` accepts `testToken`. Valid for this tenant's key → the quote is created with `quotes.is_test = true`, skips the plan limit and lead hold, and is never counted (`estimates_created` in the web app, `estimates_sent` in the worker) or metered. Invalid, expired or another tenant's → 403 `TEST_LINK_INVALID`. More than 10 test requests per tenant in 24 h → 429 `TEST_LIMIT_REACHED`. Any `test` / `isTest` / `is_test` key a client puts in `source` is stripped.
	•	`GET /quote/:slug?test=<token>` shows a "Test mode" note when the token is valid for that tenant (an invalid one is ignored), and doesn't set the first-visit flag.
	•	`GET /api/quotes` items carry `isTest`. `GET /api/billing` returns `selectedPlanId` (the plan picked on the pricing page; pre-selection only, never checkout).

T-149 quote link (dashboard cookie or app Bearer; tenant from the signed-in user):
	•	`GET /api/tenant/slug[?check=<slug>]` → `{ "slug", "changeable", "check?": { "slug", "available", "reason?", "message?" } }`. `reason`: `too_short` | `too_long` | `invalid_characters` | `reserved` | `taken` (another business's current or former slug).
	•	`PUT /api/tenant/slug` `{ "slug" }` → `{ "slug", "changeable": false }`. Allowed once. 400 `INVALID_SLUG`, 409 `SLUG_TAKEN`, 409 `ALREADY_CHANGED`. The old slug goes to `tenant_slug_history`: it keeps redirecting and can never be taken by anyone else. Writing `tenants.slug` directly is refused by a DB trigger (only the service role may change it).
	•	`POST /api/tenant/share-event` `{ "event": "copied" }` → `{ "ok": true }`. Sets `tenants.quote_link_copied_at` once (home checklist).

Public page `GET /quote/:slug` (T-149): the business's hosted quote page, rendering the same widget as `/embed/:tenantKey` (AD-024), so submissions go through `POST /api/public/quotes` with that tenant's key under the same rate limits, Turnstile and honeypot. 200 for a current slug with an active site; 308 to `/quote/<current>` for a former slug; 404 for unknown, malformed or inactive. Rate limit scope `quote_page` (60/min/IP). The first view sets `tenants.quote_link_first_visit_at`. `/embed/:tenantKey`, `widget.js` and `iframe-loader.js` are unchanged.

CRUD /api/services

Create and manage services.
Service object:

{
  "serviceId": "svc_1",
  "name": "Patio Cleaning",
  "active": true,
  "documentTypeDefault": "formal_quote"
}

PUT /api/services/:serviceId/pricing

Pricing config for a service.
Request:

{
  "baseFee": 50,
  "minimumCharge": 80,
  "addons": [
    { "addonId": "seal", "label": "Sealing", "price": 60 }
  ],
  "multipliers": [
    { "when": { "fieldId": "dirtLevel", "equals": "heavy" }, "multiplier": 1.25 }
  ]
}

Response:

{ "ok": true }

CRUD /api/widget-config

Widget fields and file rules.
Request:

{
  "fields": [
    { "fieldId": "rooms", "type": "number", "label": "Number of rooms", "required": true }
  ],
  "files": { "minPhotos": 2, "maxPhotos": 8, "maxDocs": 3 }
}

Response:

{ "ok": true }

GET /api/quotes

List quotes for dashboard. Response includes status and key timestamps.
Response (example):

{
  "items": [
    {
      "quoteId": "qte_123",
      "serviceName": "Patio Cleaning",
      "status": "sent",
      "createdAt": "2026-01-25T10:00:00Z",
      "sentAt": "2026-01-25T10:02:00Z",
      "viewedAt": null,
      "acceptedAt": null,
      "paidAt": null,
      "total": 180,
      "currency": "GBP"
    }
  ],
  "nextCursor": null
}


⸻

Billing and Webhooks

POST /api/stripe/webhook

Stripe webhook handler for subscription and payment events.
Notes:
	•	Verify Stripe signature
	•	Update subscriptions and quotes.paidAt where relevant
Response:

{ "received": true }


⸻

WhatsApp APIs (v2 ticketed, define now)

POST /api/whatsapp/webhook

Receives inbound messages and media events from WhatsApp Cloud API.
Response:

{ "received": true }

POST /api/whatsapp/send

Sends outbound message with quote link (and optionally summary).
Request:

{
  "tenantId": "tnt_1",
  "toPhone": "+44...",
  "message": "Your estimate is ready",
  "quoteViewUrl": "https://app.yourdomain.com/q/qte_123?token=..."
}

Response:

{ "ok": true }

⸻

Business app APIs (T-137)

Auth: `Authorization: Bearer <signed-in user's Supabase access token>`. Every dashboard API (e.g. `GET /api/quotes`) also accepts it.
The app uses the widget's public `GET /api/public/widget/config?tenantKey=` and `POST /api/public/uploads/init` with the tenant key from bootstrap.

GET /api/app/bootstrap
200: `{ "tenantName": "…", "tenantKey": "tkey_…", "currency": "USD", "region": { "code": "US", "locale": "en-US", "postalCodeLabel": "ZIP code" } }`
409 `NO_SITE` when the tenant has no active widget site (the app uses the widget's form).

POST /api/app/quotes
Request: `{ "serviceId", "customer": { "name", "email", "phone?" }, "job?": { "address?", "postcodeOrZip?", "answers": [{ "fieldId", "value" }] }, "assetIds?": [] }`
Same intake as `POST /api/public/quotes` (field and photo validation, plan limits, queue), without bot checks or the AI service match. `source_json = { "type": "app", "userId" }`.
200: `{ "quoteId", "status": "queued", "quoteViewUrl", "tokenExpiresAt" }`. The app keeps `quoteViewUrl` (and its token) on the device.

GET /api/app/quotes/:quoteId
200 `AppQuoteView`: `{ id, status, businessName, serviceName, customerName, createdAt, pricing: { total, currency, estimate? }, takeoff: [], questions: [] }`. `questions` is non-empty only while `awaiting_clarification`. 404 for another tenant's quote.

POST /api/app/quotes/:quoteId/answers
Request: `{ "answers": [{ "questionId", "answer" }], "quoteToken?": "…" }`
The business confirms on site: answers merge as confirmed form answers and the quote reprices deterministically (same path as the customer's clarify). `quoteToken` is forwarded to the worker only when it matches the stored hash (needed to email the customer their link). Measurement examples are recorded (T-123).
400 `INVALID_STATUS` unless `awaiting_clarification`; 404 for another tenant's quote.

