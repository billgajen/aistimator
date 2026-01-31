# /docs/00-v1-scope.md

## v1 goal
Ship a compact SaaS that a business can:
1) Sign up and configure pricing, service area, tax, branding, and template toggles.
2) Embed a widget on their website via snippet (and optionally iframe).
3) Receive customer submissions with photos and documents.
4) Generate a professional quote package delivered via hosted quote page (mandatory) and optional PDF.
5) Track basic customer activity: created, viewed, accepted, paid (if payments enabled).

## Tech stack summary
- Next.js on Vercel (frontend + API routes)
- Cloudflare Workers + Queues (async quote processing)
- Upstash Redis (rate limiting)
- Supabase (auth + database)
- Cloudflare R2 (file storage)
- Gemini 1.5 Flash (AI vision + wording)
- DocRaptor (PDF generation)
- Postmark (email)
- Stripe (payments)

## In scope for v1
### Core surfaces
- Marketing site: signup, login, pricing, help, demo section, legal
- Dashboard: onboarding, config, billing, quotes list, basic analytics
- Hosted quote page: no login, mobile friendly, accept and pay actions

### Widget
- Embed snippet for website
- Intake form with configurable fields
- Photo upload plus document upload
- Basic validation and guidance
- Test mode and preview

### Pricing and configuration
- Services and pricing rules per tenant
- Base fee, minimum charge, add ons, multipliers
- Global tax setting (generic tax name and rate, supports VAT, GST, sales tax)
- Service area restrictions by:
  - postcode or zip allowlist
  - county or state region selection (simple)

### Quote outputs
- Hosted quote page (mandatory)
- PDF generation via DocRaptor API (one template, with toggles)
- Document type options (limited in v1 UI):
  - Instant estimate
  - Formal quote
  - Proposal and SOW are stored as types but templates can be minimal initially

### Workflow
- Email customer and business with quote link
- Customer can accept quote
- Optional payment link (Stripe) and record paid status

### Basic analytics
- Quotes created
- Quote viewed
- Quote accepted
- Payment initiated and paid (if enabled)
- Plan usage counter (estimates per month)

### Reliability
- Queue based generation
- Global rate limiting and per tenant throttles
- Retries with backoff on rate limit errors

## Out of scope for v1
- Multi language output
- Full CRM integrations (Zapier, webhooks)
- Advanced proposal builder with rich sections and case studies
- Complex scheduling or dispatch systems
- Multi seat roles and permissions beyond basic admin
- Deep compliance tooling beyond basic policies and disclaimers
- Fully native quoting inside WhatsApp chat as the core channel

## v1 definition of done
- A non technical business can configure, embed, test, go live, and generate quotes.
- The quote page looks professional and is consistent.
- The system is stable under moderate load and protects against abuse.