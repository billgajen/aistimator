# /docs/01-architecture.md

## High level components
- Next.js app (on Vercel)
  - Marketing site
  - Auth pages
  - Dashboard
  - Hosted quote view pages
  - API routes (all except queue consumer)
- Cloudflare Worker (queue consumer)
  - Processes async quote generation jobs from Cloudflare Queue
  - Runs AI extraction and rules engine
  - Updates quote status in Supabase
- Cloudflare Queues
  - Asynchronous quote generation jobs
- Upstash Redis
  - Global rate limiting
  - Per tenant throttling
- Supabase
  - Auth
  - Postgres data store with RLS
- Cloudflare R2
  - Private storage for uploads and generated PDFs
- AI provider
  - Gemini 1.5 Flash: vision extraction + wording generation
- PDF generation
  - DocRaptor API (external service)
- Email provider
  - Postmark

## Data flow: website widget to quote
1) Customer opens business website and launches embed widget.
2) Widget collects answers plus photos and documents.
3) Widget uploads files to Vercel API, receives file ids.
4) Widget submits quote request payload to Vercel API.
5) Vercel API stores submission and enqueues job to Cloudflare Queue.
6) Cloudflare Worker (queue consumer) runs:
   - fetch submission from Supabase
   - run Gemini 1.5 Flash vision extraction on images to produce signals JSON
   - run rules engine using tenant pricing config to compute price and breakdown
   - generate wording (scope summary, notes) via Gemini 1.5 Flash
   - generate hosted quote page data
   - send HTML to DocRaptor API, store returned PDF in R2 (optional toggle)
   - send emails via Postmark and mark quote status
7) Customer receives link to hosted quote page.
8) Customer views, accepts, and optionally pays deposit.

## Key architecture decisions
- All AI calls are asynchronous behind a queue.
- All public endpoints are rate limited via Upstash Redis.
- Tenant config is cached where safe, but never shared across tenants.
- Hosted quote page is the primary output; PDF is optional.
- Hybrid hosting: Vercel for Next.js (simplicity, DX), Cloudflare for queue consumer (cost, reliability).

## Scalability approach
- Queue smooths spikes.
- Upstash Redis enforces global rate limits and per-tenant fairness.
- AI calls use retries with exponential backoff.
- If provider limits are hit frequently:
  - request higher quotas
  - degrade gracefully by returning a range and requesting review

## Security boundaries
- Widget endpoints are public but rate limited and spam protected.
- Quote view pages use unguessable ids or signed tokens with expiry.
- Dashboard endpoints require Supabase auth JWT.
- R2 objects are private; access via signed URLs or API proxy.

## Observability (v1)
- Structured logs from Vercel and Cloudflare Workers.
- Basic metrics counters: quotes created, jobs processed, errors.
- Error reporting via a lightweight service or logs.
