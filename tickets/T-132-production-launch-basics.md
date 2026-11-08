# tickets/T-132-production-launch-basics.md

## Goal
Make production real: email on, live payments ready, a database that doesn't pause,
async queue processing, and a custom domain. Most steps are manual dashboard work; the
code work is checks and guards.

## In scope
- **Manual (owner):** Postmark server token and sender domain (DKIM/SPF); Stripe live
  keys and live webhook; Supabase paid plan; Cloudflare Workers Paid with Queues
  enabled; custom domain on Vercel (brand/domain decided by owner).
- **Code:** a startup env validator for web and worker that fails loudly and lists any
  missing required secret (no silent "emails off").
- **Code:** turn async processing back on in production (`SYNC_QUOTE_PROCESSING=false`
  plus a Queues binding in `wrangler.toml`). Verify the queue consumer path end to end,
  including retries and the rate limiter.
- **Code:** a health endpoint (`/api/health`) that reports DB, R2, queue, Postmark and
  Stripe reachability. No secrets in the output.
- **Code:** replace every hardcoded production URL or domain with an env var.
- Update the README "Production" section with the final setup.

## Out of scope
- Any pricing, AI or UX change.

## Progress
- 2026-11-08: async processing built and verified locally (queue bindings, one quote per invocation,
  retry fix, token auth on worker job endpoints, preparing state in widget + quote page). Production
  rollout is in `DEPLOY.md`. The live criterion below is ticked after the smoke test.

## Acceptance criteria
- [ ] Missing env vars produce a clear startup error naming each one
- [ ] A live quote submission is processed via the queue (not sync) and emails the customer and the business
- [ ] A Stripe live-mode test checkout completes, and the webhook updates the tenant plan
- [ ] `/api/health` is green in production
- [ ] The custom domain serves the app, widget.js and quote pages over HTTPS
- [ ] CHANGELOG updated with the production topology
