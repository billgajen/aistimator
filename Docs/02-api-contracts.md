# /docs/02-api-contracts.md

## Conventions
- Base prefix: `/api`
- Hosting: All API routes run on Vercel (Next.js API routes), except the queue consumer which runs on Cloudflare Workers
- JSON only. `Content-Type: application/json`
- Auth (dashboard APIs): `Authorization: Bearer <supabase_jwt>`
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
