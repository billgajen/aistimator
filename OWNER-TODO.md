# Owner TODO

Things only the owner can do: keys, accounts, real devices, real photos, prices.
Each item names the ticket, what is needed, and exactly where it goes.
Code for every item is already built; these are the steps that unlock it.

## T-133 — Region layer + US localisation

- [ ] **Apply migration 26 to production BEFORE deploying the web app or worker.**
  The new code selects `tenants.region`, `tenants.unit_system` and `services.tax_exempt`;
  without the migration, quote processing fails. File:
  `supabase/migrations/00000000000026_region_layer.sql` (backfills every existing tenant to `GB`).
  Use the same management-API route as migrations 24–25 (`scripts/deploy-migrations-24-25.sh` pattern).
- [ ] **Review the US painting pack rates.** Every number marked `TODO-OWNER` in
  `apps/web/src/lib/vertical-packs/painting-us.ts` is a placeholder (e.g. $375/room,
  $2.50/sq ft exterior, $1,200 exterior minimum). Replace with figures you are happy to show
  US businesses as starting defaults.
- [ ] **Real US photos for the US measurement check.** `scripts/hardcore-test/verify-t133.mjs`
  currently measures the UK S01 house photos as if it were a US job. Drop photos of a US
  house front (siding, 80 in front door visible) into a new gitignored folder
  `test-assets/hardcore/US-painting/` and point the script's `collectAssets(...)` path at it.
- [ ] **Check one US PDF and one US email by eye** once DocRaptor and Postmark keys are set
  (`DOCRAPTOR_API_KEY`, `POSTMARK_API_TOKEN` in Vercel env). Expect `$`, "Sales tax" and US date order.
  Code paths: `apps/web/src/lib/pdf-template.ts`, `apps/worker/src/email/index.ts`.

## T-135 — AI model registry + routing

- [ ] **Optional: an Anthropic API key** to try Claude for adjudication or identification. Set
  `ANTHROPIC_API_KEY` in the worker (`wrangler secret put ANTHROPIC_API_KEY`) and, to switch,
  `AI_MODEL_ADJUDICATION=anthropic:<model-id>`. The adapter is unit-tested but has never run live.
- [ ] **Deploy before 1 December 2026** — follow `DEPLOY.md` step by step (Queues chosen; Workers Paid done 2026-11-08). Google reroutes `gemini-2.5-flash` to `gemini-3.5-flash-lite`
  that day; the new defaults move every task off 2.5 explicitly. Until this deploys, production runs
  the old defaults.
- [ ] **Budget for the January price change.** `gemini-3.8-flash` goes from $0.75/$3.75 to
  $1.50/$7.50 per 1M tokens on 1 January 2027 (Google pricing page). Update the `prices` block in
  `packages/shared/src/ai-models.json` then.

## T-136 — SMS channel (Twilio)

- [ ] **Create the Twilio account** and set `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` in Vercel env
  (web app). Without both, the platform stays in test mode and never sends a text.
- [ ] **Buy a US number** for the first beta business and enter it at `/app/sms`.
- [ ] **Register A2P 10DLC** (brand with legal name + EIN, then a campaign on a Messaging Service) in the
  Twilio Console, and paste the Messaging Service SID at `/app/sms`. US carriers block unregistered
  business texting at volume.
- [ ] **Point the number's "A message comes in" webhook** to `https://<your-domain>/api/sms/webhook` (HTTP POST).
- [ ] **Apply migration 27** (`supabase/migrations/00000000000027_sms_channel.sql`) to production.
- [ ] **Live test from a real phone:** text the number, send a photo by MMS, reply "yes", open the link;
  then text STOP and confirm the dashboard "Text link" refuses to send.

## T-134 — Subscription-only USD plans

- [ ] **Confirm the plan numbers** in `packages/shared/src/plans.ts` (every `TODO-OWNER`): Starter $49/50
  quotes, Pro $99/200 (14-day trial), Business $199/600, annual = two months free, and the US pre-trial
  allowance of 10 test quotes (`NO_SUBSCRIPTION_LIMIT.US`).
