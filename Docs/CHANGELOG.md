# Changelog & Decision Log

> This document tracks issues encountered, architectural decisions, and fixes made to the AI Estimate Platform. It serves as institutional memory to prevent regressions and ensure consistency across development sessions.

---

## Table of Contents

- [Issues & Resolutions](#issues--resolutions)
- [Architectural Decisions](#architectural-decisions)
- [Known Constraints](#known-constraints)
- [Fix Dependencies](#fix-dependencies)

---

## Issues & Resolutions

### 2026-11-10: T-153 — A working public demo: "Try it as a customer"

**Problem:** "Try the live demo" opened a developer page asking for a Tenant Key. A visitor had nothing to try.

**Built:**
1. **Migration 36** (additive, re-runnable):
   - `tenants.is_demo`, with a guard trigger: only the service role may set or change it (a user token gets 42501, as with the slug guard, AD-036).
   - `quotes.is_demo`, copied from the tenant on insert by a trigger whatever the caller sends; an update keeps the old value.
   - The demo slug `example-home-services` reserved (also in `lib/tenant-slug.ts`).
2. **The demo business** (`scripts/seed-demo-tenant.mts`, idempotent, `--prod` via the keychain management API):
   - "Example Home Services", fixed id, our own juniper-green colour and drawn logo (`public/demo/`), no user, no owner or notification email, benchmarks off.
   - Three services built from the US packs exactly as setup builds them (`lib/demo/demo-services.ts` → `servicePayload`): Garage Door Spring Replacement and Interior Painting need no photo (rooms come from the form); Water Heater Replacement takes the label photo.
   - All send automatically and take one photo at most. Prices are the packs' own, stored as the demo tenant's configuration (AD-001).
   - The rows are written by the same builder `POST /api/services` now uses (`lib/service-rows.ts`, pulled out of the route without changing behaviour).
3. **Demo requests** (`POST /api/public/quotes`):
   - Turnstile, honeypot, the `quotes` rate limit and upload limits as for any request.
   - Then the demo limits, counted in the database so they hold without Upstash (`lib/demo/demo-guard.ts`): `DEMO_IP_LIMIT_PER_HOUR` (5) per IP, keyed by a salted hash kept only on the demo request, and `DEMO_DAILY_CAP` (200) in the last 24 h. Over either → 429 `DEMO_BUSY`, nothing created.
   - Outside any plan: no limit, no lead hold, no usage counter, no overage. Not marked `is_test` (no Test badge).
   - No unfinished lead (`POST /api/public/leads` → `skipped`).
   - Worker: no emails at all (this matters: with no owner, the business email fell back to the from-address); no `estimates_sent`; no adjudication model; one photo read. `is_demo` is in its field-by-field projection (the T-108/T-150 trap).
   - Accept, decline and feedback emails and the reminder pass skip demo quotes. A visitor's clarification answers are never recorded as calibration. Benchmarks and the admin tenant list exclude the demo.
4. **Clean-up:** the daily lifecycle cron's pass 3 (`lib/demo/demo-cleanup.ts`) deletes, for demo tenants only, uploads and PDFs older than 24 h (R2 objects first, via a new `deleteFromR2`), then quotes, then requests with no quote left. If R2 fails, the rows stay for the next run.
5. **/demo** (marketing layout, phone first):
   - "Try it as a customer", one line, and the note "Example Home Services is an example business with example prices".
   - The real widget with a new `demo` option on `EstimateWidget` (no second implementation): contact pre-filled with reserved fake details (`sam.sample@example.com`, `(555) 010-0199`) and "No email or text will be sent to anyone"; "Use a sample photo" on the photo step (a rating label we drew, uploaded through the normal path); the success message never promises an email.
   - The page polls the public quote API and shows the estimate on the same page (a range plus "would ask one question" when the quote waits for an answer), then a static "What the business sees" card with Approve & send, then "Try it free: 10 quotes, no card".
   - Over the limits: a recorded example estimate (a real demo run; a unit test checks it still matches the pack's price) and the same signup button.
   - `/demo?tenantKey=…` keeps the old developer view (moved unchanged to `components/demo/DeveloperDemo.tsx`), so the Share page's link still works.
6. **Links:** the home page, the trade pages and the footer now say "Try it as a customer" and go to `/demo`.

**Found while verifying:**
- The first sample label printed "GAS" twice and only "NATURAL GAS" for the fuel. The label read capacity correctly, but the fuel varied between passes (natural gas / propane / electric) and the quote asked the customer. A "GAS TYPE NATURAL GAS" line, as real labels have, makes the fuel read reliably. The water heater still usually asks the customer to confirm capacity (a range of about $1,890–2,410 around the $2,150 price), which is the normal T-109 path; the page shows it as a range.
- The widget's success message promised "we'll email you the link"; in the demo it now doesn't.
- The browser harness clicked before the dev server's second config load (React StrictMode runs effects twice in development only) and was sent back to the service step; it now waits for the network to settle.

**Verified:**
- `verify-t153.mts` 36/36 live (web started with `DEMO_DAILY_CAP=8`, `DEMO_IP_LIMIT_PER_HOUR=3`, `CRON_SECRET`):
  - the seeded business: flagged, slug, no user, no notification email, no benchmarks; three services, all auto-send, ≤ 1 photo, two without photos;
  - `/demo` with the note and the demo widget; `?tenantKey=` opens the developer view; home, painting and trade pages link to `/demo` with the new words; the widget config never carries the flag and serves the shipped logo;
  - no lead from the contact step; spring pair **$375** in 5.9–6.8 s; painting 2 rooms **$825**; the sample photo uploads; two photos are refused; the water heater is read from the label (range $1,890–2,410 around $2,150, with a question);
  - all three flagged demo (not test); no usage counter; nothing recorded for calibration; the IP stored only as a hash;
  - the 4th request from one IP → `DEMO_BUSY ip_limit`, nothing created; other IPs fill the cap of 8; the 9th → `DEMO_BUSY daily_cap`;
  - a business can't set the flag through `PUT /api/tenant` or directly with its own token (403), `GET /api/tenant` never returns it, and it can't read a demo quote (404);
  - clean-up: a demo request 23 h old is kept; after 24 h the cron deletes 8 quotes, 8 requests, 1 upload and its R2 object; a real business's 48 h old quote is untouched; the demo then takes requests again.
- Playwright 14/14 on a 390 px phone, signed out:
  - the note, the fake pre-filled contact details and the "no email or text" line; no sideways scroll;
  - spring: the estimate appears on the page **5.5 s** after Continue at **$375.00**; "What the business sees" with Approve & send; the signup button;
  - water heater: "Use a sample photo" fills the label slot and uploads, then the button goes (one photo); the estimate shows on the page as a range;
  - painting: $825.00; the 4th run from the same visitor shows the recorded example and signup.
- The worker logged "Demo request: no emails" for every demo run.
- Regression set: verify-t146/t147/t148/t149/t150/t151/t152 20/20, 33/33, 29/29, 35/35, 27/27, 35/35, 66/66. One T-152 unit test read the old `!isTest` guard in the intake source; it now reads `outsidePlan` (same behaviour).
- Unit tests: web 278 (+25):
  - the demo services (three, from the packs, auto-send, one photo, two without photos, the packs' prices unchanged) and the shared row builder used by the API and the seed;
  - the recorded example still matches the pack price and passes the customer language guard;
  - the limits (cap first, then per IP; env parsing; the IP hashed and salted) and their place in the route (after Turnstile and the quotes limit, before any record);
  - intake outside any plan without the Test mark; the worker's no-email, no-usage, no-adjudication and one-photo guards and its projection; no lead, reminder, calibration, benchmark or admin listing;
  - the flag: guard and inherit triggers, no tenant or public API carries it, the slug reserved;
  - clean-up: the cut-off, the order, demo rows only, rows kept when R2 fails, nothing without a demo tenant, the cron pass;
  - /demo by default and the developer view with `?tenantKey`, one widget, the new link wording everywhere, our own drawn files.

  Worker 465, mobile 11. Lint, typecheck, web and worker builds pass.

**Files:** `supabase/migrations/00000000000036_public_demo.sql`, `scripts/{deploy-migration-36.sh,seed-demo-tenant.mts}`, `packages/shared/src/{demo,index}.ts`, `apps/web/public/demo/*`, `apps/web/src/lib/demo/{demo-services,demo-guard,demo-cleanup,demo-tenant,recorded-example}.ts`, `apps/web/src/lib/{service-rows,r2,quote-intake,measurement-memory,tenant-slug}.ts`, `apps/web/src/app/demo/page.tsx`, `apps/web/src/components/demo/{DemoExperience,DeveloperDemo}.tsx`, `apps/web/src/components/embed/{EstimateWidget,steps/ContactStep}.tsx`, `apps/web/src/app/api/{services,public/quotes,public/leads,public/widget/config,public/quotes/[quoteId]/{accept,decline,feedback,clarify},cron/lifecycle,learning/benchmarks,admin/tenants}/route.ts`, `apps/web/src/{app/page.tsx,components/marketing/{SiteFooter,TradeLanding}.tsx}`, `apps/web/.env.example`, `apps/worker/src/quote-processor.ts`, `scripts/hardcore-test/verify-t153.mts`, tests.

### 2026-11-10: T-152 — Simpler dashboard: waiting work first, five menu items, free allowance fixed

**Problem:** the dashboard had ten menu items, three of them channels a business can't set up alone. Home led with stats and repeated shortcuts, not the work waiting for the owner. The free allowance reset every month, so a small business never had to pay.

**Built:**
1. **Menu: Home, Quotes, Prices, Share, Settings** (desktop and phone).
   - "Services" became **Prices**: same page, moved to `/app/prices`.
   - **Settings** is one area with tabs (Business · Branding · Billing · Notifications), each an existing page: `/app/settings`, `/app/settings/branding`, `/app/settings/billing`, and `/app/settings/notifications` (split out of the old settings page, same field and API).
   - Old URLs redirect in `next.config.js` (307, query kept): `/app/services`, `/app/branding`, `/app/billing`. Stripe checkout and portal return to the new billing URL.
   - Analytics opens from "See all numbers" on Home; `/app/analytics` still loads.
   - SMS has no menu item; its page and behaviour are unchanged.
2. **WhatsApp moved into Share** as "Use it on WhatsApp" (`components/share/UseItOnWhatsApp.tsx`, texts in `lib/share-texts.ts`):
   - "Send on WhatsApp" (`wa.me/?text=` with the quote link; counts as sharing for the checklist);
   - greeting, away and quick-reply texts for the WhatsApp Business app, each with the link and two lines on where to paste it;
   - "Connect your WhatsApp number for full in-chat quoting (advanced)" → the unchanged `/app/whatsapp`.
   No "coming soon" wording.
3. **Home, top to bottom:**
   - "Waiting for you": priced quotes awaiting approval, not tests, not held leads, newest first. Each shows customer, service and price, with Approve & send (the existing approve API). Errors such as `WORDING_NEEDS_EDIT` show in place with an Open link. Hidden when empty.
   - The T-151 7-day unfinished count.
   - The usage banner.
   - The setup checklist (`lib/setup-checklist.ts`) until done: Add a service · Check your prices · Share your quote link · First real request received.
   - Four 30-day numbers (`lib/home-numbers.ts`): requests, estimates sent, accepted, value accepted.
   - Quick Actions and the old AI-setup hero are gone.
   - **Check your prices** ticks on `tenants.prices_checked_at` (**migration 35**), stamped only by setup's "These are my prices" or saving a service on Prices (`PUT /api/tenant {pricesChecked: true}`).
   - **First real request** excludes setup tests and quotes the business made in its own app (the source lives on `quote_requests`).
   - **Branding** left the checklist. Its tick, now on the Branding tab, was wrong: `logoAssetId !== null` was true whenever the key was missing. `hasCustomBranding` needs a real logo id or a colour other than the default.
4. **Free allowance: 10 priced quotes in total** (`FREE_ALLOWANCE` in `plans.ts`: US `{10, total}`, legacy GB `{50, month}`).
   - `checkPlanLimit` and `/api/billing` read every month's `usage_counters` row (`usedForAllowance`) and sum them for a `total` allowance.
   - Subscribed tenants still count this month against their plan.
   - Tests and unfinished requests never increment the counters, as before. Over the allowance → the T-134 lead hold.
   - The limit and lead-held emails, Home banners and billing page say "free quotes" and drop "resets next month" for the free allowance.
   - Pricing page: an offer button and an FAQ "Can I try it for free?". Every "Start free" now reads **"Try it free: 10 quotes, no card"** (`freeOfferLabel()`).
5. **Setup:** an optional logo on the basics step. `components/settings/LogoUpload.tsx` is pulled out of Branding (same `/api/tenant/logo`) and used by both.
6. **Clean-up:**
   - Branding placeholders come from the region (`RegionCopy.emailExample` / `websiteExample` and the existing `phoneExample`; the hardcoded `+44 7700 900000` is gone). `GET /api/tenant/branding` returns `region`.
   - `PRODUCT_NAME` and `DEFAULT_PRIMARY_COLOR` live in `packages/shared/src/brand.ts`. "Powered by Estimator" in every web and worker email, the auth pages, the embed snippet comment, the demo page, the quote page badge and the widget footer now come from `PRODUCT_NAME`.

**Found while verifying:**
- The first draft of Home filtered quotes on `source_json`, a column that lives on `quote_requests`. Both Home queries failed silently, showing zero numbers and an unticked "first real request". They now use an inner join with an OR filter on the request. A unit test pins the shape.
- On a 390 px phone, the longer offer button pushed "Log in" onto two lines in the marketing nav. Both are compact on phones now.
- Analytics' usage tile read the legacy `plans.monthly_estimate_limit` with a GB fallback, so a free US business saw "x / 50" for this month. It now uses the same `checkPlanLimit` as enforcement and billing ("Free quotes, counted in total").

**Verified:**
- `verify-t152.mts` 66/66 live:
  - menu: five links, no Analytics/WhatsApp/SMS/Branding/Billing items;
  - redirects: 307 for the three old URLs (query kept) and `/app/widget` → Share;
  - pages: ten load (Prices, the four Settings tabs, Analytics, WhatsApp, SMS, Share, Quotes); the WhatsApp page is as before;
  - Share: wa.me with the slug link; the three texts with the link and paste steps; the advanced link; no "coming soon";
  - checklist: a service alone doesn't tick prices; confirming and copying tick; a setup test isn't a real request;
  - allowance:
    - 8 seeded last month, then quotes 9 and 10 priced this month;
    - the 11th held as a lead and not counted;
    - a setup test at the limit is priced and not counted;
    - an unfinished request doesn't count;
    - billing shows 10/10 `total` with 1 lead waiting;
    - Analytics shows the same 10/10 in total;
    - "Price this lead" is refused (402);
    - legacy GB is 50 a month (last month's 50 don't count);
    - a subscribed Starter is priced as before;
  - Home: the waiting quote shows customer, service and price ($1,400.00) above the numbers; leads and tests aren't in it; the numbers are 3/1/0/$0; a rival sees nothing and gets 404 on approve; approving sends it and empties the section;
  - Branding tab tick only after a real colour; branding API returns the region;
  - public pages: pricing offer and FAQ; no "Start free" on the home page; the login page shows the product name.
- Playwright 26/26 on a 390 px phone:
  - Home leads with "Waiting for you" (no sideways scroll); the phone menu has five items;
  - Approve & send from Home sends it, and the section is gone after reload;
  - Share: the wa.me link, Copy puts the greeting on the clipboard, the advanced link opens `/app/whatsapp`;
  - old URLs: Branding lands on Settings → Branding with the US phone placeholder; Billing lands on Settings → Billing, which shows "Free quotes used"; Services lands on Prices;
  - Notifications saves;
  - pricing and home pages have no sideways scroll;
  - setup with and without a logo both finish; the logo is saved, and "These are my prices" stamps the check.
- Regression set: verify-t146/t147/t148/t149/t150/t151 20/20, 33/33, 29/29, 35/35, 27/27, 35/35.
- Unit tests: web 253 (+28):
  - allowance: US total, GB month, sums across months, quote 11 held next month, subscribed unchanged, tests and leads never counted, email wording, Analytics on the same check;
  - pricing, FAQ, billing and every CTA wording;
  - checklist ticks and the branding check;
  - waiting filter and order; the 30-day numbers;
  - Home order, menu labels, redirects and pages, Settings tabs, Stripe return URLs;
  - WhatsApp texts (link, steps, no banned words), wa.me encoding, no "coming soon";
  - region placeholders, no leftover product name, setup logo.

  Worker 465, mobile 11. Lint, typecheck, web and worker builds pass.

**Not changed:** the WhatsApp and SMS pages and their behaviour; the mobile app API (`/api/app/*`); plan limits for subscribed tenants; Analytics' metrics (only its usage tile now reads `checkPlanLimit`, since it showed "x / 50 this month" to a free US business).

**Deployed 2026-11-10 17:27 UTC** (commit `439353b`): migration 35 (`latest 00000000000035`, `tenants.prices_checked_at` present), then worker version `4a4c0ddc-e1bf-44e3-9780-4c7332212b7b`, then web (Vercel, Ready). Owner decisions: no backfill for "Check your prices"; the free allowance stays at 10 in total. Before deploying: verify-t146–t152 20/20, 33/33, 29/29, 35/35, 27/27, 35/35, 66/66; lint, typecheck, tests (web 253, worker 465, mobile 11) and both builds pass. Live checks: worker `/health` 200; `/pricing` 200 with "Try it free: 10 quotes, no card" and the free FAQ; `/quote/<real slug>` 200 and an existing `/embed/<tenantKey>` 200; the public quote API 404 for a bad token; approve 401 when not logged in; `/app/services` 307 → `/app/prices`. No request was submitted to production.

**Files:** `supabase/migrations/00000000000035_dashboard_checklist.sql`, `scripts/deploy-migration-35.sh`, `apps/web/next.config.js`, `packages/shared/src/{plans,brand,index,api.types,database.types}.ts`, `packages/shared/src/regions/{types,us,gb}.ts`, `apps/web/src/lib/{plan-limits,setup-checklist,home-numbers,share-texts,lead-hold,email-templates,postmark,embed-snippet,quote-intake,messaging/intake-engine}.ts`, `apps/web/src/app/(dashboard)/{layout.tsx,app/page.tsx,app/prices/page.tsx,app/settings/{layout,page,branding/page,billing/page,notifications/page}.tsx}`, `apps/web/src/components/{home/WaitingForYou,share/UseItOnWhatsApp,share/SharePageClient,settings/{SettingsTabs,NotificationsSettings,LogoUpload},onboarding/OnboardingFlow,marketing/*}.tsx`, `apps/web/src/app/api/{tenant,tenant/branding,billing,billing/checkout,billing/portal,analytics}/route.ts`, `apps/web/src/app/(dashboard)/app/analytics/page.tsx`, `apps/web/src/app/{page,pricing/page,features/page,layout,(auth)/layout,demo/page,q/[quoteId]/page}.tsx`, `apps/worker/src/email/templates.ts`, `scripts/hardcore-test/verify-t152.mts`, tests.

### 2026-11-10: T-151 — Customer flow: contact first, unfinished requests, a next step after accept

**Problem:** the widget asked for address, ZIP and a required description first and contact details last, so anyone who left part-way was lost to the business. After accepting, the customer was only told the business "will be in touch".

**Built:**
1. **Migration 34** (additive, re-runnable):
   - `tenants.contact_requirement` (`email` default | `phone` | `both`);
   - `quote_requests.customer_email` nullable (phone-only requests);
   - `quotes.acceptance_json`;
   - `request_leads`: tenant, service, contact, progress, answers, ZIP, photos, a hashed lead token, `quote_id`/`completed_at`. RLS: tenants read their own; writes go through the service role.
2. **Contact rules** (`lib/contact-rules.ts`, pure): a name is always required; email and phone follow the business's setting, and at least one is always required. The widget, `POST /api/public/leads`, `POST /api/public/quotes` (replacing "name and email are required") and the chat completion check all use them. Values are stored as typed. The region gives the phone example and a new `RegionCopy.phoneHint`; the hardcoded UK example is gone. Settings has "Customer contact details".
3. **Widget order** (form and chat, quote link and embed): service → contact ("Where should we send your estimate?", privacy line with the business name) → the service's own questions (with the quantity) → photos → last step (ZIP and a description). New step files are in `components/embed/steps/` (the questions step is the old details step, moved unchanged), so the widget lost ~340 lines.
   - The address moved to accept.
   - The description is required only when the service asks no questions, in the widget and the public API (`requireDescriptionWithoutQuestions`; WhatsApp/SMS don't set it).
   - Chat mode's prompt follows the same order and the business's contact rule. Optional fields the model fills with filler are dropped (`usableContact`).
   - Chat now also passes the setup test token, which it didn't before (T-150 gap).
4. **Unfinished requests** (`lib/request-leads.ts`, `useUnfinishedLead`):
   - Saved the moment the contact step is done (`POST /api/public/leads`: new `leads` rate-limit scope, Turnstile, honeypot; no AI, no usage; never in test mode). Updated per step (`PATCH`, token-only, progress never goes back).
   - Closed on submit, by the lead token or, when a reload lost it, by the same customer's email or phone and service within 24 h. No duplicates.
   - Dashboard: "Started, didn't finish" filter and badge on Quotes, with how far they got and tap-to-call and tap-to-email (`GET /api/leads`), a strip on the "All" view, and a 7-day count on the home page.
5. **Accept:** tapping Accept asks "When suits you?" (as soon as possible / within two weeks / flexible, plus a note), the job address and a phone number (prefilled from the request), then accepts in one request (`lib/acceptance.ts`).
   - Saved as `quotes.acceptance_json`, shown on the dashboard quote page (`AcceptanceCard`), and included in the business's acceptance email.
   - A page opened before the deploy still accepts without details.
6. **Quote page:** "Send for review" is removed, and every `alert()` is replaced by an in-page message. Ask a question and the quiet Decline link stay.
7. **Phone-only customers:**
   - The worker skips the customer email when there's no address, and the business email omits it.
   - The approve, edit-and-send and reminder paths already guard or now do; resend returns 400 `NO_EMAIL`.
   - The success screen stops promising an email, and the PDF omits the empty line.

**Found while verifying:** the dashboard quote API builds its response field by field (the same projection trap as the worker in T-150). It dropped T-147's `review_hold` and T-150's `is_test`. So the "customer can already see this" note always showed the hidden wording, and the "Test" badge never showed on the quote page; only the list badge, which a different API serves, worked. All three fields are now returned with T-151's `acceptance_json`.

**Verified:**
- `verify-t151.mts` 35/35 live:
  - contact setting: default, invalid, then email-only, phone-only (stored with a null email and priced normally) and both;
  - description: optional with questions, required without;
  - leads: honeypot, invalid contact, save with no quote or usage, token-only updates, rival key 404, the business's list with progress, rival can't see it, home count;
  - submit closes the lead (no duplicate), and a lost-token lead is closed by the same customer;
  - test mode creates no lead, and a forged token gets 403;
  - accept refused without details and not accepted; with details saved and returned to the dashboard; rival 404.
- Playwright 17/17 on a 390 px phone:
  - the quote link and the embed both go service → contact;
  - region phone placeholder, hint and privacy line;
  - a customer leaving after contact appears as unfinished with `tel:` and `mailto:`;
  - a full request goes questions → photos → last step (no address field);
  - accept refuses without details, accepts with them, and the dashboard card shows them;
  - no "Send for review";
  - chat asks for name and email first and saves the lead once given;
  - Settings shows the choice; no browser dialog anywhere.

  Two harness slips, both mine, were fixed during the runs: a "reply arrived" check that matched the page footer, and re-using a tenant from an earlier run.
- Regression set: verify-t146/t147/t148/t149/t150 20/20, 33/33, 29/29, 35/35, 27/27.
- Unit tests: web 225 (+22: contact rules for each setting, phone shapes, chat filler, description rule, region phone copy, lead progress and answer cleaning, lead closing limited to own tenant + token + open + 24 h, accept checks, acceptance email, no `alert()`/"Send for review", widget order); worker 465 (+2: phone-only sends only the business email). Lint, typecheck, web and worker builds pass.

**Older verify scripts (not part of the regression set from now on, owner decision):**
- Pass: t133, t139, t140, t141, t143.
- Fail on T-146 expectations: t127 and t128 priced correctly (£1,700, £85) but expect `sent` or a public grade; t137 expects `sent`; t138 checks takeoff evidence, now business-only.
- t136 (SMS) failed its MMS and confirmation steps. SMS intake shares no code this ticket touched and no SMS or WhatsApp file changed. Not investigated further.

**Deployed 2026-11-10 15:15 UTC** (commit `f147633`): migration 34 (`latest 00000000000034`; `request_leads` with its 2 policies, `tenants.contact_requirement` default `email`, `quotes.acceptance_json`, `quote_requests.customer_email` nullable), then worker version `4d9c4016-a5fe-4db0-96cf-d24e87bf0a67`, then web (Vercel, Ready). Before deploying: verify-t146–t151 20/20, 33/33, 29/29, 35/35, 27/27, 35/35. Live checks: worker `/health` 200; `/quote/<real slug>` 200 and an existing `/embed/<tenantKey>` 200; the public quote API 404 for a bad token; approve 401 when not logged in. No request was submitted to production.

**Files:** `supabase/migrations/00000000000034_customer_flow.sql`, `scripts/deploy-migration-34.sh`, `apps/web/src/lib/{contact-rules,request-leads,acceptance,rate-limit,quote-intake,email-templates,pdf-template}.ts`, `apps/web/src/components/embed/{EstimateWidget.tsx,useUnfinishedLead.ts,steps/*}`, `apps/web/src/components/quote/AcceptDetailsForm.tsx`, `apps/web/src/components/quotes/{UnfinishedLeads,AcceptanceCard}.tsx`, `apps/web/src/components/settings/CustomerContactSettings.tsx`, `apps/web/src/app/api/public/{leads,quotes,widget/chat,widget/config}`, `apps/web/src/app/api/public/quotes/[quoteId]/{route,accept/route}.ts`, `apps/web/src/app/api/{leads,tenant,quotes/[quoteId],quotes/[quoteId]/resend}/route.ts`, `apps/web/src/app/q/[quoteId]/page.tsx`, `apps/web/src/app/(dashboard)/app/{page,quotes/page,quotes/[quoteId]/page,settings/page}.tsx`, `apps/worker/src/{quote-processor.ts,email/index.ts,email/templates.ts}`, `packages/shared/src/{api.types.ts,regions/*}`, `scripts/hardcore-test/verify-t151.mts`, tests.

### 2026-11-10: T-150 — Setup that shows the business its prices and ends with a real test quote

**Problem:** a business picking a trade template went pick template → tick services → tax → done. It never saw a price, the template rates were placeholders, and nothing ended in a real quote.

**Built:**
1. **Migration 33** (additive, re-runnable): `tenants.trade`, `trade_other` (≤ 200 chars), `selected_plan`, `onboarding_skipped_at`; `quotes.is_test` (default false, partial index).
2. **Signup → setup:**
   - `/signup?plan=<id>` keeps the plan in the user's metadata. The first `/app` or setup load copies it to `tenants.selected_plan` if it is an offered plan (`lib/signup-choices.ts`), and the billing page highlights "The plan you picked". Checkout never starts from it.
   - Signup asks the verification email to return via `/auth/callback?next=/app`.
   - `/app` redirects a business with no active services to `/app/onboarding` unless it pressed "Skip" (`POST /api/onboarding/skip`).
   - **Fixed on the way:** the auth callback redirected to `${origin}${next}`, so `next=@evil.com` was an open redirect. It now accepts same-site paths only.
3. **First question "What kind of work do you do?"** (`components/onboarding/TradeStep.tsx`): the region's packs as large options, plus "Something else" with free text, saved through `PUT /api/tenant` (`trade`, `tradeOther`; unknown trade → 400). A pack goes to its services; "Something else" goes to the existing website/describe screen. The region picker moved here, since packs depend on it.
4. **"Check your prices"** (`CheckPricesStep.tsx`), on every path before the basics:
   - `lib/price-list.ts` turns a draft service into a plain list and back: priced items with their condition in plain words, extras, adjustments ("Attic: +12%", "Jobs over $5,000: −10%"), minimum charge and base fee.
   - Every number is editable in place. Edits write the same `workSteps`, `addons`, `multipliers`, `baseFee` and `minimumCharge` that `POST /api/services` and the service editor use (AD-001). The draft's own add-on list is kept in step by name, and bad numbers keep the old value.
   - Template rates carry "These are typical starting prices. Change them to yours." "These are my prices" is required.
   - "Describe a change in plain English" reuses `PricingComposer`. As in the service editor, an empty compile never wipes add-ons or adjustments (`applyCompile`).
   - The create payload moved to `lib/onboarding-service.ts` (`servicePayload`), shared by setup and the live check.
5. **Guided test** (`TestQuoteStep.tsx`, replacing "You're ready"):
   - "Try it as your customer" calls `POST /api/onboarding/test-link` and opens `/quote/<slug>?test=<token>`. The page shows "Test mode".
   - Setup polls `GET /api/onboarding/test-quote` and shows the estimate inline with "Approve & send" (the existing approve API), then the quote link with Copy and "Go to dashboard".
6. **Server-issued test flag** (`lib/test-quote-token.ts`, `lib/test-quotes.ts`):
   - An HMAC over tenant id and a 2-hour expiry, keyed by `TEST_QUOTE_SECRET` or a key derived from the service-role key, so no new env var is needed.
   - `POST /api/public/quotes` verifies it against the tenant of the widget key: invalid, expired or another tenant's → 403. Any test marker a client puts in `source` is stripped.
   - A test request skips the plan limit and lead hold, both usage counters (web `estimates_created`, worker `estimates_sent`), overage metering and the limit email.
   - Capped at 10 per tenant per 24 h (429) so a test link can't be shared as a source of uncounted quotes.
   - "Test" badge on the quotes list and quote page.

**Found while verifying:** the live check showed a test request counted as *sent*. The worker's `loadQuoteData` copies the quote into an object field by field, so the new `is_test` column was invisible to it. This is the same enumerated-projection trap noted at T-108. `is_test` is now in the projection; re-run 27/27.

**Verified:**
- `verify-t150.mts` 27/27 live:
  - setup and plan: a new signup is sent to setup; the plan is kept (an unoffered one isn't) and reaches billing;
  - trade: pack, "Something else" with text, and an unknown trade (400);
  - prices: a price list edit stores exactly; a test request through the test link was flagged and charged $175.50 + $1,333.33 = **$1,508.83**, with usage unchanged;
  - guided test: setup's inline estimate, approve → sent, the list badge, and a rival business can't read it;
  - forgery: `source.test: true` gives a normal counted quote; tampered, made-up and rival tokens get 403; the link needs a login; a bad token on the page is ignored;
  - dashboard: a business with services sees it, and "Skip" stops the redirect.
- Playwright 11/11 through the real screens:
  - lands in setup; template path to "Check your prices" with the note and no engine terms;
  - edited the single door to $1,400; created the services; the guided test opened the quote page in test mode;
  - a request submitted as the customer appeared inline at **$1,550.00** ($150 + $1,400); Approve & send worked; the link and dashboard button show; the quotes list shows "Test";
  - the "Something else → I'll describe it" path (real AI extraction) also reached "Check your prices", without the template note.
- Unit tests: web 203 (+30): price list both ways (every pack service round-trips unchanged, one edit changes one number in the payload, add-on name sync, ±% adjustments, bad input kept), plain adjustment names, the screen rendered (every number present, no engine words), the token (tenant, expiry, tampering, wrong key, junk), source stripping, and plan ids. Worker 463. Lint, typecheck, web and worker builds pass. The web vitest config now uses the automatic JSX runtime so tests can render components.

**Not verified:** the email-verification redirect itself (no email locally; it needs the Supabase redirect URL allowlisted, see OWNER-TODO). No gauntlet: no pricing or AI change.

**Before deploying:** verify-t149's checklist check opened `/app` as a business with no services, which T-150 now sends to setup (307). The check runs as the business with a service now (one-line script fix, no app change). verify-t146/t147/t148/t149/t150: 20/20, 33/33, 29/29, 35/35, 27/27.

**Deployed 2026-11-10 14:03 UTC** (commit `9c6c445`): migration 33 (`latest 00000000000033`, the five new columns present), then worker version `373bb704-2989-4bc1-84ff-199375ae0c96`, then web (Vercel, Ready). Live checks: worker `/health` 200; `/quote/<real slug>` 200 and an existing `/embed/<tenantKey>` 200; a forged test token on the page shows no test banner, and on submit (with `source.test: true` too) gets 403 `TEST_LINK_INVALID` with no quote created (4 before, 4 after); the public quote API 404 for a bad token. A request with no test token was not sent to production (it would create a real, counted quote); that case is covered by verify-t150.

**Files:** `supabase/migrations/00000000000033_setup_test_quote.sql`, `scripts/deploy-migration-33.sh`, `apps/web/src/lib/{price-list,onboarding-service,test-quote-token,test-quotes,signup-choices}.ts`, `apps/web/src/components/onboarding/{OnboardingFlow,TradeStep,CheckPricesStep,TestQuoteStep}.tsx`, `apps/web/src/app/api/onboarding/{test-link,test-quote,skip}/route.ts`, `apps/web/src/app/api/{tenant,billing,quotes,public/quotes}/route.ts`, `apps/web/src/lib/quote-intake.ts`, `apps/web/src/app/quote/[slug]/page.tsx`, `apps/web/src/components/embed/EstimateWidget.tsx`, `apps/web/src/app/(auth)/signup/page.tsx`, `apps/web/src/app/auth/callback/route.ts`, `apps/web/src/app/(dashboard)/app/{page.tsx,onboarding/page.tsx,billing/page.tsx,quotes/page.tsx,quotes/[quoteId]/page.tsx}`, `apps/worker/src/quote-processor.ts`, `packages/shared/src/{api.types,database.types}.ts`, `apps/web/vitest.config.ts`, `scripts/hardcore-test/verify-t150.mts`, tests.

### 2026-11-10: T-149 — Quote link and QR code as the main way to go live

**Problem:** a business could only go live by pasting a script tag. Many small trades can't edit their website or don't have one.

**Built:**
1. **Readable link per business (migration 32, additive, re-runnable):**
   - `tenants.slug` (unique, format CHECK), `slug_changed_at`, `quote_link_copied_at` and `quote_link_first_visit_at`; new tables `tenant_slug_history` and `reserved_slugs`.
   - Slugs are generated **in the database** (`generate_tenant_slug`, BEFORE INSERT trigger on `tenants`), so both signup paths get one: the auth trigger and `setup-tenant`.
   - Existing tenants are backfilled oldest first, so the first business keeps the plain name. Clashes, reserved words and names under 3 characters get a 4-character suffix.
   - A **guard trigger** refuses any slug change not made by the service role. The "users can update own tenant" RLS policy would otherwise let a client skip the format, reserved-word and once-only rules.
2. **Slug rules** (`lib/tenant-slug.ts`): `slugify` mirrors the SQL (accents folded, "&" → "and", 40 characters) and `slugProblem` validates. It owns the reserved list; a unit test checks the migration's list and accent map match it.
3. **`/quote/[slug]`** (server page) resolves the slug with `lib/quote-link.ts`:
   - slug → tenant → **that tenant's own** active site key; a former slug → 308; anything else → plain 404.
   - It renders the **same widget** as `/embed` (AD-024): the embed page body moved to `components/embed/EstimateWidget.tsx`, and `/embed/[tenantKey]` is now a thin wrapper. Branding, the white-label badge, Turnstile, the honeypot and the public API rate limits therefore apply as they do in the embed.
   - New `quote_page` rate-limit scope (60/min/IP). Link-preview metadata uses the business name. The first visit sets `quote_link_first_visit_at`.
4. **Share page** (`/app/share`; the menu item "Widget" → "Share"; `/app/widget` redirects there):
   - "Your quote link" with Copy and Open, and a one-time change with live availability checking (`GET/PUT /api/tenant/slug`).
   - QR code drawn in the browser (`qrcode-generator`, zero dependencies; `lib/qr.ts` turns modules into pixels for the canvas and the PNG download).
   - "Where to put it": Google Business Profile, Facebook/Instagram bio, email signature and text reply, each with its own Copy. Region-aware via a new `RegionCopy.requestNoun` ("an estimate" for US, "a quote" for GB).
   - "Add it to your website": the existing embed code (`lib/embed-snippet.ts`) plus "Send to my web person" (a `mailto:` draft with the code and plain instructions). The tenant key is no longer shown on its own.
   - "Advanced": the existing field builder (`components/share/FormFieldsBuilder.tsx`), collapsed and unchanged.
5. **Setup's last step** shows the quote link with Copy and Open first, then the embed snippet.
6. **Home checklist:** "Embed on website" became "Share your quote link". It is ticked by `quote_link_copied_at` (via `POST /api/tenant/share-event`) or `quote_link_first_visit_at`. **Self-tick removed:** the old item checked for a `tenant_sites` row, which the Widget page created itself on first visit.

**Verified:**
- `verify-t149.mts` 35/35 live. It covers:
  - signup slug, clash suffix, reserved suffix, backfill (no tenant without a slug);
  - the Share page loads without "Your Tenant Key", and `/app/widget` → `/app/share`;
  - `/quote/{slug}` renders this tenant's own widget and records the first visit; a request through that key priced $1,400 like the embed;
  - a second business's page shows only its own widget; unknown, malformed and inactive are 404;
  - `/embed`, widget config and `widget.js` unchanged;
  - slug change: live check (reserved, taken, free), 400/409 refusals, the change itself, 308 from the old slug, once-only, the old slug unavailable to others, a direct row write refused (403);
  - share-event, the checklist label, 400 for a bad event, 401 when logged out.
- Playwright pass 14/14:
  - on a 390 px phone the quote page shows the business, has no sideways scroll, and a request submitted through the form comes back "Your estimate is ready";
  - the Share page order is right, Advanced is collapsed, and the link and all four texts copy exactly;
  - the downloaded QR PNG decodes (jsQR) to the link, and the email draft carries the code.
- Web tests 173 (+29: slug rules and SQL parity, resolution and isolation, share texts, mailto, embed snippet, QR round trip). Lint, typecheck, web and worker builds pass.

**Not verified:** the slug-change form and the setup flow's last step by eye (both checked through their APIs). No gauntlet: no pricing or AI change.

**Deployed 2026-11-10 12:36 UTC** (commit `e30a62a`): migration 32 (`latest 00000000000032`), then web (Vercel, Ready). Worker not deployed (untouched). Before deploying, verify-t146/t147/t148 re-ran against the moved widget: 20/20, 33/33, 29/29. Live checks: 3 of 3 tenants have a slug, all distinct; `/quote/<real slug>` 200, unknown slug 404; an existing `/embed/<tenantKey>` 200; the public quote API 404 for a bad token. `/app/widget` signed out goes to login first (`next=/app/widget`); the signed-in redirect to `/app/share` was verified locally only (no production login available).

**Known limits:** two signups with the same business name in the same instant can race on the unique index; the second insert fails and that signup must be retried (very rare; noted rather than solved). Changing the slug is allowed once, as the ticket says.

**Files:** `supabase/migrations/00000000000032_quote_link.sql`, `scripts/deploy-migration-32.sh`, `apps/web/src/lib/{tenant-slug,quote-link,quote-link-url,share-texts,embed-snippet,qr,tenant-site,current-tenant,rate-limit}.ts`, `apps/web/src/app/quote/[slug]/{page,not-found}.tsx`, `apps/web/src/app/embed/[tenantKey]/page.tsx`, `apps/web/src/components/embed/EstimateWidget.tsx` (moved), `apps/web/src/components/share/*`, `apps/web/src/app/(dashboard)/{layout.tsx,app/page.tsx,app/share/page.tsx,app/widget/page.tsx,app/onboarding/page.tsx,app/quotes/page.tsx}`, `apps/web/src/components/onboarding/OnboardingFlow.tsx`, `apps/web/src/app/api/tenant/{slug,share-event}/route.ts`, `packages/shared/src/{regions/*,database.types.ts}`, `scripts/hardcore-test/verify-t149.mts`, tests. Dependencies: `qrcode-generator` 2.0.4 (web), `jsqr` 1.4.0 (web, dev).

### 2026-11-10: T-148 — Banned customer words are repaired in code, not hidden

**Problem:** the wording prompt was the only thing keeping "exact", "firm", "preliminary", grades and confidence language away from customers. T-147 added a fallback that hid the estimate when the guard tripped, which is safe but loses the instant estimate. The T-147 gap also stayed open: auto-send quotes, clarification-stage payloads and approve-without-edit sends were not checked at all.

**Built:**
1. **`shared/wording-repair.ts` (pure).** `repairCustomerWording` runs the customer language guard sentence by sentence over every AI-generated text a customer can read: the scope summary, assumptions, exclusions and notes; signal recommendations (`workDescription`, `costBreakdown`, `evidence`); and cross-service suggestions (`reason`, `note`, `extractedDetails`). It repairs in a fixed order:
   - (a) the offending sentences go to a rewriter in one call. A rewrite is kept only if it passes the guard, isn't empty, stays roughly the same length, and adds no number the sentence didn't have (AD-001).
   - (b) a sentence that still trips is removed; list items left empty are dropped, and so are recommendations left with no description.
   - (c) whatever is left is "unresolved". In practice that only happens when the scope summary would end up empty.
2. **Business text is never touched.** `businessPhrasesFrom` collects the phrases the business typed: service name, description, scope includes/excludes, default assumptions, add-on labels and work step names (whole and per sentence). `maskBusinessText` masks them before the guard runs. So "Price is firm for 30 days" stays word for word, even when the wording quotes it inside a longer sentence.
3. **Worker (`quote-processor.ts` 4.7):** the repair runs after validation and before the quality gate. That means the clarification-stage, shown-early and auto-send payloads all store cleaned wording.
   - First pass: one rewrite call (`ai/wording-repair.ts`, `wording` registry task, 15 s timeout) only when the guard trips. A clean quote makes no call; the guard is pure.
   - Reprice: no AI, so it goes straight to removal.
   - Unresolved wording holds the quote as `check` in every mode, auto-send included, and skips the clarification round, so the customer never reads it. This replaces the T-147 check at 4.9: `decideReviewHold` no longer takes `wordingProblems`.
4. **Approve without editing** (`lib/quote-approval.ts` `wordingForApproval`, only when `version` is 1): the same repair runs, removal only, on the stored wording, and the result is saved in the approval UPDATE. This covers quotes priced before T-148 and quotes held for wording. Wording only deletion could fix returns 400 `WORDING_NEEDS_EDIT`; the dashboard and app already show the message. An edited quote (`version` > 1) is the business's text and is sent as written. "Save & Send" after an edit is unchanged.
5. **Trace:** `pricing_trace_json.wordingRepair` (`WordingRepairRecord`) records the path, the sentences found, whether the rewrite was called and why it failed, what was rewritten (before/after), what was removed, and what is unresolved. The dashboard trace page shows it as "Customer wording" (`components/quotes/WordingRepairCard.tsx`). The public quote API never reads the trace, and a unit test pins that.

**Found while verifying:** the first live run returned 404 on every approval. The new approve query selected `services.pricing_rules`, but that column doesn't exist: add-ons and steps live in `service_pricing_rules.rules_json`. Fixed before anything shipped, and the approve route now logs a load error instead of hiding it as "not found". verify-t146/t147 were re-run afterwards (20/20, 33/33).

**Banned words:** "guaranteed" and "guarantee" were added to `CUSTOMER_BANNED_WORDS` (owner request, closing the gap the wording prompt alone covered). Business-authored text stays masked, so a business's own "Workmanship guaranteed" is left as typed. Engine-written text (pricing notes, takeoff methods, line labels) is code or business config, not AI wording, and isn't repaired.

**Verified:** `verify-t148.mts` 29/29 live:
- Step a against the real wording model: 3 of 3 banned sentences rewritten, none removed, clean, one call in 2.6 s.
- A real quote with the business's own "firm" assumption is shown early, not held, as T-147 would have.
- Clarification-stage payloads are clean.
- Reprice with dirty stored wording, on a show-then-confirm and an auto-send service: the sentence is removed, the rest kept; shown early and sent respectively; recorded in the trace, never in the public payload.
- Approve without editing removes the generated sentences and keeps the business assumption. Unrepairable scope gets 400 and the quote stays awaiting approval. An edited quote is sent as written.

The generation path's rewrite was exercised against the real model but not inside a full quote: the model wrote clean wording for the provoking request, so no repair fired there.

Unit tests: worker 463 (+17), web 147 (+8, including the two new banned words). Lint, typecheck, web and worker builds pass. No migration. No gauntlet: wording only, no pricing.

**Deployed 2026-11-10 11:53 UTC** (commit `5529f2b`): worker version `9ad1faf9-8c46-4cc4-a9f8-ed7f3da1b89a`, then web (Vercel, Ready). Live checks: worker `/health` 200, public quote API 404 for a bad token, approve 401 when not logged in.

**Files:** `packages/shared/src/{wording-repair.ts,review-mode.ts,database.types.ts,index.ts}`, `apps/worker/src/{ai/wording-repair.ts,quote-processor.ts,__tests__/wording-repair.test.ts,__tests__/review-mode.test.ts}`, `apps/web/src/lib/quote-approval.ts`, `apps/web/src/components/quotes/WordingRepairCard.tsx`, `apps/web/src/app/(dashboard)/app/quotes/[quoteId]/trace/page.tsx`, `apps/web/src/__tests__/customer-language.test.ts`, `scripts/hardcore-test/verify-t148.mts`.

### 2026-11-10: T-147 — Show, then confirm (new default for customer-facing estimates)

**Owner decision:** under T-146 a quote held for review showed the customer no price unless a range was measured. Now the customer sees the estimate straight away, marked as an estimate the business will confirm. The business still approves every quote, and Accept stays locked until it does.

**Built:**
1. **Three modes per service (AD-035).** `services.auto_send` is unchanged; new `services.hold_until_approved` (migration 31, default false, additive and re-runnable). Both off = **Show the estimate, then I confirm it**, the new default, existing services included. `shared/review-mode.ts` holds the logic (`reviewModeOf`, `decideReviewHold`, `isShownEarly`, `customerEstimateRange`), all pure.
2. **Hold kind is recorded per quote:** `quotes.review_hold` = `shown` | `held` | `check` (migration 31). The worker (`quote-processor.ts` 4.9) writes it once, at pricing time. Only the review-by-default branch can produce `shown`. A quote any check held (validation, quality gate, send-guard, zero price, the service's own review rule) is `check`. A hold-mode service, or a quote the business created in its own app, is `held`. Older rows and plan-limit lead holds have `NULL`. Everything except `shown` is hidden exactly as under T-146.
3. **Public quote API:** a shown-early quote returns real pricing, breakdown, takeoff, scope, assumptions and exclusions with `status: pending_review`, `review: {state: 'estimate', confirmationPending: true}` and `acceptQuoteEnabled: false`. `estimateRange` appears only when the engine measured a range (same rule as auto-send, now one helper). No range is invented around a flat price.
4. **Quote page:** the normal estimate document with "This is an estimate based on your photos and details. {business} will review and confirm it." In place of Accept: "You can accept once {business} confirms this estimate." Ask a question stays; "Send for review" and Decline are hidden until approval. The page checks every 15 s and becomes the confirmed quote on the same link without a reload.
5. **Widget:** "Your estimate is ready" with the View button and "{business} will confirm it shortly."
6. **Emails:** the worker sends the customer "Your estimate from {business}" at once (`sendEstimateShownEmail`, the customer template with an `awaitingConfirmation` variant). "Your quote from …" still goes on approval. The business "Review and approve" email is unchanged.
7. **Dashboard:** the Basic step has three radio options in place of the auto-send checkbox. The quote page tells the business whether the customer can already see the estimate. Mobile app unchanged.

**Found while building, and fixed:**
- **Ask a question would have unlocked Accept.** The feedback route moved any quote to `feedback_received`, which the accept route allows and the approve route refuses. On a shown-early quote it now records the question and leaves the status at `pending_review`.
- **Viewing before approval blocked `sent` → `viewed` afterwards.** The view handler only ran when `viewed_at` was empty. It now also runs for a `sent` quote, so the first view after approval is recorded.
- **Generated wording can trip the customer language guard.** The live check caught "we'll confirm the exact dimensions with you" in an AI-written note (the T-146 wording prompt forbids "exact" but nothing enforces it). A shown-early estimate reaches the customer before anyone at the business reads it, so the worker now runs `findConfidenceLanguageInPayload` over the generated scope, assumptions, exclusions and notes. If it trips, the quote is a `check` hold with the reason in the business's review email. Only the generated wording is checked, not line labels, so a business that names a step "Firm mattress removal" is not held on every quote.

**Not fixed here (existing behaviour):** the same generated wording can still reach the customer on an auto-send quote, in a clarification-stage payload, or after the business approves without editing. Enforcing the guard on all generated wording is a separate ticket. **Closed by T-148.**

**Verified:** `verify-t147.mts` 33/33 live (local stack, migration 31 applied and re-run cleanly):
- Default service, flat $1,400: shown at once, `pending_review`, Accept locked (and 400 from the accept route), no range.
- A stored measured range ($1,250 to $1,550) comes back as `estimateRange` with the $1,400 total; it is gone once approved. The range was written onto a priced quote; the photo measurement itself was not run here.
- A quote held by the service's review rule is `check`: "being prepared", no price.
- Hold-mode service: as T-146. Auto-send service: straight out, Accept enabled.
- Approve: the same link shows the confirmed quote with Accept enabled, the customer can accept, a second tap gets 400, a rival business gets 404.
- Every public payload passes the customer language guard.

`verify-t146.mts` 20/20 (its default service now sets `holdUntilApproved`). Worker tests 446 (+18: modes, hold kind, fail-closed `isShownEarly`, measured-range rule, payload guard, estimate email), web 139. Lint, typecheck, web and worker builds pass. Quote page screenshotted at 430 px.

**Deployed 2026-11-10 11:16 UTC** (commit `4654f0a`): migration 31, then worker version `f890d5ac-2cab-42df-962c-70b769663e87`, then web (Vercel, Ready). Live checks: worker `/health` 200, public quote API 404 for a bad token, approve 401 when not logged in, `services.hold_until_approved` and `quotes.review_hold` present.

**Not verified:** no email was sent live (no Postmark locally). The service editor radios and the widget state were not checked by eye. No gauntlet run: the ticket does not touch AI, quantities or pricing.

**Files:** `supabase/migrations/00000000000031_show_then_confirm.sql`, `scripts/deploy-migration-31.sh`, `packages/shared/src/{review-mode.ts,api.types.ts,database.types.ts,index.ts}`, `apps/worker/src/{quote-processor.ts,email/index.ts,email/templates.ts,__tests__/review-mode.test.ts}`, `apps/web/src/app/api/public/quotes/[quoteId]/{route.ts,feedback/route.ts}`, `apps/web/src/app/api/services/{route.ts,[id]/route.ts}`, `apps/web/src/app/{q/[quoteId]/page.tsx,embed/[tenantKey]/page.tsx}`, `apps/web/src/app/(dashboard)/app/{services/page.tsx,quotes/[quoteId]/page.tsx}`, `scripts/hardcore-test/{verify-t147.mts,verify-t146.mts}`.

### 2026-11-09: T-146 — Business review by default; no confidence language for customers

**Owner decision (before the HVAC re-test):** quotes wait for the business to approve them, and the customer never sees grades or certainty words.

**Built:**
1. **Review by default (AD-034).** New `services.auto_send` (migration 30, default **false**, existing services included). The worker (`quote-processor.ts` 4.9) holds any quote that would have gone out (`sent` → `pending_review`) unless the service has auto-send on. Clarification rounds and the AI quality gate still run first. The business gets a **"Review and approve: {customer} - {service}"** email (`sendReviewRequestEmail`) with the price or measured range and, when a check held it, the reason. Quotes the business created in its own app don't email it. Before T-146, a `pending_review` quote emailed nobody.
2. **One-tap approval:** `POST /api/quotes/:id/approve` (`lib/quote-approval.ts`; dashboard cookie or app Bearer). It only accepts priced `pending_review` quotes, and a status guard in the UPDATE stops a double tap sending twice. It sets `approved_at`/`approved_by`, issues a fresh link for the "Your quote from …" email, and **keeps the customer's existing link valid** via `quotes.previous_token_hash`, accepted by every public token route (`quoteTokenFilter`). Before this, approving rotated the token and broke the open widget/quote page. Dashboard: **Approve & send** button, "Awaiting your approval" status. Mobile app: the same button on the quote screen. Editing then "Save & Send" also counts as approval, and a held quote's first send now emails the first-quote template, not "Updated quote".
3. **Customer-facing: exactly two states.** The public quote API never returns `pricing.estimate` (the type is now `Omit<QuotePricing,'estimate'>`). It returns `review: {state: 'estimate'|'quote'}`, plus `estimateRange` (unlabelled) for an unreviewed estimate with uncertain quantities. The quote page shows "This is an estimate based on your photos and details. {business} will review and confirm it." or "Reviewed and confirmed by {business}." The A/B/C seal, the "Measured range" label and "this range becomes your exact price" are gone. While held, the page and widget say "Your estimate is being prepared. {business} will review and send it shortly", with the range **only if the engine measured one**. The old ±12% band around a flat price was invented, and the live check caught a $1,400 flat quote showing "$1,230–$1,570".
4. **Takeoff in plain words:** `TakeoffEntry.method` is now "From your photos", "From your answers", "3 ton — from the air conditioner's rating plate" or "From the on-site room scan" (`takeoff.ts plainSource`). The technical audit (passes, spread, decoded model number) moved to `evidence`, which the public API strips and the business keeps.
5. **Generated text:** the engine note "quantity from AI signal (lower confidence)" became "estimated from your photos and details". The legacy-config advice note and "requires business owner review" went to logs (the page shows the state). The wording prompt forbids "exact", "firm", "preliminary", "guaranteed", grades, confidence and AI.
6. **Business-only grade panel** on the dashboard quote page: grade, label, description, internal range, and the hold reason.
7. **Guard:** `shared/customer-language.ts` (`findConfidenceLanguage`, `findConfidenceLanguageInPayload`: banned words, grade labels, a `grade` key, "confidence"). The gauntlet now fails any public payload that trips it and reads grades from the dashboard API. Gauntlet services set `autoSend: true`, because it measures pricing. A unit test scans the customer-facing source files.
8. **Flat-rate grade cap fix (follow-up to the AC test fix):** `priceDependsOnJobFacts` also takes the service's work steps. A step chosen by a form answer (`when`) or an identified value (`triggerSignal`) is a job fact even though its trace line carries no signals. Without this, a garage door picked by "Door size" would have been capped at B whenever a site visit was suggested.

**Verified:** `verify-t146.mts` 20/20 live:
- Default service holds the quote, and the customer sees "being prepared" with no number for the flat price.
- Internal grade A at $1,400.
- A rival business gets 404; approval works and a second tap gets 400.
- The pre-approval link still opens, showing "quote" at $1,400 with no range and no grade.
- An auto-send service goes straight out as an "estimate".
- Bearer (app) approval works, and the setting can be turned on later.

Unit tests: worker 428, web +10 (source scan, payload guard, approval rules, token filter).
Targeted gauntlet (round 3: S31 AC plate, S37 exterior painting from photos, S38 compiled HVAC): 3/3 inside their bands, no warnings, every public payload clean. Takeoff reads "646.2 sqft — From your photos" and "3 ton AC system — Selected for 3 ton, as you confirmed". The range is unlabelled. Lint, typecheck and web and worker builds all pass.

### 2026-11-09: Production AC test: flat-rate "Grade A exact", dropped draft add-ons, ICP-style plate codes

**What broke (production quote qte_b92180ec, demo tenant):** an AI-drafted "Central AC Replacement" (not the HVAC pack) went out at $4,550, labelled **"Grade A, this price is exact"**. The price was five fixed amounts that ignored tonnage, efficiency and the attic location, and the assessment itself said a site visit was needed. The AI draft also had a $450 attic surcharge, which never reached the saved service.

**Root causes and fixes:**
1. **Grade A only required that nothing was uncertain, not that anything was confirmed.** A price with no driver quantities graded A by default (`computeEstimateGrade([])`). New in `shared/grading.ts`: `priceDependsOnJobFacts(trace)` (any add-on, multiplier, inventory/measurement line, non-constant quantity, or triggered step) and `capFlatRateGrade()`. The worker caps **A → B "Provisional"** when the price is all fixed amounts **and** a site visit is recommended. The description reads "Standard price from the business’s rates. A site visit confirms the details…", not "measured from your photos". A flat-rate job with no site visit needed keeps A (the price really is the price). Applied after the R3-1 cap in `quote-processor.ts`.
2. **Applying an AI draft dropped its add-ons.** The services page copied only `workSteps` from `draft.pricing`. Now `lib/draft-addons.ts` `draftAddonsToConfig` maps `{name, price}` → `{id, label, price}` into the Add-ons list, where the owner reviews them. No trigger keywords are invented, so nothing auto-charges on mention (R2-6 unchanged). The draft's `baseFee` and `minimumCharge` are still **not** applied: the work steps already make up the price, and here the AI's $4,800 "base fee" would have doubled it.
3. **The HVAC pack couldn't decode ICP/Carrier/Rheem model numbers, and could misread a serial.** The real plate (NAC236AKA1) writes the size after a series digit ("2 36"), and the old rule only looked for "036", so no match. Worse, a transcribed serial "L0018 65769" would have decoded "018" as **1.5 ton**. The rules in `hvac-us.ts` now match only inside a model-number-shaped token (2+ letters first), plus a new ICP/Carrier/Rheem rule `[A-Z]{2,}\d{1,2}(18…60)[A-Z]` (NAC236AKA1, 24ACC636A003, RA1436AJ1NA → 3 ton). Services that already exist keep their copied rules. New tenants get these.

**Verified:** worker tests 426 (+5 grade-cap cases), web 129 (+2 draft add-ons, +5 plate/serial decodes; the old "RA1436AJ1NA can't be decoded" expectation was wrong, since it's a 3-ton unit). Typecheck, lint, web and worker builds all pass. The decode rules were tested against the real production plate's model and serial text.

**Backlog (OWNER-TODO):** AI-drafted equipment services should price by capacity tiers bound to the identified size, like the HVAC pack. And "Add service from template".

### 2026-11-09: T-144 — US marketing site, per-trade landing pages, Meta Pixel + Conversions API

**Built:**
- **Trade landing pages** from one template and one data file (`lib/marketing/trades.ts` → `components/marketing/TradeLanding.tsx`): `/trades/hvac`, `/trades/water-heaters`, `/trades/plumbing`, `/trades/electrical`, `/trades/garage-doors`, plus `/painting` (now US copy; `/trades/painting` redirects there) and a `/trades` index. Static, with per-trade titles and descriptions. Copy follows Docs/09's honest accuracy promise: photos → range, nameplate → firm price, LiDAR → exact. Example prices are the business's own rates in plain English. Only the speed-to-lead stats that already carry sources are reused. Nav: "Trades"; footer lists all six.
- **US localisation** of the home page, features page and hero mini-estimate: $ and sq ft, sales tax instead of VAT, "by text" (SMS) alongside WhatsApp, a US example business. The example arithmetic is consistent ($3,090 + 8.25% = $3,344.93). The pricing page was already USD from `plans.ts` (T-134).
- **Meta Pixel** (`components/marketing/MetaPixel.tsx`): rendered only by `SiteNav` (marketing pages) and the signup page, **never** the dashboard, the widget or a customer's quote page. Off without `NEXT_PUBLIC_META_PIXEL_ID`, and off when the browser sends **Global Privacy Control**. PageView on load.
- **Conversions API** (`lib/meta-capi.ts`): `CompleteRegistration` on signup (browser Pixel + server event via `POST /api/marketing/event`: whitelisted event, rate-limited 5/min/IP, same `event_id` for deduplication, `_fbp`/`_fbc` cookies forwarded) and `Subscribe` (or `StartTrial` for a $0 checkout) from the Stripe `checkout.session.completed` webhook, with value and currency, `event_id` = the checkout session id. Email SHA-256 hashed after Meta's normalisation, never logged. 4 s timeout, and it never throws, so marketing can't break signup or billing. Off until `META_PIXEL_ID` + `META_CAPI_ACCESS_TOKEN` are set (`.env.example`). `META_TEST_EVENT_CODE` for Events Manager testing.
- **Privacy policy** updated: the old line "the marketing site sets no tracking cookies" would have become false. It now describes the Pixel/CAPI scope, hashing and the GPC opt-out.

**Verified:** every marketing route returns 200 (`/trades/painting` → 307 to `/painting`, unknown trade → 404). Playwright screenshots of `/trades/hvac` (desktop and 390 px), `/` and `/trades`: no horizontal overflow, Measured Document styling. Screenshotting also caught leftover UK copy (hero "WhatsApp", "84 m²", a UK business name) and a lowercased "hvac template", all fixed. Web tests 122 (+6: hashing never sends a raw email, payload shape, value/currency, no-op when unconfigured, endpoint URL, network failure doesn't throw, cookie parsing, trade content integrity incl. no £). No gauntlet (owner rule: T-144).

**Not verified:** a live event reaching Meta (no Pixel id or token here). Use Events Manager → Test events with `META_TEST_EVENT_CODE` (OWNER-TODO). Docs/09: no Meta ad spend before 10–20 paying US businesses. The tracking is ready; the spend is the owner's call.

**Files:** `apps/web/src/lib/{meta-capi.ts,marketing/trades.ts,rate-limit.ts}`, `apps/web/src/components/marketing/{MetaPixel,TradeLanding,SiteNav,SiteFooter,MiniEstimate}.tsx`, `apps/web/src/app/{trades/page.tsx,trades/[trade]/page.tsx,painting/page.tsx,page.tsx,features/page.tsx,privacy/page.tsx,(auth)/signup/page.tsx,api/marketing/event/route.ts,api/webhooks/stripe/route.ts}`, `apps/web/.env.example`, tests.

---

### 2026-11-09: T-143 — Beta instrumentation: final invoice + estimate accuracy

**Built:**
- **Migration 29** (`supabase/migrations/00000000000029_final_invoice.sql`, additive, re-runnable): `quotes.final_invoice_amount` (≥ 0), `final_invoice_recorded_at`, `final_invoice_note` (≤ 500 chars), plus a partial index for the report. Existing quote RLS ("users can update own quotes") already covers it.
- `PUT /api/quotes/:id/final-invoice`: `{ amount, note? }`. `amount` takes a number or a typed money string ("$1,470.00", via `parseMoneyInput`); `null` clears it. Tenant-scoped; works with the dashboard cookie and the app bearer (AD-033).
- `GET /api/analytics/accuracy` → `computeAccuracy` (`packages/shared/src/accuracy.ts`, pure): per service and per estimate grade, the count, **median |invoiced − quoted| / quoted**, **share within ±10%**, and median signed bias (positive = quotes run low), against the Docs/09 targets (median < 10%, ≥ 80% within ±10%: the add-a-trade rule).
- Dashboard: a **Final invoice** card on the quote page (sent/viewed/accepted/paid/expired/declined) showing the ±% against the quote, and an **Estimate accuracy** panel on Analytics (overall / by service / by grade, on-target figures in brand colour). Business app: "Save final invoice" on the quote screen.

**Verified live (`scripts/hardcore-test/verify-t143.mts`): 9/9.** Two garage-door quotes ($1,400, $2,100) invoiced at +5% (bearer) and −20% (cookie) → report: 2 invoiced, median 12.5%, 50% within ±10%, bias −7.5%, grouped under the service and Grade A. Nonsense amount → 400, a rival business → 404 and an empty report, `null` clears. Unit: 10 (stats, empty input, money parsing ×8). No gauntlet (owner rule: T-143). The dashboard card and panel were typechecked and linted but not screenshotted.

**Deploy:** apply migration 29 before deploying the web app (the routes select the new columns). Listed in OWNER-TODO.

**Files:** `supabase/migrations/00000000000029_final_invoice.sql`, `packages/shared/src/{accuracy.ts,index.ts,api.types.ts}`, `apps/web/src/app/api/{quotes/[quoteId]/final-invoice,analytics/accuracy}/route.ts`, `apps/web/src/components/analytics/{FinalInvoiceCard,AccuracyPanel}.tsx`, `apps/web/src/app/(dashboard)/app/{quotes/[quoteId],analytics}/page.tsx`, `apps/mobile/{app/quote/[id].tsx,src/lib/api.ts}`, `scripts/hardcore-test/verify-t143.mts`, tests.

---

### 2026-11-09: T-142 — US gauntlet (round 3) + R3-2 fix: option answers can't silently drop the price

**Round 3 built:** `scripts/hardcore-test/scenarios3.mjs` + blind-authored `requests3.json` (a separate agent saw only name, service and tagline). Twelve US businesses across the six launch trades: six onboarded from the T-140/T-141 packs (nameplate identification on the AC, furnace, water heater and panel), six from plain-language USD pricing through the compiler. The runner gained `--round3` (run with `npx tsx`, since pack scenarios import the TypeScript packs), a pack onboarding path identical to OnboardingFlow, per-scenario photo selection, and currency-aware reports.

**R3-2 (found, fixed): S39 SENT at $95, Grade A.** Chain: customer described 40 gal but picked the closest option (50 gal electric) → the R3-1 doubt check asked a free-text question about a select field → the prose answer replaced the selection → no priced option matched → only the $95 permit priced → "no work steps applied" didn't fire (one line priced). Fix (`apps/worker/src/answer-options.ts`, generic):
1. A clarification answer to an option field snaps to the option it names (value or label, case/punctuation-blind). If it names none, the original answer is kept and the quote is held.
2. A structural send-guard holds any quote whose option-field answer isn't one of the field's options ("The answer to "<label>" doesn't match any option the price is set up for").
3. R3-1 doubt questions about an option field now carry the field's options, so the clarify page shows choices instead of a text box.

Replay of the exact failing answer through `/clarify` → `pending_review`, $1,595 kept, reason given.

**Results:** round 3 re-run `d000e87a`: **12/12 sent, all inside their hand-derived bands, 0 warnings, 0 failed checks** (table in `Docs/08`). Round 1 GB regression `0eab7250`: 9/10 identical to this morning's milestone or within known variance. S06 is held for review by guard 2, because the harness's scripted prose answer names no option (correct, and safer than a guess).

**Tests:** worker 411 (+5: option snapping by value/label, prose → none, suggested-field fallback, answers outside options, doubt question offers options).

**Files:** `apps/worker/src/{answer-options.ts,quote-processor.ts}`, `apps/worker/src/agents/quality-gate.ts`, `scripts/hardcore-test/{run.mjs,checks.mjs,scenarios3.mjs,requests3.json}`, `Docs/08-hardcore-test-findings.md`, tests.

**Relation:** closes the gap R3-1 opened (doubt questions on choice fields). Joins the T-126/R2-3/R2-7/T-139 send-guards: a wrong-money quote must land in review, never with the customer.

---

### 2026-11-09: T-138 — LiDAR room scan (RoomPlan) → `scanned` quantities (AD-028)

**Built:**
- **Shared geometry** (`packages/shared/src/room-scan.ts`, pure): `parseRoomScan` (untrusted input: version, ≤40 rooms, ≤40 walls/≤60 openings per room, every dimension positive and ≤60 m, polygon points sanitised), `summarizeRoomScan` (gross and net wall area = walls − doors/windows/openings, floor area by shoelace polygon with a width × length fallback when the polygon is degenerate, perimeter, door/window counts), `scanMeasureValue` (converts once into the signal's unit, AD-030), `scanAnswers` (pack mapping → answers), `scanEvidence`.
- **Pack data:** `ExpectedSignalConfig.scan = { measure }` with generic geometry measures (`room_count`, `wall_area_net`, `wall_area_gross`, `floor_area`, `ceiling_area`, `perimeter`, `door_count`, `window_count`). Painting packs (GB and US) interior `room_count` → `room_count`.
- **Engine:** basis `scanned` on signals and in grading: ranks with `confirmed`, Grade A eligible. The processor reads the reserved `_room_scan` answer, **honoured only when `source_json.type === 'app'`**, so a website customer can't claim "scanned on site". It strips the raw scan from the answers before anything else (no prompt ever sees it), fills mapped answers (scanned quantities are never photo-measured: they are answers, see `humanStatedQuantityKeys`), and credits the scan on answers that already carry the scan's value. A different value typed on site wins and isn't called scanned. Form signals get `basis: 'scanned'` and the evidence "Scanned on site with LiDAR (device): N rooms"; the takeoff cites it on form-field lines.
- **App route:** `POST /api/app/quotes` takes `scan`, validates it (400 `INVALID_SCAN`), and pre-fills the mapped answers so the form's required fields pass. The raw scan is stored with the request for audit (no migration: reserved answer id).
- **App:** local Expo module `apps/mobile/modules/room-scan` (Swift, RoomPlan): `isSupported()` and `scanRoom()` present RoomPlan's capture UI full screen with Done/Cancel and return one room's walls, openings and floors in metres. RoomPlan is weak-linked, so the app runs on iOS < 16 and on non-LiDAR iPhones. The JS bridge (`requireOptionalNativeModule`) reports unsupported in Expo Go and on Android, and the option is hidden there. New-quote screen: "Scan a room" / "Scan another room" when the service has scan signals, a live summary (rooms, m² walls, m² floor), and fields pre-filled from the scan (editable).

**Bug found by the live check:** the app route pre-fills `room_count` from the scan (for validation), so the worker saw it as already answered and didn't credit the scan ("Quantity provided by you"). Fixed with the value-match rule above.

**Verified live (local, `scripts/hardcore-test/verify-t138.mts`, synthetic RoomPlan-shaped scan, US interior painting): 5/5.** Three scanned rooms, room count left blank → room_count 3, $75 + 3 × $375 = **$1,200, Grade A**, takeoff "Scanned on site with LiDAR (iPhone 15 Pro): 3 rooms"; raw scan stored; invalid scan → 400; **the same scan through the public widget route is ignored** (typed 1 room → $450, no scan claim). Targeted gauntlet (owner rule, quantities changed): S01 sent, all 6 checks pass, £1,949.60 Grade B (60.7 m² measured, two passes agreeing, £28/m² + £250 scaffold; this morning's milestone run took 44 m² from the simulated customer's answer).
- Unit: 18 worker tests (shoelace, net walls, unit conversion incl. wrong-kind unit, parser rejections ×7, caps, mapping, never overwriting a typed value, evidence, Grade A, takeoff ×2, degenerate-polygon fallback). Mobile: tsc, eslint, iOS bundle export, and **Expo autolinking resolves the `RoomScan` pod and `RoomScanModule`**.

**Not verified (needs Xcode and a LiDAR iPhone):** compiling the Swift module and a real scan. In particular, which local axes RoomPlan's floor `polygonCorners` use (hence the width × length fallback), and real-room accuracy against a tape measure. See OWNER-TODO.

**Files:** `packages/shared/src/{room-scan.ts,database.types.ts,grading.ts,index.ts,api.types.ts}`, `apps/worker/src/{quote-processor.ts,takeoff.ts}`, `apps/web/src/app/api/app/quotes/route.ts`, `apps/web/src/lib/vertical-packs/{painting.ts,painting-us.ts}`, `apps/mobile/modules/room-scan/**`, `apps/mobile/{app/new.tsx,src/lib/api.ts}`, `scripts/hardcore-test/verify-t138.mts`, tests.

**Relation:** AD-028 (owner). Slots into the 2026-11-08 "customer-stated quantities are never measured" path, as that entry anticipated. Grade semantics extend T-120.

---

### 2026-11-09: T-137 — Business mobile app (Expo): on-site quoting (AD-027 channel 3, AD-033)

**Built:**
- **`apps/mobile`** (Expo SDK 58, React Native 0.88, expo-router): sign in with the business account (session in the iOS keychain via expo-secure-store) → **Quotes** list → **New on-site quote**: pick the service, customer and job details, the service's own form fields (same config the widget renders), and guided photos per `requiredAngles` (camera, retake; guided angles are uploaded first because triage reads only the first few photos) → **Quote**: polls while pricing, shows the price instrument (range while provisional, exact once confirmed), grade, takeoff with methods, and the **open confirmation questions, answered on site** → reprice → share the customer link (native share sheet). Measured Document palette; no UI kit dependency.
- **Bearer auth on the web API (AD-033):** `lib/supabase/server.ts` `createClient()` accepts `Authorization: Bearer <access token>`, bound to that user. Every existing dashboard API works for the app unchanged, under the same RLS. Only JWTs with role `authenticated` are accepted, so a leaked service-role/anon key sent as a bearer is ignored (falls back to cookie auth → 401).
- **New routes:** `GET /api/app/bootstrap`, `POST /api/app/quotes`, `GET /api/app/quotes/:id`, `POST /api/app/quotes/:id/answers` (contracts in `Docs/02-api-contracts.md`). Shared types `AppBootstrapResponse`, `AppCreateQuoteRequest`, `AppQuoteView` in `api.types.ts`; source type `'app'`.
- **Refactor (behaviour-preserving):** the public quote route's intake (service and field/photo validation, plan limits and held leads, records, token, usage, queue) moved verbatim into `lib/quote-intake.ts` `createQuoteSubmission()`. A `respond()` shim with `NextResponse.json`'s call shape keeps the moved code identical. The widget route keeps tenant-key, honeypot, rate-limit and Turnstile checks; the app route takes the tenant from the session, skips bot checks and the AI service match (the business chose the service). Measurement memory capture is shared between the customer's clarify and the app's answers (`lib/measurement-memory.ts`).
- **Takeoff:** derived-quantity lines said "Fixed price" (EV extra run). They now say "Calculated from your answers"; unresolved formulas say "Estimated — to be confirmed".

**Monorepo trap found and fixed:** installing the app put `@types/react@19` into pnpm's hoisted fallback. Next 14's `types/index.d.ts` references `react/experimental` from its own folder, which resolved to 19, so the web typecheck failed ("'react' has no exported member 'use'"). Fix: `pnpm.packageExtensions` gives `next@14` a peer on `@types/react`, so pnpm links the web app's own 18.3. Remove it when web moves to React 19.

**Verified:**
- Live, local stack (`scripts/hardcore-test/verify-t137.mts`, driving the app's own `src/lib/api.ts` client with a real Supabase sign-in and bearer, no cookies): **11/11**. Bearer on an existing dashboard API; service-role key as bearer → 401; no auth → 401; bootstrap; on-site EV-charger quote with a panel-label photo → priced in 17 s, Grade B, confirmation question; **another business gets 404 reading and answering it**; business confirms on site → sent, Grade A, $2,880, reprice in 58 ms; takeoff returned.
- Regression of the refactored widget intake: `verify-t141.mts` 5/5 exact through `/api/public/quotes`.
- App: `tsc` (strict), eslint, 11 unit tests (answers typing/validation, price headline, API client: bearer only on business calls, error surfacing, signed-out refusal, ordered uploads, token forwarding), and **`expo export --platform ios` bundles** (3.1 MB Hermes). All repo gates green (web 116, worker 388, mobile 11; web and worker builds).

**Not verified (no device or Xcode here):** running the app on an iPhone: camera, keychain, screens, navigation. See OWNER-TODO (Expo Go or a development build).

**Files:** `apps/mobile/**`, `apps/web/src/lib/{supabase/server.ts,quote-intake.ts,measurement-memory.ts}`, `apps/web/src/app/api/app/**`, `apps/web/src/app/api/public/quotes/{route.ts,[quoteId]/clarify/route.ts}`, `apps/worker/src/takeoff.ts`, `packages/shared/src/api.types.ts`, `package.json` (packageExtensions), `scripts/hardcore-test/verify-t137.mts`, `Docs/02-api-contracts.md`, tests.

**Relation:** T-138 adds the LiDAR room scan to this app (`scanned` quantities slot into `humanStatedQuantityKeys`).

---

### 2026-11-09: T-141 — Packs: plumbing fixtures, electrical, garage doors (US) + milestone gauntlet

**Built (pure data):**
- `electrical-us.ts`: **Panel upgrade** (to 200 A; a service entrance and meter base line when the existing panel is 60 A) and **EV charger installation** (install incl. first 25 ft, extra run per foot via the derived formula `max(0, run_length_ft - 25)`, charger supplied when asked, load management on a 100 A panel, service-upgrade allowance on 60 A). The existing panel rating is **identified** from the panel label or main breaker (AD-032). Decode: a rating line ("RATED 100 AMPS", "MAIN BREAKER 100 A") first, then any 60/100/125/150/200 A. Branch breakers (15/20/30 A) are ignored.
- `plumbing-us.ts`: **Fixture replacement** price list: toilets, faucets and disposals per fixture, plus a supply line per fixture when the business supplies it. T-131 catalogue semantics: a blank count means none.
- `garage-doors-us.ts`: **Door replacement** (single/double, style multipliers ×1.2 insulated, ×1.6 composite) and **torsion spring replacement** (one or two springs). Door size, style and spring count are customer knowledge, so they are form answers; photos are optional.
- All rates `TODO-OWNER`.

**Bugs found by the live check (fixed before commit):**
1. The plumbing counts were marked `criticalForPricing`, and the public API **requires** critical fields. A customer replacing only toilets got "Missing critical fields: How many garbage disposals to replace?". Catalogue counts are now optional, and `pack-integrity.test.ts` enforces that a `missingMeansZero` field is never critical.
2. The garage services required a photo although their price comes only from the form. Photos are now optional (`minPhotos: 0`).

**Verified live (local, queue path, `scripts/hardcore-test/verify-t141.mts`, services created as onboarding does): 5/5 exact.** EV charger $2,880 (panel "RATED 100 AMPS MAX." → 100 A, Grade B → confirm → A), panel upgrade $2,600 (B → A), fixtures $1,745 (A), double insulated door $2,520 (A), spring pair $375 (A). 9–27 s to first price.

**Milestone gauntlet (owner rule: full run at the end of T-141), round 1, run `7805cdd4`, vs the T-135 baseline `2625e00e`: 10/10 sent, 0 failed checks.** S03 £4,520, S04 £190, S06 £12,068, S07 £1,750, S08 £435.54 penny-exact, S10 £330: identical to the baseline. S02 £832.50 (baseline £765; £832.50 is the T-125 hand-checked figure). S01 £1,482 Grade B, range £1,314–£1,594 (baseline £1,680.80; inside the known £1,078–£1,740 measurement spread). S05 £1,982, inside its £1,900–£2,600 band. It is now Grade **C** because the simulated customer answered the hours question vaguely, so the tidy-up line is a defaulted placeholder; that is the honest T-128 grade. S09 £1,132.50, the same warning as the baseline. S08 is Grade A (was B). No regression from today's changes (scope-aware senior review, identification, tolerant triggers, recompile spec carry-over).

**Tests:** web 113 (+22: pack integrity over **every** pack, i.e. referenced fields exist, condition values are options, formula identifiers resolve, catalogue fields not critical; electrical decode ×5).

**Files:** `apps/web/src/lib/vertical-packs/{electrical-us.ts,plumbing-us.ts,garage-doors-us.ts,index.ts}`, `scripts/hardcore-test/verify-t141.mts`, tests.

---

### 2026-11-09: T-140 — Packs: HVAC replacement + water heaters (US)

**Built (pure data, no engine changes beyond one decode-rule field):**
- `apps/web/src/lib/vertical-packs/hvac-us.ts`: **Central AC**, **Heat Pump** and **Gas Furnace** replacement. The price is set by the size on the rating plate: one optional fixed-price step per size (seven tonnages 1.5–5 ton; five furnace inputs 40,000–120,000 BTU/hr), each selected by `triggerSignal` on the identified value, plus a mandatory removal/disposal line. Tonnage decode: a printed nominal tonnage ("2.5 TONS") first, then the three-digit BTU code in the model number ("…036…" → 3 ton). Furnace: the INPUT BTU/HR line. Attic and crawl-space installs carry access multipliers. Like-for-like only; upsizing is out of scope (needs a load calculation on site).
- `apps/web/src/lib/vertical-packs/water-heater-us.ts`: **Water Heater Replacement**. Tank by capacity (30/40/50/75 gal, from the printed capacity line) plus connection by fuel (natural gas / propane from the gas-type line, electric from 208/240 V or element wattage). The fuel rule ignores a gas power-vent's 120 V line. Expansion tank, drain pan and seismic straps are add-ons; an attic install is a multiplier.
- In every service the rating plate is the **first** guided photo, because triage reads only the first 2–5 photos.
- Shared: decode rules can return a constant (`value`), used for the fuel wording. Value matching no longer drops the decimal point ("1.5" ≠ "15"), but still ignores spaces, underscores, hyphens and thousands commas.
- **Recompile safety:** a plain-language pricing recompile used to rebuild `expectedSignals` through `normalizeExpectedSignals`, which drops `identify` and `envelope`. One pricing edit would have silently switched off nameplate reading. `carryOverSignalSpecs` (`ai-draft/shared.ts`, used by the compile route) restores them, and enum options, for every signal key that survives. Envelopes were also being lost this way since T-116.

**Rates and decode tables are placeholders** (`TODO-OWNER` on every number and rule). See OWNER-TODO.

**Verified live (local, queue path, `scripts/hardcore-test/verify-t140.mts`; services created exactly as onboarding does; synthetic rendered plates in `test-assets/hardcore2/T140-labels/`):**

| Service | Plate | Identified | First price | After confirm |
|---|---|---|---|---|
| Central AC | "MODEL NO. GSX140361KB" | 3 ton (BTU code) | 27 s, B, $5,450 | $5,450 A |
| Gas furnace | "INPUT BTU/HR 80,000" | 80,000 | 28 s, B, $3,900 | $3,900 A |
| Water heater | "CAPACITY 50 U.S. GAL" / "FOR USE WITH NATURAL GAS ONLY" | 50 gal + Natural gas (one call) | 22 s, B, $2,150 | $2,150 **B** |

3/3 exact. The water heater stays B by design: only capacity was asked, because the fuel options differ by at most $200, under the VOI bar ($215 = 10% of the total), so the fuel stays "identified, not confirmed". The questions read clumsily ("…from the air conditioner's rating plate (the data label on the side of the outdoor unit)"), so the where-to-look detail moved from `readFrom` into the transcription instruction.

**Tests:** web 91 (+26: pack integrity, i.e. unique ids, ≤10 steps, every trigger value is an allowed value and every allowed value selects exactly one step, plate first; typical-format decode cases for tonnage ×6, unknown code, furnace ×3, capacity ×3, fuel ×5, 120 V guard; `carryOverSignalSpecs` ×2).

**Files:** `apps/web/src/lib/vertical-packs/{hvac-us.ts,water-heater-us.ts,index.ts}`, `apps/web/src/app/api/services/ai-draft/{shared.ts,compile/route.ts}`, `packages/shared/src/identification.ts`, `scripts/hardcore-test/verify-t140.mts`, tests.

**Relation:** first consumers of T-139/AD-032. Plumbing, electrical and garage doors follow in T-141, then the full gauntlet.

---

### 2026-11-09: T-139 — Identification signals (nameplate reading, AD-029, AD-032)

**What it does.** For identify-and-replace trades the price depends on WHAT the equipment is, not its size. An expected signal can now carry an `identify` spec (pack data): where the value is printed (`readFrom`), what to transcribe, and `decode` rules (regex → code → `map` table or numeric `scale`). A new vision call (registry task `identification`, `apps/worker/src/ai/identification.ts`) transcribes each label verbatim. **Code** decodes the transcription (`resolveIdentification` in `packages/shared/src/identification.ts`). The model's own reading is used only when no rule matches, and only if it is an allowed value.

**Flow:**
- Runs in parallel with signal extraction and measurement, and only for services with an `identify` signal (others pay nothing). 25 s cap (`IDENTIFICATION_TIMEOUT_MS`); past it, nothing was read and the customer is asked.
- An identified value replaces a general vision guess of the same key (basis `identified`, confidence 0.9 decoded / 0.75 read), never a customer answer. When the label is unreadable, an appearance-only guess is kept but weakened to 0.4 (AD-029: identification needs a label).
- Pricing reads identified values through ordinary step triggers (`triggerSignal` + `triggerCondition`). Trigger comparison now matches by meaning: `"3"` equals `3`, `"natural gas"` equals `"Natural gas"`, and numeric operators accept numeric strings (`evaluateTriggerCondition`).
- **Grade:** only identifications the pricing actually reads count (`pricingReferencedKeys`: triggers, quantity sources, formula identifiers). Identified-but-unconfirmed ranks like measured (B); weak or unknown → C; customer-confirmed → A.
- **Questions (built by code, no AI):** identified → one-tap `confirm_value` ("Size of the existing unit: we read Medium from the unit's rating plate. Is that right?") with the label evidence and the allowed values as corrections. Asked only when the allowed values move the price past the VOI bar. Unknown or weak → a direct question with the options that says where the value is printed. The clarify page's "No, let me correct it" now offers the options instead of a text box when there are options. Answers snap onto the allowed value they name.
- **Provisional range:** while the equipment is unknown or weak, the range spans every allowed value. Before, the blurred-label quote showed $300, the only line that didn't depend on the size.
- **Send-guard:** if after the clarification round an identification the price depends on is still unknown (e.g. an answer outside the options), the quote is held for business review instead of sending without its main line.
- **Takeoff:** a line selected by an identified value cites the label ("Read from the unit's rating plate (photo 1): "AB36-120X" → Medium (size digits in the model number)"), or "Selected for Medium, as you confirmed".

**Also fixed (found in the live run):** the quality gate asked customers to confirm a low-confidence signal whose value was literally "unknown" ("we estimated condition rating: unknown. Is that right?"), using one of the two question slots. It now skips "unknown" values.

**Verified live (local, queue path, `scripts/hardcore-test/verify-t139.mts`, synthetic test service + synthetic rendered labels in `test-assets/hardcore2/T139-labels/`, model gemini-3.8-flash):**

| Label photo | Read | First price | Question | After answer |
|---|---|---|---|---|
| sharp | "AB36-120X" → Medium (decoded), 6.0 s | 20.0 s, Grade B, $3,200 | confirm Medium | $3,200 Grade A, sent |
| blurred | nothing (legible=false), 2.7 s | 20.8 s, Grade C, range $2,300–$4,100 | "Size of the existing unit? It is usually printed on…" + options | "large" → Large, $4,100 Grade A, sent |

The first blurred run (before the cap) spent 44.6 s on the unreadable photo: 58 s to first price, for the same outcome.

**Not proven yet:** accuracy on REAL nameplates (glare, angle, worn plates, real model-number schemes). The renders only prove the plumbing. Real photos belong to T-140 (the HVAC / water-heater packs bring the real decode tables) and T-142. Listed in OWNER-TODO.

**Known gaps (logged, not built):**
- Triage analyses at most 2 photos for "simple" requests and 5 otherwise. A nameplate photo beyond that is never read. Packs should put the nameplate first in `requiredAngles` (T-140).
- After the customer confirms, first-pass photo notes still say "Data label is unreadable… a clearer photo is required" on a now-confirmed quote. Same family as the smoke-test backlog item "internal notes shown to customers".
- After confirmation, the takeoff loses the label evidence ("Selected for Medium, as you confirmed"), because the form signal replaces the identified one.

**Tests:** worker 387 (+30: decode map/scale/first-match/malformed pattern, value snapping, resolve precedence and clipping, targets/prompt, failure/timeout/no-photo paths, apply never overrides a form answer, weak guesses, referenced keys, states, grades, both question shapes, prebuilt gate questions, the "unknown" skip, takeoff method ×2, tolerant triggers ×3).

**Files:** `packages/shared/src/{identification.ts,database.types.ts,grading.ts,index.ts}`, `apps/worker/src/ai/identification.ts`, `apps/worker/src/{quote-processor.ts,takeoff.ts,index.ts}`, `apps/worker/src/agents/quality-gate.ts`, `apps/worker/src/pricing/rules-engine.ts`, `apps/web/src/app/q/[quoteId]/clarify/page.tsx`, `scripts/hardcore-test/verify-t139.mts`, `Docs/{01-architecture.md,09-us-launch-plan.md}`, tests.

**Relation:** AD-029 (owner) → AD-032 (below). Grade semantics extend T-120/T-128. Questions follow T-108's deterministic `confirm_value` pattern and T-121's VOI bar. The reprice path (2026-11-08) needs no change: identified values live in the saved signals.

---

### 2026-11-09: Senior review gets the customer's scope answers + 30 s cap; no raw signal keys in the takeoff

**Owner decision (2026-11-09):** both options from the speed entry below: give the reviewer the scope answers AND cap its time.

**1. Reviewer sees the customer's answers.** `formatScopeAnswers` (`apps/worker/src/ai/scope-answers.ts`, pure) turns `job_answers` into lines labelled with the business's own question and option labels (widget fields, then draft suggested fields), plus the customer's description (clipped to 600 chars). Internal `_` fields are skipped. `adjudicateMeasurement` adds them to the prompt, and the system prompt gains rule 5: the customer's answers define the scope, so measure only what they asked for. Nothing is trade-specific; the text comes from the business's configuration. The junior passes are unchanged (they were not the ones over-scoping).

**2. 30 s cap.** `DEFAULT_ADJUDICATION_TIMEOUT_MS = 30000` (env `ADJUDICATION_TIMEOUT_MS`, `0` = no cap). The review gets an `AbortSignal`; past the cap the call is aborted, `adjudicateMeasurement` returns null and the pass median stands, as on any review failure. The customer is asked to confirm that value anyway.

**Measured (local, queue path, S01 photos, `ADJUDICATION_VALUE_THRESHOLD=1` to force a review on every run, `verify-speed.mts`):**

| Run | Review | Value | First price | Confirmed |
|---|---|---|---|---|
| GB, cap 30 s | cut at 30.0 s → median | 59.8 m² | 61 s | A |
| US, cap 30 s | cut at 30.0 s → median | 757 sq ft | 60 s | A |
| GB, no cap | 26.7 s | 59.6 → **55 m²**, "limited to the front elevation" | 62 s | A |
| US, no cap | 18.3 s | 709 → **710 sq ft**, "front elevation" | 50 s | A |

Before: 3 of 4 reviews on the same "front wall only" job added side elevations (66.5 → 109.8 m²; 833 → 1,120 and 711 → 1,325 sq ft), at 80–108 s each. Now 0 of 2, at 18–27 s. Small sample; T-142 covers it at scale. The forced reviews are worst case: in production a review runs only on disagreement, single-pass evidence or lines ≥ 2500.

**Known gap:** a review aborted by the cap is not recorded in `aiUsage` (the meter records completed calls), so the per-quote AI cost understates those quotes by one partial call.

**3. Raw signal key on the customer's document (found reviewing the owner's production test quote EST-2026-5D6EBD).** The takeoff line said "Customer-provided: wall_area_sqm". Clarification answers are merged with the signal key as their field id, so they have no form label, and the evidence fell back to the id. Now: "Confirmed by the customer" for clarification answers, else the field's label ("Customer-provided: <label>"), else plain "Customer-provided". Before, a pack tenant's confirmed quantity read "Customer-provided: Wall area in square feet — if you know it".

**Also seen on that quote, logged with the smoke-test backlog below (not built):** the breakdown label "Exterior walls  £18 x 34.6(Sqm)" (double space, raw unit; the page's `splitLabelMath` hides most of it, but the PDF/email may not); a "Potential Render Crack Repairs" recommendation duplicating crack filling the scope summary already includes; the exclusion "Roofline replacement (fascias/soffits replaced, not painted)" reads contradictory.

**Tests:** worker 357 (new: scope block present/absent, abort signal passed, timeout aborts and returns null, in-cap review used; `formatScopeAnswers` ×3).

**Files:** `apps/worker/src/ai/{measurement.ts,scope-answers.ts}`, `apps/worker/src/quote-processor.ts`, `apps/worker/src/index.ts` (env type), `Docs/01-architecture.md`, tests.

**Relation:** closes the "disagreement path" item left open by the 2026-11-08 speed entry. T-119 stakes routing unchanged.

---

### 2026-11-08: Speed — first price under 60 s, confirm reprice in ~0.1 s with no AI; confirmed Grade A (US smoke test)

**Reported (US production smoke test, EST-2026-6468B7):** ~5 min to show the range, minutes again to reprice after confirming 313 sq ft, and Grade B after confirmation.

**Measured, not guessed:** each quote now stores `pricing_trace_json.timings` (wall ms per stage, measurement pass times, queue wait, `repriceOnly`), and `aiUsage.byTask[].totalMs` (AI call time per task). Production log tails have no per-line timestamps, so the stored timings are the only per-stage record. Harness: `npx tsx scripts/hardcore-test/verify-speed.mts [--region GB|US] [--photos 0]`. It reproduces the smoke test: painting pack, S01 house-front photos, then the customer confirms the measured value.

**Before → after (local, queue path, S01 photos, same harness):**

| Stage | GB before | GB after | US before | US after |
|---|---|---|---|---|
| Queue wait | 0 s | 0 s | 0 s | 0 s (production: 1–5 s) |
| Signal extraction | 16.6 s | 13.0 s, in parallel with measurement | 17.9 s | 12.1 s, in parallel |
| Measurement passes | 43.7 s (14 + 17 + 13, sequential) | 15.2 s (14.7 + 15.2 in parallel, 3rd cancelled) | 67.6 s (24 + 21 + 23) | 24.2 s (15.2 + 24.2, 3rd cancelled) |
| Adjudication | 39.8 s (`high_stakes`, cov 0.12) | not needed | 60.3 s (`high_stakes`, cov 0.07) | not needed |
| Add-ons / recommendations / wording | 1.6 / 3.6 / 2.9 s, sequential | 2.0 / 2.5 / 2.8 s, parallel | 1.8 / 6.1 / 3.3 s | 2.1 / 2.7 / 3.2 s, parallel |
| Validation | 3.9 s | 4.7 s | 4.9 s | 6.2 s |
| **Submit → price shown** | **116 s** | **29–33 s** (4 runs) | **166 s** | **33–37 s** (3 runs) |
| **Confirm → final price** | **73 s** (full re-measure) | **0.14 s** | **121 s** (re-measured and re-adjudicated) | **0.17–0.28 s** |
| AI calls, first pass + reprice | 9 + 8 | 7 + **0** | 9 + 9 | 7 + **0** |

No-photo runs (the quantity is always asked): first price 11–14 s, reprice 113–120 ms, 0 AI calls, Grade A.

**What changed:**
1. **Measurement passes run in parallel** (`measureQuantities`). When the first two to finish agree within `MEASUREMENT_COV_THRESHOLD` (0.15) on every target, the third is cancelled (`AbortSignal` through `AiClient` → `fetch` / Anthropic SDK). On disagreement the third pass is awaited as before.
2. **Signal extraction runs in parallel with measurement**, which needs only the photos. Photos are fetched once, in parallel, and reused by inventory detection, which used to re-fetch them.
3. **Adjudication:** still on disagreement (cov > 0.15) and single-pass evidence at any value. The high-stakes bar goes from 1000 to **2500** (`DEFAULT_ADJUDICATION_VALUE_THRESHOLD`; env `ADJUDICATION_VALUE_THRESHOLD`). At 1000, nearly every exterior painting job was sent to the slowest call in the pipeline even when its passes agreed. Adjudications for several quantities run in parallel.
4. **Customer-stated quantities are never measured** (`humanStatedQuantityKeys`, conservative: explicit `mapsToSignal`, or the field id is the signal key, with a positive number). T-138 `scanned` quantities slot in here.
5. **Deterministic reprice after confirmation.** When a quote stops for a question it saves a reprice snapshot in `signals_json._reprice` (legacy signals, matched items, AI add-on ids, recommendations, cross-service pricing, whether validation demanded review, and the first pass's `aiUsage`/timings). On answer, `/clarify` calls the new authenticated worker endpoint `POST /reprice` and waits: answers merge as form answers (AD-002) over the saved signals, the rules engine reprices, the grade is recomputed, the provisional wording is kept. No photos are read and no AI calls are made. A 409 (no snapshot, e.g. quotes saved before this deploy) or any failure → `/trigger` as before. The trace keeps the first pass's `aiUsage`, so the quote's AI cost record survives.
6. Add-on detection (description only) runs in parallel with the photo work. Recommendations, wording and cross-service detection run in parallel.

**Accuracy evidence for change 3 (no accuracy loss on this data):**
- **Agreeing passes, no senior review:** GB 52–68 m², US 578–833 sq ft. The same house at about 54–77 m², consistent with the 55–65 m² default-thinking band.
- **3.1 Pro senior review, run on every job at threshold 1000:** 80–108 s per review. It **over-scoped 3 of 4 times on "front wall only" jobs**: GB 66.5 → 109.8 m² ("included the left side elevation"), US 833 → 1,120 and 711 → 1,325 sq ft ("front and side elevations"). The adjudicator never sees the customer's scope answers (`sides_to_paint = front_only`).
- **Candidate 3.8 Flash at `high` as adjudicator:** values sane (51.5–70.5 m², 695–745 sq ft) but **45–120 s**, so no speed gain. Registry unchanged.

**Still open: the disagreement path.** When passes disagree (cov > 0.15, as on both production smoke-test quotes), the third pass plus senior review still takes ~100–150 s. One US run: passes 22 / 23 / 31 s, adjudication 103 s, 146 s total. Options (owner decision): an adjudication time cap that falls back to the 3-pass median (the customer is asked to confirm that value anyway); or first give the adjudicator the customer's scope answers (an accuracy fix in its own right), then evaluate a lower thinking level.

**Grade B after confirming (US) — root cause.** Not the trust flag: the production trace shows `step_walls_sqft` `quantityTrusted: true`, so the earlier fix was live. No cost band either. By elimination it is the **R3-1 cap**, the only code that lowers a computed grade. On the reprocess the wording AI saw the confirmed 313 sq ft next to the photo `surface_area` signal (380) and flagged a "quantity concern". R3-1 then capped Grade A to B, after the customer had already answered. That cap isn't persisted or logged in the DB, which is why the earlier fix missed it, and it is nondeterministic (the GB re-test got A). **Fix:** once clarification answers exist, `quantityConcern` is ignored. The reprice path also clears the stored concern and never re-runs wording. Verified: every confirm in the runs above → Grade A.

**Found on the way:** `loadQuoteData` builds an enumerated projection of the quote and silently dropped `signals_json` / `content_json`. The first reprice attempt 409'd on every quote: the T-108 trap again. Both fields are now projected, with a comment.

**Tests:** worker 350 (new: parallel passes + early stop + abort, disagreement waits for the third, stakes bar, `humanStatedQuantityKeys` ×5, reprice snapshot ×4), web 65 (`repriceQuoteNow`: bearer + success, 409/network fallback).

**Files:** `apps/worker/src/{quote-processor.ts,index.ts,stage-timer.ts,quantity-sources.ts,reprice-snapshot.ts}`, `apps/worker/src/ai/{measurement.ts,client.ts,gemini.ts,anthropic.ts}`, `packages/shared/src/ai-models.ts` (call timing), `apps/web/src/lib/queue.ts`, `apps/web/src/app/api/public/quotes/[quoteId]/clarify/route.ts`, `scripts/hardcore-test/verify-speed.mts`, `Docs/01-architecture.md`, tests.

**Relation:** builds on AD-031 (queue). T-119's stakes routing is kept, with a higher bar. R3-1 keeps capping doubts raised before the customer answers. Supersedes the "reprice instantly" backlog item from the GB smoke test.

---

### 2026-11-08: Production smoke test (GB) + confirmed quantities now reach Grade A

**GB smoke test passed** (production, queue path): `POST /trigger` → queue → consumer (`retry=0/3`), 31.5 m² after adjudication (plausible 28–35), £917, maths correct, customer email delivered. Models recorded in `aiUsage`: `extraction_pass` gemini-3.8-flash ×4, `adjudication` gemini-3.1-pro-preview ×1, `wording` gemini-3.8-flash ×5. No `gemini-2.5-*`. About $0.10 per quote.

**Broke:** the customer confirmed the wall area in the clarification round, but the quote stayed **Grade B "Measured"**, when every driver was confirmed and it should have been A.
**Root cause:** the rules engine marked every `ai_signal` step `quantityTrusted: false`, even when the signal came from a form or clarification answer (`source: 'form'`, confidence 1). The processor's signal provenance correctly marked `wall_area_sqm` as confirmed. But the T-128 trace check keys entries by **step id** (`step_walls_sqm`), so it didn't see that the signal was already counted and added a second entry with basis `measured`, confidence 0.7. That capped the grade at B.
**Fix:** `getSignalValue` now reports `customerConfirmed` (same rule as the grade provenance: `source === 'form' || confidence >= 1`), and both `ai_signal` paths (per-unit and hours) trust it. The customer-facing note "quantity from AI signal (lower confidence)" is no longer added for confirmed quantities. Photo-measured quantities are unchanged and still untrusted.
**Relation:** completes T-120's "A — every driver confirmed by a human" for photo-measured steps. T-128's cap still applies to genuinely untrusted lines. Test: `apps/worker/src/pricing/confirmed-quantity.test.ts`.

**Smoke-test backlog (logged, not built):**
- ~~**Reprice instantly after confirmation.**~~ Done the same day (speed entry above). It took ~2 min, because the clarify reprocess re-runs the full photo measurement (3 passes + adjudication) and then the form answer overrides the result anyway. Skip re-measuring the quantities the customer has just answered.
- **Internal notes shown to customers:** engine and validation notes reach the customer page. Separate customer notes from business-only ones.
- **Raw unit labels** (`sqm`, signal-style units) on the customer document. Use human labels (m², per room …).
- **"Worth considering"** recommendations duplicate items already in the service scope. Filter against `scope_includes`.
- **Clarification page + clarification email styling:** bring them onto the Measured Document system.
- **"Powered by Estimator"** footer still uses the old name. Brand is "Aistimator".
- **Postmark (owner):** DKIM + Return-Path DNS before beta. The account is still pending approval, so mail only reaches the From domain. The business notification to a gmail address failed. See OWNER-TODO.

---

### 2026-11-08: Queue processing in production + worker auth + "Preparing your estimate" (AD-031)

**Decision (owner):** Cloudflare Queues over raising `maxDuration`. Photo-measured quotes take 75–150 s (see the thinking-level entry below), and sync processing held the customer's request, and the SMS/WhatsApp webhooks, for the whole pipeline. Owner upgraded to Workers Paid on 2026-11-08.

**Built:**
- `wrangler.toml`: production producer + consumer on `quote-jobs` (DLQ `quote-jobs-dlq`), **`max_batch_size = 1`**. The old commented block had 10, which processes ten quotes in series in one invocation and would exceed the consumer's wall time at ~150 s each. Also a simulated local queue (`quote-jobs-local`) so the consumer path can be tested with `wrangler dev`.
- **Worker auth** (`src/auth.ts`): `/process`, `/trigger` and `/stats` require `Authorization: Bearer CLOUDFLARE_WORKER_TOKEN` (constant-time compare). **Before this, they accepted anyone's request**: any caller could re-run a quote's AI pipeline. Fails closed: a missing secret → 503 outside `ENVIRONMENT=development`. `/health` stays public. The web app already sent the header; `getQueueStats` now does too.
- **Two latent consumer bugs fixed:** (1) the retry count came from `job.retryCount` in the message body, which never changes. A repeatedly failing quote would dead-letter without ever being marked `failed` and sit at `generating` forever; now it uses `message.attempts`. (2) Provider 429s retried without limit; they now stop at MAX_RETRIES too. `/trigger` returns 400 bad body, 503 queue not bound, 502 send failed (was a 400 for everything).
- `SYNC_QUOTE_PROCESSING` is an explicit switch (`isSyncProcessing`): `true`/`false` decide, unset = sync in local dev, async in production. Previously local dev could never use the queue.
- **Customer UI** (`isQuoteProcessing` in shared = `queued`/`generating`):
  - Widget success screen: "Preparing your estimate" with an animated tape rule (`.tape-measuring`, static under reduced motion). Polls for 5 min (was 60 s), then "Your estimate is ready" / "We have your request" (failed or held for review) / taking-longer-than-usual + email.
  - Hosted quote page: preparing panel in the document shell, polling every 4 s with `poll=1` (not a view). It loads normally once the status moves on, so the real view is recorded. `failed` shows "Your request is with {business}" instead of an empty document, and the badge says "Received", not a red "Error".
  - Public quote API no longer stamps `viewed_at` while processing (it would have blocked the later `sent → viewed`).
  - Clarify now redirects to the quote page after submitting, which shows the preparing state, instead of a static thank-you.

**Verified locally (queue path, token on):** S08 submission 3.3 s (sync 78 s), clarify 0.5 s, the consumer processed both runs, £435.54 exact, 7/7 checks. Unauthenticated `/process` and `/stats` → 401. Screenshots of the widget (preparing/ready/failed, mocked status API) and the quote page (desktop + 390 px, plus a live `queued → sent` swap in 1.8 s with the view recorded only after the swap).

**Deploy constraint:** the new worker rejects job requests without the token, so the token goes to both sides first, then the **web deploys first (still sync)**, then the worker, then `SYNC_QUOTE_PROCESSING=false`. `DEPLOY.md` steps 5–9. Rollback lever: `SYNC_QUOTE_PROCESSING=true` (the new worker still serves `/process`).

**Tests:** worker `worker-entry.test.ts` (12: auth matrix, fail-closed, `/trigger` error codes, consumer ack/retry/final-attempt-fails/429 cap), web `queue.test.ts` (3: sync switch, processing statuses).

**Files:** `apps/worker/{wrangler.toml,src/index.ts,src/auth.ts,.dev.vars.example}`, `apps/web/src/lib/{queue.ts,rate-limit.ts}`, `apps/web/src/app/{embed/[tenantKey]/page.tsx,q/[quoteId]/page.tsx,q/[quoteId]/clarify/page.tsx,api/public/quotes/[quoteId]/route.ts,globals.css}`, `packages/shared/src/{quote-status.ts,index.ts}`, `apps/web/.env.example`, `Docs/01-architecture.md`, `README.md`, `DEPLOY.md`, tests

---

### 2026-11-08: Per-task Gemini thinking level + production deploy prep (T-135 follow-up)

**What broke:** wording on `gemini-3.8-flash` hit MAX_TOKENS on most quotes. Gemini 3 thinking tokens count against `maxOutputTokens` (default 4,096); one S08 wording call used 3,933 thinking tokens for 156 output tokens. The structured call failed, then fell back to a second text call: 57 s of a 146 s submission. Same trap class as the 2.5 thinking truncations (R2-1 matcher, compile 8192→16384).

**Fix (registry data):** optional `thinkingLevel` per task in `ai-models.json` (`wording`, `chat_widget` and `service_match` = `low`) and `thinkingLevels` per model capability. `resolveThinkingLevel(task, model, env)` honours `AI_THINKING_<TASK>` (`low|medium|high|default`) and **drops a level the model doesn't list**. Gemini 2.5 returns HTTP 400 for any `thinkingConfig`, and every 3.x model rejects `minimal` (probed 2026-11-08 for 3.8/3.6/3.5-lite/3.1-lite/3-flash-preview/3.1-pro-preview/4-argon). The worker factory passes the level to `GeminiClient`; web chat, matcher and compile spread `geminiThinkingConfig(task)`. Compile, extraction_pass, adjudication and identification send nothing (model default).

**Measured (local, submission request):** S08 146 s → 78 s, £435.54 unchanged, wording 32 s+25 s → 3.7 s. S01 147 s / 116 s (£2,061.60 / £1,526, Grade B). **Rejected: `low` on extraction_pass + adjudication.** S01 dropped to 35 s, but zero thinking made the three passes agree (cov 0) on 110.9 sqm, about 2× the 55–65 sqm default-thinking runs, and the low-thinking senior accepted it: £3,355 sent. Vision and adjudication thinking is accuracy, not overhead.

**Constraint:** photo-measured quotes still take 75–150 s per request (three sequential ~22 s measurement passes, plus adjudication at 6–53 s). Sync processing behind a 60 s `maxDuration` cannot hold them. Options and the recommendation (Cloudflare Queues, T-132) are in `DEPLOY.md` §0. Also found, not fixed: the worker's `/process` and `/trigger` never check the `CLOUDFLARE_WORKER_TOKEN` bearer the web app sends.

**Deploy prep:** `DEPLOY.md` (migrations 26–28, env, merge, smoke test) and `scripts/deploy-migrations-26-28.sh`. The script refuses to run unless production is at 25 and records history per file, because migration 27 is not re-runnable (verified locally: a re-run fails on `CREATE TRIGGER` and rolls back).

**Tests:** 3 new in `ai-models.test.ts` (registry default + env override + `default` clears; dropped for 2.5 and `minimal`; factory body has `thinkingConfig` only when a level applies). Worker 324, web 60.

**Files:** `packages/shared/src/{ai-models.json,ai-models.ts}`, `apps/worker/src/ai/{client.ts,factory.ts,gemini.ts}`, `apps/worker/src/index.ts`, `apps/web/src/lib/ai/{models.ts,service-matcher.ts}`, `apps/web/src/app/api/{public/widget/chat,services/ai-draft,services/ai-draft/shared.ts}`, `apps/worker/src/__tests__/ai-models.test.ts`, `DEPLOY.md`, `scripts/deploy-migrations-26-28.sh`

---

### 2026-11-07: T-134 — Subscription-Only USD Plans (AD-026)

**Built:** one plan source `packages/shared/src/plans.ts` (US Starter/Pro/Business with monthly + annual prices, quote limits, channels, features, `overageEnabled: false`, 14-day card-required trial on Pro; legacy plans kept with their limits and overage for existing subscribers; `NO_SUBSCRIPTION_LIMIT` US 10 / GB 50 — no free tier for US). Read by `checkPlanLimit`, `plan-features.ts` (white-label + new `hasPlanFeature`/`hasPlanChannel`), `/api/billing`, the pricing page and the homepage teaser (`lib/plans-view.ts` maps definitions to `PlanInfo`; no number is typed twice). The `plans` table keeps rows only as FK targets (migration 28 adds the US ids, deactivates legacy rows).

**Over-limit = lead, not loss:** with overage off, a request beyond the limit is saved (`pending_review`, `content_json.limitHold`), the customer is told "{business} has your request and will send your estimate shortly" (no billing wording), the business is emailed ("New lead waiting — upgrade to price it"), no AI runs and the usage counter is not incremented. Same path in the widget API and the WhatsApp/SMS intake engine. `POST /api/quotes/[id]/process` + "Price this lead" on the quote page re-check the limit and run the normal pipeline with a fresh token. Dashboard banners (80% / 100%) and the limit email now describe lead capture instead of "paused".

**Stripe:** checkout takes `interval` (monthly/annual), price ids from env `STRIPE_PRICE_<PLAN>_<INTERVAL>_<CURRENCY>`, `payment_method_collection: 'always'`, trial only when the business never had a Stripe subscription. Existing subscribers change plans in the Customer Portal (proration). The webhook maps prices → plans with `planForStripePrice` and **upserts** the subscription.

**Two latent bugs found and fixed:** (1) checkout and the webhook queried `plans.stripe_price_id`, a column no migration ever created — checkout always returned NO_STRIPE_PRICE and the webhook could never bind a plan; (2) the webhook only UPDATED `subscriptions`, but signup never inserts a row — a first paid checkout would have been silently unrecorded.

**Also:** dashboard revenue stat used a hardcoded `$` (T-133 miss) — now the tenant currency.

**Tests:** `plans.test.ts` (single source, annual = 10×, trial, legacy, region allowance, env price mapping both ways, usage levels, Starter #51 not billable, legacy overage still meters) + an intake test proving the held lead is saved, unpriced and not counted. Web 60, worker 321. No gauntlet (owner rule: billing).

**Owner-only:** confirm the prices, create Stripe test products (`apps/web/scripts/stripe-setup-plans.mts`), set the env price ids, enable the Customer Portal with plan switching + proration, then run trial → paid → upgrade → downgrade in test mode.

**Files:** `packages/shared/src/{plans.ts,index.ts,api.types.ts}`, `supabase/migrations/00000000000028_us_plans.sql`, `apps/web/src/lib/{plan-limits.ts,plan-features.ts,plans-view.ts,lead-hold.ts,stripe.ts,email-templates.ts,messaging/intake-engine.ts}`, `apps/web/src/app/api/{public/quotes,billing,billing/checkout,webhooks/stripe,quotes/[quoteId]/process}`, billing/quote/dashboard pages, `apps/web/src/app/{pricing/page.tsx,page.tsx}`, `apps/web/scripts/stripe-setup-plans.mts`, `apps/web/.env.example`

---

### 2026-11-07: T-136 — SMS Channel (Twilio) on a Channel-Agnostic Intake Engine (AD-027)

**Built:**
- **WhatsApp pinned first:** `__tests__/whatsapp-intake.test.ts` characterises the pre-refactor intake (exact reply texts, transitions, quote creation, Cloud API send). Written and passing against the OLD code, then kept unchanged through the refactor.
- **Channel abstraction:** the state machine moved to `lib/messaging/intake-engine.ts`, driven by a `ChannelAdapter` (`send`, `downloadMedia`, `emphasize`, `senderNumberNoun`, `conversationTable`). `whatsapp-intake.ts` is now a thin adapter (WhatsApp `*bold*`, "WhatsApp number"); SMS uses plain text and "mobile number". R2 keys and `source_json.type` come from the channel name.
- **Twilio library** `lib/sms.ts` (no SDK): X-Twilio-Signature HMAC-SHA1 verification (test vector computed independently with openssl), send via REST, MMS download with basic auth, GSM-7/UCS-2 segment counting, STOP/START/HELP keywords (YES re-subscribes only an opted-out number — YES is also the intake's confirm word), opt-out store checked on **every** send (`sendSmsChecked` logs blocked attempts as `blocked_opt_out`), consent line on the first reply of each conversation. **Test mode** (`SMS_TEST_MODE=true` or no Twilio credentials): every outbound text is logged with status `test` and never leaves the platform.
- **Migration 27** `sms_channel.sql`: `sms_configs` (per-tenant E.164 number, optional Messaging Service SID, 10DLC checklist flags), `sms_conversations` (same shape as WhatsApp + `consent_notice_sent`), `sms_messages` (with billable `segments`), `sms_opt_outs` (unique tenant+phone). RLS on all four; businesses can READ opt-outs but cannot clear them — only the customer's START does.
- **Webhook** `POST /api/sms/webhook`: 503 if `TWILIO_AUTH_TOKEN` is unset, 401 on missing/invalid signature (fails closed); compliance keywords handled before any intake; MMS items become photo messages; one reply per inbound message (saves segments). Signed URL = `TWILIO_WEBHOOK_BASE_URL` or `NEXT_PUBLIC_APP_URL` + path (tunnels/proxies).
- **Dashboard:** `/app/sms` (number, Messaging Service SID, A2P 10DLC checklist with Twilio links, webhook URL, outbound segments this month, test-mode banner), "SMS" nav item, "Text link" on the quote detail page → `POST /api/sms/send-quote` (rotates the token like resend; 409 `OPTED_OUT` after STOP).
- **Region data:** `callingCode` added (US `1`, GB `44`); `normalizePhone` uses it — no US-only phone assumptions.

**Verified live in test mode** (`scripts/hardcore-test/verify-t136.mjs`, 18/18): unsigned and invalid webhooks → 401; text → description prompt with consent line, no asterisks; full intake incl. an MMS photo stored under `sms/…`; "yes" → quote created, priced $150 by the worker, link texted back; STOP → confirmation, dashboard send 409, no replies; START → send 200. The quote was held at `pending_review` because the test photo (a house) doesn't match a water-heater job — the gate behaving correctly; the script approves it before the send checks.

**No gauntlet** (owner rule: SMS plumbing doesn't touch AI/pricing); WhatsApp regression is covered by the pinned tests. Web tests 48 (was 34), worker 321.

**Not done (needs the owner):** a real Twilio account, a US number, A2P 10DLC brand + campaign registration, and a live MMS round trip — see OWNER-TODO.md. Automated 10DLC registration stays out of scope.

**Files:** `supabase/migrations/00000000000027_sms_channel.sql`, `apps/web/src/lib/{sms.ts,sms-intake.ts,auth-tenant.ts,whatsapp-intake.ts,messaging/*}`, `apps/web/src/app/api/sms/{webhook,config,send-quote}/route.ts`, `apps/web/src/app/(dashboard)/{layout.tsx,app/sms/page.tsx,app/quotes/[quoteId]/page.tsx}`, `packages/shared/src/regions/*`, `apps/web/.env.example`, tests `sms.test.ts` + `whatsapp-intake.test.ts`, `scripts/hardcore-test/verify-t136.mjs`

---

### 2026-11-07: T-135 — AI Model Registry, Provider-Agnostic Clients, Gemini 3 Upgrade

**Why it was urgent:** Google's deprecation notice — "Effective December 1, 2026, all API requests to `gemini-2.5-flash` will automatically route to `gemini-3.5-flash-lite` and be billed at Gemini 3.5 Flash-Lite rates" (aistudio.google.com/docs/deprecations, /docs/models, /docs/pricing, release notes 2026-11-02; `gemini-2.5-pro` reroutes to `gemini-3.8-flash`). The 3.8 Flash migration notes list "removed sampling parameters and prefilled model turns" as breaking changes — our client sent both.

**Built:**
- **Registry** `packages/shared/src/ai-models.json` (+ typed `ai-models.ts`): task → provider+model for `extraction_pass`, `adjudication`, `compile`, `wording`, `chat_widget`, `service_match`, `identification`; per-model request **capabilities**; a sourced USD/MTok **price table** (with `asOf` and source); a **pinned harness model** for the simulated customer (it must never drift between comparisons). `AI_MODEL_<TASK>` env overrides (`model` or `provider:model`) switch any task without a code change; legacy `ADJUDICATION_MODEL` still honoured. Grep check: no model-name strings in `apps/` or `packages/shared/src` code outside the JSON.
- **Worker `AiClient` interface** (`ai/client.ts`) — every consumer now types against it; `createAiClient(task, env, meter)` (`ai/factory.ts`). Processor routes vision work (signals, measurement, inventory) to `extraction_pass`, all text work (wording, addons, gate, validator, cross-service, recommendations) to `wording`, the senior model to `adjudication`.
- **Claude adapter** (`ai/anthropic.ts`, official `@anthropic-ai/sdk`): JSON-schema structured outputs with a Gemini→JSON-Schema translator (`toClaudeJsonSchema`: lowercase types, `nullable`→anyOf null, `additionalProperties:false`, unsupported keywords dropped), server-side refusal `fallbacks: "default"`, refusal/`max_tokens` stop reasons surfaced as errors. Selectable by config (`AI_MODEL_ADJUDICATION=anthropic:<model>`); **not exercised live — no Anthropic key in this environment** (OWNER-TODO).
- **Per-quote AI cost** in `pricing_trace_json.aiUsage` (calls, input/output tokens incl. Gemini thinking tokens, estimated USD by task+model; unpriced models listed, never guessed).
- **Web** chat/compile/AI-draft/service-matcher read the registry (`lib/ai/models.ts`); a web task routed to a non-Gemini provider falls back to its default with a warning.

**Root cause found — Gemini 3.x schema-constrained numbers degenerate.** With `response_schema`, `gemini-3.8-flash`, `gemini-3.6-flash` and `gemini-3.5-flash-lite` emit `"widthInRefUnits": 6.000000…` until MAX_TOKENS on the measurement prompt (reproduced in direct probes at temperatures 0.3/0.7/1.0, with real `systemInstruction`, with `response_json_schema`, with integer and string-typed fields — all still degenerate or produce garbage). JSON mode **without** a schema, schema described in the prompt, returns sane numbers 5/6 (the sixth was a markdown fence the parser strips). **Fix (data, not code branching):** per-model capabilities in the registry — Gemini 3.x get `structuredOutput: "prompt"` (schema in prompt, `coerceToSchemaRoot` unwraps an echoed `{"type","properties"}` wrapper and requires the root keys), real `systemInstruction` (no primed model turn), and no sampling params. Unlisted models keep the exact pre-T-135 request shape. MAX_TOKENS on a structured call now throws a clear error instead of a JSON SyntaxError. Live through the real measurement code (S01 photos, 3 passes): **3.8-flash 3/3 valid, 54.1 sqm, cov 0.11**; 3.5-flash-lite 3/3 valid but **172.9 sqm** (≈3× plausible — the Dec-1 auto-route target would have quietly inflated measured jobs); 2.5-flash 2/3 valid, 67.8 sqm.

**Comparison (gauntlet round 1, current vs one newer candidate per task; money = 7 hard-anchored scenarios: S03–S06/S09/S10 truth bands, S08 penny-exact £435.54):**

| Config | Run | Sent | Money | Median latency | Median AI $/quote | Notes |
|---|---|---|---|---|---|---|
| Current: 2.5-flash everywhere, adjudication `gemini-pro-latest` | `1e4e34cd` | 9/10 | 5/7 | 47 s | $0.0248 | pro-latest unpriced (no published price); same 5/7 as runs `8e5db672` and July `db8aa9bc` |
| Candidate: 3.8-flash everywhere (prompt mode), adjudication `gemini-3.1-pro-preview` | `2625e00e` | **10/10** | **6/7** | 66 s | $0.0273 | 1 measurement pass failed (MAX_TOKENS); S01 £1,680.80 Grade B from photos |
| Diagnostic: 3.8-flash with response schema (pre-fix) | `5366cf4b` | 9/10 | 7/7 | 50 s | $0.0232 | text tasks strong; 4 measurement passes degenerate, S01 aborted at 300 s |

**Chosen defaults:** `gemini-3.8-flash` for all Flash tasks, `gemini-3.1-pro-preview` for adjudication — equal or better accuracy than baseline, and the measurement engine works on a model that will still exist after Dec 1. **Not met:** median latency 66 s vs the 60 s target (baseline 47 s). Candidate follow-up: Gemini 3 `thinking_level` per task (text tasks low). Prices: 3.8 Flash doubles to $1.50/$7.50 on 2027-01-01, 3.1 Pro preview $2/$12.

**Process lessons (cost real runs):** zsh does not word-split `$VAR`, so a whole override list arrived as one model name; an empty bash array under `set -u` killed the worker start silently (config A ran against no worker). The eval driver now refuses to run unless the worker is healthy and every override is bound; and a smoke scenario's `aiUsage.byTask` is read before any full run (owner rule, memory `gauntlet-testing-rule`).

**Files:** `packages/shared/src/{ai-models.json,ai-models.ts,index.ts,database.types.ts}`, `apps/worker/src/ai/{client.ts,factory.ts,anthropic.ts,gemini.ts,index.ts,measurement.ts,wording.ts,signals.ts,cross-service.ts,quote-validator.ts,signal-recommendations.ts,service-draft.ts,service-detection.ts}`, `apps/worker/src/{agents/quality-gate.ts,quote-processor.ts,index.ts}`, `apps/worker/package.json` (+`@anthropic-ai/sdk`), `apps/web/src/lib/ai/{models.ts,service-matcher.ts}`, `apps/web/src/app/api/{public/widget/chat,services/ai-draft/*}`, `scripts/hardcore-test/customer-sim.mjs`, `CLAUDE.md`, `Docs/00-v1-scope.md`, `README.md`, tests `apps/worker/src/__tests__/ai-models.test.ts`

---

### 2026-11-07: T-133 — Region Layer + US Localisation (AD-025, AD-030)

**What changed:** the product was UK-shaped in code — UK door sizes as constants in the measurement engine ("a UK door is a UK door", T-118), `en-GB` and `£` symbol tables in six formatters, "Postcode" and "VAT" in copy, GBP fallbacks in APIs. Every one of those now comes from **region data**.

- **Region layer** (`packages/shared/src/regions/{types,us,gb,index}.ts`): currency, locale, unit system, postal label/pattern/examples, tax label, phone example, language variant for AI prompts, and the **reference-object table in metres** (US: 80×36 in doors, 2⅔ in brick course, 4 in siding course, 8×7 ft garage doors, outlet plates…). `resolveRegionContext(tenant)` layers tenant overrides (currency, unit system, tax label) on the region. `resolveReferenceObjects(region, packOverrides)` lets a pack replace or add references by id (`draft_config.referenceObjects`). `regionPromptBlock()` is the one prompt snippet every AI path uses.
- **Units + formatting** (`packages/shared/src/{units,format}.ts`): length/area/volume conversion with aliases (`sq_ft`, `linear_m`, `m²`…), refusing cross-kind conversion; `formatMoney`/`formatQuantity`/`formatDate`/`currencySymbol` via `Intl` (never throw on a bad code).
- **Migration 26** (`region_layer.sql`): `tenants.region` (backfilled **GB** for every existing row, default **US** for new ones, CHECK constraint), `tenants.unit_system` (nullable override), `services.tax_exempt`. No new tables → existing RLS covers the columns.
- **Measurement engine:** `REFERENCE_OBJECTS` constant deleted; the system prompt is built from the tenant's region table. **The table now owns the reference size** — when a pass names a known reference, code substitutes its dimension instead of trusting the size the model reported (AD-024). **Latent bug fixed:** `computeAnchoredValue` treated `sqft` as an area unit but always returned square metres; it now converts the metric area into the target unit. Measurement targets take the expected signal's declared `unit` first.
- **Worker:** tax label defaults from region (GB tenants with tax on and no label now show "VAT", was "Tax"); `tax_exempt` services skip tax; email money/dates use the region locale; wording prompt receives the region block; engine currency symbols from `Intl`.
- **Web:** tenant API reads/writes `region` + `unitSystem`; region picker in onboarding (first question — it decides currency, units and which pack is listed first) and settings (choosing a region applies defaults; currency is any ISO code; units overridable). All five AI-draft routes + the compiler receive the region block; the compiler is told to keep the owner's billing unit ("$2.50/sqft" → `sqft`, "per linear foot" → `linear_ft`) and to set `expectedSignals[].unit`, which `normalizeExpectedSignals` now preserves. Public quote API returns `locale`; quote page, PDF, accept/reminder/resend/revised emails format with it. Dashboard money via `Intl`, dashboard dates in the viewer's browser locale (business-facing). Trace page was hardcoded `$` — now the quote's currency. Widget and WhatsApp use the region's postal label; WhatsApp postal-code extraction uses region patterns (tenant's first).
- **US painting pack** `painting-decorating-us` (USD, rooms + sq ft, stories, US English, sq-ft envelope 100–1,000 per story). Rates are **placeholders marked TODO-OWNER** (OWNER-TODO.md). Packs carry `region`; `listPacks(region)` lists matching packs first. GB pack unchanged apart from `region: 'GB'` and a "(UK)" name suffix.

**AD-030 — units: geometry is metric, prices bind in the step's unit.** Reference tables, anchored geometry and (from T-138) scan dimensions are metric. A quantity is converted ONCE, where measurement emits it, into the unit its signal declares (`wall_area_sqft` → sq ft); from there form answers, envelopes, rates and the takeoff all share that unit, so the pricing engine stays unit-agnostic. Rejected alternative: metric signals everywhere with conversion at every edge (form merge, clarify answers, confirm step, takeoff, measurement memory) — five conversion sites, each a place to double-convert.

**Constraint:** a tenant row with no region is treated as **GB** (`LEGACY_REGION`), never silently US; only pre-migration rows lack one. **Deploy order: migration 26 before web/worker** — the worker selects the new columns.

**Grep check (no reference dimensions in engine code):** `grep -rnE "\b(1\.98|0\.76|0\.075|1\.83|1\.07|2\.032|0\.914)\b|metres: [0-9]" apps/worker/src apps/web/src packages/shared/src` excluding tests and `packages/shared/src/regions/` → one hit, a doc comment in `measurement.ts`. The compiler prompt's "front door (~2m tall)" example was removed too.

**Verified live** (`scripts/hardcore-test/verify-t133.mjs`, 13/13): new signup → region US / USD with no PUT; tax on without a label → "Sales tax"; compiler on "$3.20 per sqft walls, $450 minimum" → per-unit step 3.2/`sqft`, minimum 450, `ai_signal wall_area_sqft` with `unit: sqft`; widget shows "ZIP code"; a photo-measured quote priced in USD with locale en-US, senior adjudication settling the wall at **1,000 sq ft (band 900–1,100)**. That run used the UK S01 photos, so it proves the plumbing, not US accuracy (real US photos are an owner item). Processing took 223 s locally with adjudication — latency is T-135's concern.

**GB regression (gauntlet round 1 vs final baseline `db8aa9bc`):** full run `8e5db672` — S02/S03/S06/S07/S08 identical; S04/S05/S09/S10 differed by known compile/customer-sim variance and returned to baseline (or within its spread) on re-run `557b164a` (S04 £190, S09 £1,072.50, S10 £330, S05 £1,969 vs £1,921 — simulated payslip count). **One real regression found and fixed: S01 £1,694 → £350 twice.** Cause: the new compiler context made Gemini copy rule 3a's example description nearly verbatim ("total exterior masonry area in square metres — …"), dropping the owner's "to be painted"; the senior adjudicator then read "masonry" as the exposed brick plinth only (6.7–12.5 sqm). Proven by running S01 on the stashed pre-T-133 code (£1,680, "masonry area … to be painted"). Fix: rule 3a now requires the description to state the EXACT charged scope in the owner's words ("area TO BE PAINTED … every surface the job covers") — "the description is the measurer's ONLY definition of scope". After: S01 £1,520.40 and £1,106 (Grade B, render measured; July spread £1,078–£1,740). **Lesson:** prompt examples get copied; an example description must model scope, never just a material.

**Tests:** 13 new region/unit/format tests + 4 measurement tests (sqft conversion, region table beats the model's reported size, legacy GB table default, prompt contains the region table). Worker 306, web 34.

**Files:** `packages/shared/src/{regions/*,units.ts,format.ts,index.ts,database.types.ts,api.types.ts}`, `supabase/migrations/00000000000026_region_layer.sql`, `apps/worker/src/{ai/measurement.ts,ai/wording.ts,quote-processor.ts,pricing/rules-engine.ts,email/index.ts}`, `apps/web/src/app/api/{tenant,public/quotes/[quoteId],public/quotes/[quoteId]/accept,quotes/[quoteId],quotes/[quoteId]/resend,quotes/[quoteId]/pdf,cron/lifecycle,public/widget/config,services/ai-draft/*}`, `apps/web/src/lib/{pdf-template.ts,whatsapp-intake.ts,vertical-packs/*}`, settings/onboarding/quotes/trace/services pages, embed + quote pages, `scripts/hardcore-test/{run.mjs,verify-t133.mjs}`, `Docs/03-data-model.md`

---

### 2026-07-25: Branding v2 — business identity, bulletproof colour, white-label (still one simple page)

**Direction (user):** "simple, not too complicated, but a little more/better." Three additions chosen for value-per-control; explicitly NOT added: font pickers, secondary colours, custom CSS.

1. **Business identity block** — tagline + phone/email/website in `branding_json` (JSONB, no migration; the PUT already spreads new fields). Rendered on quote-page letterhead (tagline + `phone · email · website` line), widget letterhead, and PDF header. A commercial document finally carries contact details.
2. **Bulletproof colour** — `readableTextOn()` (WCAG relative luminance, threshold 0.45) picks white or ink text for ANY brand colour; new `on-primary` Tailwind token backed by `--color-on-primary-rgb` (RGB triple so `/60`-style opacity modifiers work). All `text-white` on primary surfaces in embed + quote pages swapped to `text-on-primary`. **Found while doing this: the quote price panel was hardcoded `style={{backgroundColor: JUNIPER}}`** — it ignored tenant colour entirely; now `bg-primary` (identical when unbranded), and its grade seal's `--seal-gap` follows `var(--color-primary)`. Dashboard adds 8 curated preset swatches (Juniper/Navy/Forest/Brick/Ocean/Plum/Amber/Charcoal) + custom picker; preview buttons use computed text colour.
3. **White-label makes the Growth promise real** — pricing page sells "Your branding on every quote" on Growth+, but `custom_branding` in `features_json` gated nothing. New `lib/plan-features.ts hasCustomBranding()` (active/trialing subscription → plan features; fail-safe false). Quote view API + widget config API return `showPoweredBy`; "Prepared with Aistimator" / "Powered by Aistimator" badges hidden for white-label tenants. Branding page notes this under the preview.

**Not done (candidates, deliberately deferred):** logo in email templates (needs a stable public logo route — signed URLs expire; emails cache), per-tenant butter/tape accent (measurement colours stay product-owned by design).

**Files:** `lib/color.ts` (+luminance/on-primary), `lib/plan-features.ts` (new), `tailwind.config.ts` (on-primary token), shared types, quote view + widget config APIs, embed page, quote page (incl. JUNIPER panel fix), `lib/pdf-template.ts`, branding page.

---

### 2026-07-25: Branding Actually Works — logo upload + colours/footer flow to widget, quote page, PDF

**What was broken (user report, confirmed):** the branding page saved `branding_json` but almost nothing consumed it. Logo upload was a "coming soon" stub with no endpoint; the public widget-config API returned zero branding fields (the colour picker affected literally nothing); the public quote API had a "logoUrl will be added when branding is implemented (T-008)" comment; footer notes reached only the PDF. Ironically the PDF route and quote-page letterhead already *rendered* logos — there was just no way to upload one. Only notification emails used the colour.

**Fixes:**
1. **Logo upload:** new `POST/DELETE /api/tenant/logo` — multipart upload (PNG/JPG/WebP ≤2MB), server-side `uploadToR2`, asset row, merges `logoAssetId` into branding_json. Branding page has real upload/replace/remove UI with preview. Logos are served via short-lived signed URLs generated per API response (no new public route, no public bucket).
2. **Colour propagation via CSS variables:** new `lib/color.ts` (`brandStyleVars` → `--color-primary` + derived `--color-primary-hover` at 18% darken; strict hex validation so garbage input falls back to juniper). Applied on the embed page root and the hosted quote page root — every `bg-primary`/`text-primary`/`hover:bg-primary-hover` class re-brands automatically, including the conversational chat (its restyle to token classes in AD-024 made this free).
3. **Widget:** config API now returns `branding: { primaryColor, logoUrl }`; letterhead shows the logo and now also renders in conversational mode (was form-only).
4. **Quote page:** public quote API returns `business.logoUrl` + `branding { primaryColor, footerNotes }` (shared type `QuoteViewBranding`); footer notes render above "Prepared with Aistimator"; brand vars applied on both the final and provisional (T-109) views.
5. **PDF:** needed no change — its logo resolution finally has data to work with.

**Design note:** tenant colour intentionally overrides juniper on customer-facing surfaces (widget + quote page); the dashboard and marketing site stay on the design system. Invalid/unset colours = juniper default.

**Files:** `apps/web/src/lib/color.ts` + `api/tenant/logo/route.ts` (new), `api/tenant/branding/route.ts`, `api/public/widget/config/route.ts`, `api/public/quotes/[quoteId]/route.ts`, branding page, embed page, quote page, `packages/shared/src/api.types.ts`

---

### 2026-07-24: PRODUCTION DEPLOY — all six of today's tickets live

**Shipped:** commits 50ec7f7…08efbf8 deployed to https://estimator-web-phi.vercel.app. Migrations 24+25 applied to prod Supabase via management API (`scripts/deploy-migrations-24-25.sh` — token from keychain, verified 3 whatsapp tables / 3 lifecycle columns / declined enum). `CRON_SECRET` set (daily lifecycle cron now active at 08:00 UTC).

**Deploy lesson:** `openssl rand | vercel env add` stores the trailing newline and the build then FAILS with "CRON_SECRET contains leading or trailing whitespace" — use `printf '%s' "$(openssl rand -hex 32)"`. Also `vercel env add` needs `--sensitive --yes` when piped or the interactive "Mark as sensitive?" prompt silently discards the value. Both fixes are in `scripts/deploy-env.sh`.

**Verified live:** all marketing pages 200, new widget.js loader served, cron 401s without bearer (fails closed as designed), quote API validation + honeypot working.

**Still off in prod (env not set, features fail open/dormant):** Upstash (rate limiting), **Postmark (all emails)**, Turnstile keys, WhatsApp vars, Stripe live keys, custom domain. Ready-to-uncomment commands in `scripts/deploy-env.sh`.

---

### 2026-07-24: WhatsApp Made Deployable — Missing Migration + Hidden Nav (closes the "coded but impossible to run" gap)

**What was wrong:** T-111/T-112 shipped a complete WhatsApp integration (Cloud API client, webhook with tenant routing, guided-intake state machine, credential setup UI) **against three tables no migration ever created** — `whatsapp_configs`, `whatsapp_conversations`, `whatsapp_messages`. Zero SQL files referenced WhatsApp; every DB call would fail on a fresh database. The setup page also wasn't linked anywhere — reachable only by typing `/app/whatsapp`.

**Fix 1 — migration 25 (`whatsapp.sql`):** creates all three tables with the exact shapes the code inserts (verified by grep of every `.from('whatsapp_*')` call + live smoke-test inserts against local Supabase). Conventions per migration-22 lessons: `tenant_id`/`quote_request_id` are TEXT with no FKs (local TEXT ids vs prod UUIDs), line comments only. `conversation_id` IS a real FK (both new UUID tables). CHECK constraints mirror the shared TS unions (status, intake_state, direction, message_type). RLS: webhook/intake run under service role, but the **config and send routes use the user-scoped client**, so authenticated users get tenant-scoped CRUD on configs and SELECT/INSERT on conversations/messages. `updated_at` triggers reuse `update_updated_at_column()`.

**Fix 2 — nav:** WhatsApp added to the dashboard Configure section (chat-bubble icon) between Widget and Branding.

**Verified:** migrations 23–25 applied to local Supabase via `supabase migration up`; smoke transaction exercised config insert, conversation insert, FK-linked message insert, intake-state update. Typecheck/lint/build green.

**Still requires the user (cannot be done from code):** (1) push migrations 24–25 to prod; (2) set `WHATSAPP_VERIFY_TOKEN`/`WHATSAPP_APP_SECRET`/`WHATSAPP_ENCRYPTION_KEY` in Vercel env; (3) live end-to-end test with real Meta credentials via the guided setup at /app/whatsapp.

**v2 backlog (deliberately not done):** proactive "quote ready" WhatsApp push from the processing pipeline — lower value than it sounds because the intake already sends the tokenized quote link in-chat at confirmation and the hosted page live-updates (T-109 polling). Meta Embedded Signup (one-click connect) — blocked on Meta Business verification, an ops track.

**Files:** `supabase/migrations/00000000000025_whatsapp.sql` (new), `apps/web/src/app/(dashboard)/layout.tsx`

---

### 2026-07-24: Marketing Website — Multi-Page Public Site on the Measured Document System (T-103 done)

**What was missing:** the root `/` was a 26-line placeholder; no pricing, features or legal pages existed anywhere. The v2 strategy reserved T-103 for the speed-to-lead homepage rebuild.

**Built:** five public pages on the design-system tokens, all server components, sharing `components/marketing/{SiteNav,SiteFooter}`:
- **`/` homepage** — signature element is `MiniEstimate`: a pure-CSS miniature of the actual estimate document (letterhead, tape-rule, dotted-leader ledger, Grade B seal, juniper price panel with mono total + measured range, photos-received chip, "generated in 58s" badge). Sections: split hero, verified speed-to-lead stats band (same sources as /painting), 4-step "Photos in. Quote out." tape timeline, "Your price. Never the AI's." does/never split on mint, measurement-grades showcase (A/B/C seals + butter range bar — the legitimate use of butter/tape), 6-feature grid, pricing teaser, juniper CTA.
- **`/pricing`** — 3 plan cards matching the seeded `plans` table ($29/200, $79/1,000, $199/3,000 + $0.50/0.40/0.30 overage; features from `features_json`), Growth highlighted with a tape badge, plain-English FAQ. **Prices are static copy — keep in sync with `supabase/seed.sql`** (noted in file).
- **`/features`** — the product's real pipeline as five numbered stages (Capture → Measure → Price → Deliver → Learn), honest to shipped capabilities only.
- **`/terms` + `/privacy`** — startup-grade legal, plain language, dated 2026-07-24. **Needs review by a lawyer before serious scale.**
- **`/painting`** refitted onto the shared nav/footer; stale "Estimator" brand fixed → **Aistimator** (the name used across the app since the design-system commit).

**Verified in browser** (dev server + screenshots): hero artifact, all sections, pricing, features. One fix from review: the sticky nav was translucent (`bg-background/90 backdrop-blur`) and went muddy over juniper bands — now solid.

**Files:** `apps/web/src/components/marketing/{SiteNav,SiteFooter,MiniEstimate}.tsx` (new), `apps/web/src/app/{page,pricing/page,features/page,terms/page,privacy/page}.tsx` (page.tsx rebuilt, rest new), `apps/web/src/app/painting/page.tsx`

---

### 2026-07-24: Quote Lifecycle Completion — Decline, Expiry, Acceptance Notification, Reminders

**What was missing (audit):** customers could accept but not decline; nothing ever flipped quotes to `expired` (status existed, no job set it); accepting sent **no notification to the business** (fatal for a speed-to-lead product); no follow-up reminders.

**Decline:** new `POST /api/public/quotes/[quoteId]/decline` mirroring accept (token-hash validated, expiry-checked, idempotent — 409 on already-declined/accepted, same valid-status list). Optional reason (500 chars) stored in `decline_reason` and included in the business notification email. Hosted quote page gets a deliberately quiet "No longer need this? Decline this estimate" link below the primary actions → inline optional-reason form → declined banner. New `declined` status: migration 24 enum value + badge entries in the customer page and both dashboard quote views.

**Acceptance notification:** accept route now emails `tenants.notification_email` ("X accepted your quote · service · total") with a dashboard link. Email failures never fail the accept/decline (fire-and-forget with logging).

**Expiry + reminders — Vercel Cron:** new `GET /api/cron/lifecycle` (daily 08:00 UTC via `apps/web/vercel.json` crons; auth = `Bearer CRON_SECRET`, **fails closed if unset**). Pass 1 flips quotes in (sent/viewed/feedback_received/revised) with `token_expires_at < now` to `expired`. Pass 2 sends ONE reminder per quote (status sent/viewed, `REMINDER_AFTER_DAYS` default 3 after `sent_at`, batch 50/run): **rotates the token** (raw tokens are never stored — the original email link is superseded; same trade-off as the resend route) and marks `reminder_sent_at` BEFORE sending (at-most-once; a crash loses a reminder rather than duplicating it). Skips the reminder pass when Postmark is unconfigured.

**Migration 24** (`quote_lifecycle.sql`): `ALTER TYPE quote_status ADD VALUE 'declined'` + `declined_at`, `decline_reason`, `reminder_sent_at` columns. Enum value is not used within the migration itself (PG same-transaction restriction).

**Deploy needs:** migration 24 to prod, `CRON_SECRET` in Vercel env (cron activates on next deploy), Postmark token for the emails to actually go out. Decline reason is surfaced via email only for now (not in dashboard quote detail UI).

**Files:** `supabase/migrations/00000000000024_quote_lifecycle.sql` (new), `packages/shared/src/{database.types.ts,api.types.ts}`, `apps/web/src/app/api/public/quotes/[quoteId]/{accept,decline}/route.ts` (decline new), `apps/web/src/app/api/cron/lifecycle/route.ts` (new), `apps/web/src/lib/email-templates.ts` (3 templates), `apps/web/src/app/q/[quoteId]/page.tsx`, dashboard quotes list + detail badges, `apps/web/{vercel.json,.env.example}`

---

### 2026-07-24: Widget Consolidation — Single Implementation, All Modes (AD-024)

**What was wrong (audit findings):** the shipped `public/widget.js` was a stale Preact bundle (built 2026-01-31, source last touched 2026-02-14) with **no build wiring** — inline/floating embeds served an old form with no photo upload, no service-specific fields, no conversational mode. Conversational existed twice (Preact `ConversationalWidget`, never shipped; React `ConversationalChat` in the embed page, reachable only via /demo) with divergent features and styling. `iframe-loader.js` silently dropped `data-display-mode`, so the conversational snippet shown to customers was broken. Dashboard offered no conversational option. Three styling systems, none matching the design system for chat.

**AD-024 — one widget implementation, iframe-mounted everywhere:** every mount mode now renders the hosted embed page (`/embed/[tenantKey]`) in an iframe. `public/widget.js` was rewritten as a small handwritten vanilla loader (no build step → **a stale bundle is structurally impossible**): `data-mode` inline|iframe (iframe-in-container + postMessage auto-resize) or floating (juniper launcher button + slide-over panel, mobile full-screen; `EstimatorWidget.open()/.close()`); `data-display-mode="conversational"` passes `?mode=conversational` through. Supports legacy `data-button-label`. `iframe-loader.js` kept as a deprecated back-compat shim (existing snippets keep working) and now also honours `data-display-mode`. **Deleted the entire Preact implementation** (`packages/widget` — Widget, ConversationalWidget, ab-test.ts and the never-wired A/B assignment logic). Consequences: style isolation for free, conversational available in every mode, **Turnstile now works for all modes** (widget UI always runs on the platform origin), single styling system.

**Also:** conversational chat restyled from hardcoded blue (#3b82f6) inline styles to Measured Document tokens (juniper bubbles, mist assistant bubbles, warm radii, token borders). Dashboard widget page now has a two-axis picker — Placement (inline | floating) × Experience (form | AI chat) — generating correct snippets; "iframe" placement removed as redundant (identical to inline under AD-024). /demo rebuilt on the same two axes; floating preview loads the real production loader.

**⚠️ rollout note:** deleting `packages/widget` was blocked by tooling permissions in-session; if `packages/widget/` still exists, remove it (`git rm -r packages/widget`). Sites embedding the OLD widget.js get the new loader on their next page load — attributes are compatible (`data-mode`, `data-container`, `data-button-label` all honoured); visual change: Preact modal → iframe panel. After this deploys, `TURNSTILE_SECRET_KEY` can be enabled in production (all modes send tokens).

**Files:** `apps/web/public/widget.js` (rewritten), `apps/web/public/iframe-loader.js`, `apps/web/src/app/embed/[tenantKey]/page.tsx` (chat restyle), `apps/web/src/app/(dashboard)/app/widget/WidgetPageClient.tsx`, `apps/web/src/app/demo/page.tsx` (rebuilt), `packages/widget/` (deleted)

---

### 2026-07-24: Turnstile + Honeypot on Quote Submission (anti-abuse layer, part 2 of 2)

**What:** Bot protection on `POST /api/public/quotes`, complementing the same-day rate limiting. Two mechanisms:
1. **Honeypot** — hidden off-screen `website` field rendered in the iframe embed form and the Preact widget source (`Widget.tsx`). Server rejects any submission with a non-empty value using a deliberately generic `VALIDATION_ERROR`. Always on; zero risk to legit users (old widget bundles simply omit the field, absence passes).
2. **Cloudflare Turnstile** — `apps/web/src/lib/turnstile.ts` verifies tokens against siteverify. **Enforcement is keyed on `TURNSTILE_SECRET_KEY`**: unset → skipped entirely; set → token mandatory (403 `VERIFICATION_FAILED` on missing/rejected). Cloudflare outages/network errors **fail open** — rejection is fail-closed, infrastructure failure is not.

**Client:** `apps/web/src/components/embed/useTurnstile.ts` — invisible (`appearance: interaction-only`, `execution: execute`) explicit-render integration; `getToken()` promise API used by both the form `handleSubmit` and the conversational chat auto-submit in `embed/[tenantKey]/page.tsx`. Challenge containers stay mounted across step/spinner transitions (chat fetches its token BEFORE swapping to the submitting spinner — the container must be in the DOM). Widget callbacks dispatch through a pending-ref because Turnstile binds callbacks once at render; tokens are single-use so re-submits reset+re-execute.

**⚠️ Deploy constraint:** do NOT set `TURNSTILE_SECRET_KEY` in production until embeds sending tokens are what's actually deployed. The stale `public/widget.js` bundle (inline/floating mounts) sends no token — enabling the secret today would 403 those submissions. Enable after the widget consolidation ticket, or accept iframe-only enforcement. Sitekey must have the platform domain allowed (inline/floating embeds on customer domains will additionally need domain allowlisting or Embedded-widget domain checks relaxed — part of the widget ticket).

**Not covered (deliberate):** widget/chat per-turn Turnstile (UX-hostile; rate limits cover it), uploads/init (rate-limited; assets are orphaned unless a quote references them), WhatsApp intake (doesn't go through the public API; Meta webhook is signature-verified).

**Tests:** 8 unit tests `src/__tests__/turnstile.test.ts` (fail-open unset/outage/HTTP-error, fail-closed missing/rejected, remoteip omission). 24 web + 289 worker passing.

**Files:** `apps/web/src/lib/turnstile.ts` (new), `apps/web/src/components/embed/useTurnstile.ts` (new), `apps/web/src/app/api/public/quotes/route.ts`, `apps/web/src/app/embed/[tenantKey]/page.tsx`, `packages/widget/src/Widget.tsx`, `apps/web/.env.example`

---

### 2026-07-24: Rate Limiting Added to Public Intake Endpoints (closes launch-blocking abuse hole)

**What was wrong:** `POST /api/public/quotes`, `/api/public/uploads/init`, and `/api/public/widget/chat` had **no rate limiting at all**. The only limiter lived in the worker (`apps/worker/src/rate-limiter.ts`) guarding AI processing — but production runs `SYNC_QUOTE_PROCESSING=true` (no queues), so the worker limiter is out of the hot path entirely. Anyone could script unlimited submissions that burn Gemini budget, create DB rows, issue presigned R2 URLs, and consume tenant plan quota.

**Fix:** New `apps/web/src/lib/rate-limit.ts` — Upstash Redis fixed-window limiter (atomic INCR+EXPIRE pipeline, same approach as the worker's) with **per-IP and per-tenant-key** counters per endpoint scope. Defaults: quotes 5/min/IP + 30/min/tenant (runs full AI pipeline), uploads 20/min/IP + 100/min/tenant, chat 15/min/IP + 100/min/tenant. Env-overridable (`RATE_LIMIT_<SCOPE>_{IP,TENANT}`, `RATE_LIMIT_WINDOW_SECONDS` — see `.env.example`). Checks run after basic validation but **before any DB access**; blocked requests get a neutral 429 (`RATE_LIMITED`) with `Retry-After`. IP from first `x-forwarded-for` entry (Vercel) with `x-real-ip` fallback.

**Decision — fail-open:** missing Redis config or Redis errors never block quote requests (consistent with the plan-limits fail-open decision). Rate limiting is a damage limiter, not an availability dependency. **Deploy note: production Vercel env must have `UPSTASH_REDIS_REST_URL`/`TOKEN` set or this ships disabled** (a one-time console warning fires if unset).

**Testing:** web app now has vitest (`apps/web/vitest.config.ts`, mirrors worker config); 16 unit tests in `src/__tests__/rate-limit.test.ts` via an injectable store fake. Root `pnpm test` changed from worker-only to `pnpm -r --if-present test` (runs web + worker; 16 + 289 passing).

**Deliberately out of scope (follow-up tickets):** Turnstile/captcha + honeypot on submission; limits on token-gated public routes (`clarify`, `feedback`, `accept` — lower risk, token-protected); cheap public reads (`widget/config`, `quotes/[quoteId]` GET) left unlimited.

**Files:** `apps/web/src/lib/rate-limit.ts` (new), `apps/web/src/app/api/public/{quotes,uploads/init,widget/chat}/route.ts`, `apps/web/{package.json,vitest.config.ts,.env.example}`, root `package.json`

---

### 2026-07-21: PRODUCTION DEPLOYED 🚀

**Live:** web `https://estimator-web-phi.vercel.app` (Vercel, SYNC_QUOTE_PROCESSING=true, maxDuration 60s on AI routes) · worker `estimator-worker-production.billgajen.workers.dev` (8 secrets, R2 bound, no queues) · DB Supabase `ygsuzeveesgrafgpkrev` eu-central-1 (23 migrations + seed via management API — old project `iyvpqykjjymtavjkktgo` was paused >90 days, unrestorable) · Stripe TEST mode: meter `estimate_overage`, product + 3 metered prices (50/40/30p) wired into plans, webhook `we_1TvesO3J76egMmNyRb8SSdn4`.

**Deploy-found fixes (f13d0e4):** migrations 16/17 had UUID FKs against TEXT parents, 18 duplicated a migration-2 policy — committed files had drifted from applied reality; fixed + policy guards added.

**Post-launch list:** Postmark token (emails off), Stripe live keys, Cloudflare Workers Paid for queues, Supabase plan upgrade (free tier pauses — killed the old project), custom domain.

---


### 2026-07-21: Design System v2 — "The Measured Document" (commit 1aef8e4)

**Context:** user rejected the Editorial Black B&W look ("old Google Bootstrap template") and asked for a billion-dollar-grade redesign: pastel-leaning brand colours, ultra attention to detail, priority on the estimate page, widget and form fields; marketing site to follow separately.

**Direction:** identity grounded in the product's own world — paper, ink, and the measuring tape. Juniper `#205E56` brand; porcelain/mint/mist/butter pastel surfaces; tape `#DCAF3E` reserved exclusively for measurement UI; ink `#1B2823` text. Type: Bricolage Grotesque / Instrument Sans / Spline Sans Mono (all figures tabular via `.figure`). Signature elements in `globals.css`: `.tape-rule` tick dividers, `.grade-seal` A/B/C assay stamp (`--seal-gap` for coloured grounds), `shadow-document`. Tokens are CSS-variable-backed so the dashboard re-skins automatically; the estimate page and embed widget were deep-restyled by hand. The marketing website must build on these same tokens.

**Files:** `apps/web/src/app/{globals.css,layout.tsx}`, `apps/web/tailwind.config.ts`, `apps/web/src/app/q/[quoteId]/page.tsx`, `apps/web/src/app/embed/[tenantKey]/page.tsx`

---


### 2026-07-20: Compiler Silently Discarded Entire Compilations (all 10 gauntlet verticals quoted £50 Grade A)

**What broke:** First full hardcore run: ALL 10 scenarios compiled to an empty pricing model → every quote went out at the £50 normalizer default (S07 £180 via addons), **Grade A "this price is exact"** — a 128-guest wedding for £50. S05 died on repeated compile HTTP 500s.

**Root cause (verified by direct Gemini reproduction, `finishReason: STOP`, valid JSON):** NOT truncation. `COMPILE_SYSTEM_PROMPT` showed `"updatedConfig": { ...complete ServiceDraftConfig... }` without ever spelling out the internal shape — Gemini guessed, emitting `workSteps` at the **root** of updatedConfig with **`label`** instead of `name`. `validateAndNormalizeDraftBulk` reads only `draft.pricing.workSteps` and `normalizeWorkSteps` filters on `step.name` → the whole compilation was silently discarded. Then `validateAndNormalizeDraft` **invented** `minimumCharge: 50` (a `|| 50` default — violating core rule "never invent numbers" and the anti-hardcoding principle), giving the deterministic engine a £50 fixed price it dutifully quoted. Grading then correctly saw "no unresolved quantities" → Grade A. Garbage-in-config is invisible to grading — separate finding, not yet addressed.

**Fix (compile robustness, 4 changes):**
1. `compile/route.ts` prompt: explicit updatedConfig JSON schema (pricing.workSteps with `name`, quantitySource, suggestedFields...) + "workSteps live at updatedConfig.pricing.workSteps, NOT at the top" instruction.
2. `compile/route.ts`: shape-drift hoist — root-level `workSteps` arrays are moved into `pricing.workSteps` before normalization (belt-and-braces alongside the existing `updatedConfig.config` unwrap).
3. `shared.ts normalizeWorkSteps`: accepts `label` as `name` fallback and `price` as cost fallback; missing cost now normalizes to visible £0, never invented £25.
4. `shared.ts`: `minimumCharge || 50` → `?? 0`; compile `maxOutputTokens` 8192 → 16384 (2.5-flash thinking tokens count against the budget — same class as the measurement 4096 truncation; suspected cause of the intermittent 500s).

**Constraint reaffirmed:** normalizer defaults must never introduce prices. Remaining invented-default audit (scope placeholders, photoGuidance) is cosmetic, left as-is.

**Files:** `apps/web/src/app/api/services/ai-draft/compile/route.ts`, `apps/web/src/app/api/services/ai-draft/shared.ts`

---

### 2026-07-20: Services API 500 on Compiler-Emitted Object Options

**What broke:** Hardcore run 3, S01: `POST /api/services` returned 500. The compiler emitted `suggestedFields[].options` as `{label, value}` objects (dropdown for scaffold access); both services routes assumed `string[]` and called `opt.toLowerCase()` → TypeError. Nondeterministic — the same scenario compiled to a boolean field (no options) in run 2 and saved fine.

**Fix:** `normalizeFieldOption()` in `apps/web/src/lib/field-options.ts` accepts both shapes; used by POST `/api/services` and PATCH `/api/services/[id]` when building widget fields.

**Files:** `apps/web/src/lib/field-options.ts` (new), `apps/web/src/app/api/services/route.ts`, `apps/web/src/app/api/services/[id]/route.ts`

---

### 2026-07-20: T-131 — Catalogue & Bounded Pricing (R2-2, R2-3, R2-4, R2-5, F2b)

**The gaps (round-2 blind testing):** price-list configs quoted the ENTIRE catalogue to every customer (£1,940 of furniture for one armchair — customer said "only the armchair" twice); block-package pricing compiled to mandatory £0 steps whose surcharges shipped alone (£16 PT quote); from-prices/ranges had no schema home; credits (resale offsets) were clamped away; contingency penalties priced on mere mention (£60 for mentioning a fridge).

**Built:**
- **R2-2 catalogue semantics:** `quantitySource.missingMeansZero` — an unanswered per-item field is a TRUSTED zero ("not requested", line dropped), not the untrusted ×1 fallback; no T-127 question, no grade cap. Compiler rule 4c: price-list items compile as per_unit steps with optional per-item fields, never unconditional fixed steps.
- **R2-3 zero-cost guard:** a mandatory non-percent step at £0 = the compiler failed to establish the primary price → quality gate + processor backstop hold the quote. Compiler rule 4b: block packages become when-bound steps per option; NEVER a £0 placeholder.
- **F2b bounded pricing:** `WorkStepConfig.costBand {low, high}` from STATED figures only (defaultCost = the from/low anchor). Priced at the anchor; the band widens the customer-facing interval (added to quantity-band spread) and caps the grade at B via a rate provenance entry. Compiler rule 4d.
- **R2-5 credits:** `costType 'credit'` — subtracts, renders negative, positive defaultCost so the never-invent clamp still holds. Compiler rule 4e.
- **R2-4 penalties:** compiler rule 4f — fees contingent on on-the-job discoveries compile as exclusions/notes wording, never priced lines.
- 6 new worker tests (277 pass) incl. the exact S23 armchair-only case.

**Files:** `packages/shared/src/database.types.ts`, `apps/worker/src/pricing/{rules-engine.ts,catalogue-pricing.test.ts}`, `apps/worker/src/{quote-processor.ts,agents/quality-gate.ts}`, `apps/web/src/app/api/services/ai-draft/{compile/route.ts,shared.ts}`

---

### 2026-07-20: T-130 — Measurement Engine Wired Into Compiler Tenants (F5)

**The gap (hardcore F5):** the compiler prompt said form_field "STRONGLY PREFERRED", so every quantity became a customer question, zero `ai_signal` sources existed, and the entire V3 measurement engine (M1–M7) sat idle for compiler-built tenants — photos informed wording, never price, across all 40 gauntlet generations.

**Design (AD-023 aligned):** quantity sources now chosen by WHO can know the quantity. Photo-measurable ones (areas, lengths, visible counts) compile to `ai_signal` + an `expectedSignals` entry (with a visual-anchor description) + an **optional** same-key number field ("— if you know it") so a customer-stated value overrides the measurement via existing form-wins fusion; `media.minPhotos ≥ 1` + photoGuidance. Customer-knowledge quantities (guests, transactions, miles) stay required form fields; computed ones stay `derived`. Engine needed NO changes — measurement keys off `quantitySource.type === 'ai_signal'` (verified at quote-processor.ts:505).

**Live verification (S01 painting, real photos, full pipeline):** ensemble measured the front elevation → **senior adjudication fired** ("unpainted brick plinth must be excluded — Junior 2 incorrectly included it") → **38.5 sqm, band 32–45, basis `adjudicated`** → **£1,078, interval £896–£1,260, Grade B "Measured"**, takeoff row shows the measurement method. In-flow confirmation asked; the customer's vague "sounds about right" correctly did not override. First compiler-built quote ever priced from photos.

**Observation (minor, logged):** the confirm_value question quoted the pre-adjudication ensemble value (55) while the final adjudicated value was 38.5 — question generation runs before adjudication settles. Cosmetic ordering; candidate tidy-up alongside F2b.

**Files:** `apps/web/src/app/api/services/ai-draft/compile/route.ts` (prompt only), `scripts/hardcore-test/scenarios.mjs` (S01 back to its true story)

---

### 2026-07-20: T-128 — Grade Honesty: Untrusted Quantities Cap the Grade (F6)

**The gap (hardcore F6):** grading only saw AI-signal provenance, so quotes priced on placeholder ×1 fallbacks or AI-operand formulas still claimed Grade A "this price is exact" (every gauntlet quote graded A, including the £85 fence and the £361k accounting quote).

**Built:** new provenance basis `'defaulted'` in `shared/grading.ts` (caps at C, like envelope); processor merges trace-level trust into provenance before grading — `legacy_fallback`/`derived_unresolved` work-step lines → `defaulted` (C), untrusted-but-resolved (AI-operand derived / ai_signal) → measured 0.7 (B). Conditional steps that legitimately didn't bind (customer answered "small car") do NOT cap — absence-by-answer is confirmed information. 2 new tests (271 pass).

**Live verification (`verify-t128.mjs`):** fence probe → T-127 question → customer answers "Not sure at all" → round spent → **sent £85 Grade C (Concept)** with the confirm-to-tighten framing (was: Grade A "exact"). The T-127+T-128 chain: ask where the money is; when the customer can't answer, say honestly what the price rests on.

**Note:** F2b (range/category pricing plausibility — the S07 junk £1×18 config) is NOT covered by trust caps (the formula resolved "cleanly") and stays open; it needs rate-plausibility/benchmark checks, tracked in `Docs/08-hardcore-test-findings.md`.

**Files:** `packages/shared/src/grading.ts`, `apps/worker/src/quote-processor.ts`, `apps/worker/src/__tests__/grading.test.ts`, `scripts/hardcore-test/verify-t128.mjs`

---

### 2026-07-20: T-127 — Defaulted Quantities Trigger In-Flow Clarification (F3)

**The gap (hardcore F3):** work-step quantities that DEFAULTED to 1 (unanswered form field, unresolvable derived formula, legacy fallback) priced silently as placeholders — the £85 "fence" that should be £1,700 — labelled "Estimated — to be confirmed" yet sent Grade A. VOI/T-108 never fired in 40 generations because clarification only evaluated AI signals.

**Built:**
- Processor collects `defaultedQuantitySteps` from `legacy_fallback`/`derived_unresolved` trace entries, resolves each step's **askKey** (form fieldId / first missing formula identifier / step id for legacy), and applies the VOI bar (`isQuestionWorthAsking`, swing modelled as rate×9) so pennies-per-unit steps don't waste the 2-question budget.
- Quality gate treats them as structural (same always-ask priority as missing AI-signal quantities), deduped, capped at 2, 1 round max.
- **Loop closure:** clarify answers already merge back as form answers keyed by `targetSignalKey` (bug-#11 flow); engine now also honours a direct form answer keyed by the STEP ID in both legacy per_unit and per_hour fallbacks, so even quantitySource-less steps reprice from an answer.
- 5 new worker tests (269 pass), incl. the fence ×1 → ask → 20 → £1,700 sequence.

**Live verification (`scripts/hardcore-test/verify-t127.mjs`, full HTTP loop):** submission without fence length → `awaiting_clarification` with "Could you tell me the approximate length of the closeboard fencing…?" targeting `fence_length_m` → answer "20" → reprocess → **sent at £1,700** (was: silent £85 Grade A). Also incidentally re-proved the T-126 send-guard: a mis-seeded £0 config went to `pending_review`, not to the customer.

**Files:** `apps/worker/src/quote-processor.ts`, `apps/worker/src/agents/quality-gate.ts`, `apps/worker/src/pricing/{rules-engine.ts,defaulted-quantity.test.ts}`, `scripts/hardcore-test/verify-t127.mjs`

---

### 2026-07-20: T-126 — Form-Bound Step Conditions + Structural Send-Guard (F7)

**The gap (hardcore F7):** work-step triggers only understood AI signals, so conditional fixed charges decided by customer answers ("SUV +£25", "weekend +£20", "£420 if it's a baby grand") compiled to empty `triggerCondition: {operator:'equals'}` stubs the engine silently dropped. Worst case: every step of the piano-move config dropped and a **£0 quote auto-sent** — the quality gate's zero-total check required `breakdown.length > 0`, which is false in exactly that failure.

**Built:**
- `WorkStepConfig.when: { fieldId, operator, equals|value }` — same shape and comparison semantics as multiplier conditions (`compareAnswerValue()` extracted from `shouldApplyMultiplier` and shared). A `when` governs the step outright, optional or not; unanswered field → step skipped with a trace log.
- Compiler prompt rule 4 rewritten: fixed conditional charges → `when` steps (equals value MUST match a field option), percentage ones → multipliers, photo-decided ones → complete triggerSignal+triggerCondition; explicit warning that partial conditions are dropped. `normalizeStepWhen()` refuses conditions lacking fieldId or a comparison value.
- **Structural send-guard** (two layers): quality gate now flags `total <= 0` regardless of breakdown, plus "N steps configured, 0 priced"; and a processor-level backstop applies the same checks even when the AI gate didn't run (no Gemini / errored) — a £0 or nothing-bound quote can never auto-send, it goes to `pending_review`.
- 8 new worker tests (S04 surcharge binding incl. option-format normalization, S09 multi-item contains-matching, the exact S09 empty-breakdown £0 gate case). 264 pass.

**Files:** `packages/shared/src/database.types.ts`, `apps/worker/src/pricing/{rules-engine.ts,conditional-steps.test.ts}`, `apps/worker/src/agents/quality-gate.ts`, `apps/worker/src/quote-processor.ts`, `apps/web/src/app/api/services/ai-draft/{compile/route.ts,shared.ts}`

---

### 2026-07-20: T-125 — Derived Quantities, Percent Steps, Subtotal Multipliers (F2)

**The gap (hardcore F2):** the engine couldn't express computed quantities — transaction tiers, mile thresholds, staff ratios, percentage charges, order-value discounts. The compiler pushed the arithmetic onto customer form fields, which customers misanswered: S05 swung from **£361,471 to £1,487** across runs of the same pricing text; S09 sent a £0 quote; S02 double-counted tiers.

**Built:**
- **AD-024: deterministic quantity formulas.** `packages/shared/src/formula.ts` — a ~180-line safe expression evaluator (no eval; `+ - * / ( )`, `ceil/floor/round/abs/min/max`, identifiers = form fieldIds/signal keys; length/token caps; unknown identifier or bad syntax fails the WHOLE formula so callers fall back explicitly, never price on garbage). Work steps take `quantitySource: { type: 'derived', formula }`. Trust propagates: all-form operands → trusted; any AI-signal operand → untrusted; unresolved → `derived_unresolved` + quantity-1 fallback flagged in the trace (T-127 hook).
- **Percent work steps:** `costType: 'percent'`, `defaultCost` = the percentage, `percentOf` = step ids (service charge on food lines) or `'subtotal'`. Evaluated after all non-percent steps.
- **Subtotal multipliers:** `when: { subject: 'subtotal', operator, value }` — order-value rules ("10% off over £5,000" ×0.9) with no customer question. `when.fieldId` is now optional; all consumers guarded.
- Compiler prompt teaches all three (rules 3b/3c + schema examples with the exact gauntlet formulas); web normalizers validate formulas parse (`extractFormulaIdentifiers`) before accepting.
- 13 new worker tests encode the gauntlet disasters as regressions (2,400 tx → 3 tiers not £360k; 20 miles → £0 line; £4,430 → no discount). 256 total pass.

**Live verification (gauntlet re-run, all penny-exact vs pricing text):** S02 £832.50 (min/max tier split + ×1.5 emergency), S03 £4,520 (discount withheld below £5k), S05 £1,921 (3 derived tier blocks), S06 £12,068 (derived canapés 128, derived staff 9, percent service charge £948 on exactly the food lines), S09 £1,432.50 (3 flights × 2 items derived, 225 excess miles derived) — S09 was the £0-quote scenario.

**Ops lesson:** running `next build` while `next dev` is live clobbers `.next` and 500s every API route until the dev server restarts. Restart `pnpm dev:web` after any build.

**Files:** `packages/shared/src/{formula.ts,index.ts,database.types.ts}`, `apps/worker/src/pricing/{rules-engine.ts,derived-pricing.test.ts}`, `apps/worker/src/ai/signals.ts`, `apps/web/src/app/api/services/ai-draft/{compile/route.ts,shared.ts}`, `apps/web/src/lib/pricing-describe.ts`

---

### 2026-07-20: T-129 — Public API Now Enforces Per-Service Required Fields (F4)

**What broke (hardcore F4):** `POST /api/public/quotes` validated required/critical fields against only the **global** `widget_configs` row (`service_id IS NULL`). The per-service rows that `POST /api/services` creates from compiled `suggestedFields` were never checked, so submissions omitting required price-driving quantities were accepted and the engine priced them at quantity 1 (the £85 fence).

**Fix:** validation now loads all `widget_configs` rows for the tenant and merges global fields (honouring their `serviceId` scoping) with the selected service's row, deduped by fieldId. Additionally, a required **number** field answered with non-numeric text counts as missing — previously junk text silently became a ×1 fallback (S01's vague area answer). General inquiries skip service-bound field validation (they aren't for that service's form).

**Verified live:** missing per-service fields → 400 listing them; junk text in number field → 400 naming it; complete answers → passes to the next gate. Harness scenarios updated: customers now give forced in-character guesses for fields the widget would require (S01 area 40, S02 ridge 2, S03 waste 2) — noting the conversion-risk tension that T-130 resolves by measuring photo-measurable quantities instead of asking.

**Files:** `apps/web/src/app/api/public/quotes/route.ts`, `scripts/hardcore-test/scenarios.mjs`

---

### 2026-07-20: Hardcore Gauntlet Complete — Findings F2–F7 Documented

**Outcome:** 4 full runs. Final run: 10/10 quotes sent, every total penny-reconciled against config via pricing traces (AD-001 held throughout). Six open findings documented in **`Docs/08-hardcore-test-findings.md`** (the canonical list): F2 derived quantities inexpressible (S05 swung +£359k/−£718 across runs on identical pricing text), F7 conditional charges can't bind to form answers → steps silently dropped → **£0 quote sent** (S09), F3 missing quantities price at ×1 with no VOI/clarification ever firing (0 of 40 generations), F6 Grade-A blind spots, F4 per-service required fields unvalidated at the public API, F5 measurement engine never engages for compiler-built tenants (photos decorative). Each needs its own ticket; none fixed yet beyond F1/F8 above.

---

### 2026-07-20: Hardcore E2E Harness (terminal-driven, 10-vertical gauntlet) + First Findings

**Context:** User requested a hardcore API-level test — 10 completely different business types (incl. a digital service) with adversarial customer requests — run entirely from the terminal, no browser.

**Built:** `scripts/hardcore-test/` — `SCENARIOS.md` (spec), `scenarios.mjs` (10 tenants: painting, roofing, landscaping, car valeting, accounting, catering, tree surgery, window cleaning, piano moving, pest control — with fieldHints/clarify hints so the "customer" answers in character), `lib.mjs` (Supabase admin REST, **@supabase/ssr 0.4.1 cookie minting** `sb-127-auth-token` = `base64-`+base64url(session), chunked at 3180; public upload → R2 PUT; polling; HEIC→JPEG via sips), `checks.mjs` (triage assertions), `run.mjs` (orchestrator; per-run results dir + REPORT.md). Assets: `test-assets/hardcore/` (gitignored) — user drops real photos; S05 synthetic bank statement (CSV + hand-built 3-page PDF, 2,388 tx) generated.

**Key plumbing facts (verified live):** dashboard routes are cookie-auth ONLY (Docs/02 "Bearer" claim is wrong); local dev processes quotes synchronously via `CLOUDFLARE_WORKER_URL` `/process` (submission POST blocks through the whole AI pipeline); `tenant_sites`/`tenant_key` has NO creation API (dashboard server components create it lazily) — harness inserts it via service-role; **the signup trigger DOES fire on `auth.admin.createUser({email_confirm:true})` locally** (creates tenant+profile; setup-tenant then 409s — harness handles both paths); public uploads accept images+PDF only (no CSV).

**Findings already (S06 smoke run):** (1) **Compiler fails on per-head/derived pricing** — catering description reproducibly yields EMPTY pricing (no work steps; normalizer default `minimumCharge: 50` papers over it) or HTTP 500 (suspected 8192-token truncation, same class as the measurement 4096 truncation bug); (2) **Grade A on a config-starved quote** — 128-guest wedding quoted at £380 (marquee addon only, later £50) with grade A "this price is exact": grading trusts quantity provenance but has no signal for "config never priced the request". Both to be confirmed/expanded in the full 10-scenario run before fixing.

**Files:** `scripts/hardcore-test/*`, `test-assets/hardcore/*` (gitignored), `.gitignore`

---

### 2026-07-18: V2 Strategy Adopted — Vertical Wedge, Horizontal Engine

**Context:** Full strategic review (codebase audit + verified market research, July 2026) diagnosed five structural flaws behind the two chronic complaints — hard setup and inaccurate quotes: (1) hand-authored pricing DSL forces AI to fuzzy-match language into rigid schemas (root cause of the recurring signal-matching/negation/keyword bug themes below); (2) no outcome→calibration feedback loop despite `quote_amendments` infrastructure; (3) uncertainty handled via review queue/wide ranges instead of in-flow customer confirmation; (4) usage limits unenforced — revenue structurally impossible; (5) WhatsApp intake is a stub while WhatsApp quoting is an empty market category.

**Decision:** Adopted `Docs/06-v2-strategy.md` as north star. Key calls:
- **AD-021: Plain-language pricing compiler.** Businesses describe pricing in natural language; AI compiles it (config-time, reviewable) into the existing deterministic `PricingRules`. Quote-time AI produces only quantities/facts with evidence. Extends AD-001/AD-003; removes the DSL-editing UX, not the rules engine.
- **AD-022: Vertical-first go-to-market on a generic engine.** Launch vertical: painting & decorating (open lane — PaintScout has no AI, no customer widget). Vertical packs are pure configuration (templates, editable rate defaults, vision guidance) — anti-hardcoding principle holds.
- **AD-023: Uncertainty resolves in-flow.** Low-confidence extractions become customer confirmation steps (→ 1.0 confidence per AD-002) plus range-first delivery, instead of defaulting to pending_review.
- Roadmap: Phase 0 billing enforcement (T-101/T-102) before all else; then setup revolution (T-104–106), accuracy engine (T-107–110), WhatsApp intake (T-111–112), painting pack (T-113–115).

**Files:** `Docs/06-v2-strategy.md` (new)

---

### 2026-07-18: T-123 Measurement Memory — the Learning Loop (Measurement Engine COMPLETE)

**Context:** The final Measurement Engine stage: every human-confirmed quantity becomes per-tenant calibration data. The estimator that has measured 200 of this business's jobs measures the 201st better — the moat, operating at the measurement layer.

**Implementation:**
- **Migration 22 `measurement_examples`:** tenant/service/signal + measured_value vs confirmed_value. **TEXT ids with NO foreign keys** — found live that local dev uses TEXT prefixed ids (tnt_...) while production uses UUID (the 2026-02-16 schema split, still real); TEXT holds both, RLS casts `::text` for cross-type safety. Also: block comments inside CREATE TABLE column lists break the supabase migration runner — use `--` line comments.
- **Capture (write side):** the clarify API stores an example whenever a confirmed numeric answer targets a signal the AI had measured (fire-and-forget, never affects the flow). Verified live: answered "60" against measured 27 → row `wall_area_sqm | 27 | 60 | clarification`. Amendment-sourced capture is a follow-up (source enum already supports it).
- **Injection (read side), two channels:** (1) recent examples (≤5/signal) as prompt calibration lines in the measurement passes; (2) **deterministic correction by code (AD-024):** `computeCalibrationFactor` — median confirmed/measured ratio over ≥3 examples, clamped [0.5, 2], <3% treated as noise — applied to the measured value AND its band, with "; calibrated ×1.51 from 3 confirmed jobs" appended to the evidence (faces the customer via the T-122 takeoff).
- **Verified live, full loop:** ×1.51 learned from 3 confirmed jobs → applied 70.5→106.5 → customer's confirmed 60 then overrode everything (AD-002 — the human always wins) and itself became the next example.

**Bug #11 found & fixed (pre-existing, latent — the clarification loop's FOURTH leg):** the clarify API set `status='queued'` but never dispatched the job — answered clarifications would sit queued forever in production. Now calls `enqueueQuoteJob` explicitly; failures leave the queued status visible rather than silently lost.

**Tests:** 5 new calibration tests (bias learning, min-sample, noise threshold, clamping, junk guards). Suite: 243 passing.

**Files:** `supabase/migrations/00000000000022_measurement_examples.sql` (new), `apps/web/src/app/api/public/quotes/[quoteId]/clarify/route.ts`, `apps/worker/src/ai/measurement.ts`, `apps/worker/src/quote-processor.ts`, `apps/worker/src/__tests__/measurement.test.ts`

---

### 2026-07-18: T-122 The Document — Quantity Takeoff, Reference, Grade on the Page

**Context:** The customer-facing document becomes a professional estimate that shows its work — the flagship differentiator no competitor has.

**Implementation:**
- **`apps/worker/src/takeoff.ts` (new, pure):** `buildTakeoff` turns the pricing trace + measurement evidence into customer-facing lines — each with item, quantity × rate, amount, and **method**: the measurement evidence string for AI-measured quantities (the senior surveyor's audit note faces the customer), "Quantity provided by you" for form answers, "Fixed quantity"/"Standard charge" for fixed lines, "Estimated — to be confirmed" for fallbacks. Tax excluded (renders in totals). `buildReference` → deterministic human-facing ref `EST-{year}-{id tail}` (no counters, no migrations).
- **Worker:** takeoff + reference attached to content after wording; stored in content_json.
- **Two AD-016 traps found live and fixed:** BOTH final stores enumerate fields — content_json dropped `takeoff`/`reference` and pricing_json dropped `estimate` until added explicitly. Warning comments left at both sites.
- **Delivery:** public GET passes `takeoff` (withheld while provisional — exact amounts) + `reference`; quote page gains a document header block (Reference · Prepared for · Valid until) and the **Measurement & takeoff** section.

**Live on the user's real quote:** header `EST-2026-5110BD`; takeoff rendered with the senior audit note as the walls method (one run: *"Included only the white rendered sections… deducting all doors and windows; Junior 1 incorrectly claimed to include brickwork…"*). A later weaker run (ensemble failed → envelope fallback) correctly rendered **Ⓒ Concept £1,003–£2,753** with method "Adjusted to typical range 27–108" — the grade honestly tracks each run's evidence quality.

**Tests:** 4 new (`takeoff.test.ts`) — evidence-as-method, form labelling, zero-line/tax exclusion, reference format. Suite: 238 passing.

**Files:** `apps/worker/src/takeoff.ts` (new), `apps/worker/src/quote-processor.ts`, `apps/worker/src/ai/wording.ts`, `packages/shared/src/database.types.ts`, `packages/shared/src/api.types.ts`, `apps/web/src/app/api/public/quotes/[quoteId]/route.ts`, `apps/web/src/app/q/[quoteId]/page.tsx`, `apps/worker/src/__tests__/takeoff.test.ts` (new)

---

### 2026-07-18: T-120 Interval Pricing + Estimate Grades, T-121 VOI Questioning (M6+M7)

**Context:** Quantities stop pretending to be points; quotes stop pretending to be exact. Every quote now declares its precision class (AACE-style) and clarification questions fire only where the money is.

**Implementation:**
- **`packages/shared/src/grading.ts` (new, pure):** `computeEstimateGrade` — **A Confirmed** (every driver human-stated/confirmed, incl. quotes with no AI quantities at all), **B Measured** (measured/adjudicated with confidence ≥ 0.6), **C Concept** (any envelope-based driver or low measured confidence); each grade carries a customer-facing label + description. `isQuestionWorthAsking` — ask when price spread ≥ max(£75, 10% of total): a £200 spread on a £15k job is noise, a £100 spread on a £210 job is not.
- **Bands ride the signals:** `ExtractedSignal.quantityBand` + `basis` set by ensemble (±cov), adjudication (senior band), envelope (bounds). Form-confirmed values are treated as exact regardless of stale bands.
- **Worker:** the pricing call is wrapped in `priceWithSignals(ss)`; interval totals come from deterministic re-runs with band-low/band-high values substituted (exact through multipliers/minimums/tax — no linear approximations). Per-quantity VOI spreads are computed the same way; worthwhile questions append to the clarification list. `pricing.estimate = {grade, label, description, rangeLow?, rangeHigh?}` persists in pricing_json.
- **Delivery:** public GET passes `estimate` through; the quote page shows a grade badge (A green / B black / C amber) + the interval + the grade description under the total.

**Live on the user's real quote — the complete engine in one run:** ensemble passes disagreed on garage inclusion → senior adjudicated ("Junior 1 included the garage but underestimated its side elevation; Junior 2 excluded it entirely") → 32.5 sqm (band 25–40) → interval priced **£960–£1,284** around best **£1,122** → **Grade B (Measured)** → VOI computed £324 spread, cleared the bar → one confirmation question queued. A graded, banded, adjudicated, selectively-questioning estimate.

**Tests:** 10 new (`grading.test.ts`) — grade matrix, VOI bars absolute/relative. Suite: 234 passing.

**Files:** `packages/shared/src/grading.ts` (new), `packages/shared/src/index.ts`, `packages/shared/src/database.types.ts`, `apps/worker/src/ai/measurement.ts`, `apps/worker/src/pricing/rules-engine.ts`, `apps/worker/src/quote-processor.ts`, `apps/web/src/app/api/public/quotes/[quoteId]/route.ts`, `apps/web/src/app/q/[quoteId]/page.tsx`, `apps/worker/src/__tests__/grading.test.ts` (new), `apps/worker/src/__tests__/measurement.test.ts`

---

### 2026-07-18: T-119 Adjudication Tier — Stakes-Based Model Routing (Measurement Engine M4)

**Context:** T-117/118's known frontier was "precision without accuracy" — passes agreeing tightly on the wrong scope. M4 adds the senior reviewer: a stronger model that resolves the CAUSE of disagreement, routed by stakes.

**Implementation:**
- **`decideAdjudication` (pure, tested):** escalate when cov > `MEASUREMENT_COV_THRESHOLD` (0.15), when only one usable pass, or when the provisional step value ≥ `ADJUDICATION_VALUE_THRESHOLD` (1000) — **measurement spend scales with the money at stake.**
- **`adjudicateMeasurement`:** the senior model (`ADJUDICATION_MODEL`, default `gemini-pro-latest` — found live that `gemini-2.5-pro` is closed to newer API keys) receives every junior pass's value/anchor/reasoning + the photos, with an explicit brief: do NOT average — resolve WHY they differ, re-examine the photos, produce final value + honest low–high band + one-sentence `scopeResolution` for the audit trail. Confidence derives from the adjudicator's band width (measured semantics preserved); failure returns null and the ensemble median stands — never blocks.
- Gemini client factory accepts `{model, maxTokens}`; raw passes retained on `MeasuredQuantity.rawPasses`.

**Live result on the user's real quote — the flagship demo of the whole engine:** 3 passes disagreed wildly (median 52, cov 0.91) → routed `high_variance` → senior model resolved: *"Included only the white rendered surfaces (main house front/sides, garage front and side) as brick is not typically painted; Junior 1 and 3 incorrectly included unpainted brickwork, while Junior 2 missed the garage side elevation"* → final 38.5 sqm (band 32–45) → quote sent at **£1,251.60** with the audit note stored as the measurement's evidence. The senior model applied domain judgment (paintable render vs unpainted brick) that no averaging could produce. T-122 will surface this note on the customer document's takeoff table.

**Tests:** 7 new (routing matrix; adjudication merge with band-derived confidence; failure/nonsense guards). Suite: 224 passing.

**Files:** `apps/worker/src/ai/measurement.ts`, `apps/worker/src/ai/gemini.ts`, `apps/worker/src/quote-processor.ts`, `apps/worker/src/index.ts`, `apps/worker/src/__tests__/measurement.test.ts`

---

### 2026-07-18: T-117 Ensemble Extraction + T-118 Anchored Takeoff (Measurement Engine M2+M3)

**Context:** Replaces single-shot quantity guessing for ai_signal quantities. New module `apps/worker/src/ai/measurement.ts`; runs ONLY for services with ai_signal quantity sources (zero extra cost for other quotes), between extraction and form merge (customer answers still win, AD-002) and before envelopes (implausible medians still caught).

**T-118 — reference-anchored takeoff:** the prompt forbids absolute eyeballing; the model finds a known-size reference in the photos (door 1.98 m, brick course 75 mm, fence panel 1.83 m…) and reports the target in REFERENCE MULTIPLES; code computes metres/areas (`computeAnchoredValue` — AD-024 for vision). Reference dimensions are physical constants in code (a UK door is a UK door), not business config; pack overrides can come later.

**T-117 — ensemble:** N passes (`MEASUREMENT_PASSES` env, default 3) at temperature 0.7; `computeEnsembleStats` → median + coefficient of variation → MEASURED confidence bands (cov ≤ 0.08 → 0.9 … > 0.3 → 0.35). Self-reported model confidence is no longer used for quantities. Evidence string carries the method: "Measured across 3 independent passes (spread ±8%), anchored to entry door height". Individual pass failures tolerated; zero usable passes → envelope fallback takes over.

**Gemini client:** `generateWithImagesAndSchema`/`generate` accept per-call `{temperature, maxOutputTokens}` — found live that Gemini 2.5 thinking tokens count against maxOutputTokens, truncating JSON mid-string at the 4096 default; measurement passes now run at 16384 with reasoning capped to two sentences.

**Live end-to-end on the user's real quote — the full stack in concert:** ensemble measured 21.8 sqm (2 usable passes, cov 0.08 — precise but scope-limited: the model consistently measured a SUBSET of the elevation) → envelope said implausible for 3 storeys → clamped to the 27 floor → priced provisionally (£1,003) → gate routed to clarification: "we estimated wall area sqm: 27. Is that right?" → customer's answer reprices exactly. The £480 silent-failure is now an honest provisional + one question.

**Known frontier (by design, next tickets):** tight ensemble agreement on the WRONG SCOPE (measuring part of the elevation) is precision without accuracy — exactly what M1 scene inventory + T-119 adjudication (a stronger model resolving what each pass included/excluded) exist to fix.

**Tests:** 11 new (`measurement.test.ts`) — anchored geometry (prefers computation over model guess), ensemble bands, pass-failure tolerance, no-target short-circuit. Suite: 217 passing.

**Files:** `apps/worker/src/ai/measurement.ts` (new), `apps/worker/src/ai/gemini.ts`, `apps/worker/src/quote-processor.ts`, `apps/worker/src/index.ts`, `apps/worker/src/__tests__/measurement.test.ts` (new)

---

### 2026-07-18: Measurement Engine Adopted (V3 estimation core) + T-116 Plausibility Envelopes

**Context:** User verdict after live testing: "same system, slightly improved" — correct about the estimation core. V2 rebuilt the workflow around the estimator; the core itself remained a single-shot vision guess with self-reported confidence (proven by 50 vs 60 sqm run-to-run variance on identical photos). Adopted `Docs/07-measurement-engine.md` as the estimation north star: reference-anchored measurement, ensemble variance as confidence, stakes-based model routing (measurement spend scales with estimate value), plausibility envelopes, interval pricing with declared AACE-style estimate grades (C Concept / B Measured / A Confirmed), value-of-information questioning, per-tenant measurement memory, and a Goldman-grade document with a quantity-takeoff table showing HOW each quantity was measured. New tickets T-116–T-123.

**T-116 implemented — Plausibility Envelopes (M5):**
- **`packages/shared/src/envelopes.ts` (new, pure math):** `computeEnvelope` (bounds scaled by a known driver, e.g. wall area = storeys × [9..36] sqm/storey, with absolute caps) + `enforceEnvelope` (accepted / clamped / fallback_injected) + comma-aware `coerceQuantity`.
- **Envelope rules ship as pack DATA** on `ExpectedSignalConfig.envelope` — rides existing `expected_signals` persistence end-to-end, zero migrations, anti-hardcoding intact. Painting pack: `wall_area_sqm` envelope added.
- **Worker integration (BEFORE pricing — ordering matters, the gate runs after pricing):** for every ai_signal quantity with an envelope: implausible measurements are CLAMPED to the nearest bound; missing measurements get the envelope MIDPOINT injected (evidence: "Estimated from typical range X–Y for this property", confidence 0.4). Both cases are added to `missingQuantitySignals` → customer clarification. **The envelope makes the quote sane; the customer makes it exact.** The bug-#10 guard also moved pre-pricing and now reads the same work-step source as the engine (`service.work_steps || rules.workSteps` — was inconsistently `rules.workSteps`).
- **Structural result:** the £480 failure class is impossible three ways — quantity-1 clamps to the plausible floor, missing measurements price at the envelope midpoint with a clarification, absurd readings (photo of the wrong thing) clamp to the ceiling. Tested for exactly these three paths.

**Tests:** 10 new (`envelopes.test.ts`) — driver scaling, defaultDriver, absolute caps, the three kill-paths of the live £480 quote, string coercion. Suite: 206 passing.

**Files:** `Docs/07-measurement-engine.md` (new), `packages/shared/src/envelopes.ts` (new), `packages/shared/src/database.types.ts`, `packages/shared/src/index.ts`, `apps/web/src/lib/vertical-packs/painting.ts`, `apps/worker/src/quote-processor.ts`, `apps/worker/src/__tests__/envelopes.test.ts` (new)

---

### 2026-07-18: Bug #10 — Missing/String AI Quantity Signals Priced Silently Wrong (found by user testing)

**Context:** User submitted a real Exterior Painting quote (3-storey front elevation) and asked "is this accurate?". It was not: **"Exterior walls: 1 sqm × £18 = £18"**, total £480 (minimum charge masking a £368 calculation). Correct total after fix: **£1,716** — a 3.6× under-quote that sailed through every guard with gate action `send`. The flagship failure mode the accuracy engine exists to prevent.

**Two root causes, both fixed:**
1. **Missing quantity signals bypassed all guards.** The walls step prices per-sqm from `ai_signal: wall_area_sqm`. When extraction produces NO such signal, the engine falls back to quantity 1 and marks `quantityTrusted: false` in the trace — but the quality gate only inspects `lowConfidenceSignals`, and a MISSING signal is never in that list. Fix: processor detects work steps whose ai_signal quantity is absent/non-numeric in fused signals → passes `missingQuantitySignals` to the gate → gate routes them to customer clarification FIRST (they're structurally wrong, not merely uncertain), producing a text question via the existing T-108 machinery; the answer merges back as a confidence-1.0 signal and the step prices correctly on reprocess. One-round cap respected.
2. **String-typed AI quantities were rejected.** On reprocess Gemini returned `wall_area_sqm: "50"` (string) — the engine's `typeof value === 'number'` check discarded a valid extraction and silently priced quantity 1. The ISSUE-2 lesson (coerceToNumber for comma-aware string parsing) was applied to form-field quantities but never to the ai_signal paths. Fix: both ai_signal quantity sites (per_unit + per_hour) now coerce string values.

**Live re-verified on the user's actual quote:** reprocessed through the fixed pipeline → "Exterior walls £18 × 60 (sqm) = £1,080", subtotal £1,430, total £1,716, breakdown label now shows the quantity transparently. (60 sqm remains an AI estimate at ~0.7 confidence — site-visit note retained; T-110 calibration will tune over time.)

**Tests:** 5 new (3 quality-gate: missing-quantity clarification without Gemini, usable-signal pass-through, one-round cap; 2 engine: string coercion to 50×£18=£900, true-missing fallback to 1×£18). Suite: 196 passing.

**Files:** `apps/worker/src/quote-processor.ts`, `apps/worker/src/agents/quality-gate.ts`, `apps/worker/src/pricing/rules-engine.ts`, `apps/worker/src/__tests__/quality-gate.test.ts`, `apps/worker/src/__tests__/quote-processing.test.ts`

---

### 2026-07-18: Verification Findings Fixed (all live re-verified)

**Context:** Fixes for every open finding from the live verification below, each re-verified in the running app.

1. **Quote page: auto-applied addons now render honestly.** They're part of the subtotal, so they appear in the main breakdown with an "Added for you — {reason}" annotation and an opt-out note, instead of a "Recommended Add-ons /each — contact us to add" panel. Breakdown lines now sum to the subtotal exactly (re-verified: 60+600+120+156 = £936). The truly-optional `availableAddons` section is unchanged.
2. **Pricing compiler: "raise the room rate to £220" now works — root cause was NOT the prompt.** Instrumentation showed Gemini returning `updatedConfig` shaped like the CONTEXT wrapper (`{config, addons, multipliers}`) — the real config sat at `updatedConfig.config` where the merge never looked, so edits were applied-then-lost. Fixes: (a) context keys renamed (`currentDraftConfig`/`currentAddons`/`currentMultipliers`) so they can't mirror into the response shape; (b) defensive unwrap of nested `config`/`addons`/`multipliers`; (c) response contract now REQUIRES a per-instruction accounting array (`instructions: [{instruction, action: applied|ambiguous, target}]`, logged server-side) — silent skips are structurally impossible; (d) prompt rule 1b maps colloquial references ("room rate", "call-out fee") to existing config items or asks. Re-verified live: "£220 per room" in the review, rush addon intact.
3. **No-subscription plan-limit default unified.** Analytics showed 200 ("Free Plan") while enforcement/billing used 50 — all three now use `DEFAULT_TRIAL_LIMIT` from `lib/plan-limits` (analytics label now "Free trial").
4. **Composer currency symbol** — services page fetches tenant currency and passes the symbol; £ tenants no longer see $.
5. **WorkStepEditor infinite render loop (pre-existing, found via 410 console errors during verification):** `numberQuestions` was a fresh `.filter()` array each render, re-firing a setState effect endlessly. Memoized; console now clean with the editor mounted.
6. **False alarm corrected:** the service wizard DOES preserve `requiredAngles` on re-save (media_config round-trips wholesale) — no fix needed; noted so it isn't "re-fixed".
7. **Deliberately not changed:** signup still creates no subscriptions row — the unified default (fix 3) makes trial behavior consistent, and the subscription row is properly created at checkout. Revisit only if trial mechanics need their own plan record.

**Files:** `apps/web/src/app/q/[quoteId]/page.tsx`, `apps/web/src/app/api/services/ai-draft/compile/route.ts`, `apps/web/src/app/api/analytics/route.ts`, `apps/web/src/app/api/billing/route.ts`, `apps/web/src/app/(dashboard)/app/services/page.tsx`, `apps/web/src/components/services/PricingComposer.tsx` (prop already existed), `apps/web/src/components/WorkStepEditor.tsx`

---

### 2026-07-18: Live End-to-End Verification (local stack + real Gemini)

**Context:** First live run of the entire V2 build: local Supabase (migrations 19–21 applied), Next dev, wrangler dev worker, real Gemini. Full journey driven through the browser: signup → painting template onboarding → widget submission with photo → worker pipeline → hosted quote → plan-limit probe → calibration/benchmarks → pricing composer.

**Verified working end-to-end:** painting landing page; signup+tenant trigger; onboarding template flow (3 services created); pack fields in widget; photo upload + T-107 quality gate; full worker pipeline — Gemini structured extraction (confidence 0.8), AD-002 form overrides (ceiling_height form beat vision), AI addon detection (woodwork auto-applied from customer phrasing), slugified-option multiplier normalization, **pricing penny-exact: (60+600+120)×1.2×1.2 VAT = £1123.20**; T-109 success-state polling flipped to "Your quote is ready!"; hosted quote page with Gemini scope wording; T-101 429 at limit + red dashboard banner; T-110 outcomes table; T-115 opt-in + k-anonymity empty state; T-104 composer round-trip English + live compile (rush addon compiled with sensible trigger keywords).

**Bugs found & fixed (commit f555fd2):**
1. `PATCH /api/tenant` → 405 (route exports PUT) — broke onboarding finish + benchmark opt-in; error path also crashed on empty body. Both call sites → PUT; error parsing guarded.
2. `requiredAngles` dropped at service creation (onboarding + bulk import) — guided-capture slots never rendered for pack services.

**Open findings (not yet fixed):**
- Quote page renders auto-applied addons in "Recommended Add-ons" as if optional while their amount is already in the subtotal — visible lines don't sum to subtotal (£816 shown vs £936). Trust-damaging; needs a breakdown-rendering fix.
- Compiler missed "Raise the room rate to £220" (kept $200, no ambiguity raised) while nailing the rush-service addon — prompt needs strengthening on mapping colloquial rate references to existing work steps, or must ask.
- Analytics "Monthly Usage" defaults to limit 200 ("Free Plan") while enforcement/billing default to 50 — inconsistent no-subscription defaults; unify into one shared constant.
- Service wizard has no requiredAngles editor and re-saving may drop angles (same class as fix #2).
- Composer/wizard shows "$" regardless of tenant currency (£ tenants see $).
- Signup creates NO subscriptions row — plans/overage all ride on defaults until checkout.
- Local-env only: `handle_new_user` trigger needed `search_path = public, extensions` (gen_random_bytes); auth verification emails don't reach Mailpit.

**Not yet exercised live:** T-108 clarify UI end-to-end (gate correctly chose 'send' at 0.8 confidence), Stripe overage metering (needs Meter ops), WhatsApp intake (needs Meta credentials), website extraction endpoint.

---

### 2026-07-18: T-115 — Cross-Tenant Rate Benchmarks (V2 roadmap complete)

**Context:** Final V2 roadmap ticket. "Similar decorators charge £10–14/sqm" — anonymized market context that becomes more valuable as painting tenants accumulate. Informational only; never feeds pricing (AD-001).

**Privacy model (the core of this ticket):**
- **Opt-in with reciprocity:** you see benchmarks only while sharing your own rates (`tenants.benchmarks_opt_in`, migration 21, default false). Opt-in happens at the point of value (analytics page) with explicit copy about what's shared.
- **k-anonymity:** a benchmark requires ≥3 distinct OTHER tenants; below that, nothing renders.
- **Per-tenant dedup:** one representative rate (median of their matching steps) per tenant per group — a tenant with many similar steps can neither skew the distribution nor bypass the k threshold.
- **Same-currency only** — mixing GBP/USD would corrupt medians.
- Cross-tenant reads use the admin client server-side, but ONLY aggregates (P25/median/P75 + tenant count) leave the endpoint.

**Implementation:**
- **`packages/shared/src/benchmarks.ts` (new):** pure math — `normalizeUnitLabel` (sqm/sq m/m2/square metre → one key; rooms/hours/walls likewise), `serviceTokens` (stopword-filtered name matching), `computeBenchmarks` (grouping + percentiles + guards).
- **`GET /api/learning/benchmarks` (new):** requester's per-unit work-step rates vs. opted-in same-currency tenants' comparable services (unit match + name-token overlap). Returns `{optedIn, benchmarks}`.
- **`PATCH /api/tenant`:** accepts `benchmarksOptIn`.
- **Analytics page:** "Market Benchmarks" card — opt-in prompt → "Similar businesses charge 15–22 per sqm (median 19). You charge 18." with in/below/above-range coloring, sample counts, and "benchmarks never change your pricing" footer.
- Shared `PricingRules` type now declares `workSteps?` (was persisted-but-untyped, AD-016 pattern — now typed).

**Tests:** 10 new (`benchmarks.test.ts`) — k-anonymity enforcement, per-tenant dedup under adversarial shapes, unit-variant matching, token filtering, zero-rate guards. Full suite: 191 passing.

**Files:** `supabase/migrations/00000000000021_benchmarks_opt_in.sql` (new), `packages/shared/src/benchmarks.ts` (new), `packages/shared/src/index.ts`, `packages/shared/src/database.types.ts`, `apps/web/src/app/api/learning/benchmarks/route.ts` (new), `apps/web/src/app/api/tenant/route.ts`, `apps/web/src/app/(dashboard)/app/analytics/page.tsx`, `apps/worker/src/__tests__/benchmarks.test.ts` (new)

---

### 2026-07-18: T-114 — Painting & Decorating Pack + Landing Page (Phase 4, V2 Strategy)

**Context:** The launch vertical (decided 2026-07-18, strategy §3). First pack in the T-113 registry, and the vertical landing page carrying the speed-to-lead pitch. All pack content is editable-default DATA in GBP; no vertical logic entered the engine.

**Pack contents (`lib/vertical-packs/painting.ts`):** three services designed to exercise every accuracy-engine system:
- **Interior Painting** — per-ROOM pricing (customers can answer room counts exactly → form_field quantity source): £200/room walls & ceilings + £60 base + £250 minimum; heavy-prep step (£150) auto-triggers when photos show `prep_level = heavy`; high-ceiling multiplier ×1.2 from a customer question; woodwork/feature-wall addons with trigger keywords. Guided angles: wide shot per room + damage close-ups.
- **Exterior Painting** — per-SQM pricing from **AI wall-area estimation** (customers can't measure render → ai_signal quantity source, deliberately exercising vision + the T-108 confirm step): £18/sqm + £100 base + £400 minimum; access-equipment step (£250) triggers at `storeys >= 2`; roofline/front-door addons. Guided angles: full elevation per side, ground-to-roof.
- **Wallpapering** — per-wall (£140/wall), optional per-wall removal step triggered by a customer boolean, we-supply multiplier ×1.15, lining-paper addon.
- Every quantity-bearing field carries `mapsToSignal` so form answers hit the canonical signal keys (the FIX-1 mapping path); expectedSignals give strict extraction schemas + T-108 confirmation targets.

**Landing page (`/painting`, static):** Editorial Black style; hero "Quote every job in 60 seconds" + "Your rates set the price — never the AI"; verified stats band ONLY (40% never respond / 95% miss 5-min / 21× — with sources; the debunked stats from strategy §2 are not used); 4-step how-it-works; deterministic-pricing trust section; feature grid; CTAs to /signup and /demo.

**Files:** `apps/web/src/lib/vertical-packs/painting.ts` (new), `apps/web/src/lib/vertical-packs/index.ts`, `apps/web/src/app/painting/page.tsx` (new)

---

### 2026-07-18: T-113 — Vertical Pack Infrastructure (Phase 4, V2 Strategy)

**Context:** AD-022 (vertical-first go-to-market on a generic engine). A pack is pure DATA — service templates with scope, media guidance, guided-capture angles (feeds T-107), default rates, expected signals, and customer questions — applied at onboarding as pre-filled, fully editable config. Anti-hardcoding holds: packs are content files, the engine never special-cases a vertical.

**Implementation:**
- **`apps/web/src/lib/vertical-packs/types.ts` (new):** `VerticalPack`/`VerticalPackService` — each service carries a complete `ServiceDraftConfig` plus addons/multipliers. Pack rates are documented as EDITABLE DEFAULTS, never authoritative.
- **`apps/web/src/lib/vertical-packs/index.ts` (new):** registry (`listPacks`/`getPack`). Adding a vertical = one data file + one registry line. Registry ships empty; T-114 adds painting.
- **Onboarding interview:** third source option "Use a template" (shown only when packs exist) → pack picker → services flow into the existing review → basics → create pipeline with **no network and no AI** — the fastest possible setup path. Pack services arrive priced (typical rates), so the pricing interview is skipped; the picker copy tells the business to review rates.

**Design notes:**
- Packs as data files (not a DB table): versioned with the code, zero migration, reviewable in PRs. A DB-backed pack store is a v2 option if packs ever become admin-editable.
- `promptContext` exists on the pack type but is NOT sent on creation — the platform auto-generates AI vision context from pricing rules by design (services API explicitly rejects frontend prompt_context). Pack vision influence flows through requiredAngles/photoGuidance/expectedSignals/workSteps, which the auto-generation reads.

**Files:** `apps/web/src/lib/vertical-packs/types.ts` (new), `apps/web/src/lib/vertical-packs/index.ts` (new), `apps/web/src/components/onboarding/OnboardingFlow.tsx`

---

### 2026-07-18: T-112 — Guided WhatsApp Onboarding (Phase 3 complete, V2 Strategy)

**Context:** The WhatsApp page was a raw credentials form ("paste your access token") with no validation — the audit flagged it as a setup-abandonment point. Full Meta Embedded Signup requires tech-provider approval (ops track, not code); this ticket delivers the best code-side experience: a guided walkthrough with live credential verification.

**Implementation:**
- **`POST /api/whatsapp/verify` (new):** validates credentials against the Graph API (`GET /{phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`, read-only, nothing persisted). Two modes: pre-save verification of new credentials, and `{useStored: true}` to health-check the saved connection (decrypts the stored token server-side). Meta's cryptic errors are translated: code 190 → "token invalid/expired, generate a permanent token in System Users"; code 100 → "you pasted the phone number, not the Phone Number ID".
- **Verify-before-save:** the connect form now verifies with Meta BEFORE persisting — bad credentials fail at setup time with a clear message, not at the first customer message. Verified display number auto-fills if left blank.
- **"Test Connection"** button on the status card → re-verifies the stored connection, reports verified name + quality rating.
- **Guided 3-step walkthrough** (replaces the old instructions block): (1) create Meta app + add WhatsApp, with deep links; (2) webhook configuration with copy-buttons for the exact Callback URL and verify token (now served by the config GET — auth'd route; the verify token is a handshake string, not a credential); (3) where to find the Phone Number ID and how to mint a PERMANENT system-user token (explicitly warns off the 24h temporary token — the most common setup failure).

**Known constraint:** Meta Embedded Signup (OAuth-style one-click connect) remains a v2 ops item — requires Meta tech-provider review. The walkthrough + verification is the practical ceiling without it.

**Files:** `apps/web/src/app/api/whatsapp/verify/route.ts` (new), `apps/web/src/app/api/whatsapp/config/route.ts`, `apps/web/src/app/(dashboard)/app/whatsapp/page.tsx`

---

### 2026-07-18: T-111 — WhatsApp Conversational Intake End-to-End (Phase 3, V2 Strategy)

**Context:** WhatsApp quoting is an empty market category (V2 strategy §1: inbound conversations are free since Meta's July 2025 pricing change; Meta's Business Agent can't do configured priced quotes). The T-023 intake state machine and webhook wiring existed, but the flow had two defects that made real quotes impossible.

**Bugs found & fixed (pre-existing, latent — fourth and fifth of the audit):**
1. **WhatsApp photos never reached R2.** `handleMediaUpload` downloaded media from WhatsApp and inserted the asset ROW, but never wrote the bytes to R2 (a comment said "Upload to R2 via the upload API" above code that didn't). The worker later fetched nothing — every WhatsApp photo silently vanished from AI extraction. Now: `uploadToR2()` runs BEFORE the asset row is created (no phantom assets); upload failure tells the customer to resend rather than pretending success.
2. **No job description was ever collected** — `job_answers` was hardcoded `[]`, so AI extraction had zero text signal and WhatsApp quotes priced from base fees alone.

**Implementation:**
- **New `awaiting_description` state** (after service selection): "Briefly describe the job — sizes, quantities or any details help us quote accurately" (min 10 chars). Stored as the `_project_description` form answer — the exact fieldId the worker's triage and signal extraction already read, so the whole pipeline (signals, addons, cross-service, T-108 confirmations) lights up with no worker changes.
- **Any first message starts the flow** — previously a magic keyword ("quote"/"estimate") was required and "Hi, do you paint houses?" got a canned nudge. A dedicated business WhatsApp number exists to quote. Keyword re-trigger kept for the completed state.
- Confirmation summary includes the job description (truncated at 80 chars).
- Flow order: any message → service selection (auto-skips for single-service tenants) → description → name → email → phone (skip = WhatsApp number) → address → photos → confirm → quote link delivered in-thread. With T-109, that link shows the provisional range immediately and the T-108 confirm flow when needed — WhatsApp inherits the full accuracy engine.

**Not done (noted for T-112):** guided WhatsApp Business API onboarding (credentials form remains raw); proactive in-thread "your final quote is ready" push from the worker (the in-thread link + hosted page live-updating covers the gap for v1).

**Files:** `packages/shared/src/database.types.ts`, `apps/web/src/lib/whatsapp-intake.ts`

---

### 2026-07-18: T-102 — Metered Overage Billing (Phase 0 complete, V2 Strategy)

**Context:** Completes Phase 0 (deferred at T-101). The hard block at the plan limit converts worse than "keep quoting, pay per extra quote" — every blocked quote is a lost lead for the business and lost revenue for the platform. Uses Stripe's modern **Billing Meter Events API** (supported by the installed stripe v20 SDK), not the deprecated usage-records API.

**Behavior matrix:**
| Tenant state | At limit |
|---|---|
| Free/trial, or plan without overage | Hard block (T-101 unchanged) |
| Active paid plan with `overage_price_cents` + metered price | Quote proceeds, one meter event billed |

**Implementation:**
- **Migration 20:** `plans.overage_price_cents` (null = no overage) + `plans.stripe_metered_price_id`. Additive only.
- **`lib/stripe.ts`:** `createCheckoutSession` attaches the metered price as a second line item (no quantity — Stripe requirement); `reportOverageMeterEvent()` posts to `billing.meterEvents` with **the quote ID as `identifier`** — Stripe dedupes on it, so retries/replays can never double-bill.
- **`lib/plan-limits.ts`:** `PlanLimitStatus` gains `overageAvailable`/`overagePriceCents`/`stripeCustomerId`. Overage requires ALL of: overage price on plan, metered price configured, subscription status `active` (never trialing — metering a trial bills nothing), Stripe customer present. `recordOverageQuote()` meters fire-and-forget: **a metering failure never fails the quote** (absorb the cost rather than lose the lead) but logs `OVERAGE NOT BILLED` loudly.
- **Both intake points** (public quotes API, WhatsApp): over-limit + overage → proceed and meter after quote creation.
- **Surfaces:** limit-reached email switches to "Quoting continues — extra quotes billed at $X each"; dashboard banner becomes amber "overage billing active" instead of red "paused"; billing page shows overage rate + overage count this period. `PlanInfo`/`BillingUsage` extended.
- `STRIPE_OVERAGE_METER_EVENT` env (default `estimate_overage`) added to both `.env.example`s.

**Stripe setup required (ops, not code):** create a Meter named per `STRIPE_OVERAGE_METER_EVENT`, create a metered price on it per plan, set `plans.stripe_metered_price_id` + `overage_price_cents`. Existing subscriptions need the metered item added (new checkouts get it automatically).

**Known constraints:** overage price display assumes USD (consistent with existing billing UI hardcoding — multi-currency billing remains v2 backlog). Proration on plan change is delegated to Stripe's defaults via the existing checkout/portal flows.

**Files:** `supabase/migrations/00000000000020_plan_overage.sql` (new), `apps/web/src/lib/stripe.ts`, `apps/web/src/lib/plan-limits.ts`, `apps/web/src/lib/email-templates.ts`, `apps/web/src/app/api/public/quotes/route.ts`, `apps/web/src/lib/whatsapp-intake.ts`, `apps/web/src/app/api/billing/route.ts`, `apps/web/src/app/api/billing/checkout/route.ts`, `apps/web/src/app/(dashboard)/app/billing/page.tsx`, `apps/web/src/app/(dashboard)/app/page.tsx`, `packages/shared/src/api.types.ts`, `.env.example`, `apps/web/.env.example`

---

### 2026-07-18: T-110 — Outcome Calibration Loop (Phase 2 complete, V2 Strategy)

**Context:** The moat ticket (V2 strategy Flaw 2): amendment/acceptance data was collected but never fed back into pricing. Existing infra: `quote_amendments` stores `before_pricing`/`after_pricing` snapshots; `/api/learning/analyze` (fired on quote PATCH) detects patterns for AI wording context. Missing: actionable pricing suggestions and a business-facing surface.

**Implementation:**
- **`packages/shared/src/calibration.ts` (new):** deterministic calibration math (no AI anywhere). Per service, over recent outcomes:
  - *raise_rates / lower_rates:* ≥3 amendments with ≥70% direction consistency and |median delta| ≥5% → "Your {service} quotes are usually raised ~15% before sending" with a `suggestedAction` phrased for the T-104 composer ("Increase all my rates for {service} by about 15%") — the calibration loop's apply path IS the plain-language compiler.
  - *price_check:* acceptance <30% over ≥5 sent quotes (suppressed when lower_rates already fired — same root cause).
  - *review_burden:* ≥50% of processed quotes stuck in pending_review → suggests adding required photos/questions to raise AI confidence (the threshold-tuning signal).
  - Guards: minimum sample sizes throughout, zero-beforeTotal amendments ignored, sub-5% medians treated as noise.
- **`GET /api/learning/calibration` (new):** computes live from the last 90 days (500 quotes / 200 amendments max) — no new tables, no stale state, no migration.
- **Analytics page:** "Pricing Insights" cards (headline, detail, the exact composer phrase to apply, link to services) + a "Quote Outcomes by Service" table (sent / accepted / acceptance % / median edit before send). Explicit copy: "Suggestions only — nothing changes unless you apply it" (AD-001).

**Design decisions:**
- Calibration NEVER auto-applies — AD-001 is absolute. The suggestion's apply path is the business speaking to the pricing composer, keeping a human decision plus deterministic compilation between data and price.
- Live computation over persisted aggregates: at current scale (hundreds of quotes/tenant) the query is cheap, and it can't drift stale. Revisit if a tenant exceeds ~500 quotes/90 days.
- Math lives in `@estimator/shared` so the worker's vitest suite covers it (web has no test infra).

**Tests:** 11 new (`apps/worker/src/__tests__/calibration.test.ts`) covering all suggestion rules, noise guards, and per-service isolation. Full suite: 181 passing.

**Files:** `packages/shared/src/calibration.ts` (new), `packages/shared/src/index.ts`, `apps/web/src/app/api/learning/calibration/route.ts` (new), `apps/web/src/app/(dashboard)/app/analytics/page.tsx`, `apps/worker/src/__tests__/calibration.test.ts` (new)

---

### 2026-07-18: T-109 — Range-First Quoting (Phase 2, V2 Strategy)

**Context:** When a quote paused for clarification or business review, the customer got nothing — no price signal at all until an email arrived. Range-first principle: an instant estimated range always, the exact quote when it's final. Also fixed a third latent clarification bug (see T-108 for the first two).

**Bug found & fixed (pre-existing, latent):** the public quote GET never returned `clarificationQuestions` — the clarify page fetched them from this endpoint and always fell into "No questions found for this quote". Combined with T-108's findings, the entire clarification feature had never worked end-to-end: questions couldn't load, answers weren't read, and the round cap was never counted. All three legs now fixed and typed (`QuoteViewResponse.clarificationQuestions`).

**Implementation:**
- **Worker:** the awaiting_clarification early-return now also stores `pricing_json` + `content_json` (pricing is already computed by the time the gate runs) — provisional pricing exists the moment the pipeline pauses.
- **Public GET** (`/api/public/quotes/[quoteId]`): for provisional statuses (awaiting_clarification / pending_review) exact figures are WITHHELD (subtotal/total zeroed, breakdown empty) and a `provisional: { rangeLow, rangeHigh, reason }` field is returned instead — the engine's confidence-based range when present, else ±12% rounded to 10s. Rationale: showing an exact price that the business may then amend erodes trust; a range makes revision expected. `acceptQuoteEnabled` forced false while provisional.
- **Hosted quote page** (`/q/[quoteId]`): provisional quotes render a dedicated view — big range display, then: awaiting_clarification → "Confirm Details → Get Exact Quote" CTA into the T-108 confirm flow; pending_review → "[Business] is double-checking your quote — final version by email shortly." No accept/PDF/feedback surfaces.
- **Widget SuccessState:** polling now captures the provisional range — the customer sees "£450 – £620" within seconds of submission, with the confirm CTA (awaiting_clarification) or "we're double-checking the details" (pending_review). The 5-minute speed-to-lead window is satisfied even when the final quote needs review.

**Design decision:** the range is computed from stored deterministic pricing, never invented at display time by AI — display-layer code only formats what the engine produced (consistent with AD-001/AD-024).

**Files:** `apps/worker/src/quote-processor.ts`, `packages/shared/src/api.types.ts`, `apps/web/src/app/api/public/quotes/[quoteId]/route.ts`, `apps/web/src/app/q/[quoteId]/page.tsx`, `apps/web/src/app/embed/[tenantKey]/page.tsx`

---

### 2026-07-18: T-108 — Quantity Confirmation In-Flow (Phase 2, V2 Strategy)

**Context:** Uncertainty was handled at the wrong moment (V2 strategy Flaw 3) — low-confidence extractions went to review queues or wide ranges instead of being resolved by the customer while they're still present. T-108 turns the existing clarification checkpoint into a one-tap confirmation flow — and fixed two latent bugs that made the existing loop non-functional.

**Bugs found & fixed (pre-existing, latent):**
1. **Clarification answers were never read.** The clarify API stored `clarification_answers_json` and re-queued the quote, but the worker never loaded the field — reprocessing re-ran extraction identically and answers had ZERO effect on the quote. Customers answered questions into a void.
2. **`clarification_count` was never projected.** `loadQuoteData()` returned a 6-field projection of the quote; the gate's loop-cap read `quoteData.quote.clarification_count` which was always undefined → 0. The "max 1 round" cap only worked by accident of bug #1 (answers being ignored meant status flow still terminated). Both clarification fields + count are now in the projection.

**Implementation:**
- **Worker — answers merge as customer signals** (`quote-processor.ts` step 1.2): on reprocess, each clarification answer maps via its question's `targetSignalKey` to a synthetic form answer appended to `job_answers` (replacing any prior answer for that key — the clarification is the customer's most recent statement). This inherits the entire AD-002 pipeline untouched: confidence 1.0, form-wins fusion, conflict provenance, lowConfidence regeneration. Numeric answers coerced with comma-separator handling (the "1,500" lesson).
- **Quality gate — deterministic confirm-value questions** (`quality-gate.ts`): when a low-confidence signal HAS an extracted value, the question is built by CODE (AD-024): "From your photos and details, we estimated room count: 4. Is that right?" with `type: 'confirm_value'`, `aiValue`, and the vision `evidence`. No Gemini call needed. AI-generated free-text questions remain only for valueless signals. `ClarificationQuestion` gains optional `type`/`aiValue`/`evidence` (backwards compatible).
- **Clarify page** (`/q/[quoteId]/clarify`): confirm_value questions render as "✓ Yes, 4 is right" / "No, let me correct it" (reveals input), with the AI's evidence shown ("What we saw: …") for trust.
- **Widget in-flow continuation** (`embed/[tenantKey]/page.tsx` SuccessState): after submission the widget polls quote status (3s interval, ~60s budget, `&poll=1` so polling doesn't trip the sent→viewed analytics transition — guard added to the public GET). If the quote needs confirmation, the customer — still present — sees "One quick check" routing straight to the confirm page; when the quote sends, the panel flips to "Your quote is ready!". Email remains the fallback for customers who leave.

**Tests:** 2 new quality-gate tests (confirm_value construction without Gemini; text fallback for valueless signals). Full worker suite: 170 passing.

**Files:** `packages/shared/src/database.types.ts`, `apps/worker/src/agents/quality-gate.ts`, `apps/worker/src/quote-processor.ts`, `apps/web/src/app/q/[quoteId]/clarify/page.tsx`, `apps/web/src/app/api/public/quotes/[quoteId]/route.ts`, `apps/web/src/app/embed/[tenantKey]/page.tsx`, `apps/worker/src/__tests__/quality-gate.test.ts`

---

### 2026-07-18: T-107 — Guided Photo Capture & Image Pre-Validation (Phase 2, V2 Strategy)

**Context:** First "accuracy engine" ticket. Bad photos silently produced bad estimates — vision confidence drops, counts go wrong, and nothing told the customer their photo was unusable (V2 strategy Flaw 3 / pipeline audit "photo quality assumptions"). Fix: guide the shot before it's taken, validate it before it's uploaded.

**Implementation:**
- **`apps/web/src/lib/image-quality.ts` (new):** browser-side `assessImageQuality(file)` — decodes to a downscaled canvas (max 320px) and checks: resolution (< 480px shortest side = HARD reject), exposure (mean luminance < 35 too dark / > 240 washed out = soft), sharpness (Laplacian variance < 25 = blurry, soft). **Fails open** — any internal error returns ok, a quality-check bug must never block an upload.
- **Embed widget `FileUploadStep`** (`embed/[tenantKey]/page.tsx`):
  - *Guided capture slots:* when the service's `media_config.requiredAngles` is configured (schema existed since the draft-config work; now surfaced to customers), each angle renders as a tappable slot card with label + guidance ("Full view — capture the entire area"), progress "2 of 3 added", filled-state thumbnail. Slots are encouragement, not a hard gate — `minPhotos` remains the enforced minimum.
  - *Reject-and-retake UX:* hard failures (tiny images) are rejected with a plain-language message; soft issues (blur/exposure) show the photo with a "Retake / Use anyway" overlay — the photo is NOT uploaded until the customer decides, and Continue is blocked while any photo awaits a decision.
  - Upload logic refactored: `startUpload()` extracted; per-slot file targeting via a shared hidden input + pending-angle ref.
- `UploadedFile` gains `status: 'needs_review'`, `angleId`, `qualityIssues`.

**Design decisions:**
- Soft issues are the customer's call ("use anyway") — legitimate photos can be dark (under-sink leaks); hard-blocking would cost leads. Only unusably-small images are hard-rejected.
- Quality thresholds are deliberately conservative (warn only on clear failures) — false "blurry" warnings erode trust faster than missed ones cost accuracy.

**Known constraint:** implemented on the embed surface (`/embed/[tenantKey]` — iframe mode, conversational host, demo). The Preact widget package (`packages/widget`, floating/inline modes) has a separate upload implementation and does not yet include guided capture/validation — follow-up when that surface is next touched (it cannot share React components; the pure `image-quality.ts` module can be ported).

**Files:** `apps/web/src/lib/image-quality.ts` (new), `apps/web/src/app/embed/[tenantKey]/page.tsx`

---

### 2026-07-18: T-106 — Onboarding Interview (Phase 1 complete, V2 Strategy)

**Context:** Final "setup revolution" ticket. Conversational setup replacing the 5-step wizard as the default path for new tenants; the wizard remains as the manual/advanced route. Target achieved by composition: signup → interview → first test quote in well under 10 minutes.

**Design decision — scripted interview, AI at the seams.** Not a freeform agent: flow control is a deterministic client-side step machine (source → services → pricing → basics → create → done); AI is invoked only through the existing extraction (T-105) and compilation (T-104) endpoints. Consistent with the platform philosophy (deterministic orchestration, AI for extraction), and reuses every quality guard those endpoints already have.

**Implementation:**
- **`extract-from-website` endpoint:** now accepts `{ text }` as an alternative to `{ url }` — the interview's "I'll describe my services" path sends the owner's own words through the same extraction+normalization pipeline (min length 30 chars for text vs 200 for sites).
- **`components/onboarding/OnboardingFlow.tsx` (new):** the interview. One question per screen, conversational tone. Key steps:
  - *Source:* "Read my website" (URL) or "I'll describe it" (textarea) → extraction
  - *Services:* extracted list with checkboxes; unpriced services labelled "we'll ask you next"
  - *Pricing interview:* loops over selected unpriced services — "How do you charge for X?" → T-104 compile → deterministic English review (AD-024) → "That's right" / "Let me rephrase" / "Skip for now"
  - *Basics:* currency, tax toggle (label + % rate, converted to DECIMAL 0-1 for `PATCH /api/tenant` per the tax-conversion lessons), optional postcode allowlist (fixes "service area buried in Settings" friction — now part of default onboarding)
  - *Create:* tenant PATCH + `POST /api/services` per service (same payload as bulk import, including compiled addons/multipliers in pricingRules)
  - *Done:* "Open My Widget" (`/embed/[tenantKey]`) for an immediate test quote + copyable embed snippet
- **`app/onboarding/page.tsx` (new):** server component; fetches tenant basics and gets-or-creates the tenant_key (same logic as the widget page).
- **Dashboard** (`app/page.tsx`): tenants with no services see a "Set up with AI — about 5 minutes" hero card linking to `/app/onboarding`, above the setup checklist.

**Notes:**
- Pricing can be skipped per service ("Skip for now") — services are still created and can be priced later via the T-104 composer in the wizard. Deliberate: never block onboarding completion on a pricing answer.
- Services are created only at the END of the interview (drafts accumulate client-side) — avoids PATCH complexity and half-configured services if the user abandons mid-flow.

**Files:** `apps/web/src/components/onboarding/OnboardingFlow.tsx` (new), `apps/web/src/app/(dashboard)/app/onboarding/page.tsx` (new), `apps/web/src/app/api/services/ai-draft/extract-from-website/route.ts`, `apps/web/src/app/(dashboard)/app/page.tsx`

---

### 2026-07-18: T-105 — Website-URL Onboarding (Phase 1, V2 Strategy)

**Context:** Second "setup revolution" ticket. "Paste your website" → AI reads the site's services/pricing pages → drafts the full service catalogue for review. Builds directly on the bulk-extraction machinery (2026-02-15) — the endpoint returns the same `{services}` contract as `extract-services`, so the review→create pipeline is reused unchanged.

**Implementation:**
- **`apps/web/src/lib/website-extract.ts` (new):** dependency-free site fetcher. `validatePublicUrl()` is an SSRF guard (http/https only, default ports, blocks loopback/private ranges/link-local/cloud-metadata/`.local`); redirects are followed manually with per-hop re-validation (max 3) so a redirect can't escape into private space. `findRelevantLinks()` scores same-origin links by pricing/services keywords; fetches homepage + top 3 (10s timeout, 1.5MB/page cap); regex-based `htmlToText()` (no cheerio — LLM input doesn't need a real DOM); combined text capped at 30k chars.
- **`POST /api/services/ai-draft/extract-from-website` (new):** feeds site text to Gemini with the extract-services rules. Key prompt rules: prices imported ONLY when the site states them; services without stated prices are created with empty workSteps (business then prices them via the T-104 composer — deliberate synergy); marketing prose consolidated to one clean entry per service. `maxDuration = 60` for fetch+AI time. 422 with a helpful message for JS-rendered sites with no readable text.
- **`BulkServiceUpload.tsx`:** renamed "Import Services" with two source tabs — "From your website" (default, URL input) and "Upload document" (existing flow untouched). Both feed the same review checklist; review cards for unpriced services explain pricing comes after import.

**Known constraints:**
- DNS-rebinding SSRF (public hostname → private IP) not guarded in v1 — acceptable on serverless (Vercel) where internal network exposure is limited; revisit if self-hosting.
- Heavily JavaScript-rendered sites (no SSR/static HTML) return little text — handled with a clear error steering users to document upload. A headless-render fallback is a v2 option.
- `validateAndNormalizeDraft`'s existing `minimumCharge || 50` default means unpriced website services get a £/$50 minimum — pre-existing behavior shared by all draft paths, left unchanged.

**Files:** `apps/web/src/lib/website-extract.ts` (new), `apps/web/src/app/api/services/ai-draft/extract-from-website/route.ts` (new), `apps/web/src/components/services/BulkServiceUpload.tsx`

---

### 2026-07-18: T-104 — Plain-Language Pricing Compiler (Phase 1, V2 Strategy)

**Context:** The service wizard required businesses to hand-author pricing DSL (signal keys, trigger conditions, multiplier operators) — the root cause of both setup friction and the recurring signal-matching bug themes (see V2 strategy entry above, Flaw 1). First "setup revolution" ticket.

**New architectural decision — AD-024: AI compiles, code explains.** The AI authors pricing config ONCE at compile time from the business's plain-language description; the review summary the business approves is rendered **deterministically by code from the compiled config** (`lib/pricing-describe.ts`), never by the AI. What the business reads is exactly what the pricing engine executes — no possibility of a summary that doesn't match the rules. Extends AD-001/AD-021.

**Implementation:**
- **`apps/web/src/lib/pricing-describe.ts` (new):** pure `describePricingRules()` renders base fee, work steps (incl. quantity sources: form field / AI signal / constant), addons (incl. auto-trigger conditions), multipliers, and minimum charge as grouped plain-English lines; `describePricingAsText()` flattens for future use (T-105/T-106 will reuse).
- **`POST /api/services/ai-draft/compile` (new):** plain-language description (typed or pasted price list, max 20k chars) → complete config via the existing `validateAndNormalizeDraftBulk` pipeline (bulk limits — price lists have many lines). Key prompt rules: **never invent numbers** — unclear items are omitted and returned as `ambiguities[]` questions; form_field quantity sources strongly preferred over ai_signal (mirrors refine endpoint's priority order); `currentConfig` passed as context so partial edits preserve unmentioned rules. Temperature 0.2 (compilation, not creativity). Returns `{updatedConfig, addons, multipliers, ambiguities}` — addons/multipliers in `AddonConfig`/`MultiplierConfig` form shapes since `ServiceDraftConfig` doesn't model multipliers.
- **`components/services/PricingComposer.tsx` (new):** leads the wizard's pricing step. Textarea → Compile → deterministic review cards ("Here's what your pricing will do") + amber ambiguity questions → Apply (via existing `applyDraftToForm` + addon/multiplier merge). Edit mode shows "Your current pricing in plain English" (collapsed) so businesses read existing rules in language, never config fields, and describe deltas ("raise the base fee to £150").
- **Wizard integration** (`services/page.tsx`): composer sits above the existing manual editors, which remain unchanged under "Or fine-tune manually" — no regression risk to the advanced path or the AI refinement panel.

**Design decisions:**
- Empty compile results for addons/multipliers do NOT clear existing form values (guards against the "configuration loss on update" recurring theme).
- Ambiguities are questions to the business, answered by editing the description and recompiling — not a chat thread (the refine panel already covers conversational iteration).

**Files:** `apps/web/src/lib/pricing-describe.ts` (new), `apps/web/src/app/api/services/ai-draft/compile/route.ts` (new), `apps/web/src/components/services/PricingComposer.tsx` (new), `apps/web/src/app/(dashboard)/app/services/page.tsx`

---

### 2026-07-18: T-101 — Enforce Monthly Plan Limits (Phase 0, V2 Strategy)

**Context:** Usage counters were tracked (`usage_counters.estimates_created`) but never enforced — quote #51 on a 50-quote plan succeeded silently. Revenue was structurally impossible. First ticket of the V2 roadmap (`Docs/06-v2-strategy.md` §5 Phase 0).

**Implementation:**
- **`apps/web/src/lib/plan-limits.ts` (new):** `checkPlanLimit()` resolves the limit from subscription→plan (`monthly_estimate_limit`), defaulting to 50 for tenants without a subscription (same default as `/api/billing`); `limit <= 0` means unlimited. Pure `evaluateLimit()` separated from IO. **Fails open** on lookup errors — a billing read failure must never block a customer quote.
- **Enforcement at both quote-creation entry points, before any records are created:**
  - `POST /api/public/quotes` → HTTP 429 `PLAN_LIMIT_REACHED`. Customer-facing message is deliberately neutral ("Online quoting is temporarily unavailable…") — never exposes the business's billing state. Widget already renders `error.message`, so no widget changes needed.
  - WhatsApp intake (`createQuoteFromIntake`) → friendly text reply, conversation resets to idle.
- **Once-per-period business notification:** after the increment that consumes the last quote, `maybeNotifyLimitReached()` sends a Postmark email (new `generateLimitReachedEmailHtml` template) with an upgrade CTA. Guarded by new `usage_counters.limit_notified_at` column claimed via conditional update (`IS NULL`) so concurrent requests can't double-send. Recipient: `tenants.notification_email`, falling back to the tenant owner's account email (same resolution as the worker's business emails).
- **Dashboard warning banners** (`/app` overview): amber at ≥80% usage, red with Upgrade CTA at 100%.
- **Migration 19** (`00000000000019_usage_limit_notified.sql`): additive `ALTER TABLE usage_counters ADD COLUMN limit_notified_at TIMESTAMPTZ` — follows the migration-16/17 lessons (no new RLS, no ID type assumptions).

**Design decisions:**
- Enforcement checks `estimates_created` (intake volume), not `estimates_sent` — the metered unit is a processed request, and blocking at intake protects AI processing costs.
- Fail-open on limit-check errors: prioritises never losing a lead over strict enforcement in a degraded state.
- The check is read-then-insert (not atomic with the increment), so a burst at the boundary could allow a couple of extra quotes — acceptable overage; deliberate simplicity.

**Not done (deferred to T-102):** metered overage billing via Stripe usage records; plan structure for widget-as-SKU.

**Files:** `apps/web/src/lib/plan-limits.ts` (new), `apps/web/src/lib/email-templates.ts`, `apps/web/src/app/api/public/quotes/route.ts`, `apps/web/src/lib/whatsapp-intake.ts`, `apps/web/src/app/(dashboard)/app/page.tsx`, `supabase/migrations/00000000000019_usage_limit_notified.sql`

---

### 2026-02-16: Production Migration Fixes — UUID Types & RLS Patterns

**Context:** Migrations 13-17 had never been applied to production Supabase. When attempting `db push`, migrations 16 and 17 failed due to schema mismatches between migration files and the actual production database.

**Root causes:**
1. **Migration 16 (conversational_widget):** `widget_analytics.tenant_id` was declared as `TEXT` but `tenants.id` is `UUID` on production. Also used `get_current_tenant_id()` function which doesn't exist — production uses subquery-based RLS policies via `user_profiles`.
2. **Migration 17 (quote_amendments):** Used `TEXT` primary keys with `generate_prefixed_id()` prefix function, but production DB uses `UUID` with `gen_random_uuid()` for all ID columns. Also used `get_current_tenant_id()` RLS pattern. The `generate_prefixed_id()` function didn't exist on production.

**Fix:**
- **Migration 16:** Changed `tenant_id TEXT` to `UUID`, replaced `get_current_tenant_id()` RLS with `tenant_id IN (SELECT ... FROM user_profiles WHERE id = auth.uid())`, replaced `auth.role()` with `auth.jwt() ->> 'role'`.
- **Migration 17:** Changed all ID columns from `TEXT DEFAULT generate_prefixed_id(...)` to `UUID DEFAULT gen_random_uuid()`, changed `tenant_id`/`quote_id`/`service_id`/`feedback_id` to `UUID`, added `CREATE OR REPLACE FUNCTION generate_prefixed_id()` as safety net, replaced all `get_current_tenant_id()` RLS with subquery pattern.
- Used `supabase migration repair` to mark migrations 0-12 as applied (already existed in DB), then pushed 13-17 incrementally, fixing errors between attempts.

**Key lesson:** Production Supabase was set up with UUID-typed columns via SQL editor, not through the migration files. Always verify actual production schema types (via `supabase db dump`) before writing new migrations that reference existing tables.

**Files:** `supabase/migrations/00000000000016_conversational_widget.sql`, `supabase/migrations/00000000000017_quote_amendments.sql`

---

### 2026-02-16: Conversational Chat — Multi-Service Awareness & Field Isolation

**Context:** Two bugs: (1) chat always auto-selected the first service, ignoring others; (2) the chat API loaded fields from ALL service-specific widget_configs, not just the selected one. This caused plumbing fields ("where is the leak?") to appear when discussing spa services.

**Root cause 1 (service lock):** `ConversationalChat` always sent `serviceId: widgetData.services[0]?.id` as fallback. The chat API's system prompt said "SELECTED SERVICE: [first service]" and the AI focused only on that.

**Root cause 2 (field bleed):** The chat API's field loading loop iterated ALL widget_configs and included any field where `!field.serviceId`. Fields in service-specific configs don't have a `field.serviceId` property (scoped by `cfg.service_id` row), so `!field.serviceId` was always true — every service's fields leaked into every other service.

**Fix:**
- **Client — service resolution** (`embed/[tenantKey]/page.tsx`):
  - `resolvedServiceIdRef` (ref, not state) starts `null` when multiple services exist
  - Opening greeting lists all available services
  - After each AI response, scans reply + user message text for service name matches (longest-first to avoid partial matches)
  - Once matched, ref updates synchronously so the very next API call uses the correct serviceId
- **Chat API — field isolation** (`api/public/widget/chat/route.ts`):
  - Rewrote field loading to check `cfg.service_id` first: global config (`null`) fields are filtered by `field.serviceId` property; service-specific config fields are only included when `cfg.service_id === body.serviceId`
  - Service-specific configs for OTHER services are now skipped entirely
- **Chat API — prompt improvements**: system prompt now tells AI to set `extractedFields.serviceId` immediately when service is identified; maxOutputTokens increased from 1000→2000 to prevent response truncation

**Files:** `apps/web/src/app/embed/[tenantKey]/page.tsx`, `apps/web/src/app/api/public/widget/chat/route.ts`

---

### 2026-02-15: Demo Conversational Mode, Bulk Service Upload & AI Refinement (3 Features)

**Context:** Businesses needed (1) a way to preview the conversational embed mode, (2) a way to bulk-create services from a pricing document, and (3) per-service AI refinement after initial draft generation via document upload or chat.

**Feature 1: Demo Page Conversational Mode**
- Added 4th "Conversational" mode to `/demo` page alongside iframe/floating/inline
- When selected, renders the embed page via iframe with `?mode=conversational` query param
- Updated `useEmbedCode` to generate conversational embed snippet with `data-display-mode="conversational"`
- Updated `IframeWidget` to accept optional `mode` prop for URL query params
- **File:** `apps/web/src/app/demo/page.tsx`

**Feature 2: Bulk Service Upload ("Upload Services")**
- "Upload Services" button on services list page (next to "Add Service")
- Opens modal with file drop zone accepting PDF, images, Word docs
- Flow: upload to R2 via authenticated `/api/uploads/init` → send to Gemini via `/api/services/ai-draft/extract-services` → review checklist → create selected services via `/api/services`
- Each created service gets full `ServiceDraftConfig` (scope, pricing, fields) and can be edited individually
- **New files:**
  - `apps/web/src/app/api/uploads/init/route.ts` — Authenticated upload endpoint (accepts PDF, images, Word docs)
  - `apps/web/src/app/api/services/ai-draft/extract-services/route.ts` — Bulk document→multi-service extraction via Gemini
  - `apps/web/src/components/services/BulkServiceUpload.tsx` — Modal UI component
- **Modified:** `apps/web/src/app/(dashboard)/app/services/page.tsx` — added Upload Services button + BulkServiceUpload modal

**Feature 3: Per-Service AI Refinement (Upload Doc + Chat)**
- After AI draft generates, a collapsible "AI Refinement" panel appears on wizard steps 2-4
- Two tabs: **Chat** (natural language instructions to refine config) and **Upload Doc** (extract pricing from document)
- Chat: sends message + current config to Gemini, returns updated config with explanation
- Upload: sends document to Gemini for pricing extraction, merges into form state
- All wizard fields remain fully editable at all times — refinement is optional helper
- **New files:**
  - `apps/web/src/app/api/services/ai-draft/extract-pricing/route.ts` — Single-service document pricing extraction
  - `apps/web/src/app/api/services/ai-draft/refine/route.ts` — Chat-based config refinement
  - `apps/web/src/components/services/AIDraftRefinementPanel.tsx` — Collapsible panel with Chat + Upload tabs
- **Modified:** `apps/web/src/app/(dashboard)/app/services/page.tsx` — added `applyDraftToForm()` helper, wired refinement panel

**Shared Refactor: AI Draft Validation**
- Extracted `validateAndNormalizeDraft()`, `parseGeminiJson()`, `callGemini()`, and all normalize helpers from `ai-draft/route.ts` into `ai-draft/shared.ts`
- All AI draft endpoints (original, extract-services, extract-pricing, refine) now share this code
- **New file:** `apps/web/src/app/api/services/ai-draft/shared.ts`
- **Modified:** `apps/web/src/app/api/services/ai-draft/route.ts` — imports from shared.ts, removed duplicate functions

**Key Design Decisions:**
- **AD-017: Partial draft updates for refinement** — The refine and extract-pricing endpoints return partial `ServiceDraftConfig` that gets merged into form state via `applyDraftToForm()`. This avoids AI overwriting fields the user manually edited.
- **AD-018: Authenticated uploads separate from public** — Dashboard uploads use `/api/uploads/init` (requires auth, derives tenantId from session) vs public widget uploads at `/api/public/uploads/init` (requires tenantKey). Dashboard uploads also accept Word docs.
- **AD-019: Conversation history in refine endpoint** — The refine chat maintains rolling conversation history (last 6 messages) so context builds across messages (e.g., "now make that cheaper" refers to last adjustment).
- **AD-020: Gemini vision for document extraction** — Both bulk and single-service extraction send uploaded documents as base64 inline data to Gemini 2.5 Flash for multimodal extraction, avoiding a separate OCR step.

### 2026-02-15: AI Refinement — quantitySource/unitLabel Stripped by normalizeWorkSteps

**Context:** When using the AI chat refinement to link a work step to a quantity signal (e.g., "Gutter Clearing should be based on gutter length"), Gemini correctly returned `quantitySource` and `unitLabel` fields on the work step. However, the `normalizeWorkSteps()` function in `shared.ts` stripped these fields because the `WorkStepInput` interface didn't include them.

**Root cause:** `WorkStepInput` interface and `normalizeWorkSteps()` map output only preserved `id`, `name`, `description`, `costType`, `defaultCost`, `optional`, `triggerSignal`. The `quantitySource`, `unitLabel`, and `triggerCondition` fields from `WorkStepConfig` were silently dropped during normalization.

**Fix:**
- Added `quantitySource` and `unitLabel` to `WorkStepInput` interface
- Added `normalizeQuantitySource()` helper — validates type is one of `form_field | constant | ai_signal`, preserves `fieldId`, `value`, `signalKey`
- Added `normalizeTriggerCondition()` helper — validates operator is one of the valid operators
- Updated `normalizeWorkSteps()` map to include `quantitySource`, `unitLabel`, and `triggerCondition` in output
- Updated `refine/route.ts` system prompt to explicitly instruct AI about `quantitySource` usage (with `form_field`, `ai_signal`, `constant` types and `unitLabel`)

**Files:** `apps/web/src/app/api/services/ai-draft/shared.ts`, `apps/web/src/app/api/services/ai-draft/refine/route.ts`

---

### 2026-02-15: Quote Editor Bugfixes & Improvements (4 Fixes)

**Context:** Testing of the Quote Editor revealed issues: a tax rate conversion bug, missing UI sections for optional extras and pricing notes, a non-configurable Accept Quote button, and signal recommendations / cross-service pricing being silently lost on every edit save.

**Fix 1: Tax Rate Bug**
- **Root cause:** `PATCH /api/quotes/[quoteId]` stored `tenant.tax_rate` (decimal 0.2) directly into `pricing_json.taxRate`, but the rest of the system (client `useQuotePricing`, customer page) expects a whole-number percentage (20). On subsequent edits, the client would divide 0.2 by 100 again, causing progressive degradation (20% → 0.2% → 0.002%).
- **Fix:** Convert `tenant.tax_rate * 100` when assigning to `pricing.taxRate`, and use raw `tenant.tax_rate` directly for tax amount calculation (was double-dividing by 100).
- **File:** `apps/web/src/app/api/quotes/[quoteId]/route.ts` (lines 343-344)

**Fix 2: Optional Extras & Pricing Notes Editor**
- **Issue:** `useQuotePricing` hook already managed `availableAddons` and `pricingNotes` state, but QuoteEditor didn't destructure or render them.
- **Fix:** Created `AddonsEditor.tsx` component for editing optional extras (label + price per addon, add/remove). Wired `availableAddons`/`setAvailableAddons` and `pricingNotes`/`setPricingNotes` into QuoteEditor with new editor sections using `AddonsEditor` and existing `ListSectionEditor`.
- **Files:** `apps/web/src/components/quote-editor/AddonsEditor.tsx` (new), `apps/web/src/components/quote-editor/QuoteEditor.tsx`

**Fix 3: Configurable Accept Quote Button**
- **Issue:** The "Accept Quote" button on the customer page was always shown. Businesses needed the ability to toggle it off.
- **Fix:** Added `acceptQuoteEnabled?: boolean` to `TenantTemplate` (defaults to `true` for backward compatibility). Public quote API now fetches `template_json` from tenant and includes `acceptQuoteEnabled` in response. Customer quote page conditionally renders Accept button. Branding page has a new toggle checkbox. Preview also respects the toggle.
- **Files:** `packages/shared/src/database.types.ts`, `packages/shared/src/api.types.ts`, `apps/web/src/app/api/public/quotes/[quoteId]/route.ts`, `apps/web/src/app/q/[quoteId]/page.tsx`, `apps/web/src/app/(dashboard)/app/branding/page.tsx`, `apps/web/src/app/api/tenant/branding/route.ts`
- **No migration needed** — `template_json` is JSONB, new key has a code-level default.

**Fix 4: Potential Additional Work Editor & Data Preservation**
- **Issue:** `signalRecommendations` and `crossServicePricing` are stored as extra fields inside `content_json`, but the editor's `buildContent()` didn't include them — silently wiped on every save. Also no UI to edit/remove AI-recommended "Potential Additional Work".
- **Fix:** QuoteEditor now reads `signalRecommendations` and `crossServicePricing` from initial content, manages them as state, and includes them in `buildContent()`. Created `RecommendationsEditor.tsx` component allowing businesses to edit descriptions and remove irrelevant recommendations. Cross-service pricing is preserved but not yet editable.
- **Files:** `apps/web/src/components/quote-editor/RecommendationsEditor.tsx` (new), `apps/web/src/components/quote-editor/QuoteEditor.tsx`

**Key Design Decisions:**
- **AD-014: Tax rate stored as percentage in pricing_json** — `pricing_json.taxRate` is always a whole-number percentage (e.g., 20 for 20%). DB `tenant.tax_rate` is a decimal (0.2). Conversion happens server-side in PATCH handler.
- **AD-015: acceptQuoteEnabled defaults true via code** — No DB migration needed. Absence of the key in existing `template_json` is treated as `true` using `!== false` check.
- **AD-016: content_json contains extra fields beyond QuoteContent type** — `signalRecommendations` and `crossServicePricing` are stored in `content_json` JSONB but not in the TypeScript `QuoteContent` interface. Editor must explicitly preserve these fields via extended type cast.

### 2026-02-15: Quote Editor, Post-Quote Journey & Learning Loop (6 Phases, 13 Tickets)

**Context:** Quotes were immutable after generation. No edit capability, no customer feedback mechanism, and the learning infrastructure (validation logs, config suggestions) was recorded but never consumed. This change adds business quote editing, customer feedback flow, and an amendment-based learning loop.

**Phase A: Schema & Types (Tickets 1-2)**
- Migration `00000000000017_quote_amendments.sql`: New enum values (`feedback_received`, `revised`), new columns on `quotes` (`business_notes`, `version`, `last_amended_at`, `last_amended_by`), new tables (`quote_feedback`, `quote_amendments`, `tenant_learning_context`) with RLS policies
- Shared types: `QuoteFeedback`, `QuoteAmendment`, `LearningPattern`, `TenantLearningContext`, `AmendmentChange` in `database.types.ts`; `UpdateQuoteRequest/Response`, `SubmitFeedbackRequest/Response`, `QuoteDetailResponse`, `LearningContextResponse`, `AnalyzeLearningRequest/Response` in `api.types.ts`
- `QuoteStatus` extended with `feedback_received` and `revised`

**Phase B: Quote Edit API (Tickets 3-4)**
- `PATCH /api/quotes/[quoteId]`: Optimistic locking via `version` field, server-side tax recalculation, structured diff computation, amendment logging, optional email resend with revised status
- `GET /api/quotes/[quoteId]` enriched to return `QuoteDetailResponse` with amendments summary and feedback list

**Phase C: Customer Feedback Flow (Tickets 5-6)**
- `POST /api/public/quotes/[quoteId]/feedback`: Token-validated feedback submission, status update to `feedback_received`, business notification email
- Customer quote page updated with "Send for Review" and "Send Feedback" buttons alongside Accept, version indicator badge for revised quotes, post-feedback confirmation state
- Accept endpoint updated to allow accepting from `revised` and `feedback_received` statuses

**Phase D: Business Quote Editor UI (Tickets 7-9)**
- New business quote detail page at `/app/quotes/[quoteId]` with full quote view, pending feedback alerts, business notes, pricing breakdown, version history, timeline
- Inline edit mode with lazy-loaded `QuoteEditor` component for mobile-first editing
- `LineItemEditor`: Drag-drop reordering (HTML5 DnD desktop + pointer events mobile), editable labels/amounts, add/remove with confirm
- `SectionEditor`: Auto-resizing textarea for text sections, editable list with add/remove for assumptions/exclusions
- `useQuotePricing` hook: Real-time subtotal/tax/total calculation from line items
- `useSortable` hook: Lightweight drag-drop implementation without external dependencies
- Email templates: `generateRevisedQuoteEmailHtml`, `generateFeedbackNotificationEmailHtml` in both web and worker packages

**Phase E: Learning Loop (Tickets 10-12)**
- `amendment-analyzer.ts` in worker: Analyzes amendment patterns (price changes, item additions/removals, content edits) and generates natural-language prompt context
- Learning integration in `quote-processor.ts`: Fetches `tenant_learning_context.prompt_context` and appends to AI wording prompt (wording only, not pricing per AD-001)
- `POST /api/learning/analyze`: Manual re-analysis trigger with same pattern detection logic
- `GET /api/learning/[serviceId]`: Returns patterns and prompt context for dashboard display
- Auto-trigger: After PATCH amendment, checks if >= 5 amendments since last analysis and fires analysis

**Phase F: Polish & Integration (Ticket 13)**
- StatusBadge updated across quotes list page, customer quote page, and business detail page with `feedback_received` and `revised` statuses
- `VALID_STATUSES` in quotes list API updated with all 12 statuses
- "View" icon link added to quotes list table linking to `/app/quotes/[quoteId]`
- Business notification email CTA now links to `/app/quotes/{quoteId}` instead of generic `/app/quotes`

**Key Design Decisions:**
- **AD-012: Optimistic locking via version field** — prevents conflicting concurrent edits without complex locking
- **AD-013: Tax recalculated server-side** — client shows preview, server is truth
- **AD-014: Learning affects wording only, not pricing** — respects AD-001. Price patterns are insights only
- **AD-015: No external drag-drop library** — pointer events + HTML5 DnD sufficient for simple list reorder
- **AD-016: Edit inline, not separate page** — reduces cognitive load, especially on mobile

**Files Created:**
- `supabase/migrations/00000000000017_quote_amendments.sql`
- `apps/web/src/lib/email-templates.ts`
- `apps/web/src/app/api/public/quotes/[quoteId]/feedback/route.ts`
- `apps/web/src/app/(dashboard)/app/quotes/[quoteId]/page.tsx`
- `apps/web/src/components/quote-editor/QuoteEditor.tsx`
- `apps/web/src/components/quote-editor/LineItemEditor.tsx`
- `apps/web/src/components/quote-editor/SectionEditor.tsx`
- `apps/web/src/components/quote-editor/useQuotePricing.ts`
- `apps/web/src/components/quote-editor/useSortable.ts`
- `apps/web/src/app/api/learning/[serviceId]/route.ts`
- `apps/web/src/app/api/learning/analyze/route.ts`
- `apps/worker/src/ai/amendment-analyzer.ts`

**Files Modified:**
- `packages/shared/src/database.types.ts` — extended QuoteStatus, Quote type, added new table types
- `packages/shared/src/api.types.ts` — added QuoteViewResponse.version, edit/feedback/learning API types
- `apps/web/src/app/api/quotes/[quoteId]/route.ts` — added PATCH handler, enriched GET
- `apps/web/src/app/api/quotes/route.ts` — updated VALID_STATUSES
- `apps/web/src/app/q/[quoteId]/page.tsx` — feedback UI, version indicator, new statuses
- `apps/web/src/app/api/public/quotes/[quoteId]/route.ts` — added version to response
- `apps/web/src/app/api/public/quotes/[quoteId]/accept/route.ts` — allow accepting from revised/feedback_received
- `apps/web/src/app/(dashboard)/app/quotes/page.tsx` — new statuses, View link
- `apps/worker/src/ai/wording.ts` — learningContext in WordingContext and prompt
- `apps/worker/src/quote-processor.ts` — fetch and pass learning context
- `apps/worker/src/email/templates.ts` — feedback and revised quote email templates
- `apps/worker/src/email/index.ts` — dashboard URL now links to specific quote

---

### 2026-02-13: Agentic AI Transformation (5 Phases)

**Context:** Major upgrade to transform the platform into an agentic AI product through 5 incremental phases, each independently deployable.

**Phase 1: Gemini 2.5 Flash Migration + Structured Outputs**
- Migrated model from `gemini-2.0-flash` to `gemini-2.5-flash` in all 3 call sites
- Added `generateWithSchema<T>()` and `generateWithImagesAndSchema<T>()` methods to GeminiClient for structured JSON output via `response_mime_type: "application/json"` + `response_schema`
- Created centralized JSON Schema definitions in `apps/worker/src/ai/schemas.ts`
- Migrated signal extraction and wording generation to structured output with `parseJSON<T>()` fallback
- **Files:** `gemini.ts`, `signals.ts`, `wording.ts`, `schemas.ts`, `service-matcher.ts`, `ai-draft/route.ts`

**Phase 2: Triage Agent**
- Heuristic-only triage (no AI call) classifies quotes as simple/standard/complex
- Photo strategy optimization: skip vision for 0 photos, cap at 5 for 3+
- Cross-service check gated by triage decision
- Returning customer detection via `quote_requests` lookup
- DB migration: `triage_json` column on quotes table
- **Files:** `agents/types.ts`, `agents/triage.ts`, `quote-processor.ts`, migration 00000000000013

**Phase 3: Signal Fusion with Provenance**
- Observer pattern recorder tracks provenance of every signal (source: form/vision/text/inferred)
- Records conflicts when form and vision disagree (AD-007: form always wins)
- DB migration: `signal_conflicts_json` column on quotes table
- **Files:** `agents/signal-fusion.ts`, `quote-processor.ts`, `database.types.ts`, migration 00000000000014

**Phase 4: Quality Gate**
- Three outputs: `send` (proceed), `ask_clarification` (max 2 targeted questions), `require_review` (flag for business)
- Clarification flow: public API + customer-facing page at `/q/[quoteId]/clarify`
- Max 1 clarification round (no infinite loops via `clarification_count` cap)
- New statuses: `awaiting_clarification`, `pending_review` added to Postgres enum and all status maps
- DB migration: clarification columns + quality gate JSON on quotes table
- **Files:** `agents/quality-gate.ts`, `clarify/route.ts`, `clarify/page.tsx`, `email/templates.ts`, migration 00000000000015

**Phase 5: Conversational Widget (A/B Test)**
- Chat-based widget alternative to the multi-step form
- Chat API (`/api/public/widget/chat`) uses Gemini 2.5 Flash structured output to extract fields from natural language
- A/B test framework with sticky localStorage assignment (form/conversational/ab-test modes)
- Widget analytics tracking (`/api/public/widget/analytics`) with `widget_analytics` table
- Loader updated to read `data-display-mode` attribute and mount correct widget variant
- Zero backend pipeline changes — conversational widget produces the same `CreateQuoteRequest`
- DB migration: `widget_analytics` table with RLS, migration 00000000000016
- **Files:** `ConversationalWidget.tsx`, `ChatBubble.tsx`, `ChatInput.tsx`, `ab-test.ts`, `chat/route.ts`, `analytics/route.ts`, `loader.tsx`, `types.ts`

**Critical constraint maintained:** AI extracts signals and drafts wording. AI never sets prices. The deterministic rules engine remains the pricing authority.

**Test results:** 168 tests passing (7 test files). Widget builds at 47.43 kB (11 modules).

**Fixes during implementation:**
- `awaiting_clarification` status added to dashboard quotes page and public quote view page status maps
- Quality gate test `makePricing()` helper needed explicit `confidence` field (required by `PricingResult` type)
- Phase 2 triage variable `descriptionAnswer` renamed to `triageDescriptionAnswer` to avoid redeclaration conflict in `quote-processor.ts`
- Phase 3 FIX-8 access override block moved inside `if (structuredSignals)` scope for fusion recorder access
- Phase 4 `GeminiClient` import changed to `import type` (only used as type parameter)

---

### 2026-02-12: Removed Hardcoded Complexity Multiplier

**Context:** The pricing engine was automatically applying a "Simple job discount" (10% off) when AI detected complexity as "low", and a 25% premium for "high" complexity. This violated the anti-hardcoding principle: "AI can extract signals and draft wording, but AI must not set the final price."

**Issue:** Hardcoded values in `getComplexityMultiplier()` function were automatically adjusting prices based on AI-detected complexity:
- `low` → 0.9 (10% discount, shown as "Simple job discount")
- `medium` → 1.0 (no change)
- `high` → 1.25 (25% premium)

**Solution:** Removed the automatic complexity multiplier entirely from three locations in `apps/worker/src/pricing/rules-engine.ts`:
1. `calculatePricing()` function (lines 304-313)
2. `getComplexityMultiplier()` helper function (lines 904-915)
3. `calculatePricingWithTrace()` function (lines 1676-1693)

Replaced with explanatory comments following the same pattern used for the previously removed access difficulty multiplier.

**Impact:**
- Quotes will no longer show automatic "Simple job discount" or complexity premiums
- Businesses can still configure complexity-based pricing manually as multiplier rules with trigger conditions
- This aligns with the principle that pricing should be deterministic based on business configuration, not AI decisions

**Related:** Follows same pattern as access difficulty multiplier removal (see line 315-316 comments in the file)

---

### 2026-02-11: Vercel Deployment Configuration

**Context:** Needed to deploy the monorepo to Vercel for external testers. The standard deployment methods weren't working due to monorepo structure with pnpm workspaces.

**Issue:** Initial CLI deployments completed in ~130ms without running the actual Next.js build. The dashboard Root Directory setting conflicted with CLI deployments.

**Solution:** Used Vercel's builds API v2 in a root-level `vercel.json`:
```json
{
  "version": 2,
  "builds": [
    {
      "src": "apps/web/package.json",
      "use": "@vercel/next",
      "config": {
        "installCommand": "cd ../.. && pnpm install"
      }
    }
  ],
  "routes": [
    { "src": "/(.*)", "dest": "apps/web/$1" }
  ]
}
```

**Key learnings:**
- The `builds` array with `@vercel/next` explicitly tells Vercel to build the Next.js app at `apps/web`
- The `installCommand` in config navigates to root to install all workspace dependencies
- Using `framework: null` doesn't work as expected for monorepos
- The original `aistimator` project has a `rootDirectory: apps/web` setting that causes CLI deploy conflicts
- Created a new `estimator-web` project that works correctly from root

**Deployment URLs:**
- Web App: https://estimator-web-phi.vercel.app
- Worker: https://estimator-worker-production.billgajen.workers.dev

---

### 2026-02-11: Editorial Black Design System

**Context:** User requested a bold, minimalist black & white design to replace the previous warm/thin design.

**Design Tokens:**
- Font: Sora (display + body), JetBrains Mono (code) via `next/font/google`
- Colors: white bg (#FFFFFF), zinc-50 surface (#F4F4F5), near-black primary (#09090B), green secondary (#16A34A)
- Typography: extrabold headings, semibold nav (text-[15px]), font-semibold buttons
- Shadows: border-based (`0 0 0 1px`) flat editorial look

**Component Library:** Created reusable components in `apps/web/src/components/ui/`:
- Button, Input, Textarea, Select, Card, Badge, PageHeader
- `cn()` utility at `apps/web/src/lib/cn.ts` (dependency-free)

**Note:** Embed widget (`apps/web/src/app/embed/`) has minimal styling changes as it renders on customer sites.

---

### 2026-02-06: Dashboard Setup Checks & Stats Bug Fixes

**Context:** Three bugs in the dashboard prevented setup completion checks and quote stats from working correctly due to incorrect column names and wrong table references.

**Bugs Fixed:**

| Bug | Root Cause | Fix |
|-----|------------|-----|
| "Add a service" not completing | Using `is_active` column that doesn't exist | Changed to `active` (correct column name in `services` table) |
| "Embed on website" never completing | Using `is_verified` column that doesn't exist | Changed to `is_active` (correct column name in `tenant_sites` table) |
| Quote stats showing all zeros | Querying `quote_requests` table | Changed to `quotes` table (which has `status` and `pricing_json` columns) |

**Schema Reference:**
- `services` table: has `active BOOLEAN` (not `is_active`)
- `tenant_sites` table: has `is_active BOOLEAN` (no `is_verified` column exists)
- `quotes` table: has `status` and `pricing_json` columns
- `quote_requests` table: does NOT have `status` or `pricing_json` columns

**File Modified:** `apps/web/src/app/(dashboard)/app/page.tsx` (lines 44, 84, 97)

**Verification:** `pnpm typecheck && pnpm lint` — pass.

---

### 2026-02-06: Dashboard & Menu Reorganization

**Context:** Streamlined the dashboard by removing redundant menu items, fixing broken stat cards, moving the setup checklist inline, and improving the welcome message.

**Changes:**

| Change | Description |
|--------|-------------|
| Menu Reorganization | Reduced from 9 to 7 menu items. Removed "Setup Checklist" (moved inline) and "Pricing Rules" (deprecated redirect). Renamed "Getting Started" to "Overview" and "Configuration" to "Configure". |
| Welcome Message | Changed from "Welcome back, [name]" to business name as heading (e.g., "Acme Plumbing"). |
| Dashboard Stats | Stats now fetch real data from `quote_requests` table. Queries count quotes by status for Sent/Viewed/Accepted, and sum `pricing_json.total` for Revenue. |
| Inline Setup Progress | Setup checklist is now a compact card at top of dashboard. Shows 4 steps with progress bar. Auto-hides when all steps complete. |
| Quick Actions | Reduced from 4 to 3 actions. Removed "Setup Checklist" link. |
| Deleted Pages | Removed `/app/onboarding` (moved inline) and `/app/pricing` (deprecated redirect). |

**Setup Completion Checks:**
1. Add a service → `services` table has active service for tenant
2. Configure widget → `widget_configs` has config with form fields
3. Customize branding → `branding_json.logoAssetId` is set OR `primaryColor` differs from default `#2563eb`
4. Embed on website → `tenant_sites` has at least 1 verified site

**Files Modified:**
- `apps/web/src/app/(dashboard)/layout.tsx` - Removed 2 menu items, renamed sections, removed unused icon functions
- `apps/web/src/app/(dashboard)/app/page.tsx` - New welcome, real stats, inline setup progress, updated quick actions

**Files Deleted:**
- `apps/web/src/app/(dashboard)/app/onboarding/page.tsx`
- `apps/web/src/app/(dashboard)/app/pricing/page.tsx`

**Verification:** `pnpm typecheck`, `pnpm lint`, `pnpm build` — all pass.

---

### 2026-02-05: UI Redesign — "Editorial Black" Bold Minimalist Design

**Context:** Complete visual redesign of the platform. Initially implemented "Warm & Approachable" (terracotta/cream), but user rejected it as looking bad. First B&W iteration with Manrope font was also rejected (text too thin/small, dull). Final "Editorial Black" iteration uses bold, modern, minimalist B&W aesthetic with Sora font.

**Design System:**
- **Font:** Sora (geometric sans-serif — display + body), JetBrains Mono (code) via `next/font/google`
- **Colors:** Pure white background (#FFFFFF), zinc-50 surface (#F4F4F5), near-black primary (#09090B), green secondary (#16A34A) for positive indicators only, zinc grays for text hierarchy
- **Shadows:** Border-based (`0 0 0 1px`) for editorial flat look, blur only on hover
- **Corners:** Tighter radius (`rounded-lg`, `rounded-xl`) — no oversized rounding
- **Typography:** Extrabold headings (text-3xl+), semibold nav items (text-[15px]), generous sizing throughout
- **Animation:** `fade-in-up` 0.25s with staggered delays

**Changes (5 phases, 30+ files):**

| Phase | Files | Description |
|-------|-------|-------------|
| Foundation | `tailwind.config.ts`, `globals.css`, `layout.tsx`, `cn.ts` | CSS variables, theme tokens, font loading, utility |
| Components | 7 new files in `components/ui/` + `EmptyState.tsx` update | Button, Input, Textarea, Select, Card, Badge, PageHeader |
| Layouts | Dashboard, auth, admin, landing layouts | Warm cream bg, warm sidebar, Fraunces headings |
| Pages | All 22 routes updated | Systematic class replacement (gray→semantic, blue→primary, etc.) |
| Polish | Verification pass | typecheck, lint, build all pass |

**Files Created:**
- `apps/web/src/lib/cn.ts`
- `apps/web/src/components/ui/Button.tsx`
- `apps/web/src/components/ui/Input.tsx`
- `apps/web/src/components/ui/Textarea.tsx`
- `apps/web/src/components/ui/Select.tsx`
- `apps/web/src/components/ui/Card.tsx`
- `apps/web/src/components/ui/Badge.tsx`
- `apps/web/src/components/ui/PageHeader.tsx`

**Architectural Decisions:**
- CSS variables for all design tokens — enables future runtime theming
- Embed widget gets minimal treatment (subtle input/button changes only) since it renders on customer sites
- `cn()` utility is dependency-free (no clsx/tailwind-merge) — just filters falsy values and joins
- Component library uses forwardRef for Input/Textarea/Select for form library compatibility
- Kept some raw Tailwind colors where they serve functional purposes (spinners, progress bars, error overlays) rather than semantic ones

**Known Issue Fixed During Implementation:**
- `replace_all` for `bg-green-50` also matched inside `bg-green-500`, producing corrupted `bg-secondary-light0`. Caught by verification grep and corrected. Same pattern checked across all files.

**Verification:** `pnpm typecheck`, `pnpm lint`, `pnpm build` — all pass. No new errors introduced.

---

### 2026-02-04: Quote Label & Signal Quality Fixes (3 fixes)

**Context:** Three quality improvements: breakdown labels showing unit math, cleaner multiplier labels, and reducing water damage false positives from AI.

**Changes:**

| Fix | File(s) | Description |
|-----|---------|-------------|
| FIX-LABELS | `apps/worker/src/pricing/rules-engine.ts` | **Breakdown labels now show unit math.** For per_unit and per_hour work steps with quantity > 1, label changes from `"Pest Treatment"` to `"Pest Treatment  £50 x 2(Rooms)"`. Added `quantity` and `unitLabel` to `WorkStepCostResult` return type. Fixed cost steps and quantity=1 steps keep plain name. |
| FIX-MULT | `apps/worker/src/pricing/rules-engine.ts` | **Cleaner multiplier fallback labels.** `generateMultiplierLabel()` now strips UI suffixes (`_input`, `_select`, `_field`, `_type`, `_dropdown`, `_choice`) from fieldId and uses `"Field: Value"` format instead of `"Value field_id"`. E.g., `"Pest Type: Mice"` instead of `"Mice pest type input"`. Only affects multipliers without explicit `label` property. |
| FIX-WATER | `apps/worker/src/ai/signals.ts` | **Reduced water_damage false positives.** Added CONDITION DETECTION GUIDELINES to signal extraction prompt: pipes alone are not water damage, pest-caused staining is pest_damage not water_damage, be conservative when unsure. |

**Architectural Decisions:**
- FIX-LABELS: Label format only changes when quantity > 1. Single-quantity and fixed-cost steps keep plain name for clean display.
- FIX-MULT: Explicit `label` on multiplier config always takes priority over `generateMultiplierLabel()`. The fallback function is only used when businesses don't configure a label.
- FIX-WATER: Prompt-based fix, no structural code change. Conservative approach — tells AI to attribute ambiguous damage to the more likely source.

**Test Updates:**
- Updated label assertions in `rules-engine.test.ts`, `quote-processing.test.ts`, and `fence-scenarios.test.ts` to match new breakdown label format.
- Used `startsWith()` matching in fence tests for per_unit work step labels.

**Verification:** `pnpm typecheck`, `pnpm test`, `pnpm build` — all pass (118/118 tests).

---

### 2026-02-04: Platform Reliability Fixes (4 issues)

**Context:** Full platform review uncovered critical reliability gaps: missing images despite upload, silent quote loss on queue failure, duplicate Gemini API calls doubling cost, and a comma-parsing bug corrupting numeric values.

**Changes:**

| Fix | File(s) | Description |
|-----|---------|-------------|
| FIX-IMG | `apps/worker/src/quote-processor.ts` | **"No images provided" when images WERE uploaded.** Root cause: asset linking (`UPDATE assets SET quote_request_id`) could silently fail, so `loadQuoteData` found 0 assets. Fix: added fallback — if no assets found via `quote_request_id`, load by `asset_ids` stored on `quote_requests` record. Also repairs the broken link for future retries. |
| FIX-IMG-2 | `apps/web/src/app/api/public/quotes/route.ts` | Asset linking error was unchecked (`await supabase.update(...)` with no error check). Now logs the error. `asset_ids` on `quote_requests` serves as a safety net. |
| FIX-QUEUE | `apps/web/src/lib/queue.ts`, `apps/web/src/app/api/public/quotes/route.ts` | **Silent quote loss.** `enqueueQuoteJob()` caught errors but never re-threw — API returned success while quote was stuck at `queued` forever. Fix: re-throw queue errors. Quotes route now catches queue failures, marks quote as `failed`, and returns a warning to the customer. |
| FIX-GEMINI | `apps/worker/src/ai/signals.ts`, `apps/worker/src/quote-processor.ts` | **Double Gemini API call.** When `expected_signals` configured, both `extractStructuredSignals()` AND `extractSignals()` were called — same images sent to Gemini twice. Fix: `extractStructuredSignals()` now returns both legacy and structured formats from a single call. Halves API cost for structured-signal services. |
| FIX-COMMA | `apps/worker/src/quote-processor.ts` | **"1,500" parsed as 501.** `convertFormValueToSignal()` split on commas and summed parts. Fix: detect thousands-separator pattern (`/^\d{1,3}(,\d{3})+(\.\d+)?$/`) first — "1,500" → 1500. Only sum when genuinely comma-separated measurements ("130,120,95" → 345). |

**Fix Dependencies:**
- FIX-IMG depends on `asset_ids` being stored on `quote_requests` (existing behavior at line 376 of quotes route)
- FIX-GEMINI changes the return type of `extractStructuredSignals()` — any other callers must destructure `{ legacy, structured }`

---

### 2026-02-04: Quote Quality Fixes v6

**Context:** Five quality fixes addressing signal type resolution, hardcoded keywords, aggressive conflict detection, note duplication, and stale widget configs.

**Changes:**

| Fix | File(s) | Description |
|-----|---------|-------------|
| ISSUE-1 | `apps/worker/src/quote-processor.ts` | **Signal type resolution bug.** Address "27 Maple Close, Maidstone, Kent, ME15 7QJ" was parsed as number `27` because `parseFloat()` inference overrode the config-declared `type: 'string'`. Replaced 17-line inline type resolution with `resolveSignalType()` function using metadata-first priority cascade: (1) `expected_signals` config, (2) widget field type, (3) `draft_config.suggestedFields` type, (4) strict regex inference (only if ENTIRE string matches `/^-?\d+(\.\d+)?$/`), (5) default string. Added unit tests. |
| FIX-2 | `apps/worker/src/quote-processor.ts` | Deleted hardcoded `getAddonKeyword()` (car-service-only keywords). Rewrote `isAddonCoveredByService()` to use generic word-overlap via `extractSignificantWords()`. Added shared `ADDON_STOP_WORDS` and `extractSignificantWords()` utilities. |
| FIX-3 | `apps/worker/src/quote-processor.ts` | Replaced aggressive single-word conflict matching in `isAddonConflictingWithExcludes()` with minimum-overlap approach: requires 2+ significant word overlap OR Jaccard >0.4. Fixes false positives (e.g., "Wi-Fi smart controller" blocked by "Smart home integration setup"). |
| FIX-4 | `apps/worker/src/quote-processor.ts` | Added `deduplicateNotes()`: exact dedup via Set, semantic dedup (>50% word overlap keeps longer note), max 3 notes with priority ranking. Called before saving `pricing_json.notes`. |
| FIX-5a | `apps/web/src/app/api/services/route.ts` | POST handler: added `mapsToSignal` to widget field mapping (was stripped during `.map()` transformation). |
| FIX-5b | `apps/web/src/app/api/services/[id]/route.ts` | PATCH handler: syncs `widget_configs` when `draftConfig.suggestedFields` is provided. Checks for existing config (update preserving files settings) or inserts new. |

**Architectural Decisions:**
- ISSUE-1: `resolveSignalType()` consults 3 metadata sources (expected_signals, widget field type, draft_config.suggestedFields) before any value inference. If ANY metadata source declares a type, inference is skipped entirely. The old `parseFloat()` inference was the root cause — it can't distinguish "27 Maple Close" from "27". The new strict regex `/^-?\d+(\.\d+)?$/` only matches when the ENTIRE cleaned string is numeric.
- FIX-2: `extractSignificantWords()` shared across FIX-2/FIX-3/FIX-4 — extracts words >3 chars excluding stop words. Generic approach works for any service type.
- FIX-3: Jaccard similarity threshold of 0.4 chosen to block "Full exterior paint" vs "Exterior paint not included" (high overlap) while allowing "Wi-Fi smart controller" vs "Smart home integration setup" (low overlap).
- FIX-5: v5 FIX-1 runtime fallback (draft_config → expected_signals) kept as safety net for services created before this root-cause fix.

**Known Constraints:**
- ISSUE-1: `inferSignalTypeFromValue()` returns `null` (not `'string'`) when uncertain, forcing the cascade to fall through to the default. This is intentional — returning `'string'` from inference would prevent the default from ever being reached.
- FIX-3: Direct substring match (Check 1) still catches cases like "Powerflush Treatment" vs "Powerflush" exclusion, even when word-level overlap is only 1 word. This is intentional — substring containment is a strong signal.

**Verification:** `pnpm typecheck`, `pnpm lint`, `pnpm test`.

---

### 2026-02-04: Quote Quality Fixes v5

**Context:** Five quality fixes and one cleanup task to improve signal accuracy, quote completeness, and data hygiene.

**Changes:**

| Fix | File(s) | Description |
|-----|---------|-------------|
| FIX-1 | `apps/worker/src/quote-processor.ts` | `mapsToSignal` fallback: widget fields → `draft_config.suggestedFields` → `expected_signals` matching. Added `draft_config` to service query. |
| FIX-2 | `apps/worker/src/ai/signals.ts`, `packages/shared/src/database.types.ts` | Room-based services: added `'room'` to dimensions type union and mapped it to `item_count` signal instead of `linear_distance`. |
| FIX-3 | `apps/worker/src/quote-processor.ts`, `packages/shared/src/database.types.ts`, `apps/web/src/app/api/public/quotes/[quoteId]/route.ts`, `apps/web/src/app/q/[quoteId]/page.tsx` | Available addons upsell: untriggered addons surfaced as "Optional Extras" section on quote page (green styling). Added `availableAddons` to `QuotePricing` type. |
| FIX-4 | `apps/worker/src/ai/wording.ts` | Notes deduplication: AI prompt now instructs not to repeat pricing notes verbatim in content notes. |
| FIX-5 | `scripts/fix-5-update-line-set-label.sql` | Data update script to fix form label from "Estimated line set length per unit" to "Number of line sets (indoor units)". |
| CLEANUP | `supabase/migrations/001_initial_schema.sql.bak` | Deleted legacy backup migration file. |

**Architectural Decisions:**
- FIX-1: Signal mapping uses a 3-tier fallback (widget config → draft_config → expected_signals) to handle cases where `mapsToSignal` is present in `draft_config.suggestedFields` but stripped when saved to `config_json.fields`.
- FIX-3: Available addons are stored in `pricing_json.availableAddons` alongside the pricing data. They exclude addons that conflict with `scope_excludes` or are covered by the core service.

**Verification:** `pnpm typecheck`, `pnpm lint`, `pnpm test` (93/93 tests pass).

---

### 2026-02-03: AD-014 Location Context Conflict Detection

**Context:** Cross-service recommendations incorrectly suggested "Roof Leak Repair" for a customer describing a bathroom leak. The existing AD-008 (phrase verification) and AD-010 (keyword matching) validations passed because the phrase mentioned "leak" and the service name contained "Leak".

**Problem Analysis:**
- Customer: "minor leak around the shower or bath seal... ceiling below... bathroom above"
- Incorrect Recommendation: "Roof Leak Repair & Inspection"
- Why AD-010 failed: "leak" appears in both phrase and service name ✓
- Missing check: Context (bathroom) vs Context (roof) mismatch

**Resolution:**
- File: `apps/worker/src/ai/service-detection.ts`
- Added `LOCATION_CONTEXTS` map with 12 context categories:
  - Indoor: bathroom, kitchen, bedroom, living
  - Structural: roof, basement, garage
  - Outdoor: garden, exterior
  - Systems: plumbing, electrical, heating
  - Other: vehicle, commercial
- Added `detectLocationContextConflict()` function that:
  - Extracts location contexts from customer phrase
  - Extracts location contexts from service name
  - Rejects recommendation if contexts don't overlap (e.g., bathroom vs roof)

**Example (Now Fixed):**
```
Phrase: "leak around the shower or bath seal"
  → Contexts: bathroom (shower, bath), plumbing (seal)
Service: "Roof Leak Repair"
  → Contexts: roof
Overlap check: bathroom/plumbing vs roof → NO OVERLAP → REJECTED
```

**Non-hardcoding Compliance:**
- `LOCATION_CONTEXTS` is a generic mapping, not tied to specific service names
- Groups semantically equivalent words that apply universally
- Can be extended without code changes (future: config-driven)

**Verification:**
- TypeScript type checking passes
- ESLint passes
- Bathroom leak customer will NOT get "Roof Leak Repair" recommendation

**Related to:** AD-008, AD-010, Cross-Service Quality

---

### 2026-02-03: Comprehensive Quote Validation Architecture

**Context:** Implemented a comprehensive quote validation system to catch ALL quote quality issues before quotes reach customers. The system validates pricing completeness, scope text, potential additional work, cross-service recommendations, addons, notes, and logical consistency.

**Files Created/Modified:**
| File | Action | Purpose |
|------|--------|---------|
| `supabase/migrations/00000000000012_quote_validation_logs.sql` | Created | Database table for validation logs + tenant settings |
| `packages/shared/src/database.types.ts` | Modified | Added 20+ validation-related types |
| `apps/worker/src/ai/quote-validator.ts` | Created | Core validator with 8 check categories |
| `apps/worker/src/ai/index.ts` | Modified | Export validator functions |
| `apps/worker/src/quote-processor.ts` | Modified | Integrated validator into pipeline |

**Validation Check Categories:**
1. **Pricing Completeness** - Form fields used, work steps triggered, expected total
2. **Scope Validation** - Promises match paid work, matches customer intent
3. **Potential Work** - No contradictions with form, no AI prices (AD-001)
4. **Cross-Service** - Service/request match, context match, negation respected
5. **Addons** - Negation respected, no conflicts with excludes
6. **Notes** - Relevance, error codes included
7. **Discounts** - No unauthorized changes
8. **Logic** - Form/description consistency

**Key Features:**
- **Auto-correction**: Automatically fixes auto-fixable issues (remove bad scope text, remove invalid recommendations)
- **Validation Logging**: All validation results logged to `quote_validation_logs` table for learning
- **Config Suggestions**: Issues flag suggested configuration fixes for business improvement
- **Tenant Settings**: Each tenant can configure validation behavior via `validation_settings` JSON column
- **Severity Levels**: Issues categorized as critical/high/medium/low with configurable actions per level

**Default Validation Settings:**
```json
{
  "enabled": true,
  "onCriticalIssue": "auto_correct",
  "onHighIssue": "auto_correct",
  "onMediumIssue": "auto_correct",
  "onLowIssue": "pass_with_warning",
  "pricingGapThresholdPercent": 20,
  "requireManualReviewAbove": 5000
}
```

**Architectural Decision:** Single comprehensive validator with structured checks (rather than multiple agents) for efficiency, shared context, and easier debugging.

**Verification:**
- All 93 worker tests pass
- TypeScript type checking passes
- ESLint passes

**Related to:** AD-001, AD-007, AD-009, AD-013, FIX-BATHROOM-1 through FIX-BATHROOM-5

---

### 2026-02-03: Bathroom Quote Quality Fixes (FIX-BATHROOM-1 to FIX-BATHROOM-4)

**Context:** A bathroom refresh quote test revealed multiple systemic issues where the quote didn't match customer expectations. Four code fixes were implemented; two issues (bathroom_size not used, missing refresh work steps) are service configuration issues requiring business dashboard changes.

---

#### FIX-BATHROOM-1: Form vs Description Conflict Detection (HIGH)

**Symptom:** Customer charged £184 rush surcharge despite description saying "ideally in the next 3 to 4 weeks". Form said "Urgent (<7 Days)" but AI correctly inferred "Flexible (2-4 weeks)" with 0.9 confidence.

**Root Cause:** `quote-processor.ts` always trusts form values (AD-007 principle), but had no mechanism to detect and flag conflicts between form input and AI inference from description.

**Resolution:**
- File: `apps/worker/src/quote-processor.ts`
- Added `detectFormDescriptionConflicts()` function that:
  - Compares AI-inferred signals (confidence ≥ 0.8) against form values
  - Detects timeline conflicts (form=urgent, description=flexible and vice versa)
  - Detects condition conflicts (form=good, description=poor and vice versa)
  - Adds warning notes to pricing without changing pricing (form still wins per AD-007)

**Example Warning Added:**
```
Note: Form selected "Urgent (<7 Days)" for Timeline, but description mentions "Flexible (2-4 weeks)". Quote uses form selection. Please confirm timeline with customer.
```

**Lesson:** Surface conflicts between form and description so businesses can follow up with customers before confirming work.

---

#### FIX-BATHROOM-4: Potential Additional Work Contradicts Form (MEDIUM)

**Symptom:** "Potential Additional Work" section suggested "Full height tiling" when form said "Splash zones only", and "Average condition prep" when form said "Good condition".

**Root Cause:** `findUnusedSignals()` in `signal-recommendations.ts` filtered by signal source but didn't do semantic matching to detect when AI signals contradict form answers.

**Resolution:**
- File: `apps/worker/src/ai/signal-recommendations.ts`
- Added `signalContradictsFormAnswer()` function with semantic mappings for:
  - `tiling_coverage`: Detects form="splash zones" vs AI="full height"
  - `condition`: Detects form="good" vs AI="poor/average"
  - `waste`: Detects form="no" vs AI suggesting waste removal
- Added filter to `findUnusedSignals()` to skip contradicting signals

**Example Filtered:**
- Form says "Splash zones only" → AI signal "tiling_coverage=full_height" is EXCLUDED from recommendations

**Lesson:** Recommendations must not contradict what the customer explicitly selected on the form.

---

#### FIX-BATHROOM-5: Scope Text Promises Unpaid Work (MEDIUM)

**Symptom:** Scope text mentioned "re-sealing around the shower area, addressing minor issues like loose grout" but these weren't line items in pricing.

**Root Cause:** AI wording generator created scope text from service description and customer keywords without validating that promised items have corresponding price lines.

**Resolution:**
- File: `apps/worker/src/ai/wording.ts`
- Added `validateScopeAgainstPricing()` function that:
  - Checks scope text for work keywords (reseal, grout, clean, repair, tile, etc.)
  - Verifies each keyword has matching line item in pricing breakdown or scopeIncludes
  - Logs warnings for scope/pricing mismatches (for business/developer visibility)

**Example Warning Logged:**
```
[Wording] Scope validation warning: Scope mentions "reseal" but no matching line item in pricing. Consider adding to exclusions or pricing.
```

**Lesson:** Scope text should describe paid work. Unpaid promises create customer expectation mismatches.

---

#### FIX-BATHROOM-2: Unused Form Field Warning (MEDIUM)

**Symptom:** Customer provided `bathroom_size: 200` sqft but it wasn't reflected in pricing. The service had no per-sqft work steps configured.

**Root Cause:** Service configuration issue - work steps used `bathroom_count` (count-based) but no steps were configured for `bathroom_size` (area-based).

**Resolution:**
- File: `apps/worker/src/pricing/rules-engine.ts`
- Added unused form field detection at end of `calculatePricingWithTrace()`:
  - Tracks which form fields are used by work steps and multipliers
  - Identifies numeric form fields that were provided but unused
  - Logs warning for developer/business visibility

**Example Warning Logged:**
```
[Pricing] Numeric form fields provided but unused in pricing: bathroom_size=200
```

**Note:** This is a diagnostic warning. The fix requires the business to add work steps that use `bathroom_size` as a quantity source (service configuration task).

---

### Out of Scope (Business Configuration Tasks)

These issues require dashboard/database changes, not code:

1. **Issue 2: bathroom_size not used** - Business needs to add work steps with `quantitySource: { type: 'form_field', fieldId: 'bathroom_size' }`

2. **Issue 3: Missing refresh work steps** - Business needs to add refresh-specific work steps:
   - `bathroom_deep_clean` (£75/bathroom)
   - `silicone_reseal` (£85 fixed)
   - `grout_refresh` (£3/sqft)
   - `minor_repairs` (£50 fixed)

---

**Files Modified:**
| File | Changes |
|------|---------|
| `apps/worker/src/quote-processor.ts` | Added `detectFormDescriptionConflicts()`, integrated into pipeline |
| `apps/worker/src/ai/signal-recommendations.ts` | Added `signalContradictsFormAnswer()`, integrated into `findUnusedSignals()` |
| `apps/worker/src/ai/wording.ts` | Added `validateScopeAgainstPricing()`, integrated into `validateContent()` |
| `apps/worker/src/pricing/rules-engine.ts` | Added unused form field detection in `calculatePricingWithTrace()` |

**Verification:**
- All 93 worker tests pass
- TypeScript type checking passes
- ESLint passes

**Related to:** AD-007 (Form signals override AI), AD-009 (Potential work limits), AD-013 (AI scope constraints)

---

### 2026-02-02: Keyword Negation in Addon Detection (FIX-NEGATION-1)

**Issue:** The pricing engine was recommending addons based on keyword matches even when customers explicitly said they didn't want extras. For example, "wobbly post" would trigger a `concrete_spur` addon recommendation even if the customer said "please no extras" in the same description.

**Root Cause:** The `findMatchingKeyword()` function in `rules-engine.ts` used simple word-boundary regex matching without any context awareness. It would match keywords regardless of surrounding negation phrases.

**Resolution:** Implemented two-layer negation detection:

1. **Global Addon Suppressors** - Phrases like "no extras", "budget only", "keep it simple" that suppress ALL keyword-triggered addons:
   ```typescript
   const GLOBAL_ADDON_SUPPRESSORS = [
     /\b(no extras?)\b/i,
     /\b(budget (only|focused|conscious))\b/i,
     /\b(keep it (simple|basic|minimal))\b/i,
     // ... etc.
   ]
   ```

2. **Contextual Keyword Negation** - Checks if a specific keyword appears after negation words within 3 words:
   ```typescript
   // Pattern: negation word + 0-2 words + keyword
   // e.g., "don't want fridge", "no extra polish"
   ```

**Files Modified:**
- `apps/worker/src/pricing/rules-engine.ts` - Added negation detection functions and integrated into addon matching
- `apps/worker/src/pricing/rules-engine.test.ts` - Added TEST-13 with 6 test cases for negation detection

**Test Coverage (TEST-13):**
- "no extras" suppresses all addons
- Negated keyword ("don't clean fridge") is skipped
- Non-negated keyword still matches correctly
- "budget only" acts as global suppressor
- "keep it simple" acts as global suppressor
- Negation with intervening words ("don't want the fridge")

**Verification:**
- All 28 rules-engine tests pass
- All 43 fence-scenario tests pass
- PRICE-SENSITIVE scenario now correctly has no addon recommendations

**Related to:** Fence Service E2E Stress Test diagnostic report (HIGH priority issue)

---

### 2026-02-01: E2E Quote Processing Integration Tests

**Context:** Implemented comprehensive E2E integration tests for the quote processing pipeline. These tests verify the complete flow from quote request submission through pricing calculation, with mocked AI signals to ensure deterministic test results.

#### TEST SUITE: E2E Quote Processing Tests

**Files:**
- `apps/worker/src/__tests__/quote-processing.test.ts` - Main integration test file (22 tests)
- `apps/worker/src/__tests__/fixtures/test-services.ts` - Test service configurations
- `apps/worker/src/__tests__/mocks/ai-signals.ts` - Mock AI signal responses

**Coverage (22 tests across 6 scenarios):**
- TEST-E2E-1: Basic Quote Processing - Verifies pricing breakdown, tax, trace summary
- TEST-E2E-2: Addon Keyword Detection - Verifies auto-recommended addons from description keywords
- TEST-E2E-3: Cross-Service Detection - Verifies pricing unaffected by cross-service mentions
- TEST-E2E-4: Signal Recommendations - Verifies processing continues with unused AI signals
- TEST-E2E-5: Low Confidence Fallback - Verifies price range shown for low confidence scenarios
- TEST-E2E-6: Form Override - Verifies form values override AI signals (AD-007 compliance)

**Key Outputs Verified:**
- `pricing_json`: subtotal, taxAmount, total, breakdown (with autoRecommended flags), recommendedAddons, notes
- `pricing_trace_json`: trace steps, summary (baseFee, workStepsTotal, addonsTotal, multiplierAdjustment, taxAmount, total)
- `signals_json`: confidence, signals array

**Test Architecture:**
- Mock AI signal extraction for deterministic results
- Test the full pricing pipeline directly
- Verify all output fields match expected calculations

**Run Tests:**
```bash
pnpm --filter @estimator/worker test
```

---

### 2026-02-01: Pricing Accuracy Test Suite & Bug Fix

**Context:** Implemented comprehensive pricing accuracy test suite with 22 tests covering all pricing components (work steps, addons, multipliers, tax, minimum charge). Tests verify mathematical correctness of the deterministic pricing engine.

---

#### ISSUE-9: String Boolean Values Not Compared to Boolean Config (MEDIUM)

**Symptom:** Multiplier with `equals: true` for `heavy_soiling` not applied when form submitted `"true"` (string).

**Root Cause:**
- File: `apps/worker/src/pricing/rules-engine.ts`
- The code handled boolean answer values compared to string config values (e.g., `true` vs `"Yes"`)
- But it didn't handle the reverse: string answer values compared to boolean config values (e.g., `"true"` vs `true`)

**Resolution:**
- Added new case in `shouldApplyMultiplier()` for string answer → boolean compareValue:
```typescript
// Handle string answer value that represents a boolean → boolean compareValue
if (typeof answer.value === 'string' && typeof compareValue === 'boolean') {
  const answerAsBool =
    answer.value === 'true' ||
    answer.value === 'True' ||
    answer.value === 'TRUE' ||
    answer.value === 'Yes' ||
    answer.value === 'yes' ||
    answer.value === 'YES' ||
    answer.value === '1'
  return answerAsBool === compareValue
}
```

**Lesson:** Form data can arrive as either booleans or strings depending on the form framework. Handle both directions of comparison.

---

#### TEST SUITE: Pricing Accuracy Tests

**File:** `apps/worker/src/pricing/rules-engine.test.ts`

**Coverage (22 tests):**
- TEST-1: Basic quote calculation (4 rooms, 2 bathrooms)
- TEST-2: Full service with all optional work steps and addons
- TEST-3: Minimum charge NOT triggered (above minimum)
- TEST-4: Minimum charge TRIGGERED (below minimum)
- TEST-5: String number parsing from form inputs
- TEST-6: Boolean string values ("true", "Yes")
- TEST-7: Array field multipliers (multi-select)
- TEST-8: Numeric comparison operators (gt, lt, lte, gte)
- TEST-9: Zero quantities don't create $0 lines
- TEST-10: Tax rounding precision (no floating-point errors)
- TEST-11: Multiplier stacking order (multiplicative)
- TEST-12: Addon keyword case sensitivity
- Additional edge cases (empty forms, disabled tax, large numbers)

**Test Service:** "Complete Home Cleaning" with comprehensive configuration:
- Base fee: £25, Minimum charge: £75
- Work steps: Room cleaning (per-unit), Bathroom (per-unit), Kitchen (fixed), Oven (optional), Carpet (optional), Windows (optional)
- Addons: Fridge, Laundry, Pet treatment (keyword-triggered)
- Multipliers: Property size, Urgency, Heavy soiling, New customer, Loyalty

**Run Tests:**
```bash
pnpm --filter @estimator/worker test
```

---

### 2026-02-01: Quote Generation Quality Fixes v6 (Stress Testing)

**Context:** Designed 20 ultra-realistic test scenarios across 7 service categories and identified 8 bugs/issues affecting real-world quote generation.

---

#### ISSUE-1: Numeric Comparison Operators Fail with String Form Values (HIGH)

**Symptom:** Multiplier with `gte: 25` for `roof_age_years` not applied when form submitted `"30"` (string).

**Root Cause:**
- File: `apps/worker/src/pricing/rules-engine.ts`
- Operators `gt`, `lt`, `gte`, `lte` required BOTH values to be `typeof number`
- Form inputs often come as strings, so `typeof "30" === 'string'` caused silent failure

**Resolution:**
- Added `coerceToNumber()` helper function with comma handling
- Updated all numeric operators to use coercion:
```typescript
case 'gte': {
  const answerNum = coerceToNumber(answer.value)
  const compareNum = coerceToNumber(compareValue)
  if (answerNum === null || compareNum === null) return false
  return answerNum >= compareNum
}
```

**Lesson:** Form data types are unpredictable. Numeric comparisons must coerce before comparing.

---

#### ISSUE-2: Comma-Separated Numbers Not Parsed (MEDIUM)

**Symptom:** Floor area "2,400" parsed as 2 instead of 2400, causing massive undercharge.

**Root Cause:**
- `parseFloat("2,400")` stops at first non-numeric character → returns 2
- Common UK/US formatting uses commas for thousands

**Resolution:**
- `coerceToNumber()` strips commas: `value.replace(/,/g, '')`
- Updated `calculateWorkStepCost()` to use `coerceToNumber()` for form field parsing
- Updated type inference in `quote-processor.ts` to detect comma-formatted numbers

**Lesson:** Always normalize number formats before parsing.

---

#### ISSUE-3: Zero Quantity Creates $0 Line Items (LOW)

**Symptom:** Quote shows "0 sockets × £25 = £0" instead of omitting the line.

**Root Cause:** No check to skip zero-cost line items in work step processing.

**Resolution:**
- Added check after `calculateWorkStepCost()`:
```typescript
if (stepResult.cost === 0) {
  console.log(`[Pricing] Skipping work step "${step.name}" - zero cost`)
  continue
}
```

**Lesson:** Zero-value line items are unprofessional. Skip them.

---

#### ISSUE-4: Array Contains Doesn't Match Case-Insensitively (MEDIUM)

**Symptom:** Multi-select `["network", "endpoints", "cloud_m365"]` didn't match multiplier `contains: "Cloud_M365"`.

**Root Cause:** Array `includes()` uses strict equality, case-sensitive.

**Resolution:**
- Updated `contains` operator for arrays:
```typescript
if (Array.isArray(answer.value) && typeof compareValue === 'string') {
  const compareValueLower = compareValue.toLowerCase()
  return answer.value.some(v =>
    typeof v === 'string' && v.toLowerCase() === compareValueLower
  )
}
```

**Lesson:** Multi-select values need case-insensitive matching.

---

#### ISSUE-5: Explicit Negation Not Detected in Cross-Service (HIGH)

**Symptom:** Customer wrote "thinking of getting an awning but not for this quote" but awning service was still recommended.

**Root Cause:** `isGenuineServiceRequest()` didn't detect explicit negation phrases.

**Resolution:**
- Added negation patterns to `nonRequestPatterns`:
```typescript
/\b(not for this|not for now|not this time)\b/i,
/\b(don'?t need|won'?t need|no need)\b/i,
/\b(not needed|not required|not necessary)\b/i,
/\b(don'?t want|won'?t want)\b/i,
/\b(just mentioning|for context|for reference)\b/i,
/\b(thinking of|considering|might|maybe)\b.*\b(but not|but later|another time)\b/i,
/\b(separate|different|another)\s+(quote|job|project)\b/i,
```

**Lesson:** Explicit customer negations must be respected.

---

#### ISSUE-6: Ambiguous Values Not Handled (MEDIUM)

**Symptom:** `levelling_required: "possibly"` treated as truthy, included in firm price.

**Root Cause:** No detection of ambiguous/uncertain values like "possibly", "maybe", "quote_option".

**Resolution:**
- Added `detectAmbiguousValue()` function
- `convertFormValueToSignal()` returns `null` for ambiguous values
- Ambiguous values are logged and skipped from firm pricing

**Lesson:** Uncertain customer inputs shouldn't be included in firm quotes.

---

#### ISSUE-7: Multi-Value Fields (Arrays) in Multipliers `equals` (MEDIUM)

**Symptom:** Array field `audit_scope: ["network", "endpoints", "cloud_m365"]` didn't trigger multiplier `equals: "network"`.

**Root Cause:** `equals` operator for arrays only checked strict equality, not contains.

**Resolution:**
- Added array handling to `equals` operator:
```typescript
if (Array.isArray(answer.value) && typeof compareValue === 'string') {
  const compareValueLower = compareValue.toLowerCase()
  const hasMatch = answer.value.some(v =>
    typeof v === 'string' && v.toLowerCase() === compareValueLower
  )
  return hasMatch
}
```

**Lesson:** Multipliers with `equals` should match any value in multi-select arrays.

---

#### ISSUE-8: Tax Calculation Rounding (LOW)

**Symptom:** Potential penny discrepancies with fractional tax rates.

**Root Cause:** Formula `Math.round(subtotal * rate) / 100` assumed rate is percentage integer.

**Resolution:**
- Changed to explicit percentage calculation:
```typescript
const rawTax = subtotal * (taxConfig.rate / 100)
taxAmount = Math.round(rawTax * 100) / 100
```
- Updated all 3 tax calculation locations

**Lesson:** Tax calculations should be explicit about percentage conversion.

---

### Files Modified

| File | Issues Fixed |
|------|-------------|
| `apps/worker/src/pricing/rules-engine.ts` | ISSUE-1, 2, 3, 4, 7, 8 |
| `apps/worker/src/quote-processor.ts` | ISSUE-2, 5, 6 |

---

### 2026-02-01: Quote Generation Quality Fixes v5

**Context:** Testing cybersecurity service quote revealed four issues. All fixes are future-proof with no hardcoded values.

---

#### FIX-1: Use structuredSignals.overallConfidence (CRITICAL)

**Symptom:** "Price shown as range due to limited information" appeared incorrectly for form-only submissions.

**Root Cause:** `calculatePricingWithTrace()` used legacy `signals.confidence` (defaults to 0.5 without images) instead of `structuredSignals.overallConfidence` (1.0 after form signals merged).

**Resolution:**
- File: `apps/worker/src/pricing/rules-engine.ts`
  - Changed: `const confidence = structuredSignals?.overallConfidence ?? signals.confidence`
  - Falls back to legacy confidence only when structuredSignals unavailable

**Lesson:** After form signal merging, `structuredSignals.overallConfidence` reflects true confidence (1.0 for form data).

---

#### FIX-2: No Warnings for Photo-Optional Services (HIGH)

**Symptom:** Three warnings appeared ("No images provided", "Site visit recommended") for services where `minPhotos = 0`.

**Root Cause:** No distinction between photo-required vs photo-optional services when no images uploaded.

**Resolution:**
- File: `apps/worker/src/ai/signals.ts`
  - Added `getSignalsWithoutImagesPhotoOptional()` - returns confidence 0.8, no warnings, no site visit
  - Added `getSignalsWithoutImagesV2PhotoOptional()` - matching V2 version
- File: `apps/worker/src/ai/index.ts`
  - Exported new functions
- File: `apps/worker/src/quote-processor.ts`
  - Checks `service.media_config?.minPhotos ?? 1`
  - Uses photo-optional functions when `minPhotos === 0`

**Lesson:** Business configuration (`minPhotos`) should control whether missing photos trigger warnings.

---

#### FIX-3: Enhanced String Matching for Multipliers (MEDIUM)

**Symptom:** Timeline multiplier not applied. `"urgent_(<7_days)"` didn't match `"Urgent (<7 days)"`.

**Root Cause:** Case-insensitive comparison insufficient when format differs (underscores vs spaces, brackets).

**Resolution:**
- File: `apps/worker/src/pricing/rules-engine.ts`
  - Enhanced `shouldApplyMultiplier()` for `equals` operator
  - Added `normalize()` function: converts to lowercase, underscores→spaces, removes brackets
  - `"urgent_(<7_days)"` → `"urgent 7 days"` matches `"Urgent (<7 days)"` → `"urgent 7 days"`

**Lesson:** Form option values may have format variations. Normalize before comparing.

---

#### FIX-4: Intent-Aware Addon Detection (MEDIUM)

**Symptom:** Phishing Simulation addon not recommended despite customer saying "want to tighten our controls".

**Root Cause:** FIX-7 (symptom vs solution) was too conservative - blocked intent signals.

**Resolution:**
- File: `apps/worker/src/ai/signals.ts`
  - Enhanced `detectAddonsFromDescription()` prompt
  - Added "INTENT SIGNALS" category: recognizes goal keywords ("want to", "need to", "improve", "prevent", "strengthen", "tighten", "ensure", "enhance")
  - Added "CONTEXT COMBINATION" rule: symptom + intent = recommend

**Lesson:** Distinguish between passive symptoms (no action) vs expressed intent (has goal).

---

### 2026-02-01: Quote Generation Quality Fixes v4

**Context:** Deep analysis of a boiler service quote test revealed multiple issues with quote generation quality. Four fixes were implemented based on severity.

---

#### FIX-1: Remove AI Prices from Potential Additional Work (CRITICAL)

**Symptom:** "Potential Additional Work" section showed AI-invented prices like £180, £125, £150 that were not from business configuration.

**Root Cause:** `signal-recommendations.ts` asked AI to generate `estimatedCost` values.

**Resolution (AD-001 Compliance):**
- File: `packages/shared/src/database.types.ts`
  - Made `estimatedCost` optional and deprecated
  - Updated `costBreakdown` to contain work description without prices
- File: `apps/worker/src/ai/signal-recommendations.ts`
  - Prompt now asks for `whatItInvolves` (work description) not costs
  - Added `stripPricesFromText()` to defensively remove any price patterns
  - Recommendations now describe WHAT might be needed, not how much it costs

**Lesson:** Extends AD-001 - AI can suggest work but cannot set or estimate prices.

---

#### FIX-2: Addon vs Exclusion Conflict Check (CRITICAL)

**Symptom:** "Powerflush" addon was auto-recommended even though "Powerflush" was in `scope_excludes`.

**Root Cause:** No check to prevent recommending addons that conflict with explicit exclusions.

**Resolution:**
- File: `apps/worker/src/quote-processor.ts`
  - Added `isAddonConflictingWithExcludes()` function
  - Checks addon label/ID against `scope_excludes` words
  - Applied to both description-based and image-based addon detection
  - Logs when addon is skipped due to conflict

**Lesson:** Exclusions should prevent not just scope promises but also addon recommendations.

---

#### FIX-3: Vision Severity Calibration (HIGH)

**Symptom:** Severe corrosion with water staining rated as "fair" instead of "poor".

**Root Cause:** Vision prompt lacked calibration guidance for condition ratings.

**Resolution:**
- File: `apps/worker/src/ai/signals.ts`
  - Added "CONDITION RATING CALIBRATION" section to prompt
  - Clear definitions for excellent/good/fair/poor
  - Explicit examples: "Rust on pipe joints + water staining = poor"
  - Instruction to err on the side of rating WORSE when damage is visible

**Lesson:** AI vision needs explicit calibration examples for severity assessment.

---

#### FIX-6: Error Code Integration (HIGH)

**Symptom:** Customer-reported error codes (e.g., boiler "EA" code) captured but not used in quote wording.

**Root Cause:** Error codes extracted as signals but not passed to wording context.

**Resolution:**
- File: `apps/worker/src/ai/wording.ts`
  - Added `errorCode?: string` to `WordingContext`
  - Added prompt section for error code with instruction to explain if recognized
- File: `apps/worker/src/quote-processor.ts`
  - Extracts error code from structured signals (keys: error_code, boiler_error_code, fault_code, display_code)
  - Passes to wording context

**Lesson:** Captured signals should flow through to customer-facing content.

---

**Note:** FIX-5 (work step triggers) is a configuration issue, not code.

---

### 2026-02-01: Quote Generation Quality Fixes v4 - Remaining Fixes

Additional fixes from the v4 analysis, implementing FIX-4, FIX-7, and FIX-8.

---

#### FIX-4: Ignore Unused Signals in Fallback Calculation (HIGH)

**Symptom:** `linear_distance` triggered fallback mode (`"Low confidence for: linear_distance"`) for boiler service even though no work step uses that signal.

**Root Cause:** All low-confidence signals triggered fallback, regardless of whether they're actually used in pricing.

**Resolution:**
- File: `apps/worker/src/quote-processor.ts`
  - Added `getUsedSignalKeys()` function to extract signal keys referenced by work steps
  - Modified `evaluateFallback()` to only include signals that are actually used
  - Logs when ignoring unused low-confidence signals

**Lesson:** Fallback should only trigger for signals that affect pricing, not all extracted signals.

---

#### FIX-7: Smarter Addon Keyword Matching (MEDIUM)

**Symptom:** "radiators go lukewarm" triggered Powerflush recommendation - symptom words matching addon names.

**Root Cause:** AI addon detection didn't distinguish between symptoms and explicit requests.

**Resolution:**
- File: `apps/worker/src/ai/signals.ts`
  - Updated `detectAddonsFromDescription` prompt with "SYMPTOM vs SOLUTION DISTINCTION" section
  - Clear examples of symptoms (don't match) vs requests (do match)
  - AI now only recommends addons when customer explicitly requests or mentions them

**Lesson:** Natural language understanding must distinguish between describing problems and requesting solutions.

---

#### FIX-8: Form Data Overrides Vision for Access (MEDIUM)

**Symptom:** Customer said "Access is easy" but AI detected "moderate" from cabinet photos, causing "Cabinet modification" to be recommended.

**Root Cause:** Customer's explicit statement about access wasn't overriding AI vision assessment.

**Resolution:**
- File: `apps/worker/src/quote-processor.ts`
  - Added `detectAccessOverrideFromDescription()` function
  - Checks project description for explicit access statements
  - Overrides `access_difficulty` signal with confidence 1.0 when found
  - Patterns: "access is easy", "easy access", "readily accessible", etc.

**Lesson:** Explicit customer statements should override AI inference (extends AD-002).

---

### 2026-01-31: AI Scope Constraint & No-Hardcode Rule

**Context:** Customer asked "if possible, a service at the same time" and AI responded with "A boiler service is included" in the scope summary. The business never configured boiler servicing as part of this service.

**Impact:**
- If business doesn't offer it → loses trust when they can't deliver
- If business offers it at extra cost → loses money because AI said it's "included"

**Root Cause:**
- `scope_includes` was passed to AI as informational context, not a hard constraint
- The prompt said "reference what's included if provided" (optional)
- No explicit instruction telling AI it CANNOT mention services outside `scope_includes`
- AI read customer's "if possible, a service" as intent and included it

**Resolution:**

1. **File: `/CLAUDE.md`**
   - Added "Anti-hardcoding principle" section to Code conventions
   - Prevents future hardcoded fixes like "add 'boiler servicing' to excludes"
   - All business values must come from database configuration

2. **File: `apps/worker/src/ai/wording.ts`**
   - Added "CRITICAL - SCOPE BOUNDARIES ARE ABSOLUTE" section to WORDING_PROMPT
   - Explicit rules: MUST NOT mention services outside scope_includes
   - Customer requests outside scope acknowledged in notes, not promised
   - Examples showing correct vs wrong behavior

**Lesson:** This extends AD-001 (AI must not set prices) to "AI must not expand scope". The business configuration is the absolute boundary for what can be offered.

**See:** AD-013 for the architectural decision.

---

### 2026-01-31: Intelligent Signal Key Unification

**Context:** The BUG-001 fix used a hardcoded synonym map to match form signals to AI signals. This approach was not scalable (adding "paper_count" requires code changes) and brittle (substring matching, order-dependent). The system already had infrastructure for proper signal mapping (`mapsToSignal`, `expected_signals`) but it wasn't being used intelligently.

**Root Cause:** Form fields and AI extraction used DIFFERENT signal keys:
- Form field: `fieldId: "number_of_leaks"` (human-created)
- AI signal: `key: "leak_count"` (AI-invented)

Then the system tried to reconcile them with a brittle synonym map.

**Solution: Canonical Signal Key Derivation (AD-012)**

Instead of post-hoc matching, make form and AI use the SAME key from the start:
1. When a user creates a question like "How many papers?", the system auto-derives `paper_count`
2. This becomes the `mapsToSignal` on the field AND the signal key in `expectedSignals`
3. AI is constrained to use ONLY these expected signal keys

**Changes Made:**

1. **File: `apps/web/src/app/(dashboard)/app/services/page.tsx`**
   - Added `deriveSignalKey(label, fieldType)` function that intelligently derives canonical keys:
     - "How many papers?" (number) → `paper_count`
     - "Number of Leaks" (number) → `leak_count`
     - "Approximate Age of Roof" (number) → `roof_age`
     - "Is the leak causing interior damage?" (boolean) → `has_interior_damage`
     - "Type of Roofing Material" (dropdown) → `roofing_material_type`
   - Removes common filler words (how many, number of, please enter, etc.)
   - Singularizes plurals (papers → paper)
   - Adds appropriate suffix based on field type (_count, _type, has_, etc.)
   - Updated `fieldToSignal()` to use `deriveSignalKey()`

2. **File: `apps/worker/src/ai/signals.ts`**
   - Rewrote `buildExpectedSignalsPromptSection()` with STRICT instructions
   - AI is now explicitly told to use ONLY the provided signal keys
   - Prohibits AI from inventing new keys like "item_count" when "paper_count" is expected
   - Clear examples showing correct key usage

3. **File: `apps/worker/src/quote-processor.ts`**
   - Simplified `findSemanticSignalMatch()` to prioritize explicit `mapsToSignal`
   - Removed the hardcoded synonym map (no longer needed)
   - Matching order: direct mapsToSignal → exact fieldId → normalized → singular/plural
   - Added `mapsToSignal` parameter to the function

**Benefits:**
- No hardcoded synonyms - works for ANY field type automatically
- Deterministic - same derivation logic everywhere
- Self-documenting - `expected_signals` explicitly lists what matters
- AI-constrained - AI uses the keys we define, not invented ones
- Scalable - add new question types without code changes

**Lesson:** Signal matching should happen at configuration time, not processing time. By ensuring form and AI use identical canonical keys, we eliminate the need for fuzzy post-hoc matching.

---

### 2026-01-31: Quote Quality Fixes v3 (Comprehensive Review)

**Context:** Continued testing after v1.5.0 revealed 2 additional critical bugs. Cross-service recommendations were matching wrong services (gutter request → Window Cleaning), and multipliers were not being applied due to type comparison failures.

---

#### BUG-004: Cross-Service Recommending Wrong Service - CRITICAL

**Symptom:** Customer requested "gutter cleaning" but "Residential Window Cleaning" was recommended instead. The matched phrase verification (AD-008) passed because the phrase existed, but the SERVICE was wrong.

**Root Cause:**
- AD-008 verification only checked if `matchedPhrase` exists in source text
- It did NOT verify that the recommended SERVICE matches the customer's REQUEST
- Customer said "gutter cleaning" → AI matched to "Window Cleaning" because:
  - Either no "Gutter Cleaning" service exists
  - Or AI made a wrong semantic connection between "gutter" and "window"

**Resolution:**
- File: `apps/worker/src/ai/service-detection.ts`
- Added AD-010: Service-request relevance validation after phrase verification
- Extracts key object words from the matched phrase (e.g., "gutter" from "gutter cleaning")
- Verifies the recommended service name contains the key object word
- Handles singular/plural variations (gutters → gutter)
- Rejects recommendations where service name doesn't match request keywords

**Lesson:** Phrase verification alone isn't enough. The recommended SERVICE must semantically match what the customer REQUESTED.

---

#### BUG-005: Multipliers Not Being Applied - CRITICAL

**Symptom:** User configured multipliers (e.g., "When roof age ≥ 10 → +5%", "When interior damage = Yes → +10%") but `multiplierAdjustment: 0` in pricing trace. Conditions were met but multipliers not applied.

**Root Cause:**
- File: `apps/worker/src/pricing/rules-engine.ts` line 649
- `case 'equals': return answer.value === compareValue` used STRICT equality
- Form checkbox submits `interior_damage: true` (boolean)
- Multiplier config has `equals: "Yes"` (string)
- `true === "Yes"` evaluates to `false` due to type mismatch
- Same issue with number values: `10` (number) vs `"10"` (string)

**Resolution:**
- File: `apps/worker/src/pricing/rules-engine.ts`
- Replaced strict equality with type-aware comparison in `shouldApplyMultiplier()`
- Boolean handling: `true` matches "Yes", "yes", "true", "1", 1
- Number handling: Compares as numbers if both can be parsed
- String handling: Case-insensitive comparison
- Fallback to strict equality for other types

**Lesson:** Form data types and config value types may differ. Comparison logic must normalize types before checking equality.

---

### 2026-01-31: Quote Quality Fixes v2 (Deep Investigation)

**Context:** Deep investigation of the v1.4.0 fixes revealed 3 critical bugs that were missed. These bugs caused form data to not properly override AI signals, false cross-service recommendations, and pricing configuration loss.

---

#### BUG-001: Signal Key Semantic Mismatch - CRITICAL

**Symptom:** Customer submitted "Number of Leaks: 2" via form, but signals_json showed BOTH `number_of_leaks=2` (form) AND `leak_count=1` (AI). The AI signal was sometimes used in pricing instead of the form signal.

**Root Cause:**
- Form used field ID `number_of_leaks` but AI extracted signal key `leak_count`
- Different keys = no override happened, both signals coexisted
- The form signal merge code only did exact key matching

**Resolution:**
- File: `apps/worker/src/quote-processor.ts`
- Added `findSemanticSignalMatch()` function that normalizes keys and matches synonyms
- Normalization: removes `number_of_`, `_count`, `_quantity` suffixes
- Synonym groups: `['leak', 'leaks', 'leakcount']`, `['room', 'rooms']`, etc.
- Form signal now finds and overrides the AI signal even with different keys

**Lesson:** Form->AI signal matching needs semantic awareness, not just exact string matching.

---

#### BUG-002: Keyword Fallback Bypassed Phrase Verification - CRITICAL

**Symptom:** "Residential Window Cleaning" recommended for roof leak quote. Customer said "gutters overflow on that side sometimes" but quote showed "The customer explicitly requests gutter cleaning with the phrase 'I might need some gutter cleaning as well.'" - a hallucinated phrase.

**Root Cause:**
- AI detection (AD-008) had phrase verification to prevent hallucination
- Keyword fallback `detectCrossServiceMentionsKeywords()` had NO verification
- Window Cleaning had keyword "gutter" → matched "gutters overflow" → false positive
- The "reason" text was fabricated, not from actual customer input

**Resolution:**
- File: `apps/worker/src/quote-processor.ts`
- Added `extractPhraseContext()` to get actual text around keyword match
- Added `isGenuineServiceRequest()` to verify intent patterns
- Request patterns: "need", "want", "require", "looking for", "also", "as well"
- Non-request patterns: "overflow", "sometimes", "because of", "near"
- Keyword matches must pass verification to be recommended

**Lesson:** ALL detection paths need the same validation rigor. Fallbacks can't be lower quality.

---

#### BUG-003: Add-ons and Multipliers Not Saved - CRITICAL

**Symptom:** User configured add-ons and multipliers in service wizard, but after saving and reloading, they were gone. Only default empty values shown.

**Root Cause:**
- POST handler destructured request body but `pricingRules` was NOT included
- PATCH handler same issue - `pricingRules` not extracted
- POST inserted hardcoded defaults: `{ baseFee: 0, addons: [], multipliers: [] }`
- Frontend sent `pricingRules` but API ignored it completely

**Resolution:**
- File: `apps/web/src/app/api/services/route.ts` (POST)
  - Added `pricingRules` to request body destructuring
  - Use `pricingRules.baseFee`, `.addons`, `.multipliers` in insert
  - Return `pricing_rules` in response for frontend state update
- File: `apps/web/src/app/api/services/[id]/route.ts` (PATCH)
  - Added `pricingRules` to request body destructuring
  - Added upsert to `service_pricing_rules` when `pricingRules` provided
  - Return `pricing_rules` in response
- File: `apps/web/src/app/api/services/route.ts` (GET)
  - Added join with `service_pricing_rules` table
  - Transform response to include `pricing_rules` at top level
- File: `apps/web/src/app/api/services/[id]/route.ts` (GET)
  - Added join with `service_pricing_rules` table
  - Transform response to include `pricing_rules` at top level

**Lesson:** When adding new fields to a wizard, ensure the API handler extracts and persists them, AND returns them when fetching.

---

### 2026-01-31: Quote Quality Fixes (Roof Leak Test)

**Context:** Testing a roof leak quote submission revealed 6 quality issues that made quotes look unprofessional.

---

#### Issue #1: Form Data Ignored (leak_count=2 became 1) - CRITICAL

**Symptom:** Customer submitted "Number of Leaks: 2" via form, but quote showed "1 leak" because AI vision extraction was used instead.

**Root Cause:**
- Form signal merge in `quote-processor.ts` line 382 was conditional on `service.expected_signals && service.expected_signals.length > 0`
- If `expected_signals` was empty/not configured, form answers were NEVER merged into signals
- AI-extracted signals (often wrong) were used instead of customer-provided form data

**Resolution:**
- File: `apps/worker/src/quote-processor.ts`
- Changed form signal merge to be UNCONDITIONAL - now happens if `structuredSignals` exists
- Processes EACH form answer, not just those matching `expected_signals`
- Uses `mapsToSignal` from widget config or falls back to `fieldId` as signal key
- Form signals always have `confidence: 1.0` and `source: 'form'`

**Lesson:** Form data is the source of truth - it should ALWAYS override AI guesses, regardless of signal configuration.

---

#### Issue #2: Window Cleaning Recommended for Roof Leak - HIGH

**Symptom:** AI recommended "Window Cleaning" service for a roof leak quote. Customer never mentioned windows.

**Root Cause:**
- AI fabricated `matchedPhrase: "may require gutter cleaning"` that didn't exist in customer text
- Previous validation only checked phrase length (> 5 chars), not existence in source

**Resolution:**
- File: `apps/worker/src/ai/service-detection.ts`
- Added phrase existence verification: `descriptionLower.includes(phraseLower)`
- If `matchedPhrase` doesn't exist in source text, recommendation is REJECTED
- Raised confidence threshold from 0.8 to 0.9 to reduce false positives
- Added anti-hallucination rule to AI prompt

**Lesson:** AI-generated phrases must be verified against source text to prevent hallucination.

---

#### Issue #3: 6 Verbose Potential Work Items - MEDIUM

**Symptom:** Quote showed 6 "potential additional work" items with 2-3 sentence descriptions each, overwhelming the customer.

**Root Cause:**
- No limit in AI prompt for number of recommendations
- No constraint on description length in prompt

**Resolution:**
- File: `apps/worker/src/ai/signal-recommendations.ts`
- Updated prompt with strict constraints:
  - Maximum 3 recommendations
  - `workDescription`: 3-5 words only
  - `reason`: 1 sentence, max 20 words
  - `costBreakdown`: short phrase
- Added hard limit in `parseRecommendations()`: `slice(0, MAX_RECOMMENDATIONS)`
- Recommendations sorted by confidence before trimming

**Lesson:** AI output needs explicit length constraints, plus code-level enforcement as backup.

---

#### Issue #4: Scope Says "Inspection" When Customer Wants "Repair" - MEDIUM

**Symptom:** Customer wrote "carry out a repair... permanent fix, not just sealant" but scope summary only mentioned "inspect and provide a report".

**Root Cause:**
- Wording prompt didn't instruct AI to match scope language to customer intent keywords
- AI defaulted to conservative "inspection" language

**Resolution:**
- File: `apps/worker/src/ai/wording.ts`
- Added "SCOPE MUST MATCH CUSTOMER INTENT" section to prompt
- Intent detection based on keywords: repair/fix/replace vs inspect/check/assess
- Clear guidance for when pricing covers Phase 1 only but customer wants repair

**Lesson:** AI-generated wording must reflect customer's stated intent, not generic safe language.

---

#### Issue #5: Service Configuration Mismatch (Not a Code Bug)

**Symptom:** Service named "Roof Leak Repair" but work steps only included Inspection + Report, no repair line items.

**Root Cause:** Configuration issue - business configured service name implying repair but didn't add repair work steps.

**Resolution:**
- File: `apps/web/src/app/(dashboard)/app/services/page.tsx`
- Added validation warning in Test step:
  - Detects if service name contains "repair/fix/replace"
  - Checks if any work steps contain those keywords
  - Shows warning: "Service name includes 'Repair' but no repair work steps configured"

**Lesson:** UI should help users catch configuration mismatches before publishing.

---

### 2025-01-31: Service Creation UI Simplification

**Goal:** Make service creation simple and intuitive for business owners.

**Changes Made:**

1. **Renamed tabs to business-friendly terms:**
   - "Signals & Steps" → "Pricing Setup"
   - "Widget Fields" → "Customer Questions"

2. **Hidden "Expected Signals" editor:**
   - Business owners don't need to understand signals
   - Signals are now auto-generated from form fields

3. **Renamed "Work Steps" to "Price Breakdown":**
   - Clearer description: "Define how you charge for this service. Each item appears as a line on the quote."

4. **Updated Work Step trigger dropdown:**
   - Now shows question labels instead of signal keys
   - E.g., "How many employees?" instead of "employee_count"

5. **Removed arbitrary limits:**
   - Work steps no longer limited to 5 (was arbitrary)

**Files Changed:**
- `apps/web/src/app/(dashboard)/app/services/page.tsx`
- `apps/web/src/components/WorkStepEditor.tsx`
- `packages/shared/src/database.types.ts` (added SuggestedField type export)

**No Backend Changes:** AI extraction, pricing engine, and signal processing remain unchanged.

---

### 2025-01-30: IT Infrastructure Audit Test - Multiple Bugs

**Test Case:** IT Infrastructure Audit quote submission with form fields for `employee_count` and `server_count`.

#### Issue #1: Form Signals Flagged as Low Confidence (HIGH)

**Symptom:** `employee_count` and `server_count` (form signals with 100% confidence) appeared in `lowConfidenceSignals`, triggering unnecessary fallback warnings.

**Root Cause:**
- `lowConfidenceSignals` array was populated during initial AI extraction
- When form signals were merged later with `confidence: 1.0`, the array was NOT regenerated
- Fallback evaluation in `evaluateFallback()` still used the stale `lowConfidenceSignals` array

**Resolution:**
- File: `apps/worker/src/quote-processor.ts`
- After form signals are merged into `structuredSignals.signals`, regenerate the `lowConfidenceSignals` array based on current signal confidence values
- Added after line ~457:
```typescript
const confidenceThreshold = service.confidence_threshold || 0.7
structuredSignals.lowConfidenceSignals = structuredSignals.signals
  .filter(s => s.confidence < confidenceThreshold)
  .map(s => s.key)
```

**Lesson:** Always regenerate derived data (like `lowConfidenceSignals`) when the source data (signals array) is modified.

---

#### Issue #2: Cross-Service Recommending Residential for Business (HIGH)

**Symptom:** "Smart Home Wi-Fi Dead Zone Fix" was recommended for a Business IT Audit - completely irrelevant context.

**Root Cause:** No filtering for business context - all tenant services were matched regardless of B2B vs B2C appropriateness.

**Resolution:**
- File: `apps/worker/src/ai/service-detection.ts`
- Added B2B/B2C context awareness section to the AI prompt
- AI now detects the context of the primary service (residential vs commercial/business)
- Only recommends cross-services that match the same context
- Example rule: "If the primary service is business/commercial (e.g., IT Audit), do NOT recommend residential consumer services (e.g., Smart Home)"

**Lesson:** Cross-service detection needs context awareness, not just keyword matching.

---

#### Issue #3: Automatic Global Access Difficulty Multiplier (MEDIUM)

**Symptom:** Line items like "moderate access: £95" appeared for IT Audit service - a service where "access difficulty" makes no sense.

**Root Cause:**
- Access multiplier was **hardcoded globally** in the pricing engine
- Applied to EVERY quote regardless of service type
- Businesses had NO control over this - they didn't configure it
- AI extracted `access_difficulty` from photos and pricing engine ALWAYS applied multiplier

**Resolution:**
- File: `apps/worker/src/pricing/rules-engine.ts`
- Removed `getAccessMultiplier()` function
- Removed access multiplier application in `calculatePricing()` (lines 315-324)
- Removed access multiplier application in `calculatePricingWithTrace()` (lines 1296-1315)
- Added comments explaining removal and alternative approach

**Future Enhancement:** If a business WANTS access-based pricing, they can configure it as a work step with trigger conditions in their service's pricing rules.

**Lesson:** Global automatic pricing adjustments are dangerous. All pricing logic should be business-configurable, not hardcoded.

---

#### Issue #4: Cross-Service Recommendations with £0.00 Price (HIGH)

**Symptom:** "Smart Home Wi-Fi Dead Zone Fix" showed with "~£0.00" - worse than not showing it at all.

**Root Cause:**
- Cross-service recommendations were shown even with £0 or unknown price
- If pricing rules weren't configured or calculation failed, £0 was displayed

**Resolution:**
- File: `apps/worker/src/quote-processor.ts`
- Before adding to recommendations, check `estimatedTotal > 0`
- Skip and log services with invalid pricing:
```typescript
if (pricingResult.estimatedTotal <= 0) {
  console.log(`[Processor] Skipping cross-service ${rec.serviceName} - invalid pricing`)
  continue
}
```

**Lesson:** Always validate pricing output before displaying. £0 recommendations damage credibility.

---

#### Issue #5: Meaningless `item_count` Signal for IT Audit (LOW)

**Symptom:** `item_count = 2` extracted for IT audit - meaningless for this service type.

**Root Cause:** Generic signal extraction tries to count "items" regardless of service context.

**Status:** Deferred - Lower priority since it doesn't affect pricing due to work-step model. Consider making `item_count` extraction conditional based on service type in future.

---

## Architectural Decisions

### AD-001: Deterministic Pricing from Business Configuration

**Decision:** AI does NOT set prices. All pricing is computed from business-configured rules.

**Rationale:**
- Pricing must be predictable and auditable
- Businesses need full control over their pricing
- AI can extract signals and draft wording, but the final price comes from rules

**Implications:**
- Pricing engine only uses signals as inputs to configured rules
- No "AI suggested price" feature
- Work steps, addons, multipliers all configured by business

---

### AD-002: Form Signals Override AI-Extracted Signals

**Decision:** When a customer provides a value via form (e.g., square footage), it ALWAYS overrides any AI-extracted value.

**Rationale:**
- Customer knows their project better than AI vision guessing from photos
- Form inputs have confidence: 1.0 by definition
- Reduces disputes ("I told you it was 500 sqft, not 800!")

**Implications:**
- Form signal merging must happen AFTER AI extraction
- Must regenerate derived data (lowConfidenceSignals) after merge
- Log when form overrides AI for debugging

---

### AD-003: Work-Step Pricing Model

**Decision:** Primary pricing model uses configurable work steps with trigger conditions, not global automatic adjustments.

**Rationale:**
- Different services need different pricing logic
- Global adjustments (like access difficulty) don't apply to all service types
- Businesses should control what factors affect their pricing

**Implications:**
- Removed automatic access difficulty multiplier (see Issue #3)
- Complexity multiplier kept (applies more universally)
- New pricing factors should be added as configurable work steps

---

### AD-004: Cross-Service Context Matching

**Decision:** Cross-service recommendations must match the context (B2B vs B2C) of the primary service.

**Rationale:**
- Recommending "Smart Home" for "IT Audit" is nonsensical
- Damages credibility of the entire quote
- Better to recommend nothing than something irrelevant

**Implications:**
- AI prompt includes context awareness rules
- Services implicitly categorized by keywords in name/description
- Future: Consider explicit B2B/B2C flag on service configuration

---

### AD-005: Explicit Quantity Sources for Per-Unit Pricing

**Decision:** Per-unit pricing items must explicitly declare their quantity source: `form_field`, `constant`, or `ai_signal` (deprecated).

**Rationale:**
- Form data (100% confidence) must be used over AI guesses (60% confidence)
- "Kitchen × room_count" is nonsensical and destroys trust
- Business owners need full control over pricing logic
- Deterministic pricing enables the Quote Simulator
- Eliminates the "where did this number come from?" confusion

**Superseded by AD-006** - See below for the enhanced implementation.

---

### AD-007: Unconditional Form Signal Override

**Decision:** Form answers are ALWAYS merged into structured signals with `confidence: 1.0`, regardless of `expected_signals` configuration.

**Rationale:**
- Form data is explicitly provided by the customer - it's the source of truth
- AI vision extraction can guess wrong (e.g., counting 1 leak when customer says 2)
- Business shouldn't need to configure `expected_signals` for form data to work
- Removing the dependency simplifies configuration

**Implications:**
- All form answers (except `_` prefixed internal fields) become signals
- `mapsToSignal` from widget config is used if available, otherwise `fieldId`
- Signal type is inferred from value if not in `expected_signals`
- Form signals always override AI signals for the same key

---

### AD-008: Cross-Service Phrase Verification

**Decision:** Cross-service recommendations are rejected if `matchedPhrase` cannot be found as an exact substring in the customer's input text.

**Rationale:**
- AI sometimes fabricates customer quotes (hallucination)
- Recommending "Window Cleaning" for a roof leak is embarrassing
- Verification ensures recommendations are grounded in actual customer text
- Raising threshold to 0.9 reduces marginal false positives

**Implications:**
- `matchedPhrase` must be a literal substring of description (case-insensitive)
- Paraphrased or summarized phrases will be rejected
- May reduce some valid recommendations, but prevents hallucinated ones
- Confidence threshold raised from 0.8 to 0.9

---

### AD-009: Potential Work Limits

**Decision:** Signal recommendations are limited to 3 items maximum, with strict length limits on descriptions.

**Rationale:**
- 6 verbose items overwhelm customers
- Long descriptions look like upselling, not helpful suggestions
- Quality over quantity improves trust
- Sorted by confidence ensures best recommendations shown

**Constraints:**
- Maximum 3 recommendations
- `workDescription`: 3-5 words
- `reason`: 1 sentence, max 20 words
- `costBreakdown`: short phrase
- Sorted by confidence before trimming

---

### AD-010: Cross-Service Name-Request Relevance

**Decision:** Cross-service recommendations are rejected if the SERVICE NAME doesn't contain keywords from the customer's REQUEST.

**Rationale:**
- AD-008 phrase verification prevents hallucinated phrases but doesn't verify service match
- "Gutter cleaning" request should NOT recommend "Window Cleaning" service
- Customer mentions "gutter" → only "Gutter Cleaning" service is relevant
- Recommending wrong service is worse than recommending nothing

**Implementation:**
1. Extract key object words from matched phrase (excluding common verbs/fillers)
2. Check if any key word appears in the service name
3. Handle singular/plural variations (gutters → gutter)
4. Reject if no match found

**Examples:**
- Phrase: "gutter cleaning" → Key words: ["gutter"] → Matches "Gutter Cleaning" ✓
- Phrase: "gutter cleaning" → Key words: ["gutter"] → Rejects "Window Cleaning" ✗
- Phrase: "paint the walls" → Key words: ["paint", "walls"] → Matches "Painting" ✓

**Implications:**
- More restrictive than AD-008 alone
- May reduce some edge-case valid recommendations
- Significantly reduces false positives
- Works in conjunction with AD-008 (phrase verification)

---

### AD-011: Type-Aware Multiplier Comparison

**Decision:** Multiplier condition matching handles type differences between form values and config values.

**Rationale:**
- Form checkboxes submit `true`/`false` (boolean)
- Config values may be "Yes"/"No" (string) or 1/0 (number)
- Strict equality fails across types: `true === "Yes"` → false
- Businesses shouldn't need to match exact types in config

**Type Normalization:**
| Form Value | Matches Config Values |
|------------|----------------------|
| `true` (bool) | `true`, "true", "True", "Yes", "yes", "1", 1 |
| `false` (bool) | `false`, "false", "False", "No", "no", "0", 0 |
| `10` (number) | 10, "10" |
| "Large" (string) | "large", "LARGE", "Large" (case-insensitive) |

**Implications:**
- Config values are more forgiving
- Boolean checkboxes work with string "Yes"/"No" conditions
- Number fields work with string number conditions
- String comparisons are case-insensitive

---

### AD-012: Canonical Signal Key Derivation

**Decision:** Form fields and AI extraction MUST use identical signal keys, derived automatically from question labels using `deriveSignalKey()`.

**Rationale:**
- BUG-001 fix used hardcoded synonym map - not scalable or maintainable
- Different keys (form: `number_of_leaks`, AI: `leak_count`) caused override failures
- Signal matching should happen at configuration time, not processing time
- Canonical keys eliminate the need for fuzzy post-hoc matching

**Implementation:**

| Question Label | Field Type | Derived Key |
|----------------|------------|-------------|
| "How many papers?" | number | `paper_count` |
| "Number of Leaks" | number | `leak_count` |
| "Approximate Age of Roof" | number | `roof_age` |
| "Is the leak causing damage?" | boolean | `has_leak_damage` |
| "Type of Roofing Material" | dropdown | `roofing_material_type` |

**Derivation Rules:**
1. Remove filler words: "how many", "number of", "please enter", etc.
2. Singularize plurals: "papers" → "paper"
3. Add suffix based on type:
   - number → `_count` (default), `_age`, `_area` (if label contains those)
   - dropdown/radio → `_type`, `_material`, `_condition` (based on label)
   - boolean/checkbox → `has_` or `is_` prefix

**AI Constraint:**
- Expected signals prompt explicitly tells AI to use ONLY provided keys
- AI cannot invent new keys like `item_count` when `paper_count` is expected
- Violations result in unmatched signals (acceptable over wrong matches)

**Migration:**
- Existing services continue to work with normalized matching fallback
- New services automatically use canonical keys
- No code changes needed for new question types

---

### AD-013: AI Wording Constrained to Configured Scope

**Decision:** AI-generated wording MUST NOT promise services outside the business's configured `scope_includes`.

**Rationale:**
- `scope_includes` is the source of truth for what the business offers
- AI accepting customer requests for unconfigured services causes:
  - Lost trust (can't deliver what was promised)
  - Lost money (gave away service for free)
- This extends AD-001 "AI must not set prices" to "AI must not expand scope"

**Implementation:**
- Prompt constraint is primary defense (explicit instruction in WORDING_PROMPT)
- Business configuration is respected as absolute boundary
- Customer requests outside scope are acknowledged but not promised
- Notes suggest: "Additional services like [X] can be quoted separately upon request."

**Implications:**
- AI cannot say a service is "included" unless it appears in scope_includes
- Customer requests for unlisted services are handled gracefully
- When in doubt, AI mentions LESS not MORE
- Business controls what they offer; AI describes it, never expands it

**Related:**
- AD-001: Deterministic Pricing from Business Configuration
- AD-007: Unconditional Form Signal Override

---

### AD-006: Consolidated Pricing with Auto-Linking and Strict Validation

**Decision:** All pricing configuration consolidated in Service wizard with auto-linking, smart defaults, and strict validation that blocks publish.

**Key Features:**

1. **Simplified UI - "Multiply by" Dropdown:**
   - No technical "quantity source" terminology
   - Simple dropdown: "Multiply by [Number of Bedrooms]" or "Always 1"
   - Customer Questions appear as options, Fixed quantities as fallback

2. **Auto-Linking:**
   - System suggests matching questions based on step name keywords
   - "Bedroom Cleaning" + question "Number of Bedrooms" = auto-suggest link
   - One-click accept: "Link to 'Number of Bedrooms'? [Yes, link it]"

3. **Smart Defaults:**
   - Only 1 number question? Auto-select it
   - Step name matches question? Pre-select that link
   - No number questions? Default to "Always 1"

4. **Strict Validation (Block Publish):**
   - Per-unit items without quantity link = HARD ERROR
   - Invalid field references = HARD ERROR
   - Publish button disabled until errors fixed
   - Clear error messages with "Go back to Pricing Setup" guidance

5. **Hidden Advanced Mode:**
   - AI Signal option hidden behind "Show advanced options"
   - Only visible for legacy services or power users

6. **Consolidated Pricing Page:**
   - Base fee, minimum charge, add-ons, multipliers all in Service wizard
   - Standalone `/app/pricing` page now redirects to Services
   - One place to configure everything about a service

**Quantity Source Types:**
| Type | Display Name | Use Case |
|------|--------------|----------|
| `form_field` | Customer Question dropdown | Links to a number question answer |
| `constant` | "Always 1", "Always 2", etc. | Fixed quantity |
| `ai_signal` | Hidden in Advanced mode | Legacy only |

**Files Changed:**
- `apps/web/src/components/WorkStepEditor.tsx` - Complete rewrite with auto-linking, simplified UI
- `apps/web/src/app/(dashboard)/app/services/page.tsx` - Added base fee, add-ons, multipliers; strict validation
- `apps/web/src/app/(dashboard)/app/pricing/page.tsx` - Replaced with redirect to Services
- `apps/worker/src/pricing/rules-engine.ts` - Uses explicit quantitySource
- `packages/shared/src/database.types.ts` - QuantitySource interface

**Validation Rules:**
| Type | Condition | Action |
|------|-----------|--------|
| Error | per_unit/per_hour without quantitySource | Block publish |
| Error | quantitySource.fieldId not in questions | Block publish |
| Warning | No pricing items and baseFee = 0 | Show warning |

**Migration:**
- Existing services continue to work (legacy fallback)
- New services must have all quantities linked to publish
- Standalone pricing page shows redirect message

---

### AD-030: Units — Metric Geometry, Prices Bind in the Step's Unit (T-133)

**Decision:** Reference tables, anchored geometry and scan dimensions are metric (canonical). A measured quantity converts once, at the point measurement emits it, into the unit its expected signal declares. Everything downstream (form answers, envelopes, rates, takeoff) uses that unit; the pricing engine never converts.

**Rationale:** one conversion site instead of five; a US business types and sees sq ft, prices in $/sq ft, and the engine stays unit-agnostic. Region data (AD-025) supplies units, currency, tax wording and reference sizes; engine code holds none of them.

**Implications:** a signal key should name its unit (`wall_area_sqft`); a missing region on a tenant row means legacy GB.

---

### AD-031: Quote processing is asynchronous in production (2026-11-08)

**Decision:** production enqueues every quote on Cloudflare Queues (`SYNC_QUOTE_PROCESSING=false`); sync `/process` is for local dev and as a rollback lever only. **Why:** photo-measured quotes take 75–150 s, longer than any request a customer or webhook should hold, and turning thinking down to fit made the measurement wrong (S01 £3,355). **Consequences:** the customer can reach a quote before it is priced, so every customer surface must handle `queued`/`generating` (`isQuoteProcessing`); worker job endpoints are token-authenticated; one quote per consumer invocation. **Rejected:** raising `maxDuration` to 300 s (a spinner for minutes, the webhooks still block, and a 53 s adjudication can still exceed it).

---

### AD-032: Identification — the model transcribes, the pack decodes (T-139)

**Decision:** equipment identity (capacity, fuel, size class) is established by a vision call that TRANSCRIBES label text verbatim, and by pack-supplied decode rules that turn the transcription into the value. The model's own reading is a fallback, accepted only when it is one of the signal's allowed values. An identified value grades like a measured one (B) until a human confirms it; appearance alone never identifies (an unreadable label weakens any guess to Grade C and asks). **Why:** AD-024 for labels: reading characters is what vision is good at, while decoding a manufacturer's model-number scheme is a deterministic lookup that belongs in data. **Rejected:** asking the model for the final value directly (it would silently "decode" schemes it half-knows), and per-trade decoding code in the engine (anti-hardcoding).

---

### AD-033: The business app authenticates with the Supabase access token as a bearer (T-137)

**Decision:** the server Supabase client accepts `Authorization: Bearer <access token>` in place of the session cookie, bound to that user, so the mobile app reuses every dashboard API under the same RLS. Only user tokens (JWT role `authenticated`) are honoured. New `/api/app/*` routes exist only where the app needs something the dashboard doesn't have (bootstrap, on-site create without bot checks, a compact quote view, business answers). **Rejected:** a separate API-key scheme (a second auth system to secure), and minting cookies on the device (fragile, and couples the app to @supabase/ssr's cookie format).

### AD-034: The business reviews by default; grades are business-only (T-146)

**Decision:** a quote reaches the customer only after the business approves it, unless the service opts in to "Send automatically without review". The customer sees exactly two states, an **Estimate** (unreviewed) and a **Quote** ("Reviewed and confirmed by {business}"), and never a grade, a grade label, or the words "exact", "firm" or "preliminary". Uncertain quantities show as an unlabelled range. Grades and confidence stay in `pricing_json`, on the dashboard and in the accuracy tracking. **Why:** the honest promise is the business's confirmation, not the model's self-assessed precision ("Grade A, exact" on a flat $4,550 AC replacement). **Rules that follow:** the public quote API is the only customer data path, so it strips `estimate` and takeoff `evidence`. `shared/customer-language.ts` is the guard the gauntlet runs on every public payload. Approval keeps the customer's existing link valid (`previous_token_hash`) instead of rotating it away. **The default was superseded by AD-035 (T-147).**

### AD-035: Show the estimate, then the business confirms it (T-147)

**Decision:** supersedes the default in AD-034. A quote still reaches "Quote" status only when the business approves it, but by default the customer sees the estimate as soon as it is priced, marked as an estimate the business will confirm, with Accept locked. A service can opt to hold the estimate until approval (the AD-034 behaviour) or to send automatically. The rest of AD-034 stands: two customer states, grades business-only, the public quote API as the only customer data path, the language guard, and the existing link staying valid through approval. **Why:** a customer who is shown nothing leaves; the honest promise is still the business's confirmation, and the page says so. **Rules that follow:** the reason a quote is waiting is recorded on the quote (`quotes.review_hold`), never inferred later from the service, so changing a service's mode does not change what earlier customers see. Showing early fails closed: only a priced quote recorded as `shown` is visible, and anything a check held, including generated wording that trips the language guard, stays hidden until approved. (T-148: banned words are now repaired first, by rewrite then removal; only wording that can't be repaired holds the quote.) No customer action may move a quote off `pending_review`; only the business's approval does. **Rejected:** deriving "shown" from the service's current mode at read time (a mode change would reveal held quotes), and storing the flag in `content_json` (dashboard edits rewrite it).

### AD-036: The quote link is the main way to go live; slugs belong to the database (T-149)

**Decision:** every business has a readable hosted quote page, `/quote/{slug}`, and the Share page leads with it and its QR code; the embed code is the second option. The page renders the one widget implementation (AD-024), never a copy. Slugs are generated and guarded **in the database**: a BEFORE INSERT trigger names every new tenant, and only the service role may change a slug, once. A former slug redirects forever and can't be reused, so a printed QR code never lands on another business. **Why:** most small trades can share a link but can't edit a website; generating in SQL covers every way a tenant is created, and the guard keeps the rules enforceable despite the tenant-update RLS policy. **Rejected:** generating slugs in app code at signup (two creation paths, one of them a DB trigger); unlimited changes (each change strands printed QR codes on a redirect); an iframe of `/embed` inside the hosted page (a frame inside a page on the same origin adds resize jank on phones for nothing).

### AD-037: Setup ends with the business's own prices and a real test quote; test requests are server-issued (T-150)

**Decision:** guided setup always passes through "Check your prices" before anything is created, and ends with the owner submitting a request on their own quote page and approving it. The price list is a view over the existing pricing config, never a store of its own. A request is a test only when it carries an HMAC token the server issued to the signed-in owner for that tenant; the flag lives on `quotes.is_test`, set at creation, and every usage counter checks it. **Why:** template rates are placeholders, and a business that never sees its numbers sends wrong prices; the first quote should prove the whole loop on both sides. A client-settable flag would be a free-quotes switch. **Rejected:** a separate "setup prices" table (a second source of truth); a test flag in `source_json` (clients write it); a test mode on the public widget without a token; unlimited test requests (a shared test link would be uncounted quoting).

### AD-038: Contact comes first, and a started request is the business's lead (T-151)

**Decision:** the widget asks for contact details straight after the service, and the request is saved as an unfinished lead (`request_leads`) the moment they are given. It becomes the normal quote on submit and the lead is closed, so there's no duplicate. Leads live in their own table, not as a quote status: they never run AI, never count toward usage, and stay out of the quote pipeline, billing and analytics. Which contact details are required is the business's setting, never hardcoded. The full address is asked on accept, when the customer has a reason to give it. **Why:** a customer who leaves half-way is still a lead the business can call. **Rejected:** an `unfinished` quote status (every status switch, count and analytics query would have to learn it), saving leads from the first keystroke (consent and privacy), and creating leads for the owner's setup tests.

---

### AD-039: Home is the work waiting; the free allowance is in total (T-152)

**Decision:** the dashboard has five menu items (Home, Quotes, Prices, Share, Settings). Home leads with quotes waiting for approval, then unfinished requests, then a setup checklist whose every step ticks only on a real action (never on a row existing), then four 30-day numbers. WhatsApp quoting without setup lives on Share (wa.me plus WhatsApp Business texts), and full in-chat WhatsApp stays an advanced page. The free allowance for a business without a plan is counted across all months (`FREE_ALLOWANCE` per region, `per: 'total' | 'month'`) by summing the existing usage counters, so there's no new counter to keep in step. **Why:** an owner opens the app to act on work; a monthly free allowance meant a small business never had to pay. **Rejected:** a separate lifetime counter column (a second source of truth for usage), hiding WhatsApp as "coming soon" (it already works through the quote link), and ticking "Check your prices" whenever a service exists (it would tick together with "Add a service" and mean nothing).

---

### AD-040: The public demo is one flagged example business, outside every count (T-153)

**Decision:** /demo runs the real widget against one example tenant marked `is_demo`. The flag is set only by the service role (a guard trigger) and copied to its quotes by a trigger, so no API can forge it either way. A demo request goes through the normal pipeline with the business's own configured prices (AD-001). It is never counted (plan, usage, analytics, calibration, benchmarks), never emails anyone, uses the cheap models with one photo, and is deleted after 24 hours. Its limits are counted in the database, not Redis, so they hold where Upstash is off. **Why:** a visitor should see the real thing in a minute, and a demo must cost little and leave nothing behind. **Rejected:** a recorded video or fake estimate as the main path (not the real product); reusing `is_test` (test quotes email the typed address and show a Test badge); a separate demo widget (AD-024: one widget); a Redis-only cap (off in production).

---

## Known Constraints

### KC-001: No Automatic Access-Based Pricing

**Constraint:** The system no longer automatically applies access difficulty multipliers.

**Why:**
- Access difficulty doesn't apply to all service types (e.g., IT Audit)
- Businesses didn't configure it, so shouldn't appear in quotes
- Creates confusing line items customers didn't expect

**Workaround:** Businesses wanting access-based pricing can configure it as a work step with appropriate trigger conditions.

---

### KC-002: Cross-Service Requires Valid Pricing

**Constraint:** Cross-service recommendations are only shown if they have pricing > £0.

**Why:**
- £0 recommendations look broken
- If pricing rules aren't configured, recommendation shouldn't show
- Better user experience to show nothing than broken data

---

### KC-003: Form Signals Must Match Expected Signals (RESOLVED)

**Constraint:** ~~Form fields with `mapsToSignal` must match signal keys defined in `expected_signals`.~~

**Status:** RESOLVED by KC-004 - signals are now auto-generated from form fields.

---

### KC-004: Signals Auto-Generated from Form Fields

**Constraint:** Expected signals are no longer manually configured. They are automatically derived from Customer Questions (form fields).

**Why:**
- Business owners don't understand "signals" - they understand "questions"
- Manual signal configuration was error-prone and confusing
- Auto-generation ensures signals always match form fields

**How it works:**
1. When a user creates a Customer Question (e.g., "How many employees?"), the system auto-generates:
   - An expected signal with key derived from the label (e.g., "employees")
   - Signal type inferred from field type (number → number, dropdown → enum, etc.)
   - `mapsToSignal` set on the field to match the generated signal key
2. The "Expected Signals" editor is hidden from the UI
3. Work step triggers now show question labels instead of signal keys

**Implications:**
- ExpectedSignalEditor component is no longer used in service creation
- Backend processing logic unchanged - signals still work the same way
- AI continues to extract standard signals (complexity, condition, etc.)

---

### KC-005: Per-Unit Items Should Declare Quantity Source

**Constraint:** Per-unit and per-hour pricing items should have an explicit `quantitySource` to ensure accurate, deterministic pricing.

**Why:**
- Without explicit source, the system guesses using legacy fallback logic
- Guessing leads to wrong prices (e.g., "Kitchen × room_count")
- Form data is 100% accurate, AI guesses are ~60% accurate
- Business owners need to understand and control pricing logic

**Workaround:** Legacy services continue to work with fallback logic, but:
- A deprecation warning is logged
- Quote notes may include "uses legacy quantity estimation"
- New services should always configure explicit quantity sources

**Validation:**
- Quote Simulator shows warnings for missing quantity sources
- Per-unit items display "(no source!)" in collapsed header if not configured
- Test step shows configuration status summary

---

## Fix Dependencies

### FD-001: Issue #1 and Fallback System

**Relationship:** Issue #1 fix (regenerating lowConfidenceSignals) directly affects the fallback evaluation system.

**Dependencies:**
- `evaluateFallback()` reads `structuredSignals.lowConfidenceSignals`
- If this array is stale, wrong fallback mode may be triggered
- Form signals with 1.0 confidence must NOT trigger "low confidence" fallbacks

**Testing:** When testing fallback modes, always verify with a mix of AI-extracted and form-provided signals.

---

### FD-002: Issue #2 and Issue #4 Relationship

**Relationship:** Both issues relate to cross-service recommendations quality.

**Flow:**
1. AI detects potential cross-services (Issue #2 context fix)
2. Pricing is calculated for each
3. Only services with valid pricing are shown (Issue #4 fix)

**Testing:** Test cross-service with:
- B2B primary service + mixed B2B/B2C other services
- Service without pricing rules configured
- Service with £0 base fee and no applicable rules

---

### FD-003: Issue #3 and Work-Step Model

**Relationship:** Removing automatic access multiplier pushes pricing control to work-step configuration.

**Migration:** Existing businesses relying on access adjustments need to:
1. Add a work step for access adjustment
2. Configure trigger signal: `access_difficulty`
3. Configure trigger condition: `equals: "difficult"` (or similar)
4. Set appropriate pricing

**Note:** This is a breaking change for businesses that expected automatic access pricing.

---

## Version History

| Date | Version | Changes |
|------|---------|---------|
| 2026-02-06 | 1.13.0 | Dashboard & Menu Reorganization: Reduced menu from 9 to 7 items, inline setup progress, real quote stats, improved welcome message, deleted redundant pages |
| 2026-02-03 | 1.12.0 | Comprehensive Quote Validation Architecture: 8 validation categories, auto-correction, validation logging, config suggestions, tenant settings |
| 2026-02-03 | 1.11.0 | Bathroom Quote Quality Fixes: Form/description conflict detection (FIX-BATHROOM-1), contradicting signal filter (FIX-BATHROOM-4), scope/pricing validation (FIX-BATHROOM-5), unused form field warning (FIX-BATHROOM-2) |
| 2026-02-02 | 1.10.1 | Keyword negation in addon detection (FIX-NEGATION-1): Global addon suppressors, contextual keyword negation |
| 2026-02-01 | 1.10.0 | Quote Quality Fixes v6 (Stress Testing): 8 issues fixed - numeric operator type coercion (ISSUE-1), comma-separated numbers (ISSUE-2), zero line items (ISSUE-3), array case-insensitive (ISSUE-4), explicit negation (ISSUE-5), ambiguous values (ISSUE-6), array equals matching (ISSUE-7), tax rounding (ISSUE-8) |
| 2026-02-01 | 1.9.1 | Quote Quality Fixes v4 (remaining): Ignore unused signals in fallback (FIX-4), smarter addon keyword matching (FIX-7), form overrides vision for access (FIX-8) |
| 2026-02-01 | 1.9.0 | Quote Quality Fixes v4: AD-001 compliance for recommendations (no AI prices), addon/exclusion conflict check, vision severity calibration, error code integration |
| 2026-01-31 | 1.8.0 | AI Scope Constraint & No-Hardcode Rule (AD-013): AI cannot promise services outside scope_includes, added anti-hardcoding principle to CLAUDE.md |
| 2026-01-31 | 1.7.0 | Intelligent Signal Key Unification (AD-012): Canonical signal key derivation, AI constrained to expected keys, removed hardcoded synonym map |
| 2026-01-31 | 1.6.0 | Quote Quality Fixes v3 (BUG-004, BUG-005): Cross-service relevance validation (AD-010), multiplier type coercion (AD-011) |
| 2026-01-31 | 1.5.0 | Quote Quality Fixes v2 (BUG-001, BUG-002, BUG-003): Semantic signal matching, keyword phrase verification, pricing rules save fix |
| 2026-01-31 | 1.4.0 | Quote Quality Fixes (AD-007, AD-008, AD-009): Unconditional form signal merge, cross-service phrase verification, potential work limits |
| 2026-01-31 | 1.3.0 | Consolidated Pricing (AD-006): Auto-linking, smart defaults, strict validation, hidden advanced mode, standalone pricing page removed |
| 2026-01-31 | 1.2.0 | Explicit Quantity Sources (AD-005): Added quantitySource to WorkStepConfig, reordered wizard (Questions before Pricing), added Test step with Quote Simulator |
| 2025-01-31 | 1.1.0 | Simplified Service Creation UI: renamed tabs to business-friendly terms, hid signals editor, auto-generate signals from form fields |
| 2025-01-30 | 1.0.0 | Initial changelog created. Documented IT Audit test bugs #1-5. |

---

## How to Use This Document

### When Fixing a Bug:
1. Add entry under "Issues & Resolutions" with symptom, root cause, resolution
2. Check "Fix Dependencies" to see if your fix affects other areas
3. Update "Known Constraints" if your fix introduces new limitations

### When Making Architectural Changes:
1. Add entry under "Architectural Decisions" with rationale
2. Document implications for existing code
3. Check if change conflicts with existing decisions

### Before Starting New Work:
1. Review "Known Constraints" to avoid reintroducing removed features
2. Check "Fix Dependencies" if working in related areas
3. Search this doc for related previous issues

---

*Last Updated: 2026-02-06 (v1.13.0)*
