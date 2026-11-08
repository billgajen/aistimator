# Production deploy — us-launch (T-133 → T-136, T-134, queue processing)

**Deadline: before 2026-12-01.** On that day Google reroutes `gemini-2.5-flash` to
`gemini-3.5-flash-lite` (measured at ≈3× the real wall area in T-135) and
`gemini-2.5-pro` to `gemini-3.8-flash`. Production runs the old 2.5 code until this ships.

Production: web `https://estimator-web-phi.vercel.app` (Vercel project `estimator-web`),
worker `https://estimator-worker-production.billgajen.workers.dev`, Supabase `ygsuzeveesgrafgpkrev`.
Run every command from the repo root unless the step says otherwise.

**Why this order:** migration 26 must be in before any new code runs, because the new code selects
`tenants.region`. The new worker **requires** the shared token, so the web app must already send it:
the web deploys first (still in sync mode), then the worker, then the switch to the queue. Production keeps
working at every step.

| # | Step | Touches production |
|---|---|---|
| 0 | Workers Paid | done (owner, 2026-11-08) |
| 1 | Local checks | no |
| 2 | Read-only production checks | read only |
| 3 | Create the two queues | Cloudflare |
| 4 | Migrations 26, 27, 28 | Supabase |
| 5 | Shared worker token | Cloudflare + Vercel env |
| 6 | Other Vercel env vars | Vercel env |
| 7 | Merge to `main` and deploy the web app (still sync) | Vercel |
| 8 | Deploy the worker (queues + token auth) | Cloudflare |
| 9 | Switch to queue processing | Vercel env + redeploy |
| 10 | Smoke test | production data (two test accounts) |

---

## 1. Local checks

```bash
pnpm typecheck && pnpm lint && pnpm -r test && pnpm build
```
Last run (2026-11-08, `us-launch` @ the queue commit): typecheck ✓, lint ✓ (only the existing `<img>`
warnings), tests web 63 ✓ and worker 336 ✓, builds ✓. The queue path was also run end to end locally
(simulated Cloudflare Queue, token auth on): S08 submission **3.3 s** (sync was 78 s), clarify 0.5 s,
consumer priced both runs, £435.54 exact.

## 2. Read-only production checks

```bash
npx vercel env ls production
(cd apps/worker && npx wrangler secret list --env production)
```
Note down:
- Vercel: is `CLOUDFLARE_WORKER_URL` there? (It must be.) Is `CLOUDFLARE_WORKER_TOKEN` there? (It will be replaced in step 5.)
  Are `POSTMARK_API_TOKEN` and `POSTMARK_FROM_EMAIL` there? (Needed by step 9.)
- Either list: **no** `AI_MODEL_*` and **no** `ADJUDICATION_MODEL`. A pin like that overrides the model
  registry. If the worker has `ADJUDICATION_MODEL`, remove it:
  `(cd apps/worker && npx wrangler secret delete ADJUDICATION_MODEL --env production)`

## 3. Create the queues

```bash
(cd apps/worker && npx wrangler queues create quote-jobs && npx wrangler queues create quote-jobs-dlq)
```
Both must print "Created queue". If one says it already exists, that's fine.

## 4. Migrations 26, 27, 28

```bash
bash scripts/deploy-migrations-26-28.sh
```
The script reads the management-API token from the keychain, as for migrations 24–25. It **refuses to run
unless production is at exactly 25**, then applies 26 → 27 → 28 one file at a time and records each in
`supabase_migrations.schema_migrations` straight away. Each file is one transaction, so a failure leaves
that file fully unapplied. Never re-run 27 by hand after it has succeeded: its triggers and policies aren't idempotent.

Expected last line: `region_cols 2`, `gb_tenants` = `all_tenants` (every existing business is backfilled
to GB), `sms_tables 4`, `us_plans 3`, `legacy_active 0`.

## 5. Shared worker token

One line, so the same value reaches both sides:
```bash
T="$(openssl rand -hex 32)"; (cd apps/worker && printf '%s' "$T" | npx wrangler secret put CLOUDFLARE_WORKER_TOKEN --env production) && npx vercel env rm CLOUDFLARE_WORKER_TOKEN production --yes 2>/dev/null; printf '%s' "$T" | npx vercel env add CLOUDFLARE_WORKER_TOKEN production --sensitive --yes; unset T
```
The live worker ignores the secret until step 8, and the live web app ignores the new env until step 7 redeploys it.
Check that `npx vercel env ls production | grep CLOUDFLARE_WORKER_TOKEN` shows it.

## 6. Other Vercel env vars

