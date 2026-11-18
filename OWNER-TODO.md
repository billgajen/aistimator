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

- [x] (T-180, 2026-11-18: you confirmed Starter, Pro and the 10 free quotes; only Business is still marked.)
  **Confirm the plan numbers** in `packages/shared/src/plans.ts` (every `TODO-OWNER`): Starter $49/50
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

- [x] **Postmark account approved on 11 Nov 2026.** Emails now reach any address, not only the sending domain. (The
  GB smoke test's business notification to a gmail address was rejected on 8 Nov, before the approval.)
- [x] **Postmark DKIM:** the sending domain was verified in Postmark on 10 Nov 2026.
- [ ] **Postmark Return-Path:** check that the Return-Path DNS record shows as verified (Postmark → Sender Signatures /
  Domains). It helps delivery; it does not block sending.
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
  8. **Reply to the customer inside the app (T-157 follow-up, v2 backlog).** A customer question reaches the business
     by email and shows on the quote page, but the business answers outside the app (phone, its own email) and then
     presses "Mark as answered", or edits the quote and sends it. A reply box that emails or texts the customer and
     keeps the thread on the quote is not built.
  9. **Suggest chasing a quiet customer (T-158 follow-up).** A quote the customer opened several days ago and has not answered still reads "Nothing for you to do". Make its next step "Contact customer" after a set number of days.
  10. **Small photo copies for photos sent by text, WhatsApp or the mobile app (T-172 follow-up; do it with the
     WhatsApp ticket, T-111 in `Docs/06-v2-strategy.md`).** Since T-172 the web form makes a small copy of each photo
     for small pictures. A photo that arrives by SMS, by WhatsApp or from the business's mobile app has none, so its
     small pictures on the dashboard and the quote page still load the full photo. Those photos reach storage through
     the server (or the app), not a browser, so the copy has to be made there; the serving side needs no change (it
     already falls back to the original and will use a copy at `<key>.small` once one exists).
  11. **The on-site app's own upload and form routes (T-182 follow-up).** The app starts photo uploads and reads the
     service's form through the public routes the website form uses, which are rate limited by network address. A
     signed-in trade on a busy shared network could be made to wait (the app waits and retries; it never skips the
     limit). Routes behind the app's sign-in, with the same checks on size and type, would not share that limit.
  12. **Editing a quote in the on-site app (T-182 follow-up).** The app shows a quote's lines and sections and
     approves it; changing a line, or adding or removing a service, is done in the dashboard.
  13. **The app before the App Store (T-182 follow-up; the TestFlight ticket).** Icon and splash, the three brand
     fonts, the EAS settings, the encryption declaration, and the plan-limit wording (Apple does not allow an app to
     point at a purchase outside it). The list is in the T-182 section.
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

- [ ] **Try it on your iPhone: use the steps in the T-182 section at the end of this file** (they replace
  this item, and point the app at production). The original note:
  (no Xcode needed): install **Expo Go** from the App Store, then on the Mac
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

- **Since T-173 the limits are in one file, with more doors covered and different figures: see T-173, sections 2 and 3. The list below is as it stood on 2026-11-10.**
- [x] **Upstash Redis is configured in Vercel** (seen 2026-11-17, T-178: `UPSTASH_REDIS_REST_URL` and
  `UPSTASH_REDIS_REST_TOKEN` are set, and the limits block as they should). **The worker gets no Upstash values:
  its limiter stays off, by design** (your decision, T-178, AD-060). The earlier instruction to add them to the
  worker is withdrawn.

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
- [x] **`quote_feedback` allowed anonymous inserts**: closed by migration 43 (T-173), with eight other open rules. See T-173, section 1.
- (as written in T-157) **`quote_feedback` still allows anonymous inserts** (policy "Public can insert feedback", `WITH CHECK (true)`, plus
  `GRANT INSERT … TO anon`), although the public feedback route writes with the service role and checks the quote's
  token first. Anyone with the public anon key could insert rows straight into the table. Left as it is in T-157 on
  purpose; drop the policy and the grant in a later migration.

## Reliability (found during T-157, 2026-11-13)

- [ ] **The worker's wording, add-on detection and validation AI calls have no timeout.** A stalled call holds the
  request until the platform ends it (one local submission hung for four minutes), and the wording fallback only
  runs on an error, never on a stall. Give them one in a small ticket, like identification (25 s), adjudication
  (30 s) and the sentence rewriter (15 s) already have.
- Production `quote_feedback.id` is `uuid`; the local database issues `fb_…` text ids. Harmless today (the
  "answered" route accepts both), but local and production schemas differ there.

## T-154 — Home page rewrite

- [x] **Deploy: web only** (`npx vercel deploy --prod`). No migration, no worker change. Done 2026-11-10 with T-155
  (commits 430756e, 8793481; deployment `dpl_GuF1ZuFeccR8pZFvDqduYoZmmxug`).
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

## T-155 — Home page polish (deploy: web only, with T-154)

- [x] **Deployed** 2026-11-10 with T-154 (web only, deployment `dpl_GuF1ZuFeccR8pZFvDqduYoZmmxug`).

Features page gaps (checked 2026-11-10). The copy was reworded in T-155 to what is live; each item names the claim to
put back once the gap is fixed (`app/features/page.tsx`; the marketing test bans the old wording, so update it too).

- [ ] **PDF.** No PDF is made in the normal flow: one exists only after you click Download PDF on the dashboard quotes
  list, and only then does the customer page show a PDF button. A PDF made before a revision is served again unchanged.
  `DOCRAPTOR_API_KEY` is not set in Vercel, so PDFs are DocRaptor test (watermarked) documents. Proof:
  `api/quotes/[quoteId]/pdf/route.ts`, `api/public/quotes/[quoteId]/pdf/route.ts` (404 until made), `lib/docraptor.ts`.
  **Restore once fixed:** "Estimate page in your branding, with a PDF" (features §04) and "Hosted estimate pages &
  PDFs" (pricing page bullet).
- [ ] **Reminder.** Built and on (the daily `/api/cron/lifecycle` sends one reminder 3 days after sending if there's no
  response; Postmark is set in Vercel, and the account was approved on 11 Nov 2026). Quotes that were
  revised or got questions never get one. **Restore once fixed:** "Expiry and one polite reminder, automatically"
  (features §04; it now reads "Estimates expire automatically").
- [ ] **Price comparisons.** Built (`api/learning/benchmarks`, opt-in on the Analytics page), but it needs 3 other
  opted-in businesses with the same currency, so everyone sees "Not enough comparable businesses yet". Analytics is
  reached only from "See all numbers" on Home, and there's no way to opt back out. **Restore once fixed:** the bullet
  "Opt-in, anonymised price comparisons" and, at the end of the §05 text, ", and, if you opt in, how your prices compare
  with similar businesses".
- [ ] **Quantity working.** The quote's own page shows label and amount only. The working (quantity × rate) is on the
  pricing trace page, linked only from the quotes list and only once a quote is sent, so not while it awaits your
  approval. The trace doesn't show where a quantity came from (form, AI, derived) although the engine records it.
  **Restore once fixed:** "You see how every quantity was worked out" (features §02), "Every estimate’s working visible
  in your dashboard" (features §03) and, on the painting page, "Your copy of each estimate shows how every quantity was
  worked out." (all now "See the working behind every sent estimate").
- [ ] **Expiry (live; one wrinkle).** The daily cron expires quotes when the 30-day link runs out, and the customer page
  then blocks accept. The "Valid until" date shown to the customer comes from the estimate's validity days, not the
  link's expiry; they usually agree (30 days) but can differ after a reminder or resend renews the link. **Claim kept:**
  "Estimates expire automatically". If "Valid until" is ever made to follow the link, nothing to restore.

## T-156 — Approve a quote from the email in one tap

- [x] **Deploy, in this order:** done 2026-11-10 22:28 UTC (commit `b0d310c`, worker `fb03997a-fd7a-4d76-b6df-817f622e3dc8`,
  web `dpl_Dr12ziHWJFHJYD97Fk6WaAWZTw44`).
  1. migration 37: `bash scripts/deploy-migration-37.sh` (the `quote_approval_tokens` table, the trigger that ends
     open links when a quote changes, and `quotes.approved_via`);
  2. the worker: `(cd apps/worker && npx wrangler deploy --env production)`;
  3. the web app: `npx vercel deploy --prod`.

  The worker first, because the old web app ignores the new table. The web app last, because `/approve` needs the table.
- [ ] **Try it by hand:** send a request to your own business. In the "Review and approve" email, tap **Approve & send**
  on your phone, check the page shows the price, and press the button. You should see "Sent", and the customer address
  should get "Your quote from …" once. Tap the button in the email again: "Already approved".
- [x] **Email delivery:** the Postmark account was approved on 11 Nov 2026, so the review email and the customer's
  confirmed quote reach any address. (Written while the approval was pending.)
- [x] **Per-IP limit:** the `approval_link` limit uses Upstash, which is set up in Vercel since 2026-11-17. The
  per-link cap (10 presses, counted in the database) applies regardless. See "Rate limiting" above.
- Test requests from setup keep the review email, marked "[Test]" with a banner, and the button works like any other
  (it counts toward nothing). Demo requests send no email.

## T-157 — Quote actions that always work

- [x] **Deploy, in this order:** done 2026-11-13 17:58 UTC (commit `7eafff7`, worker `fdd2fb86-9425-4f89-b05a-27d7cbd69ea9`,
  web `dpl_BLrNeaZ7cU8yiYiRjrmb4JmB3o7w`).
  1. migration 38: `bash scripts/deploy-migration-38.sh` (`quotes.link_token_hashes` and the trigger that keeps the
     replaced link whenever a quote's token changes);
  2. the worker: `(cd apps/worker && npx wrangler deploy --env production)`;
  3. the web app: `npx vercel deploy --prod`.

  The migration first, because the new web app's public quote routes read the new column: without it every customer
  quote page would fail. The old web app and old worker ignore the column, and the trigger already protects links
  they hand out. The worker before the web app keeps the rounding and the business email rule in step with the editor.
- [ ] **First, open one existing quote link** (from any customer email sent before today). It should open as before.
  This is the one thing the read-only deploy checks could not prove: a made-up token gets 404 either way.
- [ ] **Try by hand, with your own business and a customer address you can read:**
  1. *Emails to you.* Leave Settings > Notifications empty. Accept a quote as the customer: "Quote accepted" should
     reach your login email. Ask a question and decline another quote: the same. Then fill in a different address in
     Settings and repeat one of them: it should go there instead, and so should the worker's "Review and approve"
     email for a new request. Reply to a customer email ("Your quote from …"): the reply should be addressed to you.
  2. *Buttons.* On a sent quote: **Send again**, **Copy link**, Edit. On an accepted quote: Copy link only. On a
     quote awaiting approval: Approve & send and Edit only. **Text link** should be missing everywhere until an SMS
     number is connected. Press Send again on a quote whose customer has no email: it isn't offered. Any failure
     should appear as a line under the header, never a browser pop-up.
  3. *Links.* Open the link from the customer's first email. Then press Send again, Copy link, and wait for (or
     trigger) the 3-day reminder. The first link should still open the quote each time, and so should every newer one.
  4. *Questions.* As the customer, ask a question: "Message sent" shows, Accept and Decline stay, and it is the same
     after a reload. On the quote page the banner reads "Customer question"; press **Mark as answered**, reload, and
     it should stay closed with the status back to Viewed (T-158: it now reads "Waiting for customer", with "They
     opened it today" in the Next step box). The customer can then ask again or accept.
  5. *Revised.* Edit a sent quote and Save & Send twice: the status should read Revised both times (T-158: it now
     reads "Waiting for customer", "Updated quote sent today" on the list).
  6. *Money.* Open an older painting quote with a line like "Exterior walls  £18 x 34.6(Sqm)" in the editor: the amount
     box should read 622.8, not 622.8000000000001. Change that amount, leave the label, save: the customer page
     should show "Exterior walls" with no maths under it. A line you leave alone keeps its maths.
- [x] **Email delivery:** the Postmark account was approved on 11 Nov 2026, so every email in step 1 reaches any
  address. (This note said it was still waiting; that was out of date.)
- Not built here, by the ticket: new status wording, tabs and next-step layout; any SMS work beyond hiding the button;
  replying to the customer inside the app (backlog item 8 above).
- The live check is `scripts/hardcore-test/verify-t157.mts` (add `PLAYWRIGHT_DIR=…` for the page checks). It joins the
  regression set: run t146 to t157 before a commit or deploy.

## T-158 — Quotes say whose turn it is

- [x] **Deploy: the web app only.** Done 2026-11-13 22:52 UTC (commit `879de02`, web
  `dpl_4DgPGdsvb7dDP5CDzyBXGiqbSHSv`). `npx vercel deploy --prod`. No migration and no worker deploy: nothing in the
  database changed, and the worker's behaviour is the same (the new shared file is not used by it).
- [ ] **Try by hand, on your own business:**
  1. *Tabs.* Open Quotes. It should open on **Needs you** when anything waits for you, otherwise on **All**. Each tab
     shows a count: Needs you, Waiting for customer, Accepted, Closed, Unfinished, All. On your phone the tabs should
     scroll sideways and each quote should stack.
  2. *Labels.* No quote should read Sent, Viewed, Revised or Feedback. A sent quote reads "Waiting for customer" with
     a line such as "Sent 2 days ago, not opened yet" or "Opened yesterday".
  3. *One button with words.* A quote awaiting approval: **Check and approve**. A customer question: **Answer
     question**. An accepted quote: **Contact customer**. A quote unopened for 3 days, or expired: **Send again**.
     A quote sent today: no button. Everything else is under **More**, in words (Copy link, Download PDF, Send again,
     Pricing trace).
  4. *Search.* Type part of a customer's name or email. The list should narrow and the counts with it. (Search used
     to fail on every attempt; see the changelog.)
  5. *Quote page.* A quote awaiting approval starts with "Check the price and approve. The customer can accept only
     after you approve." and **Approve & send**. After approving it reads "Nothing for you to do. Waiting for
     <first name>. Sent today, not opened yet." An accepted quote reads "<Name> accepted on <date>. Contact them to
     book the job." with **Email** and **Call**.
  6. *Progress.* Under the box: Request received, You approved, Customer opened, Customer accepted, each with its date
     once done. A service set to send automatically shows "Sent automatically" as step two. A declined quote ends
     with "Customer declined".
  7. *Home.* "Waiting for you" should also list a customer question and a request that could not be priced, and count
     them: "3 need you".
  8. *Customer page.* Open an approved quote as the customer: the button reads "Accept this quote", the quiet link
     "Decline this quote", and afterwards "Quote accepted" or "Quote declined". For a service that sends
     automatically, all of these still say "estimate".
- Worth knowing:
  - "Opened <when>" is the first time the customer opened the quote. A later visit does not change it.
  - An opened quote always reads "Nothing for you to do", however long ago it was opened. The app does not yet
    suggest chasing a customer who has gone quiet (product backlog item 9 above).
  - The mobile app still shows its own status words (`apps/mobile/src/lib/price.ts`). It was outside this ticket.
    **Fixed in T-182:** the app takes its words from the same shared file as the dashboard.
- Not built here, by the ticket: the menu, a Home redesign, a "seen" state for unfinished requests, the sign-in
  tagline (next ticket); replying to the customer inside the app (backlog item 8); a "booked" or "job done" status.
- The live check is `scripts/hardcore-test/verify-t158.mts` (add `PLAYWRIGHT_DIR=…` for the page checks; it saves
  screenshots of the list, the quote page and the phone width into its results folder). It joins the regression set:
  run t146 to t158 before a commit or deploy.

## T-159 — Emails show a sender name

- [x] **Deploy, in this order:** the worker, then the web app. Done 2026-11-13 23:18 UTC (commit `ed75bf2`, worker
  `18e5cd25-0f05-47ff-9366-10d2e259fb3b`, web `dpl_D3aagpDvXwnVBAws7i3Ux8Hg4M9s`).
  1. `(cd apps/worker && npx wrangler deploy --env production)`
  2. `npx vercel deploy --prod`

  No migration and no new setting: the address still comes from `POSTMARK_FROM_EMAIL`. Either order is safe (each
  app names its own emails); the worker first keeps every email consistent from the moment the web app changes.
- [ ] **Try by hand:**
  1. *A customer email.* Approve a quote for a customer address you can read (or press Send again). In the inbox the
     sender should read "<your business name> via Aistimator", not a bare address. Reply to it: the reply should
     still be addressed to you.
  2. *A business email.* Accept that quote as the customer, or send in a new request and wait for "Review and
     approve". The sender should read "Aistimator".
  3. If your business name has a comma, quotes or an ampersand in it, check it shows whole and unbroken.
- [x] **Email delivery:** the Postmark account was approved on 11 Nov 2026, so these emails reach any address. (This
  note said it was still waiting; that was out of date.)
- Worth knowing: a business name longer than 60 characters is cut in the sender name (mail apps shorten long sender
  names anyway). The name inside the email itself is not cut.
- No live check script for this one: locally there is no email provider, so nothing is sent. The header is checked
  in the unit tests, including what each app hands to Postmark.

## T-160 — Sectioned menu, a fuller Home, unfinished requests that clear

- [x] **Deploy, in this order:** done 2026-11-14 08:55 UTC (commit `704753b`, web
  `dpl_CorK2Fmdg56YHNGNAEgasGhnvgf8`; production is at migration `00000000000039`).
  1. migration 39: `bash scripts/deploy-migration-39.sh` (`request_leads.seen_at` and `handled_at`);
  2. the web app: `npx vercel deploy --prod`.

  The migration first: the new Home, the menu badge and the Unfinished list read the new columns, and would fail
  without them. The old web app ignores the columns, so the gap between the two steps is safe. No worker deploy.
- [ ] **Try by hand:**
  1. *Menu.* Three sections: Work (Home, Quotes, Unfinished requests, Analytics), Set up (Services, Quote link,
     WhatsApp), Account (Settings). No "Prices", "Share" or SMS. On your phone, open the menu: the same sections, and
     it closes when you tap an item.
  2. *Old bookmarks.* Open /app/prices and /app/share: they should land on Services and Quote link.
  3. *Unfinished requests.* On your own quote link, give your details and stop before sending. Home should show
     "1 new person started a request but didn't finish" and the menu a "1" beside Unfinished requests. Open the list:
     the person is tagged "New", and the "1" goes. Go back to Home: the banner is gone. Start another unfinished
     request: both come back. Press **Done** on a person: they leave the list and stay gone after a reload.
  4. *Home.* Below the checklist: "Where your quotes stand" with three counts (tap one: it opens that tab of Quotes),
     "Latest activity" with lines such as "Sarah opened the quote, 2 hours ago" (tap one: it opens the quote), "Your
     quote link" with Copy and Open, and "Last 30 days" with "up 3", "down 1" or "same" under each number.
  5. *A new business.* Sign up a second account (or look at one with no quotes): it should read "No quotes yet…" and
     "Nothing has happened yet…", not zeros and an empty box.
  6. *Sign-in.* The login page should read "Instant quotes on your website, in your prices." under the name.
  7. *Settings > Notifications.* The field is labelled "Send notifications to".
- Worth knowing:
  - "Done" has no undo. The person is kept in the database, only hidden.
  - Home's counts leave out test quotes; the tabs on Quotes include them (with the "Test" tag). So "Needs you" on Home
    can be lower than the tab's count while a test quote waits.
  - "Accepted" on Home is the last 30 days; the Accepted tab lists every accepted quote.
  - Latest activity covers the last 30 days. "Opened" is the first time the customer opened the quote.
- Not built here, by the ticket: any change to the Services, Quote link, Analytics or WhatsApp pages beyond titles,
  paths and wording; one-click WhatsApp connection; SMS; chasing quiet customers (backlog item 9).
- The live check is `scripts/hardcore-test/verify-t160.mts` (add `PLAYWRIGHT_DIR=…` for the page checks; it saves
  screenshots of Home, the phone menu and the Unfinished list into its results folder). It joins the regression set:
  run t146 to t160 before a commit or deploy (there is no verify-t159).


## T-162 — The product is called Qolumns

No domain, address or URL changed: that is the next ticket.

- [x] **Deploy, in this order:** done 2026-11-14 17:24 UTC (commit `906323a`; worker version
  `2ad7e64c-592d-49c3-844a-4becd95f6134`; web `dpl_EiSzpwavbPiUHawQTeVbcaxLHUri`; production is at migration
  `00000000000040`).
  1. migration 40: `bash scripts/deploy-migration-40.sh` (reserves the quote-link names `qolumns` and `qolums`). It
     first checks that no business holds either word and stops if one does;
  2. the worker: `cd apps/worker && npx wrangler deploy --env production` (emails then say "Powered by Qolumns"
     and come from "… via Qolumns");
  3. the web app: `npx vercel deploy --prod`.

  Checked live, signed out and read-only: the five public pages, both loader files, the two reserved names, worker
  health, the quote API's 404, and that the web app's `R2_BUCKET_NAME` names the bucket the worker binds (yes).

  The order is not fragile: the old web app ignores the two new rows, and worker and web only disagree on the name
  in an email for the minutes between steps 2 and 3. Nothing else depends on it.
- [ ] **Try by hand:**
  1. *Pages.* Home, Pricing, a trade page, Terms, Privacy and the login page say "Qolumns" in the header, the
     footer ("© 2026 Qolumns.") and the browser tab. Share the home page link in a chat app: the preview image
     should say Qolumns (previews are cached; a new link such as `/?v=2` forces a fresh one).
  2. *Dashboard.* The name at the top of the menu is Qolumns.
  3. *Quote link page.* The website code starts `<!-- Qolumns Widget (Inline) -->` and contains
     `<div id="qolumns-widget"></div>`.
  4. *A customer's view.* Open your quote link: "Powered by Qolumns" under the form. Open a quote: "Prepared with
     Qolumns" at the foot.
  5. *Emails.* Send yourself a request. The customer email's sender should read "<your business> via Qolumns",
     the business email's sender "Qolumns", and both say "Powered by Qolumns" at the foot. **The T-159 hand test
     above was written with the old name: read it as Qolumns.**
  6. *Website code on a real page* (optional): paste the inline code into any test page. The form should show and
     grow to its height.
  7. *Reserved names.* On the Quote link page, under "Change the end of the link", typing `qolumns` or `qolums`
     should say the word is reserved. (Do not save a change: the link can be changed once.)
- **What the rename invalidates** (all small):
  - Someone in the middle of setup's "Try it as your customer" at the moment of the web deploy must press the
    button again (test tokens last two hours and are signed with a label that changed).
  - The public demo's hourly per-visitor limit starts fresh for up to an hour after the web deploy.
  - A development build of the phone app installed under the old id is now a different app: install the new one.
  - No business has the website code yet, so the old code was not kept working. A page that still carries the old
    code shows no form.

### Names only you can change (code does not depend on any of them)

- [ ] **Stripe products.** They are still called "Aistimator Starter / Pro / Business" and show on checkout and
  invoices. Rename each in Stripe → Product catalogue. The setup script names a product only when it creates one,
  so it will not rename them. Also check the account's public business name and statement descriptor.
- [ ] **GitHub repo** `billgajen/aistimator`. GitHub → Settings → Repository name. GitHub redirects the old address;
  afterwards run `git remote set-url origin https://github.com/billgajen/<new-name>.git` on this Mac. The Vercel
  Git connection follows the rename by itself.
- [ ] **Supabase project label.** Supabase → Project Settings → General → Name. Display only; the project ref
  (`ygsuzeveesgrafgpkrev`), keys and URLs do not change. While there, look at Authentication → Emails: the
  sign-up confirmation email's subject and text are set in Supabase, not in this repo, and may carry the old name.
- [ ] **Postmark.** The sender name on every email now comes from the code. Check that the Sender Signature's own
  name and the server's name in Postmark do not show the old name anywhere a customer sees.
- [ ] **When you create them:** the Apple Developer app record and the EAS project should be made as "Qolumns"
  with the id `com.qolumns.app`.
- The folder on this Mac is still `~/Documents/Estimator`. Renaming it is safe for the code, but the local
  database containers and the assistant's saved notes are keyed on the folder name, so leave it unless it bothers
  you.

### Infrastructure left with its old name (decide one at a time; none is needed for the name people read)

| What | Name today | What renaming it would involve |
|---|---|---|
| Cloudflare worker | `estimator-worker` (`estimator-worker-production.billgajen.workers.dev`) | Changing `name` in `wrangler.toml` deploys a **new** worker at a new address. Then: set its secrets again (`wrangler secret put …`; `wrangler.toml` lists nine), move the `quote-jobs` queue consumer from the old worker to the new one (a queue has one consumer), change `CLOUDFLARE_WORKER_URL` in Vercel and redeploy the web app, check a request prices, delete the old worker. Quotes wait in the queue during the switch. About an hour, with a window where pricing is paused. |
| R2 bucket | `aistimator-assets` | A bucket cannot be renamed. Create a new one, copy every object (Cloudflare's Super Slurper or `rclone`), change `bucket_name` in `wrangler.toml` (two places) and `R2_BUCKET_NAME` in Vercel, deploy worker and web together, check an old quote's photos still open, then delete the old bucket. The database stores only the path inside the bucket, so no rows change. Photo links already issued stop working at the switch (they last up to an hour). |
| Queues | `quote-jobs`, `quote-jobs-dlq`, `quote-jobs-local` | Nothing: no old name in them. |
| Vercel project | `estimator-web` (`estimator-web-phi.vercel.app`) | Renaming the project changes the `.vercel.app` address, which is the app's address today: every quote link, QR code and email link already given out points at it. Do this as part of the domain ticket, where the old address can keep redirecting. |
| GitHub repo | `billgajen/aistimator` | See the list above. Safe at any time. |
| Supabase project | ref `ygsuzeveesgrafgpkrev` | The label only (see above). The ref cannot change. |

**One mismatch to settle when the bucket is next touched** (reported, not changed): `apps/web/src/lib/r2.ts` falls
back to `estimator-assets` when `R2_BUCKET_NAME` is not set, `wrangler.toml` binds `aistimator-assets`, and both
`.env.example` files say `estimator-assets`. Production sets the variable, so the fallback is not used there, but
a new environment set up from `.env.example` would point the web app and the worker at different buckets.

- The live check is `scripts/hardcore-test/verify-t162.mts` (add `PLAYWRIGHT_DIR=…` for the pages and the website
  code in a real browser; it saves screenshots and the four rendered emails into its results folder). It joins the
  regression set: run t146 to t162 before a commit or deploy (there is no verify-t159 or verify-t161).

## T-164 — Design foundations: one design file, fixed tokens, a preview page

No page was redesigned; pages changed only where a token changed.

- [x] **Deploy: web only** (`npx vercel deploy --prod`). Done 2026-11-14 18:21 UTC (commit `54598d1`, web
  `dpl_7AVnVC1wNGVXRjow9HZGb9nx6EB2`). No migration and no worker change. Checked live, signed out and read-only:
  `/`, `/login` and `/pricing` load; `/design` loads, says "do not index" and is linked from nowhere (there is no
  sitemap); the quote API answers 404 to a made-up link.
- [ ] **Choose on the preview page, `/design`** (it is not linked from anywhere; type the address). Use the
  Accent switch at the top and look at the whole page with each one, on your phone too.
  1. **The accent:** tomato, orange or yellow. Orange is in place until you choose. Things to weigh:
     - *Orange:* button text is our dark ink and reads well (5.0:1).
     - *Tomato:* white text does not pass on it (4.0:1), and neither does our ink (3.8:1), so button text has to be
       near-black. Look at the "Try it free" button with tomato selected and decide if you like that.
     - *Yellow:* the strongest contrast for dark text (9.7:1), but its light tint is almost the butter colour we
       keep for measurements, so "needs you" would look like a measurement note again.
     - With every accent, button text is dark, never white. The accent is also never used as the colour of text on
       the page: a highlighted word is the accent *behind* the word.
  2. **The wordmark:** "Qolumns" or "qolumns", both drawn under "Wordmark". Real pages keep the current text logo
     until you choose.
  Tell me the two choices and they go in as one small ticket (the accent becomes the default token; the wordmark
  replaces the text logo).
- [ ] **Look at** (these are the visible effects of the token fixes):
  1. *Quotes and Home.* "Needs your approval", the "Needs you" tile, the unfinished-requests banner, the menu's
     count and the "New" tag are a soft orange now, not yellow. "Waiting for customer" is a quiet blue-grey.
  2. *Small grey text* (times, "Received today", hints) is darker and easier to read. So are amber, green and red
     labels.
  3. *Fields and outlined buttons* have a clearer edge everywhere, including your quote link's form and the accept
     form.
  4. *Keyboard.* Press Tab on the home page until you reach the buttons in the green band at the bottom: the ring
     is white there (it was invisible). Click into any field: it shows a clear dark ring.
  5. *The dashboard* no longer fades in when it loads.
  6. *Reduced motion.* On your phone or Mac, turn on "Reduce motion" in Accessibility: nothing slides or loops.
- Worth knowing:
  - `Docs/design/system.md` is now the one file that decides how things look and move. The three design skills only
    advise. A change to a colour, font or animation rule starts there.
  - The customer's pages (the request form and the quote page) keep the business's own brand colour. Our accent is
    never shown on them.
  - `/design` is public if someone types the address, but it is marked "do not index", linked from nowhere, and
    shows nothing private.
- **Follow-ups found here** (each needs its own ticket; details in `Docs/CHANGELOG.md` and
  `Docs/design/system.md`, "Known gaps"):
  - [ ] **228 colour classes with an opacity modifier write no CSS.** Classes that ask for a see-through tint of
    one of our colours (`ring-primary/30`, `border-danger/30`, `border-tape/50`, `bg-ink/40` and so on, in 51 files)
    have never done anything, because our colours are defined in a way Tailwind cannot make see-through. So soft
    borders show as the plain default line, and the phone menu's dimming layer has no colour. The fix is to define
    the colours so they can take a tint. It will switch all 228 on at once and change how many pages look,
    34 of them in the request form and the quote page, so it needs a look at every page, not a quiet change. A test
    already stops new ones being added.
  - [ ] **Tap sizes and small tags** (the two things the ui-ux-pro-max checklist failed on `/design`, both in the
    shared components). On a phone the shared button is 40 px tall (34 px at its small size) and fields are 42 px;
    the rule is 44 px. Tags (`Badge`) use 11 px text; the floor is 12 px. Fixing them makes every button, field and
    tag in the product slightly taller or larger, so do it with the dashboard redesign, not on its own.
- The live check is `scripts/hardcore-test/verify-t164.mts` (add `PLAYWRIGHT_DIR=…`; almost all of it is the
  browser pass; it saves `/design` at both widths with each accent into its results folder). It joins the
  regression set: run t146 to t164 before a commit or deploy (there is no verify-t159, t161 or t163).

## T-165 — Home page that shows the product; yellow accent; one free offer

- [x] **Deployed 2026-11-15 12:31 UTC** (commit `b0a9b82`): the worker first (`estimator-worker-production`,
  version `f5a37a7d-04ab-4ad6-b87c-9b68613b62a7`), then the web app (`dpl_DwHWYJtixuzPKN9KRsYYeqSBfNP5`, serving
  `estimator-web-phi.vercel.app`). No migration. Checked live, signed out and read-only (nothing was submitted):
  all twelve public pages load and none says "14-day" or "trial"; on Home the header button reads "Try it free",
  the hero has one yellow button with the full offer, the price example has two lines and no minimum, and the
  quote link shown is the live site's; `/design` shows one accent; the worker's health check answers; the quote
  API answers 404 to a made-up link.
- The preview (`estimator-6onwa5v0e-…`) is **deleted**. One earlier preview attempt that failed to build
  (`estimator-hz87ot4ta-…`, status Error, serves nothing) is still listed in Vercel; delete it there if you like.
- [ ] If you want previews that work fully in future, add the Production variables to the Preview environment in
  Vercel → Settings → Environment Variables (ideally pointing at a separate test database, not the live one).
  Without them a preview has no database: you cannot sign in on it, and quote links show an error.

Your choices from T-164 are in: the accent is yellow, and the wordmark is the name "Qolumns" in the display font.
(The "Choose on the preview page" item in the T-164 section above is done.) The header button reads "Try it
free" at every width; the hero button keeps "Try it free: 10 quotes, no card".

- [ ] **Look at the live site, on your phone and on a computer:**
  1. *The demo at the top.* It plays once when the page opens: the customer answers and adds a photo, the tape
     measure draws out and the price lands, then Approve & send is pressed and turns to "Sent". It then stays
     still. Press "Play again". On a phone the three screens are one under another; nothing swipes sideways.
  2. *One yellow button per screen.* "Try it free: 10 quotes, no card" at the top and in the green band at the
     bottom. Every other button is quieter. Dark text and a thin dark edge on the yellow.
  3. *Set up in minutes:* three steps, each with its screen. *Your prices:* a price sentence that turns into a
     price list when you scroll to it ("Show it again" replays it). *What homeowners want:* three big figures with
     their sources. *Add it anywhere:* a QR code (point your phone's camera at it: on the live site it opens the
     example business's quote page), that page on a phone, and the form on a website.
  4. *Plans:* each card has its own button.
  5. *Login:* on a computer, an example estimate sits beside the form. Your browser should offer to fill in your
     email.
  6. *Reduce motion* (Accessibility settings): the demo shows its finished screens and nothing moves.
- [ ] **In the dashboard** (after signing in): "Needs your approval" is strong yellow with a small dark dot, not a
  pale colour. On Home the "Needs you" count sits on yellow. No dashboard button is yellow.
- **The pricing decision you made (recorded as AD-047):** the 14-day trial on Pro is removed. There is one free
  offer everywhere: 10 quotes, no card. From the production deploy onward, a business that picks any plan pays from
  that day.
  - [ ] Nothing needs changing in Stripe: the trial was added by our checkout, not stored on the Stripe prices.
    Worth a look anyway: Stripe → Product catalogue, that no price has its own trial set.
  - Anyone already in a trial keeps it to its end date.
  - The billing page (Settings → Billing) should show "Select Plan" on Pro, with no trial line.
- **The minimum charge is a floor, not an item** (your change to this ticket; recorded as AD-048). Live since
  the deploy above (worker and web app).
  - Home: the sentence is "$375 per room, heavy prep adds $250." and the price list has two lines.
  - Estimates: when a job comes to less than a business's minimum charge, the customer sees the job's real lines,
    then "Minimum charge of $400.00 applied" above the total. At the minimum or above it, nothing about a minimum
    shows anywhere. No total changed.
  - The worker was deployed together with the web app for this (the pricing engine lives in the worker).
  - [ ] Try it by hand (it could not be checked live without sending a real request): give a test service a minimum charge above its smallest job, send a
    small request through your quote link, and look at (1) the customer's quote page, (2) the quote in the
    dashboard, (3) the PDF, (4) More → Pricing trace. Each should list the real line and show the note once, with
    no "Minimum charge applied" line.
  - [ ] Then press Edit on that quote: raise the line a little (the note's "+ $…" shrinks and the total does not
    move), raise it past the minimum (the note goes), lower it again (the note is back). "Remove" takes the
    minimum off that quote for good; "Undo" brings it back until you save.
  - Quotes already sent keep their totals and now show the note instead of the line, with no change to stored
    data.
  - Worth knowing: once a quote is saved with its lines at or above the minimum, it no longer carries a minimum,
    so lowering its lines in a later edit does not bring one back.
  - Worth knowing: the Pricing trace page (quotes list → More → Pricing trace) did not open at all before this
    (an error page). That was an older fault, fixed here.
  - [x] **Correction: the "$375 job becomes $500" case was never reachable.** This item used to say that the
    quote checker adds a missed work step on top of the minimum, so a $375 job with a $400 minimum that gains a
    $100 step becomes $500, and that it had always worked that way. That was wrong. The code for it existed, but
    the checker has had no way to trigger it since February 2026, and no quote was ever priced like that (0 of
    1,543 checker runs locally, 0 of 5 in production). There was no pricing question to answer. The unused code
    is removed in T-166 (see that section).
  - [ ] The Features page still quotes "$375 per room, heavy prep adds $250, minimum job $400." as something you
    can tell the system. It is not shown as a price line there, so it was left. Say if you want it to match Home.
- Worth knowing:
  - The demo's screens are built from the product's own parts (the estimate document's pieces, the status label,
    the buttons, the QR encoder) at their real size, in the example business's green. The request form in the demo
    is a copy of the real form's layout, not the live form: the live one needs a real business behind it.
  - The small photo in the demo is the sample label the "Try it as a customer" page already uses. No photographs
    were added in this ticket.
  - Features and the trade pages are **not** redesigned yet (next ticket). They still have a green main button
    and the three small frames.
- **Follow-ups found here:**
  - [ ] On the customer's quote page, the small labels on the coloured price panel ("Your quote", "Reviewed and
    confirmed by…") are white at 60% and 75%. On the example business's green that is 3.4:1 and 4.3:1, under the
    4.5:1 rule. It depends on each business's colour. It is the quote page's own style, so it was not changed here.
  - [ ] The login form's fields are 38 px tall and "Sign up" is a small text link (part of the tap-size follow-up
    in the T-164 section).
- The live check is `scripts/hardcore-test/verify-t165.mts` (add `PLAYWRIGHT_DIR=…`; it saves the home page, the
  demo's last state, login and the dashboard into its results folder). It joins the regression set: run t146 to
  t165 before a commit or deploy (there is no verify-t159, t161 or t163).

## T-166 — The quote checker flags, it never corrects

Live since 2026-11-15 14:17 UTC. No price changes.

- **A correction to what you were told in T-165.** The "$375 job becomes $500" case was never reachable. The code
  for it existed, but the quote checker has had no way to trigger it since February 2026. No quote was ever
  priced that way: 0 of 1,543 checker runs on this computer had a fix applied, and 0 of 5 in production (counted
  read-only on 15 November 2026). The T-165 notes above and in the CHANGELOG now say so.
- **What you chose (recorded as AD-049):** the unused code is deleted. The checker reads a priced quote and
  reports issues. It cannot change a price, a line, a note or any wording. A test fails if that ever stops being
  true.
- **The label "auto-corrected"** in the checker's log meant: an issue was found, nothing was corrected, and the
  quote went on without being held. It is renamed "passed with issues".
- [x] **Deploy, in this order:** done 2026-11-15 14:17 UTC (commit `79ac663`).
  1. the worker (`estimator-worker-production`, version `b288ae8c-7de3-41cd-a3b5-3655fd3b1a02`);
  2. migration 41 (`bash scripts/deploy-migration-41.sh`): the 4 old log rows now read "passed with issues",
     none is left under the old label, and no row has a correction recorded. It touched no quote, price or
     setting.
  3. the web app was not deployed: nothing it runs changed.
  Either order would have worked (the label is plain text in the database, with no rule on its values); the
  worker went first so no new row is written under the old label. Checked live, read-only: the worker's health
  check and the home page answer, and the quote API answers 404 to a made-up link.
- [ ] **Hand test:** send two ordinary requests through your quote link, one small and one
  larger. Each should be priced exactly as before, line by line. Nothing should look different anywhere: this
  ticket removes code that never ran.
- [ ] **A decision for you: should the checker's findings hold a quote?** Today they do not. Every business
  starts with the setting "auto-correct" for critical, high and medium issues, and no screen lets anyone change
  it. Since nothing is corrected, that setting means the issue is written to a log no screen shows, and the
  quote goes on. On this computer about 1 run in 8 (203 of 1,543) found such an issue; in production 4 of the 5
  logged runs did. (I did not look at each business's settings row in production, only at the log.) The choices:
  - leave it (the checker is a log only);
  - hold those quotes for your approval (more quotes will wait for you; this needs a ticket, and a look at how
    often the checker is right);
  - show the findings to the business on the quote without holding it (a ticket).
- [ ] Smaller: the stored setting is still named "auto-correct". Renaming it rewrites every business's settings
  row; it can ride with whichever choice you make above.
- Run t146 to t165 before a commit or deploy, as before. There is no verify-t166: there is nothing for a real
  request to reach.

## T-167 — Say what the AI does, and show it

- [x] **Deployed 2026-11-15 15:52 UTC** (commit `e114e7d`): web only (`dpl_ByP5uW3i3ReEgv124X9psAfxxpuw`, serving
  `estimator-web-phi.vercel.app`). No worker change and no migration. Checked live, signed out and read-only
  (nothing was submitted): Home, Features, Pricing and the six trade pages load; Home is in the new order with
  the trade pills inside "Choose your trade"; no marketing page says "exact", "firm", "guaranteed" or "AI chat";
  Pricing's two links open the demo with no error; the quote API answers 404 to a made-up link.
- The preview and the failed preview left over from T-165 are both **deleted**. Vercel lists production
  deployments only.
- **A rule you added, now in `CLAUDE.md`:** which checks a ticket needs ("Regression runs"). Marketing, design
  and copy tickets run their own script and only the earlier scripts that cover the pages changed; the full set
  is for pricing, the quote flow, the worker, emails, migrations, the end of a batch of design tickets, and
  before launch.
- [ ] **Running the full regression set faster** (your question; not built). It takes about 23 minutes one
  script after another. Running three at once looks safe for most of it, with four scripts kept on their own
  (the demo business, the cron route, and the two that time an animation), and would take roughly 10 to 12
  minutes. It needs a small runner script and three clean trial runs, so it is a ticket of its own. Details in
  `Docs/CHANGELOG.md`, T-167.
- **The message is on the site:** "The AI works out the job. Your prices work out the cost." Home has a new line
  under the headline, one new beat in the demo (the label is read, the customer taps "Yes, 50 gal is right", the
  price lands) and a new section, "What it notices". Features and the six trade pages show real screens.
- **What the AI really does is written down** in `Docs/design/ai-capabilities.md`. The site may only claim what is
  on that list, and a test fails if it claims more. To claim something new later, add it to the list first, with
  the evidence that it runs.
- [ ] **Look at it, on your phone and on a computer:**
  1. *Home:* the line under the headline; the demo (it should show the question and the pressed "Yes" before the
     price); the three figures straight after the hero; "What it notices" with its four screens; the trade pills
     under "Choose your trade"; no trades row under the hero.
  2. *Features:* the message as the headline, five steps each with its screen, step 05 "Track".
  3. *A trade page with a label* (water heaters, HVAC, electrical): the form and the reading beside the headline.
  4. *Painting:* the wall area "From your photos". *Plumbing and garage doors:* no claim that anything is read
     from a photo.
  5. *Pricing:* "Hosted estimate pages" and "Your branding on every estimate" open the demo.
- [ ] **Photographs to supply** (none were added; a real one beats a screen in each of these places). They must be
  yours or licensed, never stock passed off as a customer's job:
  - *Water heaters:* a real tank rating label, sharp and square on (it would replace the drawn sample label), and
    a tank where it stands in a garage or closet.
  - *HVAC:* the rating plate on an outdoor unit with the model number readable, a furnace's plate inside its
    front panel, and an outdoor unit in place. (Today the HVAC page names the photo and shows none.)
  - *Electrical:* the label inside a panel door showing the amps, and a finished Level 2 charger on a garage wall.
    (Today the page names the photo and shows none.)
  - *Painting:* a house front as a customer would photograph it, with the front door in the shot (the door is
    what the wall is measured against), and a finished room.
  - *Plumbing:* a fitted toilet or faucet, and a close shot of a shut-off valve.
  - *Garage doors:* the springs above a door seen from inside the garage, and a finished door.
  - *Home:* a homeowner looking at a quote on a phone, for "What homeowners want".
- **Follow-ups found here:**
  - [ ] **Tidy the "What we saw" line on the real customer page** (your note; for the customer pages ticket). On
    the question screen a customer reads, for example, `What we saw: Read from the tank's rating label (photo 1):
    "CAPACITY 50 U.S. GAL MODEL NO. EX-50-NG-DEMO" → 50 gal (capacity printed on the label)`. It is written for
    us, not for a homeowner. The demo leaves it out.
  - [ ] The customer's question itself starts with the template's description ("Capacity of the existing water
    heater tank: we read 50 gal…"). The marketing screens show the shorter sentence you approved; the real page
    could say the same.
  - [ ] The question page's heading is "Quick questions about your quote" and its intro says "to finalize your
    quote". At that point the customer has an estimate, not a quote.
  - [ ] **Pricing's plan lines** still include "Accuracy insights from finished jobs" and "LiDAR room scanning on
    site". The first is a feature name, not a promise, but it sits close to one; the second is the on-site app,
    which new businesses are not offered. They come from the plans, so they were not changed here.
  - [ ] **Label reading asks every time.** In every recorded run the sample label was read correctly and the
    customer was still asked to confirm it. That is the safe behaviour and the site now describes it. If you
    want a clear reading to price straight away, that is a pricing-flow decision and its own ticket.
  - [ ] The old three small frames (`ProductStrip`) are on no marketing page now; only `/design` still shows them.
  - [ ] Features' hero and the closing bands are words only, and a trade page's three feature cards have no
    picture. A photograph from the list above would fill them.
  - [ ] `service-match` (checking that a described job fits the chosen service) is in the inventory but on no
    page: it has no log, so it has not been seen working. Worth a live check before it is ever claimed.

## T-168 — Hero photo, the three-frame demo, three-column figures

- [x] **Deployed 2026-11-15 17:27 UTC** (commit `fd72403`): web only (`dpl_4bHfcStiezRGpxxQLGbxQC7EFFV3`, serving
  `estimator-web-phi.vercel.app`). No worker change and no migration. Checked live, signed out and read-only
  (nothing was submitted): the home page loads; the photograph loads behind the hero on a computer and sits above
  the headline on a phone; there is no switcher; the page does not jump while it loads.
- The preview is **deleted**. Vercel lists production deployments only.
- **Hero option b is the hero** (your choice): a painter on a porch checking a phone. The switch and the other
  three photographs are removed.
- **The photograph was made by an image model** (Google's `gemini-3-pro-image`) and its right edge was cut off,
  because a tape measure there carried made-up lettering. The record is in `Docs/design/photos.md`. The rules for
  such photographs are in `Docs/design/system.md`: a scene, never a customer; never beside a review or a figure
  about real users; no brands, no text or screens drawn by the model. A real photograph of your own would still
  beat it.
- [ ] **Look at it, on your phone and on a computer:**
  1. *Computer:* the photograph behind the hero, fading into the page under the words; the three frames half on
     it; the headline and the line under it easy to read.
  2. *Phone:* the photograph as a block above the headline, nothing written over it.
  3. *Tablet width (between a phone and a laptop):* the photograph is a wide block above the headline. It is
     tall there; say if you want it shorter.
  4. *The demo:* three frames of one height. It stops with Accept locked and "Approve & send" showing; it no
     longer turns to "Sent". Say if you want the press back.
  5. *What homeowners want:* three columns side by side, one column on a phone.
- [ ] **Three framed screens, then three columns of figures.** Both are in threes now, by your two instructions.
  They differ (framed screens on paper, open columns on grey) and the design file records it; say if it reads
  as repetition.

## T-169 — Dashboard: what the AI understood, the customer's photos, the phone layout

- [x] **Deployed 2026-11-16 10:57 UTC** (commit `4915e9d`): web only (`dpl_81qyt3LxSpF3jMo75M9b31UtHgpf`, serving
  `estimator-web-phi.vercel.app`). No worker change and no migration. Checked live, signed out and read-only
  (nothing was submitted): the home page and the login page load; `/app` sends a signed-out visitor to the
  login page; the photo route refuses a signed-out visitor (401); the public quote API answers 404 for a made-up
  token.
- The preview is **deleted**.
- [x] **"Worth checking" is switched off** (your decision, 2026-11-16). Everything else in "What Qolumns
  understood" is live. The group is behind one flag in the code (`SHOW_WORTH_CHECKING` in
  `apps/web/src/lib/quote-understanding.ts`). The checker still runs and logs as before; no business sees its
  notes.
- [x] *(Built in T-172, not yet deployed.)* **Worker ticket: tell the quote checker the minimum charge, base fee, tax and currency, then switch "Worth
  checking" on.** Today the checker is not told those four things, so it can write a wrong note: on a real test
  quote with a $400 minimum it wrote "an unconfigured minimum charge of £25 was added", and on taxed quotes it
  can say "the total does not match the lines". The ticket: add the four to what the checker is given
  (`apps/worker/src/ai/quote-validator.ts`), run it over quotes with a minimum, a base fee and tax and read the
  notes, then set the flag to on and deploy web. It is a worker change, so it needs the full regression set.
- [x] *(Built in T-172, not yet deployed.)* **Worker ticket: small photo copies at upload.** The small photos on Home, the Quotes list and the quote
  page are the full uploads (a few hundred KB each). Storing a small copy when a photo is uploaded would make
  the lists load faster on a phone.
- [ ] **Look at it, on your phone and on a computer.** The signed-in screens could not be checked live (the live
  checks are signed out); they passed on the local stack:
  1. *A quote with a photo:* the photo at the top of "What Qolumns understood", tap to enlarge, then what was
     read, the question and the answer, then the price in large figures.
  2. *A plain quote:* no panel at all.
  3. *Home:* a small photo on a waiting row; the small line and the up or down mark under "Last 30 days".
  4. *Services on your phone:* Edit, Disable and Delete on every row, Delete set apart.
- [ ] **The home page demo** at tablet width: the logo sits above the business name there, so nothing is cut.
  The frames are 16 px taller on a computer because the name takes two lines beside the logo.

## T-170 — Marketing photos and fixes

- [x] **Deployed 2026-11-16 14:40 UTC** (commit `6b2ca4a`): web only (`dpl_4qavC6PeWmPZTY8GWRZYQjc3aMwn`, serving
  `estimator-web-phi.vercel.app`). No worker change and no migration. Checked live, read-only (nothing was sent
  to the site): Home, Pricing and the six trade pages load; the hero photograph shows on a phone and on a
  computer with the headline starting on it; each trade page shows its photograph; on `/demo` the painting
  service offers "Use a sample photo" and it is the room; Pricing shows Starter and Pro with three "Coming
  later" lines.
- The preview is **deleted**.
- [ ] **Try one sample photo on the live demo yourself.** The live checks may not send a request, so they
  stopped at the button. On `/demo` pick Interior Painting or Garage Door Spring Replacement, press "Use a
  sample photo" and finish: you should get a price in under a minute.
- [ ] **Look at it, on your phone and on a computer:**
  1. *Home on your phone:* the painter is at the top and fades into the page; the headline is on the first
     screen.
  2. *Home on a tablet or a narrow window:* the same layout as on a computer, with the painter on the right.
  3. *"Add it anywhere":* three pictures of one size. The QR code is on a van; point your phone at it. The
     business's name is on one line in the phone.
  4. *The bottom of Home:* the evening photograph behind "Your next customer could have your price tonight."
  5. *Each trade page:* a photograph of that trade's work behind the top.
  6. *Pricing:* two plans, Starter and Pro; three lines on Pro say "Coming later".
- [x] **Business is off the public pages** (your decision, 2026-11-16): the Pricing page and Home's plan cards
  show Starter and Pro. It comes back by itself when one of its own lines (LiDAR, team members, priority
  support) is marked live in `apps/web/src/lib/marketing/plan-claims.ts`. The plan is unchanged: $199, 600
  quotes, still on the billing page, and `/signup?plan=plan_us_business` still works for anyone who has the
  link.
- [ ] **"Accuracy insights from finished jobs" is on Pro and Business, but every business gets it.** Nothing in
  the code holds it back from Starter or the free allowance. Either hold it back by plan, or list it on Starter
  too. I left the page as the plans have it.
- [ ] **"Your branding on every estimate"** is what Pro adds in name; what it really adds is that our "Prepared
  with Qolumns" badge is left off. A business's logo and colour are on every plan. Say if you want the line
  reworded.
- [ ] **Two lines on Pricing are mine, because the plans' own taglines name things that are not live.** Pro:
  "Everything in Starter, with more quotes and no badge of ours on your estimates". Business: "Everything in
  Pro, with the most quotes a month". Change the words in `apps/web/src/lib/marketing/plan-claims.ts`.
- [ ] **"Most popular" is now "Recommended".** With no customers yet, "most popular" could not be backed.
- [ ] **The dashboard's billing page still lists the plans as they are defined** (text messages, WhatsApp, the
  on-site app, LiDAR, with no "Coming later"). The dashboard was out of this ticket's scope.
- [ ] **The link under the phone's address bar is the site's real address.** On production today that is
  `estimator-web-phi.vercel.app/quote/example-home-services`, on two or three lines. It will read
  `qolumns.com/quote/example-home-services` by itself once the site moves to that domain. I did not show a
  domain the site does not have.
- [ ] **On a trade page on a computer, the top is between about 60 and 220 px taller than it was.** The trade's form sits in
  the right-hand column, which is where the photograph's subject would be, so the photograph is above it and the
  form sits partly on it. Say if you would rather have the form further up, over the photograph.
- [ ] **Three photographs carry a small retouch made in code**, and one a cut (the record is
  `Docs/design/photos.md`): a second yellow object painted out of the painting picture, a stamp on the
  plumber's wrench blurred, a warning tag covered in the garage spring sample; the electrician's picture is cut
  above the belt. If you would rather have none retouched, those three are the ones to make again.
- [ ] **The van's picture is not at 2400 px.** It is shown at about 360 px wide at most, so its files are
  1000 px and 500 px.
- [ ] **The demo's two new sample photos cost one more AI call each time a visitor uses them** (the photo is
  read, as a customer's would be). The demo's daily cap and per-visitor limit still apply.

## T-171 — Customer pages: the request form, the quote page, billing, three leftovers

- [x] **Deployed 2026-11-16 16:08 UTC** (commit `670408e`): web only (`dpl_68tijQyY2M7rDTH4JaupnL9wjqVZ`, serving
  `estimator-web-phi.vercel.app`). No worker change and no migration. Checked live, read-only (nothing was
  sent): Home, the login page and the demo load; the public quote API answers 404 for a made-up token; the
  keyboard focus ring on Home's closing band can be seen again (the fault T-170 left there is fixed).
- The preview is **deleted**.
- [x] *(Built in T-172, not yet deployed.)* **Next ticket: the form's step count.** On the step where the customer picks a service the form says
  "Step 1 of 4"; once a service with questions is picked it says "Step 2 of 5". You accepted this for now
  (2026-11-16); the fix is planned for the next ticket.
- [ ] **A setting for a business to write its own "What happens next" steps.** After a customer accepts, the
  quote page lists three steps in our words (the business gets in touch, a time is agreed, the job). A
  business has nowhere to write its own. The ticket: a place in Settings for up to three short steps, shown to
  the customer in the business's own words when it has written them, ours when it has not.
- [ ] **Send one real request through your quote link.** The live checks may not send a request, so the new
  form, the question, the quote page and Accept were proven on the local stack only.
- [ ] **Look at it on your phone.** Open your quote link and send a request with a photo:
  1. *The form* runs edge to edge; the top says "Step 2 of 5".
  2. *A question with a few choices* is rows you tap, not a picker.
  3. *Photos:* tap "Tank rating label" and add a photo, and only that row is ticked. Add one with "Add a photo"
     and no row is ticked.
  4. *After "Get my estimate"* you land on the question or the estimate in the same tab.
  5. *The question* is one sentence: "We read 50 gal from your tank's rating label. Is that right?"
  6. *The quote page* has no "Viewed" pill, and "Measurement & takeoff" says only what was read, with no prices.
  7. *Accept:* the form comes into view; after you confirm, "What happens next" lists three steps.
- [ ] **Text on your brand colour may change colour.** Text on a business's colour is now chosen so it can be
  read (4.5:1). A business with a light colour (yellow, orange, pale green) gets dark text where it had white.
  One with a bright mid-tone colour (a bright blue such as #3B82F6, a bright red) gets black text where it had
  white, because neither white nor our dark ink can be read on it. This is on buttons too, not only the price
  panel. Say if you would rather keep white on those and accept that it is harder to read.
- [ ] **The total still appears in three places on the quote page:** the price panel, the last row of the
  breakdown, and the Accept button. I read "the price appears once" as the audit's finding (the price lines
  repeated in a second block) and removed that. Say if you want the breakdown's total row or the button's
  amount gone too.
- [x] **The form's last button reads "Get my estimate"** (your decision, 2026-11-16; it read "Get Quote"),
  everywhere the form runs: the quote link page, the three embed modes and the demo.
- [ ] **The billing page no longer lists "PDF generation" and "Email notifications".** It lists exactly what
  Pricing lists, from the same source, which is how the two cannot disagree. Both are true of every plan; say
  if you want them on both pages.
- [x] **The business's on-site app still shows the label's raw text** under a question (`apps/mobile`). It is
  the business's screen, so I left it. **Fixed in T-182:** one plain line ("Read from the panel label, photo 1:
  100"), with the label's own words on a separate line.

## T-172 — Worker fixes: the checker's settings, small photo copies, AI time limits, colour classes, the step count

- [x] **Deployed 2026-11-16 18:06 UTC** (commit `c891192`): the worker first (version `d739210a`), then the web
  app (`dpl_35mburqfwb7cJgSGidy5rQDPK1u4`, serving `estimator-web-phi.vercel.app`). No migration. Checked live,
  read-only (nothing was sent): Home, the login page and the demo load; the demo form's first step reads "Step 1
  of 5"; the public quote API answers 404 for a made-up token; the worker answers its health check.
- The preview is **deleted**.
- A quote checked before this deploy shows no "Worth checking"; only quotes priced from now on can.
- [ ] **"Worth checking" is switched on.** The checker is now told your minimum charge, base fee, tax and
  currency. Four correct quotes that it used to flag (6 runs of 8) came back clean (12 runs of 12). It is still
  an AI's note: it can be wrong about wording or scope. If you see a wrong one on a real quote, tell me the
  quote and I will look; to switch the group off again is one line (`SHOW_WORTH_CHECKING`).
- [ ] **Look at the colour changes** (they are live). Open
  `scripts/hardcore-test/results/t172-colour-screens/index.html` on this computer: each changed page before and
  after, at 390 and 1440. What you will notice most:
  1. the page behind a window, and behind the dashboard's phone menu, is now dimmed;
  2. on the customer quote page, the "Measurement & takeoff" block has a pale butter ground and the range bar
     shows its filled part;
  3. tinted boxes (Danger Zone, "customer accepted", notes) have a soft coloured edge.
  The pictures were taken before your three follow-up changes, so the service window's step ring and AI boxes
  look slightly different in them from what is live.
- [ ] **Three small things I decided; say if you want any of them the other way.**
  1. *The current step in the service set-up window* had a tape-coloured ring written for it. Tape is for
     measurement only, so I removed it. **Done (your decision, 2026-11-16): the ring is juniper.**
  2. *An error on a form field* now has a full red edge. The half-strength red written for it could not be
     seen well enough (2.3:1).
  3. *Notices in butter* (the demo note, the test-mode note, the plan-usage banner) keep their butter ground
     and did not get the tape edge written for them. They are the older "butter outside measurement" item.
- [x] **"Support Tools" in the admin bar** was amber on dark ink, 2.4:1. Fixed before the commit (your
  decision, 2026-11-16): it is now a pale pill with dark text, 4.5:1 or more.
- [ ] **The AI boxes in the add or edit service window still have a pale yellow ground in two places.** The
  "AI Draft" banner ("Pre-filled from AI draft") and the closed "AI Refinement" bar use the amber warning tint
  (`tertiary-light`), which is the same colour value as butter, at full strength. That was there before T-172,
  so I left it, as you said. What T-172 had switched on there is removed: the amber edge on those two, and the
  pale ground and edges of the open "AI Refinement" box. Moving these two to a colour that is not butter's is a
  small design ticket (the tint is shared by every amber warning pill).
- [ ] **A time limit can be changed without a code change** if the AI provider is slow one day:
  `AI_TIMEOUT_WORDING_MS`, `AI_TIMEOUT_ADDONS_MS`, `AI_TIMEOUT_CHECKER_MS` on the worker (30, 20 and 30 seconds
  today; names only, no secret).
- **Photos sent by text, WhatsApp or the mobile app get no small copy** (only the web form makes one). It is in
  the product backlog near the top of this file, item 10, with the WhatsApp ticket.
- [ ] **After the deploy, send one real request with a photo through your quote link** and open the quote on
  the dashboard: the small photo should load at once, and tapping it should open the full photo.

## T-174 — Move to qolumns.com, cleaner quote links, Home's examples, the sample name

- [x] **Live 2026-11-16 22:39 UTC** (commit `8a048cb`, web `dpl_4pZAN5TUjt8peh6PcDmDtimz5ZN3`). The product is at
  `https://qolumns.com`. `www.qolumns.com`, `qolums.com` and `www.qolums.com` redirect to it. The old address
  still serves, so every quote link, QR code and embed code already given out keeps working. Emails are sent
  from `quotes@qolumns.com`. No migration; the worker's code was not redeployed (only two of its settings).
- Checked live, read-only, 34 of 34 (`verify-t174.mts --live`). The three previews are **deleted**.
- [ ] **Try by hand** (the live check cannot send anything):
  1. *An email in.* Send a message to `hello@qolumns.com` from another address. It should reach your inbox.
  2. *A real request with a photo,* through your quote link on `qolumns.com`. The photo should upload (this is
     the first upload from the new address), and the email you get should come from "Qolumns" at
     `quotes@qolumns.com`. Approve it for a customer address you can read: that email should come from
     "<your business> via Qolumns" at the same address, and a reply to it should be addressed to your business.
     If either lands in spam, tell me before anything else changes.
  3. *Sign in on `qolumns.com`.* You are signed out there: a sign-in belongs to one address. Then open Quote
     link: the link, the QR code and the website code should all say `qolumns.com`.
  4. *An old link.* Open a quote link or scan a QR code you gave out before today. It should still open, on
     the old address.
  5. *A new account* (optional): sign up on `qolumns.com` with a spare address. The confirmation email's link
     should land on `qolumns.com`.
- [ ] **In a week:** if emails are arriving normally, change the `_dmarc` record on `qolumns.com` to
  `v=DMARC1; p=quarantine;`.
- No business has a random link today (0 of 4), so nobody sees "Get a cleaner link" yet. The next business
  whose name is taken will.

### The DNS records (done by the owner, 2026-11-16; kept as the record of what is there)

The Postmark DKIM Hostname is `20261116223106pm._domainkey`. The steps were:

1. **Postmark: add the sending domain.** Postmark → Sender Signatures → Add Domain or Signature → Add Domain →
   `qolumns.com`. Postmark then shows a DKIM record (a Hostname ending `._domainkey` and a long Value) and the
   Return-Path record. Keep that page open. I could not do this step: this Mac has no Postmark account token and
   the browser is not signed in to Postmark.
2. **Cloudflare, `qolumns.com` → DNS → Records.** Delete every record Cloudflare imported from Namecheap, then
   add the rows marked "you" in the table.
3. **Cloudflare, `qolumns.com` → Email → Email Routing.** Turn it on (it refuses while Namecheap's MX records
   are still there, so do step 2 first). Add your own inbox as the destination address and click the link
   Cloudflare emails you. Create the address `hello@qolumns.com` → that destination. Cloudflare adds its three
   MX records, its SPF record and its own DKIM record itself, and locks them.
4. **Cloudflare, `qolums.com` → DNS → Records.** Delete the imported records and add that domain's rows.
5. **Postmark:** press Verify on the DKIM and the Return-Path rows. It can take a few minutes.
6. **Tell me "DNS is in"**, and paste the DKIM Hostname Postmark gave (the name only, for example
   `20261116123456pm._domainkey`; it is public, not a secret).

**`qolumns.com`**

| Do | Type | Name | Value | Proxy |
|---|---|---|---|---|
| Remove | A | `@` | the Namecheap parking address Cloudflare imported | |
| Remove | CNAME | `www` | the Namecheap parking name | |
| Remove | MX | `@` | all five `eforward1` … `eforward5.registrar-servers.com` | |
| Remove | TXT | `@` | `v=spf1 include:spf.efwd.registrar-servers.com ~all` | |
| Add (you) | CNAME | `@` | `737c965c43751a11.vercel-dns-017.com` | **Off** (DNS only) |
| Add (you) | CNAME | `www` | `737c965c43751a11.vercel-dns-017.com` | **Off** (DNS only) |
| Add (you) | TXT | the DKIM Hostname from Postmark (step 1) | the DKIM Value from Postmark | n/a |
| Add (you) | CNAME | `pm-bounces` | `pm.mtasv.net` | **Off** (DNS only) |
| Add (you) | TXT | `_dmarc` | `v=DMARC1; p=none;` | n/a |
| Added by Cloudflare (step 3) | MX | `@` | `route1.mx.cloudflare.net`, `route2.mx.cloudflare.net`, `route3.mx.cloudflare.net` (Cloudflare sets the priorities) | n/a |
| Added by Cloudflare (step 3) | TXT | `@` | `v=spf1 include:_spf.mx.cloudflare.net ~all` | n/a |
| Added by Cloudflare (step 3) | TXT | `cf2024-1._domainkey` | Cloudflare's own key | n/a |

**`qolums.com`** (the spare spelling: it only redirects, and sends no email)

| Do | Type | Name | Value | Proxy |
|---|---|---|---|---|
| Remove | A | `@` | the Namecheap parking address | |
| Remove | CNAME | `www` | the Namecheap parking name | |
| Remove | MX | `@` | all five `eforward….registrar-servers.com` | |
| Remove | TXT | `@` | `v=spf1 include:spf.efwd.registrar-servers.com ~all` | |
| Add (you) | CNAME | `@` | `737c965c43751a11.vercel-dns-017.com` | **Off** (DNS only) |
| Add (you) | CNAME | `www` | `737c965c43751a11.vercel-dns-017.com` | **Off** (DNS only) |
| Add (you) | TXT | `@` | `v=spf1 -all` | n/a |
| Add (you) | TXT | `_dmarc` | `v=DMARC1; p=reject;` | n/a |

Notes on the table:
- **Proxy off** on the four Vercel records and on `pm-bounces`. Vercel asks for DNS only so it can issue
  its certificate, and with the proxy on Postmark cannot verify the Return-Path.
- Both names point at Vercel with a CNAME, the root included: that is what Vercel asked for on this project
  (`vercel domains verify`), and Cloudflare allows a CNAME at the root.
- **SPF:** `qolumns.com` needs only Cloudflare's SPF record. Postmark does not use the root's SPF: its mail
  passes through `pm-bounces` (the Return-Path) and DKIM.
- **DMARC** starts at `p=none` (watch, block nothing). After a week of real emails arriving, change it to
  `v=DMARC1; p=quarantine;`. Say if you want reports sent to an address.
- The two `qolums.com` TXT rows tell mail servers that this domain sends no email, so nobody can fake mail
  from it. If you would rather have one mechanism for redirects, they can be left out; the redirect does not
  need them.
- I could only see the imported records from outside (they sit behind Cloudflare's proxy): an A and a `www`
  record, five MX and one TXT on each domain. If Cloudflare lists anything else it imported, delete that too.

### What was done once the DNS was in (all done)

One thing was not on this list: Vercel had issued no certificate for the four names, so HTTPS failed until
`vercel certs issue <name>` was run for each.

1. Check each record resolves, and that all four names reach Vercel with a certificate.
2. The storage bucket accepts uploads from the new address (it accepts only the old one today; without this a
   customer's photo upload on `qolumns.com` would fail).
3. Supabase auth: Site URL `https://qolumns.com`, both addresses allowed.
4. Commit and push; worker `APP_URL` and Vercel `NEXT_PUBLIC_APP_URL` to `https://qolumns.com`; deploy the web
   app. The worker itself is not redeployed (no worker code changed).
5. Check Postmark shows the domain verified, then switch the sending address to `quotes@qolumns.com` on the
   worker and the web app. Until then emails keep going out from `thegreatbilliom.com`, so none is lost.
6. `verify-t174.mts --live` (read-only), then record the deploy.

Steps 2 to 5 are `scripts/deploy-t174-settings.sh` (`--dry-run` shows what each sends).

### For you to know or decide

- [ ] **No town is stored for a business.** Setup asks for a service area as postal codes, so today's clean
  options read like `alex-hvac-replacement`, `alex-hvac-78701` and `alex-hvac-us`, not `alex-hvac-austin`. A
  town would need one optional question in setup ("Where are you based?"). Say if you want that ticket.
- [ ] **"What the photos show" on Home.** I read it as the walls example and reordered the four examples you
  have. If you meant a new example for every trade (the AI's notes on condition and access from any photo),
  that is a fifth example with its own screen: say so.
- [ ] **Sign-up confirmation emails do not come from Postmark.** Supabase sends them from its own built-in
  sender, which allows only a few emails an hour and uses a Supabase address. Before real signups arrive it
  should send through Postmark (Supabase → Authentication → SMTP, with a Postmark SMTP token). Not in this
  ticket.
- [ ] **Stripe webhook** (test mode) points at the old address. It keeps working. To move it: Stripe →
  Developers → Webhooks → the endpoint → change the URL to `https://qolumns.com/api/webhooks/stripe`.
- [ ] **`hello@qolumns.com` shows nowhere yet.** The only place that prints the support address is the
  "Who is behind this" section on Home, which is still empty (`lib/marketing/founder.ts`). "Priority support" on
  the Business plan stays "Coming later": having an address is not a promise of a faster answer. Say if you
  want the address in the footer.
- [ ] **Google and the old address.** Both addresses serve the same pages. Marketing pages should tell search
  engines the `qolumns.com` copy is the real one (a canonical link on each). Small follow-up; say if you want it.
- [ ] **The Meta application can start once this is live.** Use `https://qolumns.com` as the business website
  and `https://qolumns.com/privacy` and `/terms` as the policy links. When you reach the WhatsApp webhook step,
  the callback address is `https://qolumns.com/api/whatsapp/webhook` (the keys are still not set in production:
  T-144 and the WhatsApp section above).
- The T-149 note "Later (custom domain)" is this ticket. Quote links, QR codes and embed code made after the
  switch carry `qolumns.com`; the ones already given out keep working on the old address, for good.

## T-175 — Connect WhatsApp in one click (Meta Embedded Signup)

- [x] **Deployed 2026-11-17 00:13 UTC** (commit `25ba389`, web `dpl_B6YEx4aCvK3Foa2DNpqWnZqNasUG`): migration 42
  first, then the web app. The worker was not touched. Checked live, read-only: Home, Privacy and Terms load;
  the webhook refuses a wrong verify token (403) and a call with no valid signature (401). The two previews
  are **deleted**.
- **First real run, 17 November 2026 (yours):** connecting works end to end against the real Meta. The test
  business "Bluum - Qolumns Test" is connected with Meta's number +1 555-759-6002; its display name is in
  Meta's review. The test message was accepted by Meta and not delivered: see T-176, section 1.
- A temporary icon for the Meta app is at `Docs/design/meta-app-icon.png` (1024 × 1024).

### 1. Settings (done 2026-11-17: all five are in Vercel production)

| Name | What it is | Secret? |
|---|---|---|
| `NEXT_PUBLIC_WHATSAPP_APP_ID` | The Meta app's App ID (`4654271271562035`) | No |
| `NEXT_PUBLIC_WHATSAPP_CONFIG_ID` | The Embedded Signup configuration ID (`1566858898811795`) | No |
| `WHATSAPP_APP_SECRET` | Meta app → App settings → Basic → App secret | **Yes** |
| `WHATSAPP_VERIFY_TOKEN` | A long random string you invent. The same string goes into Meta's webhook settings | Treat as one |
| `WHATSAPP_ENCRYPTION_KEY` | Encrypts each business's stored token. Make it with `openssl rand -hex 32` | **Yes** |

- Add each with `printf '%s' 'VALUE' | npx vercel env add NAME --environment production --sensitive --yes`
  (the two `NEXT_PUBLIC_` ones with `--no-sensitive`). They take effect at the next production deploy.
- **Keep a copy of `WHATSAPP_ENCRYPTION_KEY` somewhere safe and never change it.** With a different key every
  stored connection becomes unreadable and every business has to connect again.
- Until all five are set, the page shows "One-click connect isn't switched on yet" and nothing connects.

### 2. Putting it live (steps 1 to 3 done; step 4 is yours)

1. `bash scripts/deploy-migration-42.sh` (first: the new code reads the new columns).
2. The five settings above.
3. Commit, then `npx vercel deploy --prod`. The worker is not touched.
4. The Meta dashboard list below (the webhook can only be verified once step 3 is live).

### 3. What to do in the Meta dashboard

**App settings → Basic**
- [ ] App icon: upload `Docs/design/meta-app-icon.png` (1024 × 1024, the wordmark on juniper; temporary).
- [ ] Privacy policy URL: `https://qolumns.com/privacy` (checked: the page is live).
- [ ] Terms of Service URL: `https://qolumns.com/terms` (checked: the page is live).
- [ ] User data deletion → Data deletion instructions URL: `https://qolumns.com/privacy` (section 8 says how).
- [ ] App domains: `qolumns.com` and `estimator-web-phi.vercel.app`.
- [ ] Category: Business and pages. Contact email: `hello@qolumns.com`. App purpose: for clients (other
      businesses use it).
- [ ] Website platform → Site URL: `https://qolumns.com`.
- [ ] Copy the **App secret** from here into `WHATSAPP_APP_SECRET` (step 1). Do not paste it anywhere else.

**WhatsApp → Configuration → Webhook** (after the web app is live with the settings)
- [x] Callback URL: `https://qolumns.com/api/whatsapp/webhook` (done 17 November)
- [x] Verify token: the value you gave `WHATSAPP_VERIFY_TOKEN`. Press Verify and save. (done 17 November)
- [x] Webhook fields: subscribe **`messages`** and **`account_update`**. Those two only. (done 17 November)
- [ ] **Do not subscribe** `history` or `smb_app_state_sync`. (T-177: `smb_message_echoes` IS now to be
      subscribed; see T-177, section 2.) They carry a business's
      contact list and old chats from the WhatsApp Business app. Qolumns ignores them, and not subscribing
      means they are never sent to us at all.

**Facebook Login for Business** (you have done these; listed so they can be ticked)
- [x] The six Client OAuth switches on; both addresses in the allowed domains and redirect URIs.
- [x] Configuration `1566858898811795`: permissions `whatsapp_business_management` and
      `whatsapp_business_messaging`; asset: WhatsApp accounts. Nothing else. (confirmed 17 November)

**WhatsApp → Embedded Signup Builder → "Check a launch config"**
- [ ] Paste `{"setup":{},"featureType":"whatsapp_business_app_onboarding","sessionInfoVersion":"3"}`. It
      should resolve to **v4** with WhatsApp Business app onboarding on. If it says otherwise, tell me what it says.

**App roles**
- [ ] Anyone who will test before App Review needs a role on the app (admin, developer or tester). In
      development mode nobody else can finish the sign-up.

**Then, in this order:** business verification of the portfolio → App Review for the two permissions
(`Docs/meta-app-review.md` has the two recordings and the answers) → switch the app to Live.

### 4. The first real run (after steps 2 and 3)

1. On `https://qolumns.com/app/whatsapp` press **Connect WhatsApp** and go through Meta's window to
   **Finish**. Use a business and number of your own.
2. The page should show **Connected** with the number. If it shows "Finish registering the number", the
   number already has a two-step PIN: enter it.
3. From your own phone send `Hi, I need a quote` to that number. A reply should arrive in a few seconds.
4. Press **Send a test message** to your own phone.
5. Add a payment method in WhatsApp Manager and press **Check again**.
6. **Tell me what happened at each step, and paste any error words exactly.** Four things are only known
   once a real account is tried (they are listed in the changelog under "Not proven"), and I will fix what
   differs.

### 5. For you to decide

- [ ] **Embedded Signup v4 or v5.** You said v4, and that is what this uses. Meta's docs now say v5 is the
  latest (20 October 2026). v4 still works and is what your configuration runs. v5 turns the "use the number I
  already have in the WhatsApp Business app" option on by default. Moving is one line; the code already reads
  v5's messages. Say if you want it.
- [ ] **A number that is also on the WhatsApp Business app.** Supported, and built. On such a number Qolumns
  **only answers a message that asks for a quote, an estimate or a price**, because the owner's other chats
  (suppliers, friends, existing jobs) arrive on the same number. Everything else is left for the owner to
  answer in the app. On a number connected only for Qolumns, every first message is answered, as before. Say if
  you want it different (answer everything, or let each business choose).
- [ ] **Meta asks for a "sync" of the Business app's contacts and chats within 24 hours**, or the business has
  to connect again. Qolumns makes the two requests and keeps nothing. If you would rather not make them at
  all, the choice is to not offer Business app numbers.
- [x] **The payment step's wording** (settled in T-176: it is a note, not a step). Meta's own pages disagree:
  one says a payment method is needed before any message; the pricing page says the first 1,000 replies a month
  per number are free and delivered without one.
- [ ] **Privacy and Terms.** I changed three sentences: Privacy now names Meta as a processor (for a business
  that connects WhatsApp) and gives `hello@qolumns.com` for privacy and deletion requests; Terms gives the same
  address. Both used to say "the email address on our website", and the site shows none. Read them and say
  if you want different words.
- [ ] **"WhatsApp quoting" on the Pricing page** stays "Coming later" until the first real run works. It is
  also listed for Pro and Business only, but nothing in the code holds the WhatsApp page back from Starter.
  Say which you want once it is live.

### Later (seen, not changed)

- "Connect manually" keeps its long walkthrough; on a phone it is a lot of text.
- The temporary Meta app icon is the full wordmark across a square. If Meta shows it small or in a circle, a
  single-letter mark would read better.
- The checkbox "Answer messages on this number" in the manual form is 24 px, in a 44 px row.
- A business cannot see its WhatsApp conversations in the dashboard, only the quotes they produce.
- ~~Quoting does not yet send a WhatsApp message when the business approves an estimate.~~ Built in T-176.
- The two-step PIN Qolumns sets when it registers a number is stored (encrypted) and not shown to the
  business. A business that later moves the number elsewhere may need it.

## T-173 — Bot and spam protection, the open database rules, home page changes

- [x] **Deployed 2026-11-17 10:20 UTC** (commit `cb8f632`, web `dpl_EPeniEce3hVbdTPsdDN8eYxiteET`): migration 43
  first, then the web app. The worker was not touched. The preview is **deleted**.
- [x] **The open database rules are closed on production.** Checked live with the public key only: listing
  quotes, services, form settings and business keys is refused, and so is an insert into each of the four
  tables. No row was left behind.
- [ ] **Nobody is a platform admin yet (0 accounts).** Your message had a placeholder where your sign-in
  address goes, so I did not grant it. Run `bash scripts/set-platform-admin.sh you@example.com` with the
  address you sign in to Qolumns with. Until then `/admin` is closed to everyone, you included. Then
  `bash scripts/set-platform-admin.sh --list` should say 1.
- [x] **Rate limits and the human check are on** (the Upstash and Turnstile settings were in Vercel by
  2026-11-17; T-178 checked the limiter live). See T-178 for how each fails open and its off switch.
- [ ] **Try by hand, with a spare address:** sign up, confirm from the email, log out, and use "Forgot your
  password?". None of that was tried on production (each is a real request), and no real inbox has received
  these emails yet.
- [ ] **Open one of your own quote links** (from an email you were sent). I could not: a link holds a token
  that is never stored. A made-up token is refused plainly, and the server's own access is intact.
- Everything before the deploy used stand-ins on this computer for Upstash, Turnstile and Postmark.

### 1. The three open doors in the production database (closed 2026-11-17 by migration 43)

Found while listing what a stranger can reach. All three were in production until 10:16 UTC on 2026-11-17.

- [x] **Anyone could read every quote.** A database rule ("Public can view quotes by token") never compared a
  token. The site's public key, which is in every page's JavaScript, is enough to list every quote with its
  customer's details and prices. Production holds 4 quotes.
- [x] **A signed-in business could move itself into another business** by changing one value on its own profile.
- [x] **Every sign-up counted as a platform admin** and could open `/admin`. All 3 production accounts had the role; all 3 are now `owner`.
- Also: the public key can list every business's services and form settings, and insert rows into four tables.

**The fix is migration 43, and it needs no web deploy:**

1. Done: `bash scripts/deploy-migration-43.sh`. After: `public_rules 0`, `signed_out_grants 0`,
   `profile_guard 1`, `platform_admins 0`, `owners 3`.
2. **Yours, still to do:** `bash scripts/set-platform-admin.sh you@example.com` with your own sign-in
   address. **Until you run it, nobody can open `/admin`, you included.**
3. Nothing else changes for a business or a customer: every public page already reads through the server.

- [ ] **Decide whether to tell anyone.** 4 quotes were readable. Whether any was read cannot be known from here:
  the database keeps no record of reads. Supabase's own API logs (Dashboard → Logs → API) may show requests to
  `/rest/v1/quotes` from outside the app, for as long as your plan keeps them.

### 2. What a stranger can call today, and what each can cost (A1)

| Door | What it can cost | Before this ticket | After |
|---|---|---|---|
| `POST /api/public/quotes` (form, embed, demo) | An AI run, emails, rows, one of the business's plan quotes | Limit and human check coded but off (no keys); honeypot on | Limits per address and per business by minute, hour and day; human check; honeypot |
| `POST /api/public/widget/chat` | One AI call per turn | Limit coded, off | Limit, plus an hourly one |
| `POST /api/public/uploads/init` | Storage, rows | Limit coded, off. Size and type checked only as declared | Limit; storage refuses a file that is not the declared size and type |
| `POST`, `PATCH /api/public/leads` | Rows | Limit and human check coded, off | Same, on with the keys |
| Quote page: accept, decline, question, answers | Emails to the business, rows, a re-price | Link token only, no limit | Limits per address, per quote and per business |
| `GET` a quote, its PDF, a photo | Storage reads | Link token only | Unchanged (see "Still open") |
| `POST /api/public/approval/:token` | An email to the customer | Limit coded, off; 10 presses per link in the database | Same, on with the keys |
| `GET /api/public/widget/config`, `POST …/widget/analytics` | Reads; rows | None | Limits |
| `POST /api/marketing/event` | The Meta relay | Limit coded, off | Same, on with the keys |
| Sign-up, log-in | Accounts, emails | Straight to Supabase from the browser; Supabase's own limits (2 emails an hour) | Through our server: limits per address and per email, human check on sign-up, emails by Postmark |
| Password reset | Emails | **Did not exist** | Built, with the same limits |
| WhatsApp, SMS and Stripe webhooks; the daily cron | Nothing | Signed, or a secret | Unchanged |
| The database itself, with the public key | Everything in section 1 | Open rules | Closed by migration 43 |

### 3. What you must set up (A6)

Everything works without these: protection is then **off**, and the server log says so once
(`[RateLimit] PROTECTION OFF`, `[Turnstile] PROTECTION OFF`).

**Accounts to create**

- [ ] **Upstash**: one Redis database (the free plan is enough to start; pick a region near Vercel's).
- [ ] **Cloudflare Turnstile**: one widget, in your existing Cloudflare account. Hostnames: `qolumns.com` and
  `estimator-web-phi.vercel.app`. Mode: **Managed**. The form runs inside its own frame on our address, so a
  business's own website does not need to be listed.

**Settings (names only)**

| Name | Where | What it is | Secret? |
|---|---|---|---|
| `UPSTASH_REDIS_REST_URL` | Vercel, production | The database's REST address | No |
| `UPSTASH_REDIS_REST_TOKEN` | Vercel, production | Its REST token | **Yes** |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Vercel, production | The widget's site key | No |
| `TURNSTILE_SECRET_KEY` | Vercel, production | The widget's secret key | **Yes** |
| ~~`UPSTASH_REDIS_URL`, `UPSTASH_REDIS_TOKEN`~~ | Worker | **Not to be set** (T-178, AD-060): the worker's limiter stays off, by design | — |

- Add each with `printf '%s' 'VALUE' | npx vercel env add NAME --environment production --sensitive --yes`
  (`--no-sensitive` for the two that are not secret). They take effect at the next production deploy.
- **Set both Turnstile keys in the same deploy.** With only one, the check stays off (and says so).
- `POSTMARK_API_TOKEN` and `POSTMARK_FROM_EMAIL` are already set; the account emails use them.
- No new setting holds a limit. Limits are in `apps/web/src/lib/rate-limit-config.ts`.

**Supabase settings (A5)**

None has to change for the emails to go through Postmark: the server now makes each link itself and Supabase
sends nothing. Three to check or change (Dashboard → Authentication):

- [ ] **"Confirm email"**: keep **on**.
- [ ] **"Email OTP expiration"**: keep at **3600** seconds. The emails say "for one hour".
- [ ] **"Minimum password length"**: set to **8** (it is 6; our own routes already ask for 8).
- [ ] **"Allow new users to sign up"**: switch it **off**, but only **after** the new web app is live (step 2
  of section 4). The old sign-up page calls Supabase directly and would stop working. With it off, a stranger
  cannot make an account by calling Supabase directly; our own sign-up still works, because the server makes the
  account. Tried on the local auth server, not on the hosted one: after switching it off, sign up once with a
  spare address. If that fails, switch it back on and tell me.
- The email templates and the "SMTP settings" page are no longer used by the product. Leave them.

### 4. To put it live (steps 1 and 2 done; 3 and 4 are yours)

1. Done 2026-11-17: `bash scripts/deploy-migration-43.sh`. **Not done:** `bash scripts/set-platform-admin.sh
   <your address>` (yours; see the top of this section).
2. Done 2026-11-17: committed, `npx vercel deploy --prod`. The worker was not touched. Protection is still
   off at this point, and everything works as before plus the new sign-in routes and the home page.
3. Create the two accounts and add the settings (section 3), then deploy the web app once more.
   Switch off "Allow new users to sign up" in Supabase now.
4. Check live: send yourself a request from the form, sign up with a spare address and confirm from the
   email, and use "Forgot your password?".

### 5. For you to decide

- [ ] **The first home example.** You asked for "what the AI understood: the service, the size of the job, key
  details". The product does not work the service or the size out from a message: your customer picks the
  service and answers the size question. What it does is read their message against those. So the example
  reads: the service "fits what they wrote"; the size "They answered one room, so it asks which is right"; a
  detail "They asked for it, so your line for it is added, at your price". All three were seen working on a
  live request. If you want it to say the AI works the service and size out, the product has to do that
  first: a ticket of its own.
- [ ] **The limits.** They are my starting figures: 5 requests a minute, 15 an hour and 40 a day from one
  address; 20 a minute, 60 an hour and 200 a day for one business. A business that expects more than 200
  requests a day needs the daily figure raised. One file, one line each.
- [ ] **Log-in is held after 5 wrong passwords a minute for one email.** That also lets someone who knows a
  customer's email address hold up their log-in for a minute at a time. The usual trade; say if you want it
  looser.
- [ ] **The dashboard's own uploads** (signed-in) still accept a file that differs from what was declared.
  Not a stranger's door, so I left it. One line to make it the same.

### Still open after this ticket

- A stranger can still call Supabase's own sign-up, log-in and reset addresses directly, past our routes.
  Sign-up: closed by the Supabase switch in section 3. Log-in and reset: Supabase's own limits apply there
  (its built-in sender allows 2 emails an hour), and the product no longer depends on that sender.
- The quote, its PDF and its photos are read with the link token and have no rate limit.
- Someone who signs up with an address they do not own cannot confirm it. If the real owner later signs up
  with the same address, the first password given stays until they use "Forgot your password?".

### Later (seen, not changed)

- On the range example on Home, the "Confirm details" button is a pale butter colour.
- The request form's error screen shows a warning emoji above the message.
- The log-in page does not show a note when it is reached from the old sign-in callback's error
  (`/login?error=auth_callback_error`).
- "Check your email" after sign-up has no "send it again" button; signing up again with the same address
  sends a new link.

## T-176 — WhatsApp review-ready: a message template, plainer wording, the personal number warning

- [x] **Deployed 2026-11-17 13:55 UTC** (commit `9ab85dc`, web `dpl_BiRuPZYDN4Csjcr7SPbbeAhfACS9`): web only, no
  migration, the worker not touched. Checked live, read-only: Home and the login page load; the WhatsApp page
  signed out goes to the login page; the webhook refuses a wrong verify token (403) and a call with no valid
  signature (401). No WhatsApp message was sent and no template was created. Both previews are **deleted**.
- **Nothing signed in was tried on production.** The first real use of the new page is yours.
- Checked against a stand-in for Meta on this computer. **Nothing was sent to Meta and no WhatsApp message was
  sent to anyone.**
- Checks: `verify-t176` 96/96, `verify-t175` 110/110, the full regression (25 scripts, t146 to t176) and
  `verify-t173` all pass; lint, typecheck, unit tests (web 876, worker 534, mobile 11) and both builds pass.
- Screenshots of the page from the last local run: `scripts/hardcore-test/results/`, the newest `…-t176-…`
  folder (the question, the stop for a personal number, the template in review, the connected page; phone and
  desktop).

### 1. Your test message (17 November): what production recorded

- **Meta's response to the send call was "accepted":** HTTP 200 with a message id, at 12:02:35 UTC, and again
  for your second try at 12:42:36 UTC. Meta refused nothing. Our log has no refusal line for either.
- **Meta never reported what became of them.** A delivery report (delivered, or failed with a reason) comes
  as a call to our webhook. **Between 11:18 and 12:43 UTC Meta did not call the webhook once**, and both
  messages are still stored as "sent", never "delivered" or "failed".
- Vercel's free plan keeps logs for one hour only, so anything earlier is gone.
- **Two reasons Meta would not deliver, both in its docs.** I cannot tell which applied, because the report
  never arrived:
  1. **The number is one of Meta's own 555 numbers, and its display name is still in review.** Meta: 555
     numbers "must have their display names approved before they can be used to send messages" (its error
     131037). This alone stops every message until the name is approved.
  2. **Your phone had not written to the number in the last 24 hours.** WhatsApp only delivers a free-form
     message inside that window (its error 131047). Meta accepts the call anyway and drops the message.

- [x] **The webhook is set (your answer, 17 November).** It was verified at
  `https://qolumns.com/api/whatsapp/webhook` and subscribed to `messages` and `account_update` that morning.
  **Meta does not deliver real messages to an app that is not published**, which is why it never called.
  So the missing delivery reports are Meta's rule for an unpublished app, not a fault in the set-up.
- [x] **You had not messaged the number from your phone.** So the 24-hour rule applied to both test messages
  as well as the 555 number's name review.
- **What follows until the app is published:** Qolumns does not hear a customer's message on the connected
  number, so it does not reply in the chat, and the page cannot show "Delivered". A test message can still
  arrive: Meta opens the 24 hours when your phone writes to the number, whether or not it tells us.

### 2. What was built

- **Message templates** on the WhatsApp page. One fixed template, "estimate ready":
  *"Your estimate from [your business] is ready. Open it here: [link]"*, then *"Thank you for asking [your
  business] for a price."* (Meta refuses a template that ends with the link, so it has a closing line.)
  - **Create the template** sends it to Meta. The page then shows **In review with Meta**, **Approved**,
    **Rejected by Meta** (with Meta's reason), **Paused** or **Switched off**. **Refresh** asks Meta again.
  - Nothing about it is stored: Meta is asked each time. No database change.
- **It is used.** When you approve an estimate that was asked for on WhatsApp, the customer is told on
  WhatsApp too:
  - they wrote in the last 24 hours: an ordinary message with the link;
  - longer ago: the approved template with the link;
  - longer ago and no approved template: nothing on WhatsApp (they still get the email).
  - It is tried once, for at most 8 seconds, after the estimate is already sent. It cannot fail an approval.
- **Payment is a note, not a step.** The page says "Nothing left to do", then "You don't need a card to
  start", with when a card is needed.
- **Display name in review** is said plainly, with "up to five working days" and "Nothing is broken". For one
  of Meta's 555 numbers it also says the number cannot send until the name is approved.
- **"Which app is this number on today?"** is asked before Meta's window: the WhatsApp Business app, ordinary
  WhatsApp, or a new number. "Connect WhatsApp" is locked until it is answered. **Ordinary WhatsApp stops**:
  the page says what connecting would do and gives the six steps to move the number to the free WhatsApp
  Business app first. The same warning is in the help text under the button and in "Connect manually".
- **The test message tells the truth.** If that phone has not written in the last 24 hours, the page says the
  message will probably not arrive and why, instead of "Sent". It then shows "Delivered" or "Meta did not
  deliver the message" when Meta reports it (needs the webhook).
- `Docs/meta-app-review.md` is rewritten: both recordings step by step with the Bluum test business, and the
  form answers.

### 3. Asking for less access (item 4): nothing to change

- [x] **Checked by you, 17 November:** the Embedded Signup configuration already requests only
  `whatsapp_business_management` and `whatsapp_business_messaging`. **"Log events" is Meta's own wording** on
  its screen for those, not a third permission. The configuration stays as it is.
- My earlier reading was wrong: I matched the sentence to the permission `whatsapp_business_manage_events`
  by its description in Meta's docs ("allows an app to log events"). Meta's docs do not print that screen's
  sentence, so the match was a guess, and I said so at the time. Qolumns does not request that permission.

### 4. Now that it is live

1. ~~Do not press "Create the template" for Bluum until you record the second video.~~ Bluum's template is
   on Meta now, and T-177 removes the button.
2. Open `https://qolumns.com/app/whatsapp` as Bluum and look at the page: the note that Meta is reviewing the
   name, "Nothing left to do", the payment note, and "Message templates" with its wording. Tell me anything
   that reads wrong.
3. Recording 2 (the template) can be made now. Recording 1 waits for Meta to approve the display name.

### 5. Decisions

- [x] **"Replies" stays (your answer, 17 November).** The question was "1,000 conversations" or "1,000 replies". You asked for "the first 1,000 customer conversations a
  month work without a card". Meta's pricing page today counts **messages, not conversations**: "1,000 free
  service messages per month" per number, and one WhatsApp quote takes about ten replies. So the page says
  **"your first 1,000 replies to customers each month"**, which is true on either reading. It is one sentence
  (`PAYMENT_NOTE` in `lib/whatsapp-copy.ts`) if you want Meta's window's word instead.
- [ ] **"Up to five working days"** is on the page as you asked. Meta's docs give no figure for a display name
  review.
- [ ] **Meta charges the business for each template message** (and needs a card for it). The approved-template
  note says so. Creating the template is the business's choice to use it; there is no separate switch.
- [x] **A customer who asked on WhatsApp also gets a WhatsApp message when you approve, inside the 24 hours
  too (your answer, 17 November: keep it).** Before, only the email.
- [ ] **The business's name is written into the template.** If a business changes its name later, the template
  keeps the old one until it is deleted in WhatsApp Manager and created again.

### Not proven

- Nothing here has run against the real Meta: creating a template, Meta's review statuses, sending a template,
  the display name status, delivery reports.
- Whether Meta files the template under "utility". It decides by itself and may choose "marketing"; the page
  shows what it chose.
- Whether Meta accepts a full link as the template's variable. Its docs neither allow nor forbid it; its own
  example does it.

### Later (seen, not changed)

- The WhatsApp page cannot show Meta's reason for an undelivered message (its code is logged; a column would be
  needed to show it).
- After approving, the dashboard does not say "also sent on WhatsApp" (the answer from the server carries it).
- A rejected template cannot be changed or deleted from Qolumns; that is done in WhatsApp Manager.
- When "Ordinary WhatsApp" is chosen, the warning shows twice on the page: in the stop box and in the help
  text under the button.
- On a phone, "Connect manually · with your own Meta app" wraps onto three lines.
- The Meta SDK is started with `autoLogAppEvents: true`, as in Meta's sample. It concerns our own page, not
  what a business grants.

## T-177 — WhatsApp assistant v2, connect polish, legal pages

- [x] **Deployed 2026-11-17 16:59 UTC** (commits `b45c6df` and `04acb95`, web `dpl_FVnAbJoWjyiRkAyuM2xN5FaxfHaV`):
  web only, no migration, the worker not touched. Checked live, read-only: Privacy and Terms show Billiom
  Limited and the company number; the webhook refuses a wrong verify token (403) and a call with no valid
  signature (401). **No WhatsApp message was sent, no template was created, and no request was submitted.**
- **Nothing signed in was tried on production.** What to try is in section 6.
- Checks: unit tests web 929, worker 534, mobile 11; lint and typecheck pass; `verify-t177` 99/99,
  `verify-t176` 82/82, `verify-t175` 110/110; the full regression (26 scripts, t146 to t177) and `verify-t173`
  pass; web and worker build.

### 1. The three things settled before the deploy

- [x] **Bluum is on Pro, by hand, as a free test account** (17 November). One row was added in production:
  business `tnt_4cbe2121dc1e4139b4ed84e1` ("Bluum"), plan `plan_us_pro`, status `active`, with no Stripe
  customer and no Stripe subscription. Before, Bluum had no subscription row.
  - It is never billed: Stripe does not know it exists.
  - It is not revenue. The product has no revenue report yet; when the Stripe launch ticket builds one, it
    must count Stripe subscriptions only, which leaves this row out.
  - `bash scripts/set-test-plan.sh --list` shows every free test account (today: Bluum only).
    `bash scripts/set-test-plan.sh tnt_4cbe2121dc1e4139b4ed84e1 --remove` puts Bluum back on the free allowance.
  - On Bluum's Billing page, "Manage Billing" will say there is no billing account. That is expected.
- [x] **The company number** is in Vercel as `NEXT_PUBLIC_COMPANY_NUMBER` (your choice: keep the setting). Both
  pages show it.
- [ ] **Is Bluum's template on Meta named `estimate_ready`?** I could not check this myself: asking Meta needs
  Bluum's stored token, which only production can read, and your browser was not signed in to Qolumns. Nothing
  was created. **You can see it in one look:** open Bluum's WhatsApp page and find "Message templates".
  - It shows **Approved** or **In review with Meta**: Meta has `estimate_ready`. Nothing more to do.
  - It shows **Not set up yet**: Bluum's template has another name. Tell me before Bluum reconnects, because a
    reconnect would then create `estimate_ready` beside it.

### 2. In the Meta dashboard (one change)

- [ ] **Subscribe the webhook field `smb_message_echoes`** (yours; you said you will do it) (WhatsApp →
  Configuration → Webhook fields), next to `messages` and `account_update`. It is what tells us the owner has replied from the WhatsApp Business
  app, so the assistant can stay out of that chat for 24 hours.
  - It only exists for a number that is also on the WhatsApp Business app. Bluum's number is Meta's 555
    number, which has no app, so nothing changes for Bluum.
  - Meta's message carries the owner's own words. Qolumns reads only who it was sent to and when; the words
    are not stored and not logged.
  - Without the field, everything else works: the assistant just cannot tell when the owner has stepped in.
  - Still leave `history` and `smb_app_state_sync` unsubscribed.
- Nothing else changes in Meta. Embedded Signup v5 uses the same configuration id and app id.

### 3. What changed, item by item

1. **Silent assistant.** On every connected number the assistant now says nothing unless a customer asks for
   a price for something the business offers.
   - Each new message is put to the AI with the business's own services, what each includes and excludes,
     and its service area. No list of words or trades is in the code.
   - Not a price request, or any doubt: no reply, and the message's text is not kept (only that it arrived,
     from whom and when).
   - A price request: short plain replies, no numbered menu, no "reply 1 for…", no confirmation step. It
     asks only for what is missing, then sends the link. Often that is one reply.
   - **What it asks for:** what the job is (only if the message did not say); a name (only if WhatsApp gave
     none); an email (only if the business requires both email and phone); the ZIP or postcode (only if the
     business limits where it works); photos (only if the service requires them).
   - After the link it is quiet again until a new price request.
   - **Owner takes over:** built. Needs the Meta step above.
2. **Template: automatic.** The button is gone. Connecting looks for the template on Meta: used if it is
   there, created if not. The page shows the status only (Approved, In review, Rejected with Meta's reason),
   read from Meta each time the page opens. Opening the page never creates anything.
3. **Test message note.** "Will probably not arrive" is gone. One line sits before the button, in your words.
4. **Personal number warning.** One line, in your words, in the text that introduces Meta's window. The
   three-answer question from T-176 is removed.
5. **Subscription lapse.** No active subscription: no replies, no template, no approval notice, no test
   message, no new connection. The connection is kept. The page shows your line.
6. **Embedded Signup v5.** Done. A number already on the WhatsApp Business app can connect and keeps working
   in the app (v5 has that on by default). Existing connections are untouched.
7. **Pro and above.** Which plans have WhatsApp comes from the plan definitions (today: Pro and Business).
   Other plans see one upgrade line with a link to the plans and no connect button. An existing connection
   on such a plan goes silent and is kept.
8. **Small photo copies.** A photo sent on WhatsApp is stored privately as before, and now gets a small copy
   beside it for the dashboard and the quote page. The upload limits of the request form apply (photos up to
   10 MB, PDFs up to 25 MB; other types are not kept).
9. **Privacy and Terms.** Both say who runs Qolumns. Terms have the governing law line and a WhatsApp
   section. Both dated 17 November 2026.

### 4. Decisions I took (say if you want any changed)

- [x] **Past due does not pause WhatsApp (your decision, 17 November).** WhatsApp has the same grace as the
  quote limit: a payment that failed and is being retried keeps the assistant on; a cancelled subscription
  pauses it. One rule is read by both.
- [ ] **No email is asked for on WhatsApp**, unless the business set "email and phone both required". The
  customer's WhatsApp number is already a way to reach them. The cost: a customer whose estimate is approved
  more than 24 hours later hears about it only if the template is approved (no email to fall back on).
- [ ] **No confirmation step.** The request is made as soon as the last answer is in.
- [ ] **A reply it cannot use is asked for once more, then it goes quiet** and drops the request, rather than
  keep asking in someone's chat.
- [ ] **One sentence added to the Privacy page** that you did not ask for: a WhatsApp message is read by an AI
  model to see whether it asks for a price, and one that does not is not answered and its text is not kept.
  It is true of the new assistant, so I thought it should be said.
- [ ] **One small library added** (`jpeg-js`, no dependencies of its own). The small copies of form photos
  are made in the customer's browser; a WhatsApp photo never passes through one, so the server has to make
  the copy, and that needs something that can read a JPEG.

### 6. What to try on production (all yours; I tried nothing signed in)

1. Open `https://qolumns.com/app/whatsapp` as Bluum. It should show **Connected** with no upgrade or paused
   line, and "Message templates" with a status (see section 1 for what the status tells you).
2. Once Meta approves the display name: send "Hi" from your phone to the number, then press **Send a test
   message**. The page should say "Sent." and the message should arrive.
3. `https://qolumns.com/privacy` and `/terms`: read the company line and the new WhatsApp section in Terms.
4. After you subscribe `smb_message_echoes`, nothing visible changes for Bluum (its number has no app).

### 5. The live AI check is separate and optional

- `scripts/hardcore-test/verify-t177-live.mts` puts real-sounding messages to the real model and reports
  what it did. It is not part of the regression set and never fails a ticket: a live model's answers vary a
  little between runs.
- The required checks use a stand-in for the model, so they are the same every run.
- One run of the optional live script after the last change, no further tuning: 12 of 12 messages that are not
  a price request stayed silent, and 4 of 4 price requests were answered for the right service.

### Later (seen, not changed)

- The live model sometimes treats a bare "can I get a quote for a new garage door?" as already describing the
  job, and sends the link without first asking what needs doing. The estimate page then asks for what is
  missing. Seen in two of five runs before the wording was tightened once; not chased further.
- Each message on a quiet chat costs one small AI call. A busy number that is also on the WhatsApp Business
  app will make many.
- Several photos sent at once arrive as separate calls; two arriving in the same instant can overwrite each
  other in the chat's list of photos (as before this ticket).
- A connection made before this ticket that has no template shows "Not set up yet" and asks for a reconnect;
  nothing creates one from the page, by design.
- With a lapsed subscription the page still shows "Try it"; pressing the button answers with the paused line.
- One older unit test reads the whole repository and runs close to its 5-second limit; it timed out once
  when everything ran at the same time, and passes on its own.
- On a phone, "Connect manually · with your own Meta app" still wraps onto three lines.
- `Docs/design/ai-capabilities.md` (the list of what the AI does) has no row yet for "decides whether a
  WhatsApp message is a price request". Nothing on the site claims it, so nothing is wrong; it should be
  added before the site says anything about the WhatsApp assistant.

## T-178 — No quote is ever lost

**Deployed 2026-11-17 21:02 UTC:** commit `4a08ec9`, worker version `d0450982-775a-4a98-b797-360de78ce7b8`, web
`dpl_8Nd9X47kLCDeeRU3ppc7ktsh1kKy`. No migration. Live checks (read-only): `/`, `/login` and the demo quote
link 200; the webhook refuses a wrong token (403) and unsigned or wrongly signed calls (401); 65 views of the
demo quote link in a minute gave 60 pages and then 429 from the 61st.

**Follow-up deployed 2026-11-17 22:37 UTC:** commit `c8bd969`, web only, `dpl_CxEb1478nDPagcBT13xmZGVLUpLA`.
The full regression set passed first (t146 to t177, t173 104/104, t178 52/52). It found one fault of mine: the
quote link page kept showing a changed or switched-off link's old page (in production from 21:02 to 22:37 UTC);
fixed in this deploy.

### 1. What you must do

- **The worker's rate limiter stays off, by design (your decision, 2026-11-17).** The worker has no Upstash
  values and none are to be added. Its code stays in place and fails open, so nothing breaks if they ever are.
  Nothing for you to do. (Recorded in Docs/CHANGELOG.md, AD-060.)
- **Two switches you now have** (Vercel → estimator-web → Settings → Environment Variables, then redeploy; a
  changed setting only takes effect on the next deployment):
  - `RATE_LIMITS_OFF=true` turns every website rate limit off, without removing the Upstash values.
  - `TURNSTILE_OFF=true` turns the human check off, without removing its keys.
  Remove the setting (or set it to `false`) and redeploy to turn it back on.
- [ ] **One quote is marked failed in production: `qte_b2696651e64b956566642c9a` (Bluum, 20:07 UTC).** I did
  not retry it, because a retry emails the customer. Retry it, or contact the customer yourself:
  ```
  bash scripts/retry-failed-quote.sh --list            # failed quotes, and any stuck for 15 minutes or more
  bash scripts/retry-failed-quote.sh qte_…              # price one again
  ```
  A retry emails the customer their estimate (or the business a review request) as a first run would. For a
  request from hours ago, consider contacting the customer yourself instead.

### 2. What a failed quote does now

- The business gets one email: who asked, for which service, how to reach them, and a link to the request.
- The business's quote page shows "What the customer sent": their words, each answer under the business's own
  question, where the job is, and the photos.
- The customer's page says "{business} has your request" and that the business will be in touch.
- After 60 seconds of "Preparing your estimate" the customer reads "This is taking longer than usual. We’ll
  email you as soon as it’s ready." (A customer who gave no email is told to keep the page.)
- Why it failed is stored on the quote for us. It is not in the email and not on any page.

### 3. What changed at submit

- A request with any answer or photo is never refused or redirected, whatever the note says.
- A request that is only a description, and reads like another of the business's services, is still made on
  the service the customer chose. It is priced and held: the business sees "Check the service" with both names
  and the reason, and the customer sees no price until the business decides.
- "Switch to X and Submit" is gone.

### 4. Settled in this ticket

- [x] The website's limiter is on (Upstash is configured in Vercel). It counted correctly but answered a
  blocked page view with status 200; it now answers 429.
- [x] **The website's limiter and the human check, against your four rules** (both now meet all four):
  - Fail open on an error or a timeout: yes, both. Before, the human check refused any request that came with no
    token, which is what a browser sends when Cloudflare's script is blocked or never loads.
  - Wait 500 ms at most: yes, both. Before: 1.5 seconds (limiter), 5 seconds (human check).
  - Log when failing: yes, both (`FAILING OPEN` in the Vercel logs).
  - One switch: yes, both (above). Before: neither.
- [x] **The human check blocks only when Cloudflare clearly says the token is bad** (not real, used or
  expired). No token, Cloudflare unreachable or slow, or a script that never loads: the request goes ahead. In
  the browser the form waits 4 seconds for the script and 8 for a token, never longer unless the person is
  answering a challenge.
  **The cost:** a bot that sends no token is not stopped by the human check any more; the rate limits and the
  hidden field stop it.
- [x] Workers Logs are on for production (7 days). A deploy from a `wrangler.toml` without the
  `[observability]` block would switch them off again.
- [x] A request the web app could not hand to the worker used to stay "queued" for ever. It is now marked
  failed and the business is emailed.

### Later (seen, not changed)

- The business cannot retry a failed quote itself; only the script (or a platform admin) can. A "Try pricing
  again" button on the failed request would be a small ticket.
- A stuck quote (queued or generating for a long time, with nothing working on it) tells nobody. The script's
  `--list` shows them. A daily sweep that marks them failed, which emails the business, would close this.
- When a request is refused for a missing required answer (400), the form's error screen offers only "Start
  Over", which clears what was typed. The form itself prevents this before submit, so it is rare.
- The "Check the service" notice uses the amber notice colour, which you have said reads as butter. It is the
  same style as the "Customer question" box on that page; both should move together.
- A request held with a suggestion that the AI also wants to ask the customer a question about shows the
  suggestion only after the customer answers.
- The form's own finish screen at 60 seconds was not opened in a browser; it uses the same line as the
  customer's page, which was.
- The worker's wording, add-on and validation AI calls still have no time limit of their own (see
  "Reliability", T-157). A stalled call is the likeliest cause of a slow quote.
- `scripts/hardcore-test/verify-t173.mts` had a check expecting the old refusal; it now expects the request to
  be accepted. That script was not run in this ticket.
- wrangler is at 3.114 and prints an "update to 4" notice on every command.

## T-179 — One request, several services

**Deployed 2026-11-18 08:10 UTC.** Commits `24c2d67` and `6f1afc6`, worker version `7335f6e5`, web deployment
`dpl_4qZ8P2PR8chMivBXC4X499ktGmp5`. No migration.

### 1. What to check by hand (with a test business that has two or three services)

- [ ] **Open one existing estimate** from a customer's link (any earlier quote). The page that serves it
  changed, and a real link is the one thing I cannot open: its token is never stored.

- [ ] **A real note, a real model.** Send a request on the quote link for one service and write, in "Anything
  else about the job?", that you also want another of the business's services. Open the estimate. You should
  see a card "You also asked for: “your words”" with that service's name, and either its price with
  "Add to my quote" or "Answer N questions to add it". Everything in my checks used a stand-in for the model
  that reads the note, so **the live model's reading of a real note is the one thing not proven**. If the card
  does not appear for a clear request, or appears for something you did not ask for, tell me the words you used.
- [ ] **Add it, look at the total, remove it.** The total at the top should be the two services plus tax once.
- [ ] **Your email.** You should get one "Request updated" email, not a second "new quote" email. No email
  leaves this machine, so I have read its wording but never received it.
- [ ] **The review rule.** With one service set to send automatically and the other to be reviewed, adding the
  reviewed one should put the quote back to "Needs your approval".
- [ ] **Hold until approved (softened as you asked, 2026-11-18).** Set a second service to hold until approved,
  ask for it in a note, and add it on the estimate. The main price and the total should stay exactly as they
  were; the added part should read "<your business> will confirm this part" with no price; there should be no
  accept button until you approve. Approve it: the part's price and the combined total appear. Or remove it:
  the quote is back exactly as it was.
- [ ] **The PDF.** Download one for a combined quote. The PDF service is not called on this machine; I read the
  page it prints, not a file.
- [ ] **The on-site app**, if you use it: open a combined quote. It should show the combined total, both
  service names, and the added service's lines under the takeoff. Not opened on a device here.
- [ ] **The quote editor:** "Add another service to this quote", then Save.

### 2. Decisions I made that you may want to change

- The customer can add or remove a service only while they can see a price and have not accepted or declined.
- An added service is asked only what its price needs: its required or price-critical questions, and any
  quantity it would have measured from photos. Its optional questions are not asked.
- Tax is worked out once on the combined amount, leaving out any service you have marked as not taxed.
- A combined quote counts in Overall accuracy only (not By service, and not By grade either).
- The business gets a "Request updated" email on a removal as well as on an addition.
- A business with only one service is not told about things it does not offer (see Later).

### 3. Found on the way

- The plan's usage counter loses counts when requests arrive at the same moment. Moved to **T-180 (Stripe)**,
  at your instruction; see "T-180 — Stripe" below.

### Later (seen, not changed)

- A business with one service gets no "not one of your services" notice: the note is only read for other
  services when there is more than one.
- The live model can mark a short phrase as "not one of your services" when the customer picked the wrong
  service to begin with (seen once: "the trim too" on a wallpaper request that was really about painting).
  It never gets a price. Not tuned.
- "Measure the added service from the same photos" (the ticket's own Later).
- The scope text, assumptions and "not included" list describe the main service only; an added section has
  lines and a subtotal but no wording of its own.
- Re-running pricing on a quote that carries added services (the retry script, a platform admin's retry)
  prices the main service again and drops the added sections. Rare; the customer or the business adds them back.
- The old rough-estimate code (`calculateCrossServicePricing`) is unused and still in the worker.
- On the customer's page the added section's "Remove" is a text link; the card uses the pale blue-grey panel
  the old "Other services you mentioned" box used.
- The dashboard list and Home still name a combined quote by its main service only.
- The on-site app cannot add or remove a section and does not show the "also asked for" list.


## T-180 — Stripe live billing

**Deployed 2026-11-18** (migration 44 by you; worker `1ef39c4d`; web `dpl_41s7h4F7zAULMLwM9RXR6JJDBKkD`, serving
`qolumns.com`). Read-only live checks passed: the pages load, an unknown link is 404, both webhooks refuse
unsigned and wrongly signed calls, the billing routes are closed when signed out, and the new wording is live.
**Nothing signed in or paid was tried on production: see "Now that it is live" below.**

**Built 2026-11-18.** Tested in the Stripe sandbox "Qolumns sandbox" with
Stripe's test cards only. No real charge was made, no email left this machine, no WhatsApp message was sent,
and production was not touched or read. Results are under "5. What was checked".

### Now that it is live (yours; I tried nothing signed in and bought nothing)

- [ ] **One real purchase** (step 6 below): buy Starter with your own card, land back on Billing showing the
  plan, open "Manage billing", cancel, refund it in Stripe. This is the first time the live webhook secret,
  the live prices and the live portal settings are really used.
- [ ] **In Stripe, Developers, Webhooks, the `qolumns.com/api/webhooks/stripe` endpoint:** after that purchase
  its deliveries should all say 200. A 400 there means the `STRIPE_WEBHOOK_SECRET` in Vercel is not that
  endpoint's secret (the plan still shows, because the Billing page confirms the purchase itself, but renewals
  and cancellations would not reach us).
- [ ] **Bluum's Billing page:** it should say "Test account", with nothing to buy or manage.
- [ ] **The T-179 case by hand:** see the section below.

### 1. What you run to go live, in this order (done 18 November, except step 6)

- [ ] **1. Look at five settings in the LIVE Stripe account ("Qolumns").** I could not see the live account.
  - Settings, Managed Payments: on.
  - Settings, Business, Public details: the **support email** is one you read. Stripe writes there when a
    customer asks it for help with a payment, and may refund without you if nobody answers in 48 hours.
  - Settings, Billing, Subscriptions and emails, "Manage failed payments": Smart Retries on. "If all retries
    fail": either "cancel the subscription" or "mark as unpaid" works with our code (both end the plan). The
    sandbox is set to cancel, after four tries over about two weeks.
  - The same page, "Send emails when card payments fail": your choice. If it is on, a business gets Stripe's
    email as well as ours (see "Decisions", 5).
  - Settings, Checkout and Payment Links: add your Terms and Privacy links (`https://qolumns.com/terms`,
    `/privacy`). Managed Payments shows them under its own.
- [x] **2. The database first:** `bash scripts/deploy-migration-44.sh`. It only adds things; the site that is
  live today keeps working with it. It prints Before and After and what to expect.
- [x] **3. Create the live products, prices, portal settings and webhook:**
  `cd apps/web && npx tsx scripts/stripe-setup-plans.mts --live`
  - It asks for the live secret key (what you type is not shown), prints the account's name, and asks you to
    type that name before it creates anything. It charges nobody.
  - To see first what it would do: add `--dry-run`.
  - It ends by printing six lines that start `STRIPE_PRICE_`. They are not secret.
- [x] **4. Vercel, Production, Environment Variables:**
  - add the six `STRIPE_PRICE_…` lines from step 3;
  - set `STRIPE_WEBHOOK_SECRET` to the new endpoint's signing secret (Stripe dashboard, Developers, Webhooks,
    the `qolumns.com/api/webhooks/stripe` endpoint, "Signing secret"). The script does not print it;
  - check `STRIPE_SECRET_KEY` is the live key of the new "Qolumns" account, not the retired one.
- [x] **5. Tell me to deploy** (the worker, then the web app). Done 18 November.
- [ ] **6. After the deploy, one real purchase, if you want one:** buy Starter with your own card, see the plan
  on Billing, open "Manage billing", cancel, and refund it in the Stripe dashboard. Then in the dashboard,
  Developers, Webhooks: the endpoint's deliveries should all say 200.
- [ ] **7. For the suspend switch:** `bash scripts/set-platform-admin.sh you@example.com` (if you have not),
  then `/admin/tenants`.

### 2. The setting names (Vercel, Production)

| Name | Value |
|---|---|
| `STRIPE_PRICE_US_STARTER_MONTHLY_USD` | printed by step 3 |
| `STRIPE_PRICE_US_STARTER_ANNUAL_USD` | printed by step 3 |
| `STRIPE_PRICE_US_PRO_MONTHLY_USD` | printed by step 3 |
| `STRIPE_PRICE_US_PRO_ANNUAL_USD` | printed by step 3 |
| `STRIPE_PRICE_US_BUSINESS_MONTHLY_USD` | printed by step 3 |
| `STRIPE_PRICE_US_BUSINESS_ANNUAL_USD` | printed by step 3 |
| `STRIPE_WEBHOOK_SECRET` | the endpoint's signing secret, from the Stripe dashboard |
| `STRIPE_SECRET_KEY` | already there: check it is the new account's live key |

`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is not read by any code; it can stay or go.

### 3. What Managed Payments changed (nothing was blocked)

Read from Stripe's Managed Payments docs on 2026-11-18 and then tried in the sandbox. Nothing our code does
is unsupported, so nothing was built around it.

- **Stripe is the seller.** Checkout, the receipt and Stripe's emails say "Sold through Onelink" (Stripe's name
  for it on those pages), not Qolumns.
- **The card statement reads `LINK.COM* QOLUMNS.COM`,** not `QOLUMNS.COM` alone. Stripe adds the prefix; it
  cannot be removed.
- **Tax is added on top.** $49 became $53.35 for a New York address in the sandbox. Our pages show prices
  before tax and say "plus tax" beside each one (the Pricing page, Home, Billing); the Terms say it too. To make $49 the price including tax, change "Include tax in
  prices" in Stripe's Tax settings before step 3 (a price's tax setting cannot be changed afterwards).
- **"Charge in USD" is not fully in our hands.** Prices are in USD and you are paid in USD. But Managed
  Payments always shows a customer outside the US their own currency at checkout (Stripe converts). It cannot
  be switched off.
- **A plan can only be bought through Checkout.** No code creates a subscription, an invoice or an extra charge
  any other way, and none may. So there is no per-quote overage: over the limit, a request is held.
- **Customers can also manage their plan on Stripe's own site** (cancel, change card), not only from our
  "Manage billing". Either way the change reaches us the same way.
- **Stripe sends the receipts, invoices and renewal notices itself.** Ours are only the product's own emails.
- **Stripe may refund a payment or close a dispute without asking you.** We are not told by webhook; see Later.
- **The Stripe library had to be brought up to date** (version 20 to 23). The old webhook code read two fields
  that current Stripe no longer sends (a subscription's period, an invoice's subscription), so it would have
  stored nothing: an error on every subscription event, and every payment event skipped. It is rewritten.

### 4. Decisions I made (say if you want any changed)

1. **Over the monthly limit: hold.** `plans.ts` has no overage on Starter, Pro or Business, so the 51st request
   of a Starter month is saved and not priced, like the 11th free one. It is priced when the month turns or
   the business moves up a plan.
2. **An upgrade takes effect at once and the difference is charged then. A downgrade takes effect at the end
   of the paid period** (your change, same day). "Downgrade" is a cheaper price or yearly to monthly. So Pro
   yearly to Pro monthly waits for the year to end, and so does Starter yearly to Pro monthly (its price per
   payment is lower), while Starter yearly to Pro yearly is at once. Cancelling while a downgrade is waiting
   drops the downgrade.
3. **The portal offers Starter and Pro only,** as you wrote. Business has prices but is not in the portal, so a
   business on a plan cannot move to Business by itself. The billing page still lets a business with no plan
   pick Business (T-171's rule). Tell me if Business should be hidden there too, or added to the portal (one
   line in the script).
4. **After a plan ends the business is back on the free allowance,** which is 10 priced quotes in total, ever.
   One that has priced 10 or more gets every request held. One that priced fewer than 10 in its life would
   still get the rest free. That is what `plans.ts` says today.
5. **"One email" is ours.** We send one "Your payment didn't go through" per failed payment, however many
   times Stripe retries. Stripe can send its own as well (section 1, step 1).
6. **The "2 free quotes left" email is sent once per business, ever.** The line on Home and Billing shows for
   as long as one or two are left (it says "1 free quote left" at nine).
7. **The sandbox webhook endpoint is switched off.** You asked for it to be created in the sandbox; it points at
   the live site, which would refuse every sandbox event (wrong secret) and Stripe would email you about the
   failures. The live one is created switched on.
8. **Suspend is a button on `/admin/tenants`** (with a required reason), not a script. It is logged with who
   and why. It does not touch the Stripe subscription: a suspended business that pays keeps being charged
   until you cancel it in Stripe.
9. **A business with a plan cannot open Checkout again.** The plan cards show no "Select Plan"; one "Change
   plan" button opens the portal.
10. **A suspended business's dashboard says** "Your account is paused. New requests are being saved, not
    priced. Quotes you have already sent still open." with "Email us". The reason is never shown.

### 5. What was checked

- `verify-t180` against the sandbox: **105/105.** Without a browser: the setup (products, prices, tax code,
  portal, webhook), 20 requests at once counted as 20, the free 10 and Starter's 50 holding exactly under a
  rush, the warning at 8, the hold at 10, the test account, suspend and restore, a forged webhook. Then in a
  browser on Stripe's own pages with test cards: pay Starter and land on Billing showing it; upgrade to Pro;
  switch to yearly; ask for a downgrade (nothing changes until the paid period ends, then the plan becomes
  Starter and renews at Starter's price); cancel; a card declined at checkout; a renewal that fails, shows the
  notice on five dashboard pages and sends one email, then succeeds when the card is fixed; a renewal that
  fails four times until Stripe cancels; the same webhook event twice. Renewals were made to happen with Stripe's test
  clocks. To run it again: the two commands at the top of `scripts/hardcore-test/verify-t180.mts`.
- Unit tests: web 1,055, worker 574, mobile 11. Lint and typecheck pass. The web app and the worker build.
- **The full regression set passes: 30 scripts, `verify-t146` to `verify-t180` with `verify-t173`, 2,646
  checks.** `verify-t173` 104/104, `verify-t178` 52/52, `verify-t179` 97/97 and `verify-t180` each ran alone
  on their own local servers; the other 26 ran together (2,288 checks).
- **`verify-t179`'s test business had to be put on a plan.** It sends more than ten requests; six at once used
  to count as two, so it never reached the ten free quotes. Now every request counts and the eleventh was held.
- One older unit test (T-162's search for the old embed names) has a five-second limit and timed out in three
  full runs earlier in the day while this machine was busy. It passed in the final run.

### Left on this machine and in the sandbox

- `apps/web/.env.local` now has the six sandbox `STRIPE_PRICE_…` lines (the file is not in git).
- The sandbox has the three products, six prices, the portal settings and the switched-off webhook endpoint,
  and two archived products named "Probe …" from my first test of Managed Payments. No customer, subscription
  or test clock was left.
- The local database is at migration 44.

### Not proven

- **Anything in the live account.** Every check used the sandbox. The script's `--live` run has never been
  done; its guards were tried (a key that is not live is refused; a made-up live key gets nowhere).
- **Stripe's own emails and the card statement text.** The sandbox sends no email and makes no statement.
- **How long the live account retries a card.** The sandbox tried four times in about two weeks, then
  cancelled. Yours follows the setting in section 1, step 1.
- **A customer in another currency or country.** Only a US address was used.
- **Bluum in production.** The test-account rules were checked with a stand-in business on this machine.

### Later (seen, not changed)

- **A refund or a lost dispute does not end the plan.** Stripe can refund without us; the subscription stays
  active unless Stripe also cancels it. No webhook event for either is handled.
- **The billing page does not say that a downgrade is waiting.** After a business asks for Starter in the
  portal, our page shows Pro (which it still has) with no note until the period ends. Stripe's portal says
  "Your service will be updated on <date>".
- **The Terms' "5. Billing" still mentions "metered overage (where applicable)".** No plan on offer has it.
  Your new paragraph sits under it.
- **No revenue report.** Stripe's dashboard is the record. Free test accounts are marked "Test account, not
  billed" on `/admin/tenants`.
- **A card declined at Checkout leaves an empty customer in Stripe** (Stripe makes it when the card is tried).
  A later purchase makes another. Harmless clutter.
- **The legacy plans' per-quote overage** (pre-US plans, no subscribers) is still in the code and cannot bill
  under Managed Payments.
- **`/admin/tenants` shows a plan's price from the old `plans` table,** not from `plans.ts`.
- **The Home usage banner is still butter-coloured** (a known gap in the design file).
- **Business is still marked to confirm** in `plans.ts` ($199, 600 quotes). It stays off the site.


## T-179 miss on production (found 18 November), and two small T-180 items

**Fixed, checked, committed, pushed and deployed (18 November): the worker, version `1ef39c4d`, and the web
app, `dpl_41s7h4F7zAULMLwM9RXR6JJDBKkD`.** No request was sent to production. I read
production twice, read-only: the three service configurations and that one quote; and which migration it is at.

### 1. What waits for you

- [x] **`bash scripts/deploy-migration-44.sh` is safe to run again.** (You ran it; production is at 44.) It failed on its own Before check
  (my mistake: the check counted from a column the migration creates; nothing was applied). Fixed, and this
  time run whole against a copy of the database at migration 43, and again at 44. Read-only on production, the
  fixed Before check answers: migration 43, every new count 0, 1 subscription. You should see the same line
  under "Before", then "OK", then under "After": latest 44, usage_functions 3, usage_functions_open_to_users 0,
  subscription_columns 4, tenant_columns 3, billing_guard 1, new_tables 2, subscriptions 1,
  suspended_businesses 0.
- [x] **Worker deployed after migration 44** (`/health` ok; calls with no token refused). Why it waited:
  **Migration 44, then tell me (or I look again).** The fix is in the worker, and its checks pass, but I
  did not deploy the worker: this worker build also carries T-180's new "sent" counter, which needs a
  database function that migration 44 creates. Production was still at migration 43 when my checks finished.
  Deployed first, every sent quote would log a failed count and "estimates sent" would stop counting. As soon
  as migration 44 is in, I deploy the worker (`npx wrangler deploy --env production`).
- [x] **"Vercel is set"**: said, and the web app is deployed. The read-only live checks passed.
- [ ] **Re-test by hand, now that the worker is live:** the same request as quote `qte_99acc0a15ce6d59d082e70f1`
  (wallpaper, with the note about painting). The estimate should carry a card for the painting service with
  the customer's words, and the wording should not say "quoted separately" or list the painting under "Not
  included". The old quote itself is not changed.

### 2. What the model returned, and what dropped it

- With the real model, three runs of three: the right service, confidence 0.95, the phrase "painting for
  skirting and ceilings". **The model was right.**
- **A check in code (AD-010) threw the answer away.** It wanted a word of the customer's phrase to be in the
  service's name, after first discarding "painting" as a common word. "Skirting" and "ceilings" are in no
  service's name. The other checks all passed.
- A second check (AD-014, a list of places) was found dropping a right answer for an add-on of the
  outside-painting service ("gutters and fascia"). Fixed the same way.

### 3. The fix, in short

- Code no longer asks for a word of the request in the service's name, and holds no list of types of work.
  The model's choice is overruled only when your own configuration points at a different one of your services.
- The model is now given each other service's options and add-ons. With that, "the trim and doors painted"
  became a card too (it had been "not one of your services").
- When a card is on the quote, the wording loses any "not included" line or sentence about that work, whether
  it names the service or uses the customer's words.
- If the wording ever names another of your services on a quote with no card for it, that is logged as a
  detection miss and kept on the quote's trace (`pricing_trace_json.detectionMiss`).
- The billing page says "Changes to Starter on <date>." when a downgrade is waiting.
- The Terms no longer mention metered overage. "5. Billing" starts "Paid plans are billed in advance, monthly
  or yearly." (put back at your instruction).

### 4. Checks

- The full regression set: 30 scripts, 2,651 checks, all pass (`verify-t179` 99/99, `verify-t180` 108/108).
- Unit tests: worker 587, web 1,060, mobile 11. Lint, typecheck and both builds pass.
- The optional live check with the real model, `npx tsx scripts/hardcore-test/verify-t179-live.mts`: your
  note word for word and five other explicit requests all got a card (6 of 6); two notes that ask for nothing
  extra got none. It is a report, never a gate.

### Not proven

- **Production.** Nothing was sent there. The reproduction and the end-to-end run were on this machine with
  the real model and a local copy of the three services.
- **Other trades.** The live check uses the painting services only.

### Later (seen, not changed)

- The list of places behind AD-014 is still in the code. It can now only drop a match that the service's own
  configuration does not support.
- The detection miss is recorded, not shown anywhere in the dashboard.
- "We would like the skirting boards done in white too" (no word for the kind of work) got a card in one run
  and "not one of your services" in two earlier ones, before the add-ons were given to the model.
- The billing page's "Changes to …" line asks Stripe each time the page opens; nothing about it is stored.


## T-181 — Small site fixes + Meta app review readiness

**Deployed 18 November 2026** (web only, `dpl_ePb91348jKdKgqk9T9jPQidhrG6z`, serving `qolumns.com`). Read-only live
checks passed: the changed pages and the new `/data-deletion` answer 200 (also to Meta's crawler), the new
wording is live, and both webhooks still refuse unsigned calls. Before deploying I ran the ten earlier checks
that cover these pages; all pass (two needed a count updated: 14 footer links, two "Coming later" lines).

### 1. What was done, item by item

1. **Home headline: already done (T-173), skipped.** The page, the title, the description, the social tags and
   the social image all read "Instant quotes for your customers, in your prices." The old line is nowhere.
2. **"What it notices": fixed.** The price breakdown now reads "Walls & ceilings, 3 rooms" ($1,125), visit and
   setup $75, trim $200, total $1,400, to match "three bedrooms" in the message. It was 2 rooms, $1,025.
   - The same example feeds the Painting page, which now shows 3 rooms and $1,200 too.
   - Left as it was: "They answered one room, so it asks which is right." That line is the point of the first
     example (the words differ from the answer, so it asks). Say if you want it to read "three" as well.
3. **Plan cards: rewritten.** Each line now says what the business gets. Home's cards list them too (they had
   only the price). No text-message line is on any page. "plus tax" is kept; Pricing's note under the cards
   now also says "Billed in advance, monthly or yearly." Prices, limits and Stripe are untouched.
   - Starter and Pro: "Customers see your price straight away, on your website or from a link you share";
     "Every customer gets their own estimate page to open, accept and come back to".
   - Pro adds: "Estimates under your brand alone, with no badge of ours"; "See how your estimates compare
     with your final invoices".
   - Still marked "Coming later" on Pricing (Home lists live lines only): "Quotes inside WhatsApp, on your own
     number"; "An app for pricing a job while you are on site".
   - Starter's line under its name on Pricing: "Instant quotes for your customers, with or without a website"
     (it said "Instant estimates on your website").
   - The same lines show on the Billing page's plan cards (one list feeds all three).
4. **Audience: changed in three places.** Under the hero: "For any business that quotes for its work, small to
   corporate. No website? Use your quote link." The footer: "…quotes for any business, small or large." The
   Pricing page's description: "…plans for businesses of any size." The trade pages still speak to their own
   trade ("For HVAC contractors"); say if those should change too.
5. **Meta review: one thing was missing in code, now added.** See the next section.

### 2. Meta app review: what the site has

- **Privacy Policy** `https://qolumns.com/privacy` and **Terms** `https://qolumns.com/terms`: both live, both
  answer 200, also to Meta's own crawler (checked 18 November, read-only).
- **Data deletion: a page of its own, `/data-deletion` ("Delete your data"), added in this ticket** and linked
  from every page's footer. It says how a customer asks, how a business asks, what Disconnect does for a
  WhatsApp number, and what a deletion covers. It promises nothing the Privacy Policy and Terms do not.
  **It is live** (`https://qolumns.com/data-deletion` answers 200, also to Meta's crawler), so the Meta field
  can be changed to it now.
- **App icon:** `Docs/design/meta-app-icon.png` (1024 × 1024, the wordmark on juniper). Still the temporary one.

### 3. Your steps in the Meta dashboard, in order

- [x] **Deploy T-181 first**, so `/data-deletion` exists. (Done 18 November.)
- [ ] **App settings, Basic.** Most of this was listed under T-175; tick what is already there.
  - App icon: upload `Docs/design/meta-app-icon.png`.
  - Privacy policy URL: `https://qolumns.com/privacy`.
  - Terms of Service URL: `https://qolumns.com/terms`.
  - User data deletion, "Data deletion instructions URL": `https://qolumns.com/data-deletion`.
  - Category: Business and pages. App domains: `qolumns.com`. Website: `https://qolumns.com`.
  - Contact email: `hello@qolumns.com`.
- [ ] **Business details only you have** (Meta asks for them in Basic settings and in business verification):
  - Legal business name: Billiom Limited. Registered address: [yours]. Company number: [yours].
  - Business phone: [yours]. Business website: `https://qolumns.com`.
  - Data Protection Officer contact (name, email, address), if the form asks for one: [yours].
  - Verification documents (certificate of incorporation, or a bill at the registered address): [yours].
- [ ] **Business verification** of the portfolio the app belongs to. Meta does not start App Review before it.
- [ ] **Two screen recordings, one per permission** (Meta does not accept one for both, or screenshots). The
  step-by-step for each is in `Docs/meta-app-review.md`. In short:
  - *Messaging:* signed out, sign in as the test business, open WhatsApp (shows Connected and the number),
    send a test message from "Try it" to your own phone, and show it arriving in WhatsApp.
  - *Management (the connect flow):* sign in as a second test business with no connection, press Connect
    WhatsApp, go through Meta's window to Finish, show the page saying Connected and the message template it
    set up, then the same template in WhatsApp Manager.
  - English on screen, 1080p, no sound, nothing private in view, no real customer messaged.
- [ ] **A way in for the reviewer:** a Qolumns account made for them (a business with one service), its email
  and password in the form's "access instructions" box only. Never in this repo.
- [ ] **Request advanced access** for the two permissions with the texts below, then, once approved, switch the
  app to **Live**.
- [ ] **After Live:** connect a real number, message it, see the reply. Then tell me, and "Quotes inside
  WhatsApp" can lose its "Coming later" (one line in `lib/marketing/plan-claims.ts`).

### 4. Draft justifications (short; the fuller ones are in `Docs/meta-app-review.md`)

**`whatsapp_business_messaging`**

> Qolumns lets a business give its customers a price for its services. A business connects its own WhatsApp
> number through Embedded Signup. When one of its customers messages that number asking for a price, we reply
> in the same chat on the business's behalf: we ask only for what the price needs, then send a link to the
> estimate, priced from that business's own price list. When the business approves the estimate we tell the
> same customer it is ready. We message only customers who wrote to the business first; we send no marketing.
> We need this permission to receive those messages, download the photos a customer sends, and send the replies.

**`whatsapp_business_management`**

> We use this permission to set up and keep the connection a business makes through Embedded Signup: to read
> the phone number it chose, to subscribe our app to that account's webhooks (and unsubscribe on Disconnect),
> to create one utility template in its account ("estimate_ready", which tells a customer their estimate is
> ready when more than 24 hours have passed) and read that template's review status, and to learn from the
> `account_update` webhook when a business has removed our app, so we delete the token we hold. We do not edit
> or delete templates and we do not change the business's account settings.

**The data questions, in one line each**

- *How is the data used?* To prepare the estimate for the business the customer wrote to. Each business sees
  only its own customers.
- *Is it shared or sold?* Shared only with that business and the processors named in the Privacy Policy. Never
  sold, never used for advertising.
- *How is it deleted?* `https://qolumns.com/data-deletion`.

### 5. Small things seen on the way (not fixed, as asked)

- Pricing says "50 estimates a month"; Home says "50 quotes a month".
- Pricing's answer to "Can I cancel anytime?" says "Plans are monthly with no contract", though a plan can be
  yearly.
- On Pricing's dark Pro card the two underlined lines (they link to the demo) each wrap onto a second line.
- On Home, Starter's card has two lines and Pro's has four, so Starter has empty space above its button.
- Pricing's Starter and Pro cards are different heights for the same reason.
- The Meta app icon is still the temporary wordmark.

### Not checked

- The rest of the regression set (`verify-t173`, `t175` to `t180` and others) was not run: nothing they cover
  changed. The ten that cover the changed pages were run before the deploy and pass.
- The changed pages were looked at in a browser on this machine at 1280 and 390 px wide. On production I
  checked that they load and carry the new words, not how they look.


## T-182 — Mobile app: audit, fixes, ready to test on your phone

**Web deployed 18 November 2026** (web only, `dpl_BrEMsLf6ECx4vzDkCBf6UUTLiydu`, serving `qolumns.com`; no
migration, no worker change, nothing in Stripe). The app itself is never "deployed" at this stage: it runs
from your Mac into Expo Go on your phone. You can start the phone test below now.

### The web server's side is live

- [x] **Deploy the web before the phone test.** Done 18 November. The two app-only routes (below, "What
  changed on the server") are on production.
- Read-only live checks after the deploy, all as expected: `/`, `/login`, `/pricing` and the demo quote link
  200; an unknown quote link 404; the WhatsApp webhook refuses a wrong token (403) and an unsigned call (401);
  the Stripe webhook refuses an unsigned call (400); `POST /api/app/quotes` and `GET /api/app/quotes/:id`
  without a sign-in are refused (401).
- **Not proven by those checks:** that the two app routes answer in their new shape on production. That needs
  a sign-in, and I do not sign in to production. Your first quote from the phone proves it (step 2 below: a
  quote with only a name is accepted).

### It runs in Expo Go. No Apple account, no Xcode.

Everything except the LiDAR room scan runs in Expo Go. The room scan needs a development build (it is native
code); in Expo Go the app hides the scan card and everything else works. The scan was already optional; I
checked the code path and changed nothing in it.

### Test on your iPhone, step by step

**Install**

- [ ] On the iPhone: **Expo Go** from the App Store (free). Nothing else.
- [ ] On the Mac: nothing new.

**On the Mac (Terminal)**

```bash
cd ~/Documents/Estimator
pnpm install
cd apps/mobile
cp .env.example .env
open -e .env
```

- [ ] In `.env`, set three values. Names only here; the values are in Vercel (the web project, Production):

  | Name in `apps/mobile/.env` | Value |
  |---|---|
  | `EXPO_PUBLIC_API_URL` | `https://qolumns.com` (no slash at the end) |
  | `EXPO_PUBLIC_SUPABASE_URL` | the value of `NEXT_PUBLIC_SUPABASE_URL` in Vercel, Production |
  | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | the value of `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel, Production |

  The same two Supabase values are in the Supabase dashboard under Project Settings, API ("Project URL" and
  the "anon public" key). Both are public by design. **Never put the service role key in this file.**
  `.env` is not committed.

- [ ] Start it, with the iPhone and the Mac on the same Wi-Fi:

  ```bash
  npx expo start
  ```

  A QR code appears. Open the iPhone's **Camera**, point it at the code, tap "Open in Expo Go". The first time
  iOS asks whether Expo Go may find devices on your local network: **Allow**.

- [ ] If the phone cannot connect (some Wi-Fi networks stop devices seeing each other), stop it with Ctrl+C and
  run `npx expo start --tunnel` instead. It asks once to install a small helper; say yes.
- [ ] If the app opens on "Qolumns is not set up yet", it names the setting that is missing. Fix `.env`, stop
  and start `npx expo start` again (settings are read when it starts).

**Sign in**

- [ ] Bluum's email and password, the same ones as on the web. (The app has password sign-in only, as the web
  has.) Bluum is a free test account on Pro, so nothing is charged; each test quote is a real quote on Bluum
  and counts toward its 200.
- [ ] No message goes to anyone unless you type their email address or send them the link yourself. Use your
  own name and your own phone.

**What to try**

- [ ] 1. The quotes list: Bluum's quotes, each with the dashboard's words ("Needs your approval", "Waiting for
  customer", "Could not be priced"), not "pending_review".
- [ ] 2. **The on-site path.** New quote, pick a service, take the photos, answer the questions, type a name,
  "Price this job". Count the taps, and do it with one hand. Each photo should say "Uploading 40%" then
  "Uploaded" while you carry on.
- [ ] 3. The price appears (about 20 to 60 seconds). Press **Approve & send**: the share sheet opens. Send the
  link to yourself by Messages or WhatsApp and open it: it is the customer's estimate page.
- [ ] 4. **Lost signal.** Start a new quote, take one photo, then switch on Airplane Mode. Finish it and press
  "Price this job". It should say "Saved on this phone". Go back to quotes: it is at the top. Switch Airplane
  Mode off. Within a few seconds it sends by itself and the price follows. In the dashboard there is one
  quote, not two.
- [ ] 5. **Closing the app.** Half-way through a quote, swipe the app away. Open it again: "Carry on with the
  quote" is there with your photos and answers.
- [ ] 6. A service that reads a label (if Bluum has one): the question says what was read in one line, and you
  answer it on site.
- [ ] 7. In the dashboard: the quotes you made are there with the same status, marked as made in the app, and
  Billing counts each once.
- [ ] 8. Tell me what was awkward: a button too small, a step too many, text that reads wrong.

Not bugs in Expo Go: there is no room scan card, no app icon, and the splash is Expo's.

### Not proven

I have no iPhone and no simulator on this machine (Xcode is not installed), so **I have not seen the app
run.** Proven without a phone: the app's code typechecks, lints, bundles for iOS in full, and its own API
client and sending queue pass 54 checks against the real local server (`verify-t182`) and 48 unit tests.
Not proven by anyone yet, and what your test above covers:

- the camera and the photo library, and making a photo smaller before it is kept
- photos saved in the app's own folder, and the upload progress bar moving
- the sign-in staying after the app is closed (the keychain)
- the share sheet
- the keyboard not covering a field, and how the screens look

If any of these fails on your phone, send me what you saw (a screenshot is enough).

### What changed on the server (both are routes only the app uses)

- `POST /api/app/quotes`: the customer's **email is optional** now (the name is still required). It also
  takes an id the app makes for each quote, so sending the same quote twice answers the first one.
- `GET /api/app/quotes/:id`: carries more (the lines, the minimum-charge note, added services as sections,
  whether the request is held, what was sent with the request, its photos).
- Not changed: pricing, the quote flow, the worker, Stripe, the database. One helper that reads a label
  reading back was moved into the shared package; the customer pages use it from there and their tests pass.

### Decisions (yours, 18 November 2026)

1. **Deploy the web before the phone test.** Decided: yes. Done the same day.
2. **Customer email on site.** Decided: stays optional (the name is required).
3. **App icon and splash.** Decided: in the TestFlight ticket. Not needed for Expo Go.
4. **Brand fonts in the app.** Decided: in the TestFlight ticket, with the icon. The app uses the iPhone's
   own font until then.
5. **Editing a quote or adding a service.** Decided: dashboard only. The app shows sections; it does not edit.
6. **Words at the plan limit.** Decided: reword before the App Store submission. The app says plans are
   changed on the web, and Apple's rules do not allow an app to point people at a purchase outside the app.
   Fine for Expo Go and TestFlight. It is a step in the TestFlight list below.
7. **The app's own upload route.** Decided: a small later ticket (backlog item 11 at the top of this file,
   and under "Later" below). Until then photos go through the public upload route, which is rate limited by
   network address; if a limit is hit the app waits and retries by itself and never skips the limit.

### Later: what the Apple Developer account and TestFlight need

You do not have the account yet. When you do:

- [ ] **Apple Developer Program**, $99 a year. Enrol as the company (Billiom Limited): Apple asks for the
  company's D-U-N-S number and checks it, which can take a few days.
- [ ] **An Expo account** (free) and `npx eas init` in `apps/mobile`, which links the app to it.
- [ ] **A development build** for the LiDAR room scan: `npx eas build --profile development --platform ios`,
  installed on a LiDAR iPhone (a Pro model, 12 Pro or later). Then the accuracy check in the T-138 section.
- [ ] **In App Store Connect:** a new app with the bundle id `com.qolumns.app`; the name; a 1024 px icon;
  screenshots; the privacy policy address (`https://qolumns.com/privacy`); a support address; the privacy
  answers (photos, contact details, sign-in); and a sign-in for Apple's reviewer (a test business, because
  the app has no sign-up).
- [ ] **For TestFlight:** `npx eas build --profile production --platform ios`, then `npx eas submit`. Testers
  inside your team get it at once; outside testers wait for a short review.
- [ ] **Before the App Store submission: reword the plan-limit text in the app** (decision 6). Today a held
  request and a paused account say that plans are changed on the web. Apple does not allow an app to point
  people at a purchase outside the app, so the text must say what happened and that the request is saved,
  with no mention of where to pay. Not needed for Expo Go or TestFlight. Mine to do in that ticket.
- [ ] From me, in that ticket: the icon and splash, the brand fonts, the EAS settings file and the encryption
  declaration (the app uses only standard HTTPS).

### Later

- **A small ticket: the app's own upload and form routes** (decision 7; backlog item 11). The signed-in app
  gets its own routes for starting a photo upload and reading a service's questions, limited per business
  and not per network address, so a busy shared network can never slow a trade down. The public routes and
  their limits stay as they are.
- Photos sent from the app get no small copy (only the web form makes one). Already in the backlog (item 10).
- Notifications on the phone when a customer accepts (backlog).
- Android. The code is shared, but nothing was checked on Android.
- The free-quotes-left line ("2 free quotes left") shows in the dashboard and by email, not in the app.

### Closed by this ticket

- T-137's "Try it on your iPhone": replaced by the steps above.
- T-158's note "The mobile app still shows its own status words": it uses the dashboard's words now.
- T-171's item "The business's on-site app still shows the label's raw text": it is one plain line now, with
  the label's words on a line of their own.

---

## T-183 — Approval the business can trust, quote wording, faster test runs

Built and pushed 18 November 2026. **Not deployed.** The worker and the web app both changed; there is no
migration and nothing in Stripe. To put it live: "deploy T-183" (worker first, then web).

### Read this first: one fault is live on production until this is deployed

- **What:** the check that keeps certain words about a price away from customers ("exact", "firm",
  "preliminary", "guaranteed", "guarantee") has been finding nothing in the live web app. The tool that builds
  the web app for production changed the pattern so that it matches nothing. It works on this Mac's
  development server, in the unit tests and in the worker, which is why nothing showed it.
- **What it means:** when you approve a quote without editing it, the web app does not take such a word out
  of the AI's wording, and never tells you "this wording needs editing". The worker still removes these words
  when it first writes a quote and when it reprices one, so a customer can only have seen one where that first
  pass had already missed it.
- **How I know:** two regression scripts passed against the development server and failed against a built
  web app, in the same checks. I have not read production's own build (I cannot); it is made by the same tool
  from the same files.
- **Fixed in this ticket.** It goes live with "deploy T-183". The checks now also read every built web app
  for this kind of fault.
- [ ] **Decide: deploy T-183 soon** (recommended), since this is live. Nothing else is needed from you.

### What changed, in one line each

- **Approval page** (the page behind "Approve & send" in the review email): warnings first, then every price
  line with its amount and where its quantity came from, each service's subtotal on a combined quote, the one
  total, the customer's photos as small pictures, then the one button. "Open in dashboard to edit" stays.
- **The "Review and approve" email:** the same, in the same order, with the photos as one line ("3 photos:
  view them on the approval page"). No "Powered by Qolumns". A marked row at the top for the Qolumns logo.
- **Line names:** a line is named from your customer's question and the option, never the answer text:
  "Who provides the materials: Please supply it (+15%)", not "Please supply it surcharge (+15%)". A label you
  give the rule yourself still wins.
- **Wording:** the scope summary's first sentence states the work. Headings and buttons are sentence case in
  every email, the PDF and the quote page.
- **Name with logo:** on the quote page and the PDF the business's name is beside its logo.
- **Tests:** two commands, `pnpm check:quick` and `pnpm check:full`. The regression set now runs against a
  built web app, as production is, which is how the fault above was found.

### Check by eye (I cannot see these)

- [ ] **The review email in your own mail program**, after the deploy: make a request to Bluum and read the
  email on your phone. It has been built and its content checked, but nobody has looked at it in Gmail, Apple
  Mail or Outlook. Look at the warnings box, the lines with the small grey source under each, and the top row
  where "Qolumns" stands in for the logo.
- [ ] **The approval page on your phone**, from that email: the small photos load, nothing scrolls sideways,
  the button is easy to reach. A screenshot from this machine at phone width is in the results folder of
  `verify-t183` (`approve-390.png`).
- [ ] **A quote page for a business with a logo.** The name now sits to the right of the logo. If a logo
  already has the business's name drawn into it, the name appears twice (decision 2 below).
- [ ] **How a real model opens the scope summary.** The instruction changed; the full run printed what the
  model wrote this time:
  "Preparation and application of two coats to one hallway wall totaling approximately 100 sq ft during a single Service Alpha visit. All required materials will be supplied as requested to complete the specified area."
  Read a few on real quotes after the deploy. If one still opens chattily, send it to me.
- [ ] **The Qolumns logo file.** When you have it, give it to me: it goes in the marked row at the top of the
  review email.

### Decisions for you (my recommendation first)

1. **Photos in the review email are one line, not pictures.** Recommended: keep. The photos are private, and
   mail programs block or re-host pictures, so a line is the reliable form. The approval page shows them.
2. **A logo that already contains the business's name.** The page cannot tell, so it shows the name beside it
   as you asked. Recommended: leave it; if businesses complain, add a "my logo includes my name" switch in
   Branding (a small later ticket).
3. **Logo in emails to the customer.** They show the business's name as text today and no logo, so nothing
   changed there. Adding the logo means giving a private file a public address. Recommended: a small later
   ticket, with a public address for logos only.
4. **The other emails to the business** (new quote, quote accepted, quote declined, customer feedback, plan
   limit, WhatsApp renewal) still end "Powered by Qolumns" and have no logo row. This ticket named the review
   email only. Recommended: change them all the same way in one small ticket when the logo file exists.
5. **The "Request updated" email** (a customer added a service) has an Approve & send button too, and still
   shows each service's subtotal and the total only. Recommended: give it the same detail in a later ticket.
6. **Old quotes keep their old line names.** Only quotes priced after the deploy get the new names.
   Recommended: leave them; a quote already sent should not change its words.

### The two test commands

| Command | When | Time on this Mac |
|---|---|---|
| `pnpm check:quick` | every ticket | 4 to 5½ minutes (three runs: 3 min 53 s, 5 min 26 s, 4 min 34 s) |
| `pnpm check:full` | when pricing, the worker, AI prompts, billing, the quote flow APIs, emails or a migration change | about 35 minutes (one run: 35 min 8 s, of which 5 minutes were a script that hung after passing, fixed since) |

- `pnpm check:failed` runs again only what failed last time. `pnpm check:quick --only t183` runs one script.
- Before this ticket the full set took about 55 minutes, by hand, with the servers restarted five times.
- The quick level asks no AI model (the worker runs with a stand-in), so it costs nothing and gives the same
  answer every time. It leaves out 12 of the 32 scripts: five that check what only a real model produces, six
  that need their own specially started servers, and the Stripe one. `Docs/testing.md` lists them.
- Both levels build the web app and serve the built app for most scripts. That is why they are fast, and why
  they now see what production sees.
- Once per machine: `pnpm check:setup` (the browser tools). Already done on this Mac.

### Not proven

- The review email as a mail program shows it, and the approval page on a real phone (both above).
- The wording a real model writes: the instruction is tested; the model's sentences are read by a person.
- A quantity measured from real photos reaching the approval page end to end. The two halves are each proven:
  the worker stores "measured from photos" for a photo reading (unit tests), and the page shows a stored
  "measured from photos" (`verify-t183`).
- Nothing was tried on production.

### Later

- A switch in Branding for "my logo includes my name" (decision 2).
- The logo in customer emails (decision 3); the other emails to the business (decision 4); the "Request
  updated" email (decision 5).
- The six scripts that need their own servers cannot join the quick level while the web app honours a
  stand-in's address only on the development server. That rule is a safeguard and stays.
- Every earlier deploy was checked against the development server only. The full level now uses the built
  app, so this gap is closed for the scripts in the standard set (25 of 32).
- The emails still use their old colours (blue buttons, grey text), not the design system's. A design ticket.
