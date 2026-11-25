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
     `ADJUDICATION_VALUE_THRESHOLD` (default 2500). The reviewer is given the customer's
     answers (they define the scope) and is capped at `ADJUDICATION_TIMEOUT_MS` (default 30 s);
     past the cap the pass median stands and the customer is asked to confirm it
   - T-172: the wording, add-on detection and checker calls are capped too, in one place
     (`apps/worker/src/ai/timeouts.ts`: 30 s, 20 s and 30 s; env `AI_TIMEOUT_WORDING_MS`,
     `AI_TIMEOUT_ADDONS_MS`, `AI_TIMEOUT_CHECKER_MS`; 0 = no cap). Past its cap a call is treated
     as a failed call: template wording, no AI-detected add-ons, or an unchecked quote. None of
     them can touch a price.
   - T-139: for expected signals with an `identify` spec, a label-reading call (task
     `identification`, 25 s cap) runs alongside; it transcribes nameplates and the pack's decode
     rules produce the value (AD-032). Identified values select steps via `triggerSignal`; they
     grade B until confirmed, and unknown ones are asked (with the allowed values as options)
   - recommendations, wording and cross-service detection run in parallel, then validation
     (the AI quote checker). The checker flags, it never corrects (T-166, AD-049): it is given a copy of
     the priced quote and its findings can only hold the quote for the business to review
   - if the quote needs a customer answer, it stops at `awaiting_clarification` with the
     provisional range and saves a reprice snapshot (first-pass AI outputs in `signals_json._reprice`)
   - per-stage timings and AI calls per task are stored in `pricing_trace_json.timings` / `.aiUsage`
   - T-203: every AI call waits for a busy provider (about 2, 5, 10 s, honouring Retry-After) and is then
     sent to the task's overflow model if it has one (`ai/busy.ts`; the registry's `overflow`). A run in
     which a call was busy on every provider saves nothing: it stops at a checkpoint and the job is put back
     (60, 90, 120 s) without using a real try, at most 10 times and 15 minutes from arrival, then the quote
     is marked failed as usual (AD-095, AD-096)
   - run rules engine using tenant pricing config to compute price and breakdown
   - generate wording (scope summary, notes)
   - generate hosted quote page data
   - send HTML to DocRaptor API, store returned PDF in R2 (optional toggle)
   - send emails via Postmark and mark quote status
7) Customer receives link to hosted quote page.
   If a question was asked, the clarify API calls `POST {worker}/reprice` (bearer token) and
   waits: a deterministic reprice from the snapshot plus the answers, with no AI calls and no
   photo reads (~0.1–0.3 s). Quotes without a snapshot (409) go through `/trigger` as before.
   T-204: the dashboard's "Test Your Pricing" is the same pipeline in preview mode (`POST {worker}/preview`):
   the service as the editor holds it, sample answers, no AI, no photos, nothing written. The web app never
   adds up a price of its own (AD-097).
   T-204: a photo reading that fails (error, timeout, unusable answer) no longer lets the quote go out: it is
   held for the business with "Photos could not be read" (AD-098). A provider that is only busy is T-203.
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