| Variable | Value |
|---|---|
| `SMS_TEST_MODE` | `true` until Twilio and A2P 10DLC are ready (texts are logged, never sent) |
| `POSTMARK_API_TOKEN`, `POSTMARK_FROM_EMAIL` | **Required before step 9.** Customers who close the widget get their estimate only by email |
| `STRIPE_PRICE_US_{STARTER,PRO,BUSINESS}_{MONTHLY,ANNUAL}_USD` | Optional now: test-mode ids from `apps/web/scripts/stripe-setup-plans.mts`. Without them checkout returns `NO_STRIPE_PRICE`, but the pricing page still renders |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Leave unset (`/api/sms/webhook` returns 503 without them) |
| `SYNC_QUOTE_PROCESSING` | Leave at `true` for now. Step 9 changes it |

Pattern: `printf '%s' 'VALUE' | npx vercel env add NAME production --sensitive --yes`.

## 7. Merge `us-launch` into `main` and deploy the web app (still sync)

```bash
git checkout main && git pull --ff-only
git merge --no-ff us-launch -m "Merge us-launch: region layer, model registry, SMS, US plans, queue processing"
pnpm typecheck && pnpm -r test
git push origin main
```
If Vercel → estimator-web → Settings → Git shows the GitHub repo connected, the push deploys production.
Wait for that deployment to say **Ready**. If not, run `npx vercel deploy --prod` from the repo root.
Then open `https://estimator-web-phi.vercel.app/pricing` and check that it loads.

## 8. Deploy the worker

```bash
(cd apps/worker && npx wrangler deploy --env production)
curl -s https://estimator-worker-production.billgajen.workers.dev/health
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://estimator-worker-production.billgajen.workers.dev/process -d '{}'
```
The deploy output must list `QUOTE_JOBS: quote-jobs` as a producer and `quote-jobs` as a consumer. Expected
results: health returns `"status":"ok"`, and the unauthenticated `/process` returns **401**. Anything else, stop.

## 9. Switch to queue processing

```bash
npx vercel env rm SYNC_QUOTE_PROCESSING production --yes; printf '%s' 'false' | npx vercel env add SYNC_QUOTE_PROCESSING production --yes
npx vercel deploy --prod
```
Leave `(cd apps/worker && npx wrangler tail --env production)` running in a second terminal for step 10.

## 10. Production smoke test

Use two new test accounts (signup defaults to US; the onboarding region picker sets GB). For each one:
onboarding → pick the region → apply the painting pack → Widget page → open the hosted widget link
(`/embed/<tenantKey>`) → submit an exterior job with 2 photos of a house front.

**Queue path** (both quotes)
- [ ] The widget switches to "Preparing your estimate" within a few seconds (no long spinner)
- [ ] `wrangler tail` shows `POST /trigger 200`, then `[Worker] Processing job: quoteId=…, retry=0/3`
- [ ] "Open the estimate page" shows the preparing panel and turns into the estimate without a reload
- [ ] The customer email arrives (Postmark)

**GB painting quote** (`Painting & Decorating (UK)`, region GB)
- [ ] `£`, `VAT` when tax is on, day/month dates, postcode wording, grade seal, takeoff in sqm
- [ ] Breakdown sums to the subtotal, and total = subtotal + tax

**US painting quote** (`Painting (US)`, region US)
- [ ] `$`, `Sales tax`, US date order, ZIP code label in the widget, quantities in sq ft
- [ ] Rates are still the `TODO-OWNER` placeholders. Check the format, not the figures

**Models actually used** (Supabase → SQL editor):
```sql
select id, status,
       pricing_trace_json->'aiUsage'->'byTask' as by_task,
       pricing_trace_json->'aiUsage'->'estimatedCostUsd' as usd
from quotes order by created_at desc limit 2;
```
- [ ] Every `model` is `gemini-3.8-flash` or `gemini-3.1-pro-preview`. **No `gemini-2.5-*`**

**Pricing page** (`/pricing`, signed out)
- [ ] Starter $49, Pro $99, Business $199 a month; annual $490 / $990 / $1,990 ("two months free")
- [ ] The Pro card says 14-day free trial, card required
- [ ] With the Stripe ids set: "Start 14-day trial" opens Stripe test checkout (card 4242 4242 4242 4242)

## Rollback

- **Queue misbehaving:** set `SYNC_QUOTE_PROCESSING=true` and run `npx vercel deploy --prod`. The new worker
  still serves `/process` (with the token). This is the fastest lever, but photo quotes over 60 s will time out again.
- Web: Vercel → Deployments → promote the previous production deployment.
- Worker: `(cd apps/worker && npx wrangler rollback --env production)`. The old worker ignores the token.
- Migrations stay in place. They are additive and the old code ignores the new columns and tables. A full rollback
  puts production on the 2.5 models again, so only do it before 1 December.
