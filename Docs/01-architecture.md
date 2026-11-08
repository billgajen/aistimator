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
5) Vercel API stores submission and enqueues the job: `POST {worker}/trigger` with
   `Authorization: Bearer CLOUDFLARE_WORKER_TOKEN` (the worker rejects job requests without it).
   The request returns with status `queued`; the widget and the hosted quote page show
   "Preparing your estimate" and poll until the quote settles.
   (`SYNC_QUOTE_PROCESSING=true` instead calls `/process` and waits — local dev default.)
6) Cloudflare Worker (queue consumer, one quote per invocation, 3 retries then `failed`) runs:
   - fetch submission from Supabase
   - fetch the photos once, then in parallel: vision extraction to signals JSON (model per
     task from `packages/shared/src/ai-models.json`) and the measurement passes for
     photo-measured quantities (passes run together; when the first two agree within the CoV
     threshold the third is cancelled). Quantities the customer already stated are not measured.
     Senior adjudication only on disagreement, thin evidence, or a line worth ≥
     `ADJUDICATION_VALUE_THRESHOLD` (default 2500)
   - recommendations, wording and cross-service detection run in parallel, then validation
   - if the quote needs a customer answer, it stops at `awaiting_clarification` with the
     provisional range and saves a reprice snapshot (first-pass AI outputs in `signals_json._reprice`)
   - per-stage timings and AI calls per task are stored in `pricing_trace_json.timings` / `.aiUsage`
   - run rules engine using tenant pricing config to compute price and breakdown
   - generate wording (scope summary, notes)
   - generate hosted quote page data
   - send HTML to DocRaptor API, store returned PDF in R2 (optional toggle)
   - send emails via Postmark and mark quote status
7) Customer receives link to hosted quote page.
   If a question was asked, the clarify API calls `POST {worker}/reprice` (bearer token) and
   waits: a deterministic reprice from the snapshot plus the answers, with no AI calls and no
   photo reads (~0.1–0.3 s). Quotes without a snapshot (409) go through `/trigger` as before.
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
