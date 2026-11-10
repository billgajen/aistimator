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
- **Product backlog, added 2026-11-09 (not built; owner-requested, park until scheduled):**
  1. **Document types are cosmetic.** Instant Estimate / Formal Quote / Proposal / Statement of Work change only the
     AI wording tone; price, layout, PDF and title are identical. Give each a real format: Proposal (phases, timeline,
     options), SOW (deliverables, milestones, terms), Formal Quote (full terms and an acceptance block). Until then,
     consider hiding Proposal and SOW from the selector.
  2. **Model comparison for service setup.** Compare `gemini-3.8-flash` vs `gemini-3.1-pro-preview` on the compile and
     service-setup scenarios (AI draft, refine, website extract). Switch only if Pro is clearly better (owner rule: current
     vs one candidate).
  3. **"Test & Publish" preview prices photo-measured quantities at 1** (e.g. 1 m² walls → $18 + minimum top-up), which
     looks broken. Pre-fill a typical value from the pack's plausibility envelope (editable, labelled "from photos —
     sample"), show low / typical / high prices, add a per-quantity source switch (Photos only / Ask customer / Both),
     and an optional "Test with a photo" upload.
  4. **Painting accuracy: fix the photo scale.** Ask the customer for one known measurement (e.g. house width) and use it
     as the measurement anchor, so the wall area doesn't hinge on the door-size assumption.
  5. **"Add service" has no template picker.** Pack templates (`lib/vertical-packs/`) only appear in onboarding
     (`OnboardingFlow.tsx`), so an existing business can't add one later (e.g. an HVAC company adding water heaters).
     Let "Add service" start from any pack template, with the pack's signal specs, questions and `TODO-OWNER` rates
     to review, the same as onboarding. (Owner confirmed 2026-11-09 after the production AC test: "Add service from template".)
  6. **AI-drafted equipment services should price by capacity tiers bound to the identified size**, like the HVAC
     pack. Today the draft prices a replacement as fixed amounts and leaves "ac_tonnage" as an unused signal, so a 2-ton
     and a 5-ton system cost the same. When the service is identify-and-replace, the draft should produce one step per
     size (`triggerSignal` on the identified value) and an `identify` spec, with the rates marked for owner review.
  7. **Review notifications by SMS and push (T-146 follow-up).** "Awaiting your approval" alerts go by email only. SMS
     needs a business mobile number setting (`sms_configs` is the customer-facing number). Push needs
     `expo-notifications`, device tokens and an Apple push key in the mobile app.
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
  model numbers carry neither a "0xx" code nor the ICP/Carrier/Rheem "series digit + size" form (NAC236, added
  2026-11-09 from a real plate) fall back to the model's reading plus a customer confirmation. Tell me which brands your customers have most, and I'll add their schemes.

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

## T-138 — LiDAR room scan

- [ ] **Development build on a LiDAR iPhone** (12 Pro or later Pro model): install Xcode, then
  `cd apps/mobile && npx expo run:ios --device` (or `npx eas build --profile development --platform ios`).
  Expo Go can't load the native RoomPlan module; the app hides the scan button there.