- [ ] **Create the Stripe test products and prices:**
  `cd apps/web && STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/stripe-setup-plans.mts`, then paste the
  printed `STRIPE_PRICE_*` lines into Vercel env.
- [ ] **Enable the Stripe Customer Portal** (Settings → Billing → Customer portal): allow switching between
  the three products, proration on, cancellation at period end.
- [ ] **Apply migration 28** (`supabase/migrations/00000000000028_us_plans.sql`) to production.
- [ ] **Run the test-mode journey:** start the Pro trial (test card 4242…), let it convert (or end the
  trial in the dashboard), upgrade to Business, downgrade to Starter — check `/app/billing` follows each step.

## Production smoke test (2026-11-08)

- [ ] **Postmark: add DKIM and Return-Path DNS records** for the sending domain, then request account approval
  (Postmark → Sender Signatures / Domains). Until it's approved, Postmark only delivers to addresses on the
  From domain. The GB smoke test's business notification to a gmail address was rejected. **Do this before beta.**
- Engineering backlog from the smoke test (not owner work; listed so it isn't lost, details in CHANGELOG
  2026-11-08): internal notes shown to customers, raw unit labels,
  "worth considering" duplicating scope items, clarification page + email styling, "Powered by Estimator" name.
- [x] **Disagreement path decided 2026-11-09:** both. The reviewer gets the scope answers and a 30 s cap (CHANGELOG 2026-11-09).

## T-139 — Identification signals (nameplate reading)

- [ ] **Real nameplate photos** for the accuracy check: 5–10 photos of real equipment rating plates
  (AC condensers, furnaces, water heaters; some sharp, some angled/glared/worn) into a new gitignored folder
  `test-assets/hardcore2/T140-nameplates/`, with the true capacity/fuel for each in a `truth.json` next to
  them. The engine is built and verified only on synthetic renders; T-140 brings the real decode tables.

## T-140 — HVAC + water heater packs

- [ ] **Review the rates** in `apps/web/src/lib/vertical-packs/hvac-us.ts` and `water-heater-us.ts`: every number marked
  `TODO-OWNER` is a placeholder (e.g. 3-ton AC system $5,000 + $450 removal; 50 gal tank $1,450 + $450 gas connection;
  attic ×1.12–1.2).
- [ ] **Check the decode rules against real plates** (same photo folder as T-139 above). The rules read a printed tonnage,
  a "0xx" BTU code in the model number, the furnace INPUT line, the capacity line and the fuel wording. Brands whose
  model numbers don't carry a "0xx" code (some Carrier and Rheem formats) fall back to the model's reading plus a customer
  confirmation. Tell me which brands your customers have most, and I'll add their schemes.

## T-141 — Plumbing, electrical, garage door packs

- [ ] **Review the rates** in `apps/web/src/lib/vertical-packs/{plumbing-us,electrical-us,garage-doors-us}.ts` (all `TODO-OWNER`),
  e.g. 200 A panel $2,600, EV install $1,150 + $18/ft past 25 ft, toilet $325 + $275 supplied, double door $1,950.
- [ ] **One real panel-label photo** (inside the door, or the main breaker) to check the amperage reading, same folder as T-139.

## T-137 — Business mobile app

- [ ] **Try it on your iPhone** (no Xcode needed): install **Expo Go** from the App Store, then on the Mac
  `cd apps/mobile && cp .env.example .env` (fill `EXPO_PUBLIC_API_URL` with the Mac's LAN address, e.g.
  `http://192.168.1.20:3000`, and the Supabase URL/anon key) and run `npx expo start`; scan the QR code.
  Check: sign in, new quote with camera photos, price appears, confirm a question, share the link.
- [ ] **Apple Developer account** ($99/yr) and an EAS project (`npx eas init`) before TestFlight. T-138 (LiDAR) needs a
  development build, not Expo Go, because it adds native code.
- [ ] The app needs the business's widget site set up (it reuses the widget's form). Without one it says so.

