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
400 `INVALID_STATUS` (not `pending_review`), 400 `NOT_PRICED` (lead held at the plan limit, price it first), 409 `ALREADY_SENT` (a second tap), 404 for another tenant's quote.
`PATCH /api/quotes/:id` with `sendToCustomer: true` also counts as approval. A held quote's first send emails "Your quote from …", not "Updated quote".

Services: `POST /api/services` and `PATCH /api/services/:id` accept `autoSend: boolean` ("Send automatically without review", default false). With it off, the worker holds every quote that would have been sent (`pending_review`) and emails the business "Review and approve: …". Quotes created in the business's own app send no such email.

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