- [ ] **Accuracy check:** scan 2–3 real rooms, tape-measure them, and send me the numbers. I need to confirm the floor
  outline axes (the server falls back to width × length if they're wrong) and the net wall area.

## T-143 — Final invoice + accuracy

- [ ] **Apply migration 29** (`supabase/migrations/00000000000029_final_invoice.sql`) to production **before** deploying the web
  app. Additive and re-runnable.
- [ ] During beta, ask each business to record the final invoice on finished jobs (quote page → Final invoice). The Analytics
  "Estimate accuracy" panel is the beta success metric (median error < 10%, ≥ 80% within ±10%).

## T-144 — US marketing + Meta

- [ ] **Read the six trade pages** (`/trades`, and `/painting`) and adjust any claim you don't want to make. Copy lives in
  `apps/web/src/lib/marketing/trades.ts`.
- [ ] **When you're ready to advertise** (Docs/09: after 10–20 paying US businesses): create the Pixel in Meta Events Manager
  and set `NEXT_PUBLIC_META_PIXEL_ID`, `META_PIXEL_ID` and `META_CAPI_ACCESS_TOKEN` in Vercel. Then test with
  `META_TEST_EVENT_CODE` (Events Manager → Test events): sign up once and check that CompleteRegistration arrives from both
  Browser and Server, deduplicated. Remove the test code afterwards.

## T-146 — Business review by default

- [ ] **Deploy in order:** `bash scripts/deploy-migration-30.sh` FIRST (the worker reads `services.auto_send`), then the
  worker, then the web app.
- [ ] **Know what changes on deploy:** every service, existing ones included, starts holding new quotes for your
  approval. Customers see "Your estimate is being prepared". You get a "Review and approve" email, then tap
  **Approve & send** on the quote (dashboard or app). To keep a service sending instantly, edit it → Basic →
  **Send automatically without review**.
- [ ] **Old verify scripts:** `verify-t137.mts` / `verify-t138.mts` expect app quotes to end at `sent`. Under review-by-default
  they end at `pending_review` until approved. They're historical ticket checks; re-baseline only if you rerun them.

## T-147 — Show, then confirm

- [x] **Deploy in order:** `bash scripts/deploy-migration-31.sh` FIRST (the worker writes `quotes.review_hold` and reads
  `services.hold_until_approved`; without the column every quote update fails), then the worker, then the web app.
  Done 2026-11-10 11:16 UTC: migration 31, worker `f890d5ac`, web (commit `4654f0a`).
- [ ] **Know what changes on deploy:** every service that is not set to send automatically, existing ones included,
  starts showing the customer the estimate straight away, marked as an estimate you will confirm. Accept stays locked
  until you tap **Approve & send**. To keep a service hidden until you approve, edit it → Basic → **Hold until I
  approve**. Quotes already waiting at deploy time stay hidden.
- [ ] **Check one live email:** submit a test request on a default service and confirm "Your estimate from
  {business}" arrives, then approve it and confirm "Your quote from {business}" arrives. Postmark is not configured
  locally, so neither send was checked live (the template is unit-tested).
- [ ] **Wording the customer shouldn't see:** superseded by T-148. Banned words are now rewritten or removed; only
  wording that can't be fixed holds the estimate.
- [ ] **Not checked by eye:** the three options in the service editor (Basic step) and the widget's "Your estimate is
  ready" state. The quote page was screenshotted.

## T-148 — Banned customer words repaired in code

- [x] **Deploy in order:** worker first, then web. No migration. (Web first is also safe; the worker change is what
  repairs new quotes.) Done 2026-11-10 11:53 UTC: worker `9ad1faf9`, web (commit `5529f2b`).
- [ ] **What you'll notice:** an estimate whose wording had "exact", "firm" or "preliminary" is no longer hidden. The
  sentence is rewritten (or removed) and the estimate goes out as normal. The quote's trace page has a **Customer
  wording** section showing what changed. Your own scope, assumptions and exclusions are never changed.
- [ ] **One new approve error:** "The estimate's wording uses a word customers should not see … Edit the wording, then
  send it." It appears only when the whole scope summary is the problem. Edit the quote and use Save & Send.
- [ ] **Auto-send services:** a quote whose wording can't be fixed is now held for you instead of going out (rare;
  same reason in the review email).
- [x] **"guaranteed" / "guarantee":** added to the guard's word list (`CUSTOMER_BANNED_WORDS`) in T-148. Your own text
  ("Workmanship guaranteed for 12 months") is still left as you typed it.

## T-149 — Quote link and QR code

- [x] **Deploy in order:** `bash scripts/deploy-migration-32.sh` FIRST (the web app reads `tenants.slug` on the Share,
  setup and home pages; without the column they fail), then the web app. The worker is not touched.
  Done 2026-11-10 12:36 UTC: migration 32, web (commit `e30a62a`). Worker not deployed.
- [ ] **Know what changes on deploy:** every business gets a link like `/quote/your-business-name`, existing ones
  included (backfilled oldest first; a clash or reserved word gets a short suffix such as `-3f2a`). The menu item
  "Widget" is now **Share**: link and QR code first, embed code second, form fields under Advanced. Installed widgets
  and `/embed/...` links keep working unchanged.
- [ ] **Changing the link is allowed once.** The old link keeps redirecting to the new one.
- [ ] **Home checklist:** "Embed on website" became "Share your quote link". It ticks when you copy the link or the
  page gets its first visit; existing tenants start unticked.
- [ ] **Turnstile:** the quote page runs on the platform domain, the same as `/embed`, so the current Turnstile site
  key covers it. No change needed.
- [ ] **Later (custom domain):** when the custom domain is set, every shared link and printed QR code should use it.
  Set `NEXT_PUBLIC_APP_URL` before businesses start printing QR codes, or old prints will point at the vercel.app address.
