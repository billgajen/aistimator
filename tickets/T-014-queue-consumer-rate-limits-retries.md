# tickets/T-014-queue-consumer-rate-limits-retries.md

## Goal
Create queue consumer that processes quote jobs with throttling and retries.

## In scope
- Cloudflare Worker queue consumer handler
- Upstash Redis rate limiter:
  - Global limit (e.g., 100 requests/minute across all tenants)
  - Per-tenant limit (e.g., 10 requests/minute per tenant)
  - Implemented using Redis INCR with TTL
- Exponential backoff on 429/provider errors
- Update quote status: generating, failed, sent

## Out of scope
- Multi-provider routing (optional later)
- Advanced monitoring

## Acceptance criteria
- [x] Jobs process successfully under normal load
- [x] Rate limiting prevents bursts from breaking provider quotas
- [x] Per-tenant throttling ensures fairness
- [x] Failed jobs record error and set status `failed`

## Completed
- 2026-01-25: Queue consumer implementation complete
  - Created Upstash Redis rate limiter (`apps/worker/src/rate-limiter.ts`):
    - Sliding window rate limiting using Redis INCR with TTL
    - Global limit (100 req/min default) and per-tenant limit (10 req/min default)
    - Configurable via environment variables
  - Updated queue consumer (`apps/worker/src/index.ts`):
    - Checks rate limits before processing each job
    - Updates quote status: queued -> generating -> sent/failed
    - Exponential backoff on errors (30s, 60s, 120s)
    - Max 3 retries before marking as permanently failed
    - Handles API rate limit errors (429) with longer delays
  - Created Supabase utilities (`apps/worker/src/supabase.ts`):
    - updateQuoteStatus() for status changes
    - getQuoteWithRequest() to fetch quote with related data
    - getQuoteAssets() to fetch associated assets
  - Added HTTP endpoints for testing:
    - GET /health - health check with service status
    - GET /stats - rate limit usage stats
    - POST /trigger - manual job trigger for testing
  - Updated web app queue integration (`apps/web/src/lib/queue.ts`):
    - Sends jobs to worker via HTTP /trigger endpoint
    - checkQueueHealth() and getQueueStats() helpers
  - Updated wrangler.toml with queue bindings and dead letter queue

## Implementation notes
- Use `@upstash/redis` client in the Worker
- Rate limit keys: `ratelimit:global:{minute}` and `ratelimit:tenant:{tenantId}:{minute}`
- Check limits before processing; if exceeded, requeue with delay