- [ ] **Not checked by eye:** the "Change the end of the link" form (checked through the API) and the setup flow's
  last step. The quote page on a phone and the Share page were screenshotted.

## T-150 — Setup that shows prices and ends with a test quote

- [x] **Deploy in order:** `bash scripts/deploy-migration-33.sh` FIRST (the web app writes `quotes.is_test` on every
  new quote and reads the new tenant columns), then the **worker** (it stops counting test requests as sent), then
  the web app. Done 2026-11-10 14:03 UTC: migration 33, worker `373bb704`, web (commit `9c6c445`).
- [ ] **Supabase redirect URL:** signup now asks the verification email to return to
  `https://estimator-web-phi.vercel.app/auth/callback?next=/app`. Add `https://estimator-web-phi.vercel.app/**` to
  Supabase → Authentication → URL Configuration → Redirect URLs (and your custom domain later). Until it's there,
  Supabase falls back to the Site URL, as today. Signing in afterwards still lands in setup.
- [ ] **Know what changes on deploy:** a business with no services is sent to setup when it opens the dashboard,
  until it creates a service or presses "Skip — set up manually instead". Existing businesses with services see no
  change.
- [ ] **Optional:** set `TEST_QUOTE_SECRET` in Vercel to sign test links with their own key. Without it the key is
  derived from the Supabase service-role key; changing either invalidates open test links (2-hour links anyway).
- [ ] **Test requests:** up to 10 per business per day are free and marked "Test"; after that the test link says to
  try tomorrow. They still email the address typed into the form.
- [ ] **Not checked live:** the verification email's redirect (no email locally). Everything after sign-in was
  driven in a browser.

## T-151 — Customer flow: contact first, unfinished requests, next step after accept

- [x] **Deploy in order:** `bash scripts/deploy-migration-34.sh` FIRST (the web app writes `request_leads` and reads
  `tenants.contact_requirement`; without them the widget's contact step and every submission fail), then the
  **worker** (phone-only customers have no email: it must skip the customer email), then the web app.
  Done 2026-11-10 15:15 UTC: migration 34, worker `4d9c4016`, web (commit `f147633`).
- [ ] **Know what changes on deploy:** every widget (quote link and installed embeds) asks for contact details right
  after the service, then the questions, photos, and ZIP + description last. The address moved to accept. Default
  contact rule: email required, phone optional. Change it in Settings → Customer contact details.
- [ ] **Unfinished requests:** someone who gives their details and leaves shows up under Quotes → "Started, didn't
  finish", with call and email buttons, and as a 7-day count on the dashboard home. Nothing is sent to them
  automatically (out of scope). They don't count toward your plan.
- [ ] **Accepting now asks** when suits the customer, the job address and a phone number, and the acceptance email
  includes them. Quote pages already open before the deploy still accept the old way.
- [ ] **Phone-only customers** (if you choose "Phone required"): they get no email; their link is on screen, and
  "Resend" says to text it instead.
- [x] **Regression set (owner decision 2026-11-10):** only `verify-t146` … `verify-t151` are run from now on. The older scripts (t127–t143) are historical ticket checks, out of date since T-146, and are not fixed or re-baselined.


## T-152 — Simpler dashboard: waiting work first, five menu items, free allowance fixed

- [x] **Deploy in order:** `bash scripts/deploy-migration-35.sh` FIRST (Home reads `tenants.prices_checked_at`; without it
  the home page query fails), then the **worker** (only its email footer reads the product name now), then the web app.
  Done 2026-11-10 17:27 UTC: migration 35, worker `4a4c0ddc`, web (commit `439353b`).
- [x] **Confirm the free allowance** (owner decision 2026-11-10: 10 in total, no backfill for "Check your prices"): `FREE_ALLOWANCE` in `packages/shared/src/plans.ts` (`TODO-OWNER`): US 10 priced
  quotes **in total**, never resetting; legacy GB tenants keep 50 a month. Subscribed tenants are unchanged. A US
  business that already used quotes in earlier months now counts them all; if it has 10 or more, its next request
  is held as a lead until it picks a plan.
- [ ] **Know what changes on deploy:** the menu is Home, Quotes, Prices, Share, Settings. Old links still work
  (`/app/services`, `/app/branding`, `/app/billing` redirect). Analytics opens from "See all numbers" on Home.
  SMS has no menu item; its page and behaviour are unchanged at `/app/sms`. WhatsApp moved into Share ("Use it on
  WhatsApp"), and the full WhatsApp setup page is unchanged at `/app/whatsapp`.
- [ ] **Stripe:** checkout and the Customer Portal now return to `/app/settings/billing`. Nothing to change in Stripe;
  the old `/app/billing` return URL also still redirects.
- [ ] **Existing businesses** see "Check your prices" unticked until they confirm (save a service on Prices).
  It never ticks on its own.

## T-153 — A working public demo: "Try it as a customer"

- [x] **Deploy in order:** (done 2026-11-10 18:13 UTC: migration 36, seed, `DEMO_DAILY_CAP=100`, worker `cd26a177`,
  web, commit `b0a9ea8`)
  1. `bash scripts/deploy-migration-36.sh` (adds the demo flag, its guard and the reserved slug).
  2. `npx tsx scripts/seed-demo-tenant.mts --prod` (creates "Example Home Services" with its three services; safe to
     re-run, it updates in place).
  3. The **worker** (demo requests: no emails, no usage, no adjudication, one photo).
  4. The **web app**.
- [x] **Set `DEMO_DAILY_CAP` in Vercel** (production; set to 100 on 2026-11-10). Default 200 demo requests a day if unset; each one is a real
  AI run on the cheap models. `0` turns live runs off: every visitor then sees the recorded example. Optional:
  `DEMO_IP_LIMIT_PER_HOUR` (default 5). Both are counted in the database, so they work without Upstash.
- [ ] **The daily lifecycle cron needs `CRON_SECRET`** (already set since 2026-07): it now also deletes demo requests
  and their uploads after 24 hours.
- [ ] **Look at /demo on your phone once** and read the example prices: they are the US pack rates (`TODO-OWNER` in the
  packs), shown as an example business's prices.
- [ ] **What a visitor can't do:** sign into the demo business (it has no user), get any email or text, or create a
  lead. The water heater path uses a sample label we drew (`apps/web/public/demo/`); when a reading is unsure it shows
  a range and asks a question, like any real quote.

## Rate limiting (found at the T-153 deploy, 2026-11-10)

- [ ] **Configure Upstash Redis — it is not set anywhere in production**, so every rate limit below is off (they fail
  open by design). Create an Upstash Redis database, then set:
  - Vercel (Production): `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`;
  - worker: `npx wrangler secret put UPSTASH_REDIS_URL --env production` and `UPSTASH_REDIS_TOKEN` (note the
    different names), then redeploy both.

  Unprotected until then:
  - `POST /api/public/quotes` (5/min per IP, 30/min per business): each request runs the AI pipeline. The plan
    limits still cap what a business is charged; the honeypot is the only bot check while Turnstile is unset.
  - `POST /api/public/widget/chat` (15/min per IP): every turn is a model call, with no other limit.
  - `POST /api/public/uploads/init` (20/min per IP): issues upload URLs and creates asset rows.
  - `POST /api/public/leads` and `PATCH /api/public/leads/:id` (20/min per IP): database writes.
  - `GET /quote/:slug` (60/min per IP): the quote link page.
  - `POST /api/marketing/event` (5/min per IP): the Meta relay (inactive while the Meta keys are unset).
  - Worker queue consumer: the AI-processing limiter (100 global, 10 per business per window) and its stats endpoint.

  The demo's own limits (`DEMO_DAILY_CAP`, `DEMO_IP_LIMIT_PER_HOUR`) are counted in the database and already apply.

## T-154 — Home page rewrite

- [ ] **Deploy: web only** (`npx vercel deploy --prod`). No migration, no worker change.
- [ ] **Review the screenshots** in `scripts/hardcore-test/results/2026-11-10-t154-screenshots/` (home at 390 px and
  1440 px, the phone menu, a trade page, the features page, the social preview image).
- [ ] **Founder section:** fill in `apps/web/src/lib/marketing/founder.ts` (name, role, a two-or-three-sentence note,
  optional photo in `apps/web/public/`). It stays hidden until name and note are set.
- [ ] **Support email:** set `SUPPORT_EMAIL` in `packages/shared/src/brand.ts` once the domain is chosen; the founder
  section shows it automatically.
- [ ] **Pricing page still promises Pro channels that aren't live:** "Quoting by text (SMS)" and "On-site app for your
  phone" (from `plans.ts` channels), and the Pro tagline says the same. Decide: set up Twilio and release the app, or
  change the plan wording (plan content was out of scope for T-154).
- [ ] **Accept and decline alerts** reach the business only if Settings → Notifications has an address; otherwise they
  only show in the dashboard. Consider emailing the owner's login address by default (product change, not done).

