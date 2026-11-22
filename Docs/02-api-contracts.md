# /docs/02-api-contracts.md

## Conventions
- Base prefix: `/api`
- Hosting: All API routes run on Vercel (Next.js API routes), except the queue consumer which runs on Cloudflare Workers
- JSON only. `Content-Type: application/json`
- Auth (dashboard APIs): Supabase session cookie, or `Authorization: Bearer <supabase access token>` (T-137: the business app). A bearer is accepted only when its JWT role is `authenticated`; service-role/anon keys are ignored. Row-level security applies either way.
- Public widget APIs: `tenantKey` (public) + server-side domain allowlist checks
- Standard error envelope (example):
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid input", "details": [] } }

- HTTP status usage:
  - 400 validation
  - 401 unauth
  - 403 forbidden
  - 404 not found
  - 409 conflict (idempotency)
  - 429 rate limited
  - 500 server error

## Rate limits and the human check (T-173)
- Every public route counts the call before it reads or writes anything. The limits are in
  `apps/web/src/lib/rate-limit-config.ts` (per address, and per business, quote or email address; some scopes
  also by hour and by day). Over a limit: **429** with
  `{ "error": { "code": "RATE_LIMITED", "message": "Too many tries in a short time. Please wait a minute and try again.", "retryAfterSeconds": 42 } }`
  and a `Retry-After` header. With Upstash not configured, slow (500 ms) or failing, the call goes ahead.
  `RATE_LIMITS_OFF=true` turns every limit off.
- `POST /api/public/quotes`, `POST /api/public/leads` and `POST /api/auth/signup` take `turnstileToken`. With both
  Turnstile keys set, a token Cloudflare clearly rejects (not real, used or expired) is **403**
  `VERIFICATION_FAILED`. **A request with no token goes ahead** (T-178, AD-060), as does one whose token
  Cloudflare could not judge within 500 ms. With either key unset, or `TURNSTILE_OFF=true`, the field is ignored.
  They also take the hidden field `website`, which must be empty.
- The quote actions (`accept`, `decline`, `feedback`, `clarify`) are limited by address first, then, once the
  quote's link token has been checked, per quote and per business.
- `POST /api/public/uploads/init`: `sizeBytes` must be a whole number. The `uploadUrl` (and `smallUploadUrl`) is
  signed for exactly that size and the declared `contentType`; a PUT of anything else is refused by storage (403).

## Requests are never refused for what the customer wrote (T-178)
- `POST /api/public/quotes` **no longer returns `SERVICE_MISMATCH`** (400, with `suggestedService`). That code
  is gone; a client that still handles it simply never sees it.
- A request that carries any answered question, a `quantity` or any `assetIds` for the chosen service is
  accepted on that service whatever its `_project_description` says. The service matcher is not asked.
- A request whose only content is its description is judged by the matcher, which is given every active
  service's name, description, includes and excludes:
  - another of the business's services clearly fits → **200**, `status: "queued"`, the request is made on the
    chosen service. The suggestion is stored on the request and the priced quote is held for the business
    (`pending_review`, hidden from the customer) with the reason;
  - nothing the business offers fits → a general inquiry (**200**, `isGeneralInquiry: true`), or **400**
    `SERVICE_NOT_AVAILABLE` when the business switched general inquiries off. Both as before;
  - unsure, slow or failing → accepted as usual.
- When the request is saved but cannot be handed to the pricing worker: **200** with `status: "failed"`, the
  customer's link, and `warning`. The quote is marked failed and the business is emailed.
- `GET /api/public/quotes/{id}`: `customer.hasEmail` (boolean; never the address). On `status: "failed"` the page
  says the business has the request and will be in touch.
- `GET /api/quotes/{id}` (dashboard) adds `request` (`description`, `answers[] { label, value }`, `postcode`,
  `address`, `quantity`) and `serviceSuggestion` (`serviceId`, `serviceName`, `reason`, or `null`).
- `POST /api/admin/quotes/{id}/retry`: a signed-in platform admin, **or** the header `X-Retry-Code` holding the
  one-time code `scripts/retry-failed-quote.sh` wrote onto that quote (one quote, one use, ten minutes).
  Otherwise **403**. Only for `failed`, `queued` or `generating` quotes. **502** `QUEUE_FAILED` if the worker
  cannot be reached (the quote goes back to `failed`).
- `GET /quote/{slug}` (the quote link page) over its limit answers **429** with `Retry-After` and a plain HTML
  line. It used to answer 200 with the same words.

## One request, several services (T-179, AD-061)
A quote can carry up to two added services ("sections"), each priced from its own service's rules. One total,
tax once, one accept. No migration: the shape is in `Docs/03-data-model.md`.

- `GET /api/public/quotes/{id}` adds, once the customer can see a price:
  - `alsoAsked[]`: what else the customer asked for in their note. Each
    `{ id, words, serviceId | null, serviceName?, state: "offered" | "added" | "not_offered", price?, questions?, priceOnApproval? }`.
    `priceOnApproval` marks a service the business approves first (hold until approved): it never has a `price`.
    `price` (before tax) is present only when nothing more needs asking; `questions[]` are
    `{ key, label, type: "number" | "text" | "select" | "boolean", options?, unit?, prefill? }`. `prefill` is what
    the note said: a suggestion for the customer to confirm, never used unconfirmed. `not_offered` has no price.
  - `sections[]` on a combined quote: `{ serviceId, serviceName, main, lines[], minimum, subtotal, addedBy?, awaitingApproval? }`,
    the main service first. Absent on a single-service quote. A part with `awaitingApproval: true` has no
    price for the customer yet (`lines: []`, `subtotal: 0`): its service holds until approved and the business
    has not approved. It is left out of `pricing.subtotal`, `taxAmount`, `total` and the range, which are then
    the quote as it stood before the part was added; no `actions.pdfUrl` is given while a part waits.
  - `canChangeSections` (the customer can add or remove right now) and `serviceName` (the main service).
  - `pricing.subtotal`, `taxAmount` and `total` are the combined figures; `pricing.breakdown` stays the main
    service's lines.
- `POST /api/public/quotes/{id}/sections` `{ token, serviceId, answers?: [{ fieldId, value }] }`. Adds a service
  the customer asked for. The price comes from the worker's rules engine (no AI). Answers `{ ok, status }` and
  no figures (the page reads the quote again; a part waiting for approval has a price the customer may not
  see). **422** `ANSWERS_NEEDED` with `questions[]` when the service's own questions are not all answered
  (a pre-filled value does not count until it is sent). **404** `NOT_OFFERED` for a service the customer did not
  ask for or the business does not price; **409** `ALREADY_ADDED`, `TOO_MANY` (two is the limit) or
  `NOT_CHANGEABLE` (accepted, declined, or not visible to the customer); **503** `TRY_AGAIN` if the price could
  not be worked out.
- `DELETE /api/public/quotes/{id}/sections` `{ token, serviceId }`. Removes it again, before accepting.
- Both are protected like `/clarify` (AD-055, AD-060): counted by address before anything is read, then the
  link token is checked (**401**), then counted for the quote and for the business (**429**). Limits fail open.
- Adding a section moves the quote to the strictest review setting among its services: it stays sent only if
  every service sends automatically; otherwise it is `pending_review` again and cannot be accepted until the
  business approves. It stays visible to the customer (`review_hold: "shown"`): a service set to hold until
  approved hides only its own added part (`awaitingApproval`), never the price already seen. Removing the last
  added section puts the quote back exactly where it stood. The business gets one "Request updated" email per
  change, never a second quote.
- `POST /api/quotes/{id}/sections/price` (dashboard) `{ serviceId, answers? }`: what one of the business's other
  services costs as a section. Saves nothing. **200** `{ section }`, **422** `ANSWERS_NEEDED { questions }`,
  **404** `NOT_A_SERVICE` or `NO_PRICE`.
- `PATCH /api/quotes/{id}`: `pricing_json.sections[]` may be sent (each `{ serviceId, breakdown[] }`; at most
  two; each one of the business's own services, not the quote's own). Every subtotal, the tax and the total are
  worked out again on the server. Omitting a section removes it. `content_json.alsoAsked` is kept from the
  stored quote.
- `GET /api/app/quotes/{id}` (on-site app): `serviceName` lists every service on the quote ("A + B"), the total
  is the combined one, and each added service's lines follow the takeoff.
- Worker `POST /section` (token required, like `/reprice`) `{ quoteId, serviceId, answers? }` →
  `{ success, ready, section | questions }`. Reads only.
- Usage: adding or removing a section counts nothing. One request is one quote.

## Billing (T-180, AD-062, AD-063)
Stripe is the seller (Managed Payments): it charges, adds the tax, sends the receipts. Our side is four signed-in
routes, one webhook and one admin route. Plan numbers come from `packages/shared/src/plans.ts`; price ids from the
`STRIPE_PRICE_<PLAN>_<INTERVAL>_USD` settings. No route here returns a card detail or a key.

- `GET /api/billing` → `{ subscription, usage, availablePlans, selectedPlanId, canCheckout, canManage,
  freeQuotesLeftLine, suspended }`. It reads only what the webhook stored; it never calls Stripe.
  - `subscription.status`: `active`, `trialing`, `past_due` (a payment failed and is being retried: the plan
    still works), `canceled` (had a plan, it ended) or `none`. `subscription.plan` is the plan the business has
    **now**: `null` for `none` and for `canceled`.
  - New in T-180: `interval` (`monthly` | `annual` | null), `cancelAt` (when a cancelled plan ends; it works
    until then; `cancelAtPeriodEnd` is true whenever it is set), `paymentFailed`, `endedPlanName`, and
    `testAccount` (a free test account: a plan with no Stripe customer; nothing to buy or manage).
  - `canCheckout`: the business has no plan now and is not a test account. `canManage`: it has a Stripe customer.
  - `freeQuotesLeftLine`: "2 free quotes left. Pick a plan to keep pricing every request." at 8 of 10, the same
    with "1 free quote" at 9; otherwise null.
  - `usage` is unchanged (`per` `total` for the free allowance, `month` for a plan).
- `POST /api/billing/checkout` `{ planId, interval?: "monthly" | "annual" }` → `{ checkoutUrl }`. A Managed
  Payments Checkout session for the plan's price. **409** `TEST_ACCOUNT` for a free test account; **409**
  `ALREADY_SUBSCRIBED` when the business has a paid plan (it changes plan in the portal); 404 `PLAN_NOT_FOUND`;
  400 `NO_STRIPE_PRICE` when the price setting is missing; 503 `STRIPE_NOT_CONFIGURED`. Stripe sends the
  business back to `/app/settings/billing?success=true&session_id=…` or `?canceled=true`.
- `POST /api/billing/confirm` `{ sessionId }` → `{ confirmed: boolean }`. Called by the billing page on the way
  back from Checkout: stores the plan from Stripe at once (the same function the webhook uses, so doing both
  changes nothing). **404** if the session is not this business's own.
- `POST /api/billing/portal` → `{ portalUrl }`. Stripe's customer portal: switch between Starter and Pro,
  monthly or yearly (an upgrade takes effect at once and the difference is charged then; a cheaper plan or
  yearly to monthly takes effect at the end of the paid period), cancel at the end of the paid period,
  change the card, past invoices. **400** `NO_CUSTOMER` when the business has never bought (and for a test
  account).
- `GET /api/billing/pending` → `{ pending: null | { planId, planName, interval, at } }`. A plan change that is
  waiting for the end of the paid period (a downgrade asked for in the portal). The billing page shows it as
  "Changes to <plan> on <date>." It is read from Stripe when asked and never stored; any trouble reading it
  is `pending: null`. It is null once the plan is set to end, and for a business with no paid plan.
- `GET /api/billing/notice` → `{ notice: null | { kind, line, action, actionLabel, email? } }`. The line the
  dashboard shows on every page: `payment_failed` ("Your payment didn't go through. Update your card to keep
  your quotes running.", `action: "portal"`) or `suspended` (`action: "email"`). Suspended wins.
- `POST /api/webhooks/stripe` (Stripe only; signed with `STRIPE_WEBHOOK_SECRET`). Handles exactly
  `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`,
  `invoice.payment_failed`, `invoice.paid`, and (T-191) `charge.refunded`, `charge.dispute.closed`; each re-reads
  from Stripe and stores the subscription (a full refund of the current period or a lost dispute cancels it
  first: AD-074). Answers
  `{ received: true }`; `{ received: true, duplicate: true }` for an event already handled (nothing is touched);
  `{ received: true, handled: false }` for any other event type; **400** for a missing or wrong signature;
  **500** when storing failed (Stripe sends it again).
- `POST /api/admin/tenants/:tenantId/suspend` `{ suspended: boolean, reason?: string }` (platform admin only;
  a reason is required to suspend) → `{ tenantId, suspended, changed }`. 403 for anyone else, 400 without a
  reason, 404, 400 `DEMO_BUSINESS`. Written to `admin_activity_logs`. `GET /api/admin/tenants` items carry
  `suspendedAt` and `testAccount`.
- Requests while a business has no room (the 10 free quotes are used, the plan's monthly number is reached, the
  plan has ended, or the business is suspended): `POST /api/public/quotes` still answers 200 with
  `status: "held"` and the neutral message; the quote is saved `pending_review` with `content_json.limitHold`.
  Nothing is lost and nothing about billing is shown to the customer.
- `POST /api/quotes/:quoteId/process` (price a held lead): **402** `PLAN_LIMIT_REACHED` when there is still no
  room, **403** `ACCOUNT_PAUSED` when the business is suspended. A lead priced here is now counted.
- `GET /api/whatsapp/config` `access.why` can also be `suspended`.

## T-189: templates, sign-up source, alerts

- **A service from a template** uses `POST /api/services` with the body setup sends (`servicePayload`); there
  is no new route. The list and its starting prices are built in the browser from the packs
  (`lib/service-templates.ts`).
- **`POST /api/auth/signup`** takes an optional `source`: `{ utm?: { source, medium, campaign, term, content },
  referrer?, landing?, at? }`. The server keeps only those keys, as short plain strings, the referrer as a host
  and the landing page as a path; anything else is dropped. It is never required and never a reason to refuse.
- **`POST /api/auth/confirm`**, for a sign-up, writes that source to `tenants.signup_source` once (migration
  45; server-only, a trigger refuses any other writer). A failure to write it never stops the sign-in.
- **`GET /api/admin/tenants`** items gain `cameFrom`: one line ("newsletter / email / launch · from
  example.org · first page /pricing", "came directly · first page /", or "Not recorded").
- **Alerts** have no route. The worker and the web app email `ALERT_EMAIL` (unset = off) through
  `claim_ops_alert(p_kind, p_every_seconds)` (migration 45, service role only), which returns `send` and
  `held_back`. Kinds: `quote_failed`, `worker_error`, `queue_backed_up`. The worker gains a `scheduled`
  handler (production: every 5 minutes) that reads waiting quotes and changes none.
- **The public quote's price lines**: the customer's page words an added line from the line's `source`
  (`seen` / `words`), not from `recommendationReason`, which is still sent and no longer shown.

## T-198: "Ask Qolumns" (the Help assistant) and the owner's Questions tab

The same rules as T-197's routes: every `/api/support/ask` route is the signed-in user's own business; every
`/api/admin/support/questions` route is the platform admin's. The assistant reads and answers: these routes
write one table (`help_questions`) and nothing else.

- **`GET /api/support/ask?page=/app/services`** → `{ "suggestions": [{ "entry": "services-add", "question":
  "How do I add a service?" }] }`: up to three, chosen from the business's own state. No AI is asked. Each is
  the heading of an entry in Docs/help.
- **`POST /api/support/ask`** `{ "question": "…", "conversationId": "<uuid>", "page": "/app/quotes/…" }` →
  `application/x-ndjson`, one JSON object a line, as the answer is written:
  - `{ "t": "text", "v": "…" }` for each piece of an answer in the model's own words;
  - last, `{ "t": "done", "id": "<question id>" | null, "outcome": "answered" | "not_sure" | "not_offered" |
    "broken" | "team" | "declined" | "failed", "text": "<the whole answer, as kept>", "actions": [{ "kind":
    "open", "href": "/app/services", "label": "Open Services" } | { "kind": "team" | "feature" | "problem",
    "label": "…" }], "rate": true }`.
  - For `not_sure`, `team` and `declined` there are no pieces: `text` is our own sentence. `failed` is "I
    couldn't answer just now." (any failure, or more than 20 seconds) with the report form offered.
  - 400 `MISSING_QUESTION` / `TOO_LONG` (1,000 characters); 429 `DAILY_LIMIT` (60 a day per business, counted
    in the database; a count that cannot be read allows the question).
  - What the model is given: the help guide, the business's own state (plan, quotes used and allowed, its
    services, prices checked, link shared, WhatsApp connected, branding set, region, currency, the page), and,
    from a quote's page, that quote's lines, rates, quantities and where each quantity came from. Never a
    customer's name, email, phone, address, photos or message.
- **`POST /api/support/ask/:id`** `{ "rating": "yes" | "no" }` → `{ "success": true }`; 404 for a question that
  is not this business's.
- **`POST /api/support/reports`** also takes `{ "kind": "problem", "fromAssistant": "<conversation id>",
  "turns"?: [{ question, answer }], "context"? }`: "Send this to the Qolumns team". The report's words are the
  conversation as we kept it for this business (`turns` is used only when nothing was kept). The report is
  marked `from_assistant` and its questions point at it.
- **`GET /api/admin/support`** now also returns `"questions": [QuestionRow]` (newest first), and `count`
  includes the questions that need a look.
- **`GET /api/admin/support/questions/:id`** → `{ "question": {...} }`: the question, the answer, the guide
  entries used, the rating, the business and its plan, the page, the report it became, the same sitting.
  **`POST`** `{ "review"?: "guide_updated" | "nothing_to_do" | "open", "note"?: "…" }`.
- **`GET /api/admin/support/problems/:id`**: `sorting.fixTicket` is set only for a fault; `sorting.draftReply`
  for every other kind.
- **The worker's `POST /support/job`** also takes `"help": "…"` on a `support_sort` job: what the help guide says
  near the report's words (at most 9,000 characters). It is used only for the draft reply, which the worker asks
  for in a second call (`support_reply`) after the sorting is stored, and only when the kind is not a fault.
- **The phone app** uses `GET /api/support?quoteId=…` and `POST /api/support/reports` (`kind: "estimate"`) as
  they are, with its bearer token.

## T-197: Help, reports, feature requests, the support inbox

Every `/api/support` route is the signed-in user's own business (session cookie): 401 signed out; another
business's report is 404. Every `/api/admin/support` route is the platform admin's: 403 for anyone else. Errors
are `{ "error": { "code", "message" } }`; the message is written for the person to read.

**The business**
- **`GET /api/support`** → `{ "plan": "Free", "reports": [MyReport], "requests": [MyRequest], "unread": 1 }`,
  newest first. `MyReport`: `{ id, kind: "problem" | "estimate", body, choices, quoteId, isTest, status,
  statusLabel, setupHint: { line, rate, serviceId } | null, unread, createdAt }`. `MyRequest`: `{ id, text,
  status, statusLabel, createdAt }` (never who else asked or how many).
  `GET /api/support?quoteId=…` → `{ "reports": [...] }`: only the reports ON that estimate.
- **`GET /api/support/unread`** → `{ "count": 1 }` (the dot on the Help item).
- **`POST /api/support/reports`**
  - `{ "kind": "problem", "body": "…", "screenshotAssetId"?: "ast_…", "context"?: { page, quoteId, browser,
    screen, lastError } }`. The screenshot is an upload made through `POST /api/uploads/init` (an image, up to
    10 MB, the business's own). Of `context` only those keys are kept; the server adds the plan.
  - `{ "kind": "estimate", "quoteId": "qte_…", "choices": ["too_high", …], "body"?: "…", "expectedTotal"?: 750 }`.
    At least one choice; `body` is required with `other`. `expectedTotal` is recorded only.
  - → `{ "report": MyReport, "message": "Thanks, we’ve got it. You’ll see our reply here and by email." }`.
    The report is saved first; sorting follows in the worker and its failure changes nothing here.
  - 400 `MISSING_TEXT` / `MISSING_CHOICE` / `INVALID_TOTAL` / `INVALID_SCREENSHOT`, 404 `QUOTE_NOT_FOUND`,
    429 `DAILY_LIMIT` (20 reports a day per business; a count that cannot be read allows the report).
- **`GET /api/support/reports/:reportId`** → `{ "report": MyReport, "messages": [{ id, from: "business" | "team",
  body, createdAt }] }`. Opening it marks our reply as read.
- **`POST /api/support/reports/:reportId/messages`** `{ "body": "…" }` → `{ "message": {...} }`. A reply on a
  report we had closed sets it to `new` again.
- **`POST /api/support/features`**
  - `{ "text": "…" }` → `{ "step": "match", "matches": [{ id, title, summary }] }` (up to three; nothing is saved
    yet) or `{ "step": "saved", "voted": false, "message": "…" }`. The match step waits five seconds at most;
    after that, or on any failure, the request is saved as new.
  - `{ "text": "…", "voteFor": "<request id>" }` → `{ "step": "saved", "voted": true }`; 409 `ALREADY_VOTED`
    ("You’ve already asked for this."); 404 for a request that may not be offered.
  - `{ "text": "…", "different": true }` → saved as a new request.
  - 429 `DAILY_LIMIT` (20 a day per business).

**The owner (platform admin)**
- **`GET /api/admin/support`** → `{ "problems": [ProblemRow], "features": [FeatureRow], "count": 7 }`.
  Problems by priority (severity, businesses affected, age); a merged report is counted under the one it joined.
  Feature requests by votes, then by paying businesses. `?count=1` → `{ "count": 7 }` only (new items).
- **`GET /api/admin/support/problems/:id`** → `{ "problem": {...} }`: the business and plan, its words, the
  screenshot (a short-lived signed address), what was attached, the estimate cut down to line names, sums and
  the business's prices, the AI's sorting and draft fix ticket, look-alikes, merged reports, the thread.
- **`POST /api/admin/support/problems/:id`** `{ "action": … }`:
  `reply { body }` · `status { status }` (not `fixed`) · `fixed { message?, confirm }` (`confirm: false` →
  `{ "preview": { businesses, subject, html } }`; `true` sets every attached report to fixed and tells each
  attached business once → `{ ok, businesses, emailed }`) · `merge { into }` · `unmerge` · `approve { approved }`
  · `note { note }` · `sort` (one more try).
- **`GET /api/admin/support/features/:id`** → `{ "feature": {...} }` with the businesses that asked and their
  own words. **`POST`** `{ "action": … }`: `rename { title?, summary? }` · `status { status }` (not `shipped`) ·
  `shipped { confirm }` (preview, then set and email every business that voted, once) · `merge { into }` ·
  `split { voteId }`.

**The worker** (the web app's bearer token, like `/process`)
- **`POST /support/job`** `{ "kind": "support_sort" | "feature_title", "id": "…", "mode"?: "queue" | "wait" }` →
  202. `queue`: the job goes on the quote queue (production). Otherwise it runs after the answer is sent
  (`wait` answers with the outcome). A job is tried once and acknowledged whatever happened.
- **`POST /support/match`** `{ "words": "…" }` → `{ "success": true, "matches": [{ id, title, summary }] }`.
  Empty on any failure.

## T-196: won this month, the phone's notifications, the time zone

- **`GET /api/app/bootstrap`** gains `won`: `{ "headline": "Won this month: $12,400 from 7 jobs" | null,
  "onSite": "Plus $3,200 from 2 estimates you made on site." | null } | null`. The sentences are written by the
  server in the business's currency, the same ones Home shows (`packages/shared/src/won.ts`). `won` is null
  before the business's first accepted estimate, and when there is nothing to say this month; `headline` is null
  for a business that only quotes on site (its `onSite` then has no "Plus"). Optional query `?tz=<IANA name>`:
  the phone's time zone, kept the first time when the business has none.
- **`/api/app/push-token`** (session cookie or bearer; every row is the signed-in user's own):
  - `GET` → `{ "prefs": { "newRequest": true, "accepted": true, "question": true }, "registered": false }`
  - `PUT { "token": "ExponentPushToken[…]", "platform": "ios" | "android" }` registers this phone or refreshes
    it; a phone another user had signed in on moves to this user. A new phone starts with the user's switches.
    Same answer as `GET`. 400 `INVALID_TOKEN`, `INVALID_PLATFORM`. The user and business written are always
    the signed-in ones; anything else in the body is ignored.
  - `PATCH { "newRequest"?, "accepted"?, "question"? }` sets switches on every phone of the user. 400
    `INVALID_SWITCH`, `NO_CHANGE`; 409 `NO_DEVICE` when no phone is registered yet.
  - `DELETE { "token" }` forgets this phone (sign-out). Only the caller's own row can be deleted.
- **`POST /api/tenant/time-zone { "timeZone": "Europe/London" }`**: the dashboard reports the browser's zone;
  only the first one is kept. 400 `INVALID_TIME_ZONE`. `{ "ok": true, "kept": boolean }`.
- **Notifications have no route of their own.** They are sent beside the business's emails for three events
  and nothing else (`packages/shared/src/push.ts`): a customer's new request (the worker after pricing, a
  request held at the plan limit, a request that could not be priced), an accepted estimate
  (`POST /api/public/quotes/:id/accept`) and a question from "Ask a question"
  (`POST /api/public/quotes/:id/feedback` with `feedbackType: "feedback"`; a review request does not notify).
  Body: one sentence (customer name, service name or total). Data: `{ quoteId, event }`. Never the customer's
  message, address, phone or email. A failed send is logged with the quote id and counts, and never changes any
  route's answer. Settings: `EXPO_ACCESS_TOKEN` (optional, web and worker).

## Account routes (T-173)
The browser does not call Supabase's auth directly. All answer `{ "ok": true }` or the standard error envelope.
- `POST /api/auth/signup` `{ "email", "password", "businessName", "plan"?, "turnstileToken"?, "website"? }`.
  Makes the unconfirmed account and emails its confirmation link through Postmark. The answer is the same when
  the address already has an account (that address is emailed "You already have an account"). 400 for a bad
  email, a password under 8 characters or no business name; 503 `EMAIL_NOT_SENT`.
- `POST /api/auth/login` `{ "email", "password" }`. Sets the session cookies. 401 `INVALID_LOGIN` (the same for a
  wrong password and an unknown address); 403 `EMAIL_NOT_CONFIRMED`.
- `POST /api/auth/forgot-password` `{ "email" }`. Emails a reset link if the address has an account; the answer
  is the same either way.
- `POST /api/auth/confirm` (a form post: `type` = `signup` | `recovery`, `token_hash`). Uses the link from an
  account email and answers **303**: to `/app` or `/reset-password`, or to `/login?notice=link-expired` /
  `/forgot-password?notice=link-expired`. It is the button on `/auth/confirm`; opening that page uses nothing up.
- `POST /api/auth/reset-password` `{ "password" }`. Signed-in only (the reset link signs the person in). 401 otherwise.
- `/api/admin/*` and `/admin` need the role `admin`, which no sign-up has (`lib/roles.ts`; migration 43).

## Room scan models (T-193, AD-076)

- `POST /api/app/room-models` (signed in, the app). Body `{ sizeBytes }` (whole bytes, at most 40 MB). Answers
  `{ modelId, uploadUrl }`: a signed PUT for exactly that size of `model/vnd.usdz+zip`, at
  `<tenant>/room-models/<modelId>.usdz`. The app puts `modelId` on the room in the quote's `scan`.
- The scan (`AppCreateQuoteRequest.scan`, `RoomScanPayload` version 1) may now carry, per wall and opening,
  `start` and `end` (`[x, z]` metres on the floor plane), and per room `ceilingHeightM` and `modelId` (a UUID).
  Each is optional; a bad one is left off and the sizes still count.
- The address of a model, `{ url }` signed for 10 minutes, only for a model in that quote's own scan (404
  otherwise): `GET /api/quotes/:quoteId/room-models/:modelId` (signed in, the quote's tenant);
  `GET /api/public/quotes/:quoteId/room-models/:modelId?token=` (the quote's token, not expired);
  `GET /api/public/approval/:token/room-models/:modelId` (an approval link that can still approve). The two
  public ones are limited to 30 a minute (`room_model`).
- Responses that now carry the scan: `QuoteDetailResponse.roomScan` and `AppQuoteView.roomScan` (`RoomScanView`;
  the app's also has `modelUrls`, by model id), `QuoteViewResponse.roomScan` (`CustomerRoomScanView`: no
  wall-by-wall list), the approval summary's `roomScan` and `roomModelPath`. `AppBootstrapResponse.region.unitSystem`
  is new.

## Room scan areas, rescan, plan (T-194, AD-077)

- A scanned room is an **area**: `RoomScanRoom.roomsCovered` (a whole number 1 to 40; absent = 1) and its `name`.
  `room_count` is filled with the rooms covered summed across the areas.
- `POST /api/app/quotes` with a `scan`, and the rescan below, answer **403 `ROOM_SCAN_NOT_IN_PLAN`** when the
  business's plan has no room scan (Pro and Business have it). `AppBootstrapResponse.roomScan` says which.
- `POST /api/app/quotes/:quoteId/scan` (signed in). Body `{ area, index? }`: `area` is a `RoomScanRoom` (with
  `modelId` when its model was uploaded); `index` replaces that area, none adds one. Only a quote made in the app
  (`source_json.type = 'app'`), not approved (status `pending_review` or `awaiting_clarification`, no `approved_at`;
  409 `INVALID_STATUS` otherwise). The quote is queued and priced again. Answers `{ success }`.
- `GET /api/app/room-models/:modelId` (signed in): `{ url }` signed for 10 minutes, for a model in the business's own
  folder (the app's "View in 3D" before the quote is sent).
- `/room-model#src=<signed url>&name=<area>`: the 3D viewer page the app opens; only addresses on our storage or the
  site itself are opened.
- `TakeoffEntry.scanMeasure` on a line the scan priced. `RoomScanView.pricing` (`kind`, `lines`, `sentence`),
  `AppQuoteView.roomScan.canScanAgain`. Per area the views now carry `roomsCovered`, `wallLength` (was `perimeter`),
  `wallLengthLessDoors`, `tallestWall`, lettered `walls`, `smallReturns`; totals carry `areas`.
  `CustomerRoomScanView` is `{ rooms: [{ name, roomsCovered, figures, planSvg?, modelId? }], priced }`.

## Security notes
- Quote view tokens have an expiry (`tokenExpiresAt`). Expired tokens return 403.
- Future hardening: Consider HMAC-signed tokens for quote view URLs to prevent enumeration.

⸻

Public APIs (Widget + Quote View)

POST /api/public/uploads/init

Create upload intent and get signed upload URL(s) for direct upload (PUT).
Request:

{
  "tenantKey": "tnt_abc123",
  "files": [
    { "fileName": "kitchen.jpg", "contentType": "image/jpeg", "sizeBytes": 234234 },
    { "fileName": "spec.pdf", "contentType": "application/pdf", "sizeBytes": 734234 }
  ]
}

Response:

{
  "uploads": [
    { "assetId": "ast_1", "uploadUrl": "https://...", "method": "PUT" },
    { "assetId": "ast_2", "uploadUrl": "https://...", "method": "PUT" }
  ]
}

Small photo copies (T-172). A photo's entry in `files` may carry `"small": { "contentType": "image/webp", "sizeBytes": 23456 }`:
the small copy the browser made of it (longest side 480 px). When that is declared as `image/webp` or `image/jpeg` and
at most 204,800 bytes, the photo's entry in `uploads` also carries `"smallUploadUrl"`, a signed PUT address for the
copy, at a key derived from the original's (`<key>.small`). Otherwise there is no `smallUploadUrl`; the photo itself
is accepted as before. `small` is optional and a client that does not send it (the mobile app, SMS and WhatsApp
intake, any older page) works unchanged. A small copy is not an asset: it has no row, counts toward no limit and is
never read by the AI. File size limits, the file count and the rate limit are unchanged.

Before a small copy is served, the server reads its first bytes and its size from storage: it must start as a WebP
or a JPEG and be within the limit. A copy that is missing or fails is never served; the original is.

POST /api/public/quotes

Create quote request (widget submission). Stores submission and enqueues job.
Request:

{
  "tenantKey": "tnt_abc123",
  "serviceId": "svc_cleaning",
  "customer": { "name": "Sam", "email": "sam@email.com", "phone": "+44..." },
  "job": {
    "address": "Optional",
    "postcodeOrZip": "SE1 1AA",
    "answers": [
      { "fieldId": "rooms", "value": 3 },
      { "fieldId": "urgency", "value": "standard" }
    ]
  },
  "assetIds": ["ast_1", "ast_2"],
  "source": { "type": "widget", "pageUrl": "https://client.com/quote" }
}

Response:

{
  "quoteId": "qte_123",
  "status": "queued",
  "quoteViewUrl": "https://app.yourdomain.com/q/qte_123?token=...",
  "tokenExpiresAt": "2026-02-25T12:00:00Z"
}

GET /api/public/quotes/:quoteId

Returns data for hosted quote view page (no auth, token required).
Query or header should include token, v1 uses query for simplicity:
	•	GET /api/public/quotes/qte_123?token=...
Response:

{
  "quoteId": "qte_123",
  "status": "sent",
  "documentType": "instant_estimate",
  "business": { "name": "Acme Services", "logoUrl": "https://..." },
  "customer": { "name": "Sam" },
  "pricing": { "currency": "GBP", "total": 180, "taxLabel": "VAT", "taxAmount": 30 },
  "breakdown": [{ "label": "Base service", "amount": 150 }],
  "notes": { "assumptions": [], "exclusions": [] },
  "validUntil": "2026-02-10",
  "assets": [{ "assetId": "ast_1", "type": "image", "viewUrl": "https://...", "smallUrl": "https://...&size=small" }],
  "actions": {
    "acceptUrl": "https://app.yourdomain.com/q/qte_123/accept?token=...",
    "payUrl": "https://app.yourdomain.com/q/qte_123/pay?token=..."
  }
}

T-146 additions to this response:
	•	`review`: `{ "state": "estimate" }` until the business approves, then `{ "state": "quote", "approvedAt": "…" }`. The page reads "This is an estimate based on your photos and details. {business} will review and confirm it." or "Reviewed and confirmed by {business}."
	•	`estimateRange`: `{ "low", "high" }` only on an unreviewed estimate with uncertain quantities. No label.
	•	`provisional` while `pending_review`: only when the engine measured a range. A flat price shows no number until it is approved.
	•	`pricing` NEVER carries `estimate` (grade/label/description), and `takeoff[]` rows carry no `evidence`. Both are business-only (`GET /api/quotes/:id`).
	•	T-171: `read?: string[]` is what was read or measured for the quote, in the customer's terms, a sentence each (`"From your tank's rating label: 50 gal, Natural gas"`, `"From your photos: about 919 sq ft (Exterior walls)"`). Only what is in the quote: a label reading the customer confirmed or that was used as read, a quantity a priced line took from photos or a scan. Never an amount, never the words read off a label, never a word of `customer-language.ts`. Absent when there is nothing, and withheld (like `takeoff`) while the price is a range. The customer's quote page draws these and no longer draws `takeoff` rows; `takeoff` is still returned for other readers.
	•	The token may be the current link or the one issued before approval (`quotes.previous_token_hash`). The same applies to accept, decline, feedback, pdf and asset routes. T-157: or any earlier link of the quote (`quotes.link_token_hashes`), see "T-157 quote actions" below.

POST /api/quotes/:quoteId/approve (T-146, dashboard cookie or app Bearer)
The business approves a quote awaiting its review. The quote is marked approved (`approved_at`/`approved_by`) and sent, and the customer is emailed a fresh link. The link they already hold keeps working.
200: `{ "status": "sent", "emailed": true|false, "emailError?" }`
400 `INVALID_STATUS` (not `pending_review`), 400 `NOT_PRICED` (lead held at the plan limit, price it first), 400 `WORDING_NEEDS_EDIT` (T-148: the unedited generated wording has banned customer words that only deleting the scope would remove; edit it first), 409 `ALREADY_SENT` (a second tap), 404 for another tenant's quote.
T-148: approving an unedited quote (`version` 1) first removes banned customer words from its generated wording and saves the result (`content_json`, plus `pricing_trace_json.wordingRepair`). An edited quote is sent as written.
`PATCH /api/quotes/:id` with `sendToCustomer: true` also counts as approval. A held quote's first send emails "Your quote from …", not "Updated quote".
T-156: every approval records how in `quotes.approved_via`: `dashboard` (cookie), `app` (Bearer), or `email_link` (below, with `approved_by` null). `approved_at` is when.

**One-tap approval from the review email (T-156, AD-041)**

The worker's "Review and approve: {customer} - {service} - {price}" email has an **Approve & send** button linking to `GET /approve/{token}`, plus "Open in dashboard to edit". A test request from setup has the subject prefixed "[Test] " and a banner at the top; demo requests send no email.
- **The token:** 43 URL-safe characters (256 random bits), one per email, in `quote_approval_tokens` (migration 37).
  - Only its sha256 is stored. It's bound to one quote and one tenant, expires after 72 hours, and works once.
  - A newer review email for the same quote replaces it (`invalidated_reason = 'replaced'`).
  - A database trigger invalidates it when the quote's status, version, pricing or wording changes by any route (`quote_changed`).
  - It approves its own quote and nothing else. It is not a session.
- `GET /approve/{token}` (page, no login): shows the business, customer, service, price or measured range, and scope summary. **Opening it never approves.** Headers: `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`.
  - **T-183: while the link can still approve, the page shows what the price is judged by, in this order:** warnings ("Check the service", "Customer also asked for", "Worth checking"); every price line with its amount and where its quantity came from; on a combined quote each service's subtotal; tax; the one total; the customer's photos as small pictures; then the one button. The page and the review email are drawn from one result, `approvalDetail()` (`packages/shared/src/approval-detail.ts`). A used, replaced or expired link shows the short summary only.
  - **Where a quantity came from** is stored on each price line as `source` (`photos`, `label`, `answer`, `scan`, `details`, `calculated`, `fixed`, `words`, `choice`; `packages/shared/src/quantity-source.ts`), on the main service's lines and on a section's. A line the business typed or changed in the editor has none. The business reads it as "Measured from photos", "The customer's answer", "Your fixed price" and so on; a quote priced before T-183 is read from its takeoff.

GET /api/public/approval/:token/photos/:assetId (T-183; no auth; the token is the credential)
- One of the customer's photos for the approval page. `?size=small` serves the small copy when the photo has one (T-172).
- **302** to a signed storage address that lasts 5 minutes (`Cache-Control: private`, `Referrer-Policy: no-referrer`). Uploads stay private; there is no public address.
- Served only while the link can still approve (not used, replaced, expired or pressed too often), and only for a photo that is on the link's own quote's request and is an image of the link's own tenant. **Everything else is 404**, the same answer as a photo that does not exist.
- Opening a photo is not a press: nothing is counted against the link and nothing changes.
- Rate limit: scope `approval_photo`, 120 a minute per address and per link.
- The link's row is read fresh on every call (`noStore()`): a GET handler's database read is otherwise kept and reused by Next.

POST /api/public/approval/:token (no auth; the token is the credential)
- Rate limits:
  - per IP and per link: scope `approval_link`, 10 and 5 a minute (Upstash; fails open without it);
  - plus at most 10 presses per link, counted in the database, which holds without Redis.
- It ignores any body: the quote and tenant come from the token's own row. It then calls the same `approveQuote` as the dashboard and app, so the status guard, wording repair, customer email and kept customer link all behave the same.
- Response: `{ "outcome", "title", "body", "dashboardPath?", "emailed?" }`.
- Status by outcome:
  - 200 `approved` (`emailed: false` when the customer has no email address or email is off);
  - 409 `already_approved` (a second press, or approved elsewhere; nothing changes);
  - 410 `link_expired` (expired, replaced or invalidated);
  - 409 `not_awaiting` (declined, expired or withdrawn);
  - 400 `wording_needs_edit` (T-148);
  - 400 `not_priced` (held at the plan limit);
  - 429 `too_many` or `RATE_LIMITED`;
  - 404 `not_found` (unknown token, or a token whose tenant doesn't own the quote).
- No GET (405). Logs carry the quote id and outcome only.

Services: `POST /api/services` and `PATCH /api/services/:id` accept `autoSend: boolean` ("Send automatically", default false) and, from T-147, `holdUntilApproved: boolean` ("Hold until I approve", default false). Both off is the default mode, "Show the estimate, then I confirm it". Setting one clears the other. Unless auto-send is on, the worker holds every quote that would have been sent (`pending_review`) and emails the business "Review and approve: …". Quotes created in the business's own app send no such email.

T-148 customer wording repair:
	•	Every AI-generated text in the public payload (`notes.scopeSummary`, `notes.assumptions[]`, `notes.exclusions[]`, `notes.notes`, `signalRecommendations[].workDescription|costBreakdown|evidence`, `crossServicePricing[].reason|note|extractedDetails[]`) passes `shared/customer-language.ts`. The worker repairs it before storing: one rewrite call when the guard trips, then removal. Text the business typed is kept as written.
	•	`pricing_trace_json.wordingRepair` (`WordingRepairRecord`: path, found, rewriteCalled, rewriteError?, rewritten[], removed[], unresolved[]) is business-only: `GET /api/quotes/:id` and the trace page. The public API never returns it.

T-147 show, then confirm (supersedes the T-146 default; AD-035):
	•	The worker records why a `pending_review` quote is waiting in `quotes.review_hold`: `shown` (default mode: the customer already sees the estimate), `held` (service set to hold, or a quote the business created in its app), `check` (validation, quality gate, send-guard, the service's own review rule, or, from T-148, generated wording the repair could not clean). `NULL` on older rows and plan-limit lead holds. Only `shown` with a price above zero is shown early (`isShownEarly`, `shared/review-mode.ts`).
	•	`GET /api/public/quotes/:quoteId` for a shown-early quote: `status` stays `pending_review`; `review` is `{ "state": "estimate", "confirmationPending": true }`; `pricing`, `breakdown`, `takeoff` and `notes` (scope, assumptions, exclusions) carry the real figures; `estimateRange` is present only when the engine measured a range; no `provisional`; `acceptQuoteEnabled` is `false`. Every other `pending_review` quote is returned exactly as under T-146 (pricing zeroed, `provisional` only for a measured range).
	•	Viewing never moves a quote off `pending_review`. The first view after approval still records `sent` → `viewed`, even if the customer opened the estimate earlier.
	•	`POST /api/public/quotes/:quoteId/accept` returns 400 `INVALID_STATUS` until the business approves.
	•	`POST /api/public/quotes/:quoteId/feedback` accepts `feedbackType: "feedback"` (Ask a question) on a shown-early quote and leaves the status at `pending_review`. `approval_request` is still 400 there.
	•	After `POST /api/quotes/:quoteId/approve` the same link returns `review.state = "quote"` with `acceptQuoteEnabled` back to the tenant setting.
	•	Emails: a shown-early quote sends the customer "Your estimate from {business}" at once (worker, Postmark tag `estimate-customer`), saying the business will confirm. "Your quote from {business}" still goes on approval. The business "Review and approve" email gained the one-tap button and the hold line in T-156.

POST /api/public/quotes/:quoteId/accept

Marks quote accepted.
Request:

{ "token": "..." }

Response:

{ "status": "accepted", "acceptedAt": "2026-01-25T12:00:00Z" }

POST /api/public/quotes/:quoteId/pay/init

Creates Stripe checkout session if enabled and returns Checkout URL.
Request:

{ "token": "..." }

Response:

{ "checkoutUrl": "https://checkout.stripe.com/..." }


⸻

Dashboard APIs (Tenant + Config + Quotes)

GET /api/me

Returns current user and tenant context.
Response:

{ "userId": "usr_1", "tenantId": "tnt_1", "role": "admin" }

GET /api/tenant

Tenant settings summary.
Response:

{
  "tenantId": "tnt_1",
  "name": "Acme Services",
  "currency": "GBP",
  "tax": { "enabled": true, "label": "VAT", "rate": 0.2 },
  "serviceArea": { "mode": "postcode_allowlist", "values": ["SE1", "SE2"] }
}

PUT /api/tenant

Update tenant settings (currency, tax, service area).
Request:

{
  "currency": "GBP",
  "tax": { "enabled": true, "label": "VAT", "rate": 0.2 },
  "serviceArea": { "mode": "county_state", "values": ["Kent"] }
}

Response:

{ "ok": true }

T-157 quote actions that always work (dashboard cookie or app Bearer unless marked public; AD-042):
	•	**One rule per action**, in `packages/shared/src/quote-status.ts`, read by the button and by the route it calls:
		- Send again (`POST /api/quotes/:id/resend`): `sent`, `viewed`, `revised`, `expired`, and the customer has an email address. Otherwise 400 `INVALID_STATUS` or 400 `NO_EMAIL`; then 503 `EMAIL_NOT_CONFIGURED`. Every check runs before anything is written. A change made while sending → 409 `INVALID_STATUS`. A revised quote stays `revised` (`statusAfterResend`); anything else becomes `sent`.
		- Copy link (`POST /api/quotes/:id/link`) and Download PDF (`POST` and `GET /api/quotes/:id/pdf`): `sent`, `viewed`, `feedback_received`, `revised`, `accepted`, `paid`, `expired`. Otherwise 400 `INVALID_STATUS` (new on the PDF routes; the link route used to refuse `feedback_received` and `revised`).
		- Text link (`POST /api/sms/send-quote`): `sent`, `viewed`, `feedback_received`, `revised`, `expired` (unchanged), and an active SMS number (400 `SMS_NOT_CONFIGURED`). It now leaves a `revised` or `feedback_received` quote in that status instead of setting `sent`.
		- Edit (`PATCH /api/quotes/:id`): unchanged (not `accepted`, `paid`, `generating`, `queued`, `failed`).
	•	`GET /api/quotes/:quoteId` also returns `smsActive: boolean` (the tenant has an active row in `sms_configs`). The quote page shows "Text link" only when it is true.
	•	**What the AI understood and the customer's photos (T-169).**
		- `GET /api/quotes/:quoteId` also returns `photos: [{ id, url }]` (the customer's photos in the order sent; `url` is the path `/api/quotes/:quoteId/photos/:assetId`, never a storage address) and `understanding: { photos[], words[], alsoNoted[], asked[], checks[], checksBeforeChange }` (`QuoteUnderstanding` in `@qolumns/shared`). Each list item is `{ text, detail? }`; `asked` items are `{ question, answer | null }`. Every list can be empty; nothing is padded. **`checks` is always empty and `checksBeforeChange` always false today:** "Worth checking" is switched off (`SHOW_WORTH_CHECKING` in `apps/web/src/lib/quote-understanding.ts`) and the checker's log is not read for this route. When it is on, `checks` are the descriptions from the newest quote checker run for that quote that found something (`quote_validation_logs`, read for the caller's tenant only); `checksBeforeChange` is true when the quote's total is no longer the total the checker read. The checker's `found`, `expected` and suggested fix are never returned.
		- `GET /api/quotes/:quoteId/photos/:assetId` → 302 to a signed storage address that lasts 300 seconds (`Cache-Control: private`). 401 signed out. 404 `NOT_FOUND` when the quote is another tenant's, the asset is not one of that quote's request, the asset row is another tenant's, or it is not an image: the same answer as an id that does not exist. 503 `STORAGE_UNAVAILABLE` when storage is not configured. Neither the key nor the signed address is logged.
		- T-172: each entry of `photos` also has `smallUrl` (the same path with `?size=small`). `GET /api/quotes/:quoteId/photos/:assetId?size=small` and `GET /api/public/assets/:assetId?token=…&size=small` answer with the photo's small copy when it has one that passes the server's check, and with the original when it has not (a photo uploaded before T-172). Sign-in, tenant and token checks are the same for both sizes; both answer with a signed address. A public quote's `assets[]` carry `smallUrl` for photos.
		- `GET /api/quotes` items carry `photoUrl` (the first photo's path, or null).
		- Nothing here writes: no route in this ticket changes a quote, a price or the checker's log.
	•	**Links.** Every route that hands out a link still makes a new token (raw tokens are never stored), but the replaced one keeps working: a database trigger (migration 38) puts the old `quote_token_hash` at the front of `quotes.link_token_hashes` (no duplicates, the newest 10). All public token routes (`GET /api/public/quotes/:id`, accept, decline, feedback, pdf, clarify, assets) accept the current link, `previous_token_hash`, or any hash in that list. Expiry is unchanged: `token_expires_at` covers every link of the quote (410 `TOKEN_EXPIRED`).
	•	`POST /api/quotes/:quoteId/feedback/:feedbackId/answered` ("Mark as answered") → `{ "feedbackId", "feedbackStatus": "acknowledged" | "resolved", "quoteStatus", "pendingLeft" }`. Sets a pending question (or an old review request) to `acknowledged`. When the quote is `feedback_received` and nothing is pending, it goes back to `viewed`. Scoped to the signed-in user's tenant and to that quote: any other id is 404 `NOT_FOUND`. 401 when signed out. Pressing twice is harmless.
	•	`PATCH /api/quotes/:quoteId`:
		- `sendToCustomer: true` on a quote the customer already had (`sent`, `viewed`, `feedback_received`, `revised`) gives `revised`; it used to flip `revised` back to `sent`. A first send is still `sent`.
		- with `sendToCustomer: true` every pending `quote_feedback` row of the quote becomes `resolved`, not only `feedbackId`. A plain save still resolves only `feedbackId`.
		- each `pricing_json.breakdown[].amount` is rounded to 2 decimals (`roundMoney`: half away from zero) and `subtotal` is the sum of the rounded lines. Tax and total as before. `breakdown` must be an array (400 `INVALID_REQUEST`).
		- a line whose amount changed while its label is still exactly the engine's generated label loses that label's maths ("Exterior walls  £18 x 34.6(Sqm)" → "Exterior walls"). A label the business typed or changed is never rewritten.
		- the minimum charge (T-165, `editedBreakdown`): a `breakdown` entry with `kind: "minimum"` asks to keep the quote's minimum. The server ignores its `amount` and `minimumCharge`: it takes the minimum stored on the quote and works the top-up out again from the lines sent, so lines + entry = the minimum. It stores no entry when the lines total the minimum or more, when none was sent (the business removed it), or when the stored quote carries none (a quote without a minimum never gets one). Only the marker counts in what is sent; an unmarked line is a line.
	•	**The minimum charge (T-165).** `pricing.breakdown` in `GET /api/public/quotes/:quoteId` and `GET /api/quotes/:quoteId` may hold one entry `{ "label": "Minimum charge applied", "amount": 25, "kind": "minimum", "minimumCharge": 400 }`: the top-up to the business's minimum charge. Clients show it as the note "Minimum charge of $400.00 applied" above the total, never as a line (`splitMinimum`, `minimumChargeNote` in `@qolumns/shared`). `GET /api/onboarding/test-quote` returns `lines` without it and `minimumCharge` (number or null) beside them. `pricing.notes` no longer carries the sentence.
	•	`GET /api/public/quotes/:quoteId` (public) also returns `questionPending: true` while a question from the customer is unanswered. `POST …/accept` and `POST …/decline` (public) are allowed in `sent`, `viewed`, `revised` and `feedback_received`, as before; the page no longer hides them after a question. A second question while one is open is still refused (400 `INVALID_STATUS` from `feedback_received`).
	•	**Emails to the business** (quote accepted, customer question, quote declined, plan limit, held lead, and the worker's new-quote and review emails) go to `tenants.notification_email` when set, otherwise to the account email of the tenant's first user. The demo business gets none. The same address is the `Reply-To` on customer emails (worker, approve, edit and send, send again, reminder). Before T-157 the three public routes sent nothing unless the setting was filled, and the worker ignored the setting.
	•	**Sender name (T-159).** Every email's From header is built by `emailFromHeader` in `packages/shared/src/email-from.ts`: to a customer `"<tenant name> via Qolumns" <POSTMARK_FROM_EMAIL>`, to the business `"Qolumns" <POSTMARK_FROM_EMAIL>`. The tenant name is cleaned (no line breaks, control characters or angle brackets), cut to 60 characters and quoted, so it cannot change the address or add a header. `sendEmail` in both apps requires `from: { kind: 'customer', businessName } | { kind: 'business' }`. Reply-To is unchanged.
	•	The engine rounds every line amount where it is created, so stored `pricing_json.breakdown[].amount` and `pricing_trace_json.trace[].amount` have at most 2 decimals and the lines add up to `subtotal`. The label format is unchanged.

T-153 public demo ("Try it as a customer", /demo):
	•	The demo business is one tenant with `tenants.is_demo = true` (migration 36), created by `scripts/seed-demo-tenant.mts`. Only the service role can set or change the flag (a guard trigger refuses a user token, 42501). `quotes.is_demo` is copied from the tenant on insert by a trigger, whatever the caller sends. No tenant or public API accepts or returns either flag.
	•	`POST /api/public/quotes` to the demo business: Turnstile, honeypot, the `quotes` rate limit and upload limits as usual, then the demo limits, counted in the database: `DEMO_IP_LIMIT_PER_HOUR` (default 5) per IP (a salted hash, stored as `quote_requests.source_json.demoIp`) and `DEMO_DAILY_CAP` (default 200) in the last 24 h. Over either → 429 `{ error: { code: "DEMO_BUSY", reason: "ip_limit" | "daily_cap" } }` and nothing is created. A demo request is outside any plan and never counts as usage; test tokens don't apply.
	•	`POST /api/public/leads` to the demo business → `{ skipped: true }` (no unfinished lead).
	•	`GET /api/public/widget/config` for the demo business serves the shipped logo `/demo/example-home-services-logo.svg`.
	•	Demo quotes send no email (worker, accept, decline, feedback, reminders), use no adjudication model, read one photo at most, are never recorded for calibration, and are excluded from benchmarks and the admin tenant list.
	•	`GET /api/cron/lifecycle` pass 3 deletes demo quotes, requests and uploads (R2 objects first) older than 24 h; the response carries `demoDeleted: { quotes, requests, assets, objects }`.

T-152 simpler dashboard:
	•	`PUT /api/tenant` accepts `pricesChecked: true` (the business confirmed its prices: setup's "These are my prices", or saving a service on Prices). It stamps `tenants.prices_checked_at`, which ticks "Check your prices" on Home. Nothing else sets it.
	•	`GET /api/billing` `usage.per`: `month` (a live plan, or the legacy GB 50 a month) or `total` (the free allowance: 10 priced quotes in total, never resets). With `total`, `estimatesCreated` is the sum over every month and `heldLeads` counts all held leads, not just this month's. Other fields unchanged.
	•	The plan limit (`checkPlanLimit`, used by `POST /api/public/quotes`, the WhatsApp/SMS intake and `POST /api/quotes/:id/process`) reads the same rule; its result carries `per`. Tests (T-150) and unfinished requests (T-151) still never increment the counters. Over the allowance → the T-134 lead hold.
	•	`GET /api/tenant/branding` also returns `region` (for the Branding placeholders).
	•	Dashboard URLs: `/app/services` → `/app/prices`, `/app/branding` → `/app/settings/branding`, `/app/billing` → `/app/settings/billing` (307, query kept). Stripe checkout and portal now return to `/app/settings/billing`. The mobile app API (`/api/app/*`) is unchanged.

T-151 customer flow:
	•	Contact rules (`lib/contact-rules.ts`, per business `tenants.contact_requirement`: `email` (default; phone optional) | `phone` (email optional) | `both`). A name is always required. Enforced by `POST /api/public/leads`, `POST /api/public/quotes` (replaces the old "name and email are required"; 400 `VALIDATION_ERROR` with `fields`) and the chat completion check. `PUT /api/tenant` accepts `contactRequirement`; `GET /api/tenant` returns it. `GET /api/public/widget/config` returns `contactRequirement` and `region.phoneExample` / `region.phoneHint`.
	•	`POST /api/public/leads` `{ tenantKey, serviceId, customer{name,email?,phone?}, turnstileToken?, website?, testToken?, source? }` → `{ leadId, leadToken }`: an unfinished request, saved when the contact step is done. Rate limit scope `leads` (20/min/IP, 300/min/tenant), Turnstile and honeypot as for submission. No AI, no usage. A valid `testToken` → `{ skipped: true }` and no row; an invalid one → 403.
	•	`PATCH /api/public/leads/:leadId` `{ tenantKey, leadToken, progress: contact|questions|photos|details, answers?, postcode?, assetIds? }` → `{ ok: true }`. Only the token holder, only while unfinished (404 otherwise); progress never moves back; answers are bounded plain values.
	•	`POST /api/public/quotes` accepts `leadId` + `leadToken`. On success the lead is closed (`quote_id`, `completed_at`), and so is any other open lead for the same customer (email or phone) and service from the last 24 h, so a reload can't leave a duplicate. A service with no questions of its own needs a non-empty `_project_description` (400 "Please describe the job."); with questions it is optional. WhatsApp/SMS intake don't apply this rule.
	•	`GET /api/leads?days=30` (dashboard) → `{ items: [{ leadId, customerName, customerEmail, customerPhone, serviceName, progress, progressLabel, answerCount, photoCount, postcode, createdAt, lastActiveAt }] }`: unfinished only, own tenant.
	•	**T-160, unfinished requests that clear** (dashboard cookie or app Bearer; own tenant only):
		- `GET /api/leads?days=30` leaves out requests marked done, adds `isNew` (not seen before) to each item, and returns `asOf` (when the list was read). Reading it changes nothing.
		- `GET /api/leads/new-count` → `{ count }`: unfinished requests not seen yet (the menu badge; Home's banner is the same count).
		- `POST /api/leads/seen` `{ asOf }` → `{ marked }`: marks the business's unseen requests started up to `asOf` as seen. A missing, invalid or future `asOf` means now.
		- `POST /api/leads/:leadId/done` → `{ ok: true }`: sets `handled_at`; the request leaves the list and every count. Repeating it is fine. Another business's request, a finished one or an unknown id → 404 `NOT_FOUND`.
		- `GET /api/quotes?group=…` `counts.unfinished` follows the same rule (not finished, not done, last 30 days).
		- Signed out, all four answer 401.
	•	`POST /api/public/quotes/:quoteId/accept` accepts `details: { timing: asap|two_weeks|flexible, timingNote?, address, phone }` (all but the note required when `details` is sent; 400 with `fields`). Saved as `quotes.acceptance_json` and included in the business's acceptance email. A request without `details` (a page opened before T-151) accepts as before.
	•	`GET /api/public/quotes/:quoteId` returns `customer.phone` (the link holder's own number, to confirm on accept). `GET /api/quotes/:quoteId` now also returns `review_hold`, `is_test` and `acceptance_json`.
	•	`quote_requests.customer_email` is nullable (phone-only requests). Customer emails (worker estimate/quote emails, approve, edit-and-send, reminders) are skipped when there is no address; `POST /api/quotes/:id/resend` → 400 `NO_EMAIL` (T-157: "This customer gave no email address. Copy the link and send it to them another way.", checked before anything is written).

T-150 setup and test requests (dashboard cookie or app Bearer; tenant from the signed-in user):
	•	`PUT /api/tenant` also accepts `trade` (a vertical pack id, `"other"`, or null) and `tradeOther` (≤ 200 chars, kept only when `trade` is `"other"`). An unknown trade → 400 `INVALID_INPUT`.
	•	`POST /api/onboarding/test-link` → `{ "url": "<origin>/quote/<slug>?test=<token>", "issuedAt", "expiresAt" }`. The token is an HMAC over the tenant id and a 2-hour expiry (key: `TEST_QUOTE_SECRET`, else derived from the service-role key). 401 when logged out.
	•	`GET /api/onboarding/test-quote?since=<ISO>` → `{ "quote": null }` or `{ "quote": { id, status, serviceName, currency, subtotal, taxAmount, taxLabel, total, lines[{label, amount}], scopeSummary } }`: the tenant's latest test request since the link was issued.
	•	`POST /api/onboarding/skip` → `{ "ok": true }`. Sets `tenants.onboarding_skipped_at`; `/app` stops redirecting to setup.
	•	`POST /api/public/quotes` accepts `testToken`. Valid for this tenant's key → the quote is created with `quotes.is_test = true`, skips the plan limit and lead hold, and is never counted (`estimates_created` in the web app, `estimates_sent` in the worker) or metered. Invalid, expired or another tenant's → 403 `TEST_LINK_INVALID`. More than 10 test requests per tenant in 24 h → 429 `TEST_LIMIT_REACHED`. Any `test` / `isTest` / `is_test` key a client puts in `source` is stripped.
	•	`GET /quote/:slug?test=<token>` shows a "Test mode" note when the token is valid for that tenant (an invalid one is ignored), and doesn't set the first-visit flag.
	•	`GET /api/quotes` items carry `isTest`. `GET /api/billing` returns `selectedPlanId` (the plan picked on the pricing page; pre-selection only, never checkout).

T-149 quote link (dashboard cookie or app Bearer; tenant from the signed-in user):
	•	`GET /api/tenant/slug[?check=<slug>]` → `{ "slug", "changeable", "random", "options?": string[], "check?": { "slug", "available", "reason?", "message?" } }`. T-174: `random` is true while the link still ends in the four generated characters and has never been replaced (decided on the server: generated ending, `slug_changed_at` empty, nothing in `tenant_slug_history`). `options` (only when `random`, and not on a `?check` call) is up to three clean links built from the business's own stored details (service area, trade, website name, region), each already checked free; it can be empty. `reason`: `too_short` | `too_long` | `invalid_characters` | `reserved` | `taken` (another business's current or former slug).
	•	`PUT /api/tenant/slug` `{ "slug" }` → `{ "slug", "changeable", "free" }`. Allowed once (`changeable: false`, `free: false`). T-174: replacing a `random` link is free and leaves the one change (`changeable: true`, `free: true`); the server decides that from the tenant's record, never from the request, and it happens once. The same format, reserved-word and never-reuse checks run either way. 400 `INVALID_SLUG`, 409 `SLUG_TAKEN`, 409 `ALREADY_CHANGED`. The old slug goes to `tenant_slug_history`: it keeps redirecting and can never be taken by anyone else. Writing `tenants.slug` directly is refused by a DB trigger (only the service role may change it).
	•	`POST /api/tenant/share-event` `{ "event": "copied" }` → `{ "ok": true }`. Sets `tenants.quote_link_copied_at` once (home checklist).

Public page `GET /quote/:slug` (T-149): the business's hosted quote page, rendering the same widget as `/embed/:tenantKey` (AD-024), so submissions go through `POST /api/public/quotes` with that tenant's key under the same rate limits, Turnstile and honeypot. 200 for a current slug with an active site; 308 to `/quote/<current>` for a former slug; 404 for unknown, malformed or inactive. Rate limit scope `quote_page` (60/min/IP). The first view sets `tenants.quote_link_first_visit_at`. `/embed/:tenantKey`, `widget.js` and `iframe-loader.js` are unchanged.

CRUD /api/services

Create and manage services.
Service object:

{
  "serviceId": "svc_1",
  "name": "Patio Cleaning",
  "active": true,
  "documentTypeDefault": "instant_estimate"
}

T-189 (AD-070): `documentTypeDefault` is stored and returned but read by nothing: every quote has one style. A
create or update that sends it is accepted and the value ignored. `POST /api/services/ai-draft` no longer reads
`documentType`.

PUT /api/services/:serviceId/pricing

Pricing config for a service.
Request:

{
  "baseFee": 50,
  "minimumCharge": 80,
  "addons": [
    { "addonId": "seal", "label": "Sealing", "price": 60 }
  ],
  "multipliers": [
    { "when": { "fieldId": "dirtLevel", "equals": "heavy" }, "multiplier": 1.25 }
  ]
}

Response:

{ "ok": true }

CRUD /api/widget-config

Widget fields and file rules.
Request:

{
  "fields": [
    { "fieldId": "rooms", "type": "number", "label": "Number of rooms", "required": true }
  ],
  "files": { "minPhotos": 2, "maxPhotos": 8, "maxDocs": 3 }
}

Response:

{ "ok": true }

GET /api/quotes

List quotes for dashboard. Response includes status and key timestamps.
Response (example):

{
  "items": [
    {
      "quoteId": "qte_123",
      "serviceName": "Patio Cleaning",
      "status": "sent",
      "createdAt": "2026-01-25T10:00:00Z",
      "sentAt": "2026-01-25T10:02:00Z",
      "viewedAt": null,
      "acceptedAt": null,
      "paidAt": null,
      "total": 180,
      "currency": "GBP"
    }
  ],
  "nextCursor": null
}

T-158 (whose turn it is, AD-043). Query: `search`, `status`, `limit`, `cursor`, and `group`:
	•	`group` = `needs_you` | `waiting` | `accepted` | `closed` | `all` filters by the groups in `packages/shared/src/quote-turn.ts` (`QUOTE_GROUP_STATUSES`: needs_you = `pending_review`, `feedback_received`, `failed`; waiting = `sent`, `viewed`, `revised`, `awaiting_clarification`; accepted = `accepted`, `paid`; closed = `declined`, `expired`). `queued` and `generating` are in no tab and come back under `all`.
	•	`group=default` resolves on the server: `needs_you` when it has any quote, otherwise `all`.
	•	With `group`, the response also carries `counts` (`{ needs_you, waiting, accepted, closed, unfinished, all }`) and `group` (the one used). The quote counts follow `search`; `unfinished` is the number of unfinished requests in the last 30 days (the same rows as `GET /api/leads`). An unknown group → 400 `INVALID_GROUP`.
	•	**Without `group` the response is as before**: every quote, no `counts`, no `group` (the mobile app's call).
	•	Items also carry `declinedAt`, `expiresAt` (the link's expiry) and `held` (saved but not priced: the plan limit was reached). They feed the label, detail line and next step (`quoteTurn`).
	•	`status=declined` is accepted (it was missing from the valid statuses, so that filter returned every quote).
	•	`search` matches the customer's name or email. Before T-158 every search answered 500: the filter compared JSON with `ilike`. The value is quoted, so commas and brackets are part of the search.
	•	Every query in the route (the list, the five quote counts, the unfinished count) is filtered by the caller's tenant.
	•	`GET /api/quotes/:quoteId` also returns `declined_at` and `token_expires_at` (the quote page's tracker).


⸻

Billing and Webhooks

See "Billing (T-180, AD-062, AD-063)" near the top of this file. The Stripe webhook is
`POST /api/webhooks/stripe` (this section used to give an address that never existed).


⸻

WhatsApp APIs (T-111, T-112; rewritten in T-175; T-176; T-177)

T-177, for every route below: WhatsApp is for a business whose plan includes the WhatsApp channel (the plan
definitions in `packages/shared/src/plans.ts` decide) and whose subscription is active or on trial
(`lib/whatsapp-access.ts`). Otherwise the routes that would connect or send answer 403 `PLAN_REQUIRED` (the plan
has no WhatsApp, or there is no plan) or 403 `ASSISTANT_PAUSED` (the subscription is not active): `POST connect`,
`PUT config`, `POST send`. Reading and disconnecting stay open, and a connection is never removed for this.

Every dashboard route below needs a signed-in user and acts on that user's own business only. The stored row
(`whatsapp_configs`) is server-only since migration 42: the routes read and write it with the service role. No
response ever carries an access token, an app secret or a PIN.

GET /api/whatsapp/config
The connection as the page shows it, and what the page needs to open Meta's Embedded Signup.

{
  "configured": true,
  "config": {
    "method": "embedded",            // or "manual"
    "phoneNumberId": "1065…", "displayPhoneNumber": "+1 555-0100", "verifiedName": "Kent Garage Doors",
    "isActive": true, "alsoOnBusinessApp": false, "connectedAt": "…",
    "token": { "state": "ok", "expiresAt": "…", "daysLeft": 60 },   // state: no_expiry | ok | expiring (< 14 days) | expired
    "registered": true, "messagesReady": false,
    "paymentUrl": "https://business.facebook.com/wa/manage/home/?waba_id=…"
  },
  "access": { "allowed": true, "why": null, "line": null },   // T-177. why: "plan" | "subscription"; line: the one line the page shows
  "connect": { "available": true, "appId": "…", "configId": "…", "graphVersion": "v27.0", "signupVersion": "v5" },
  "setup": { "webhookUrl": "https://qolumns.com/api/whatsapp/webhook", "verifyToken": "…" },   // manual method only
  "manualNeedsSecret": false
}

POST /api/whatsapp/connect   { "code", "wabaId"?, "phoneNumberId"?, "businessId"?, "onBusinessApp"? }
Finishes a connection started in Embedded Signup. `code` is from the login callback (it lives 30 seconds); the ids
are from Meta's message event and are never trusted: the server exchanges the code, asks Meta whose token it is,
reads the account's numbers with that token, and only connects a number Meta lists under it. Then it subscribes the
app to the account, registers the number (not a WhatsApp Business app number) and stores the token encrypted.
→ { "ok": true, "config": { … }, "registrationProblem": null | "…" }
T-177: after a successful connect the message template is looked for on Meta and created only if the account has
none with our name (best effort; it never fails the connect). The page runs Embedded Signup v5.
Errors: 400 INVALID_REQUEST, 403 NOT_YOUR_ACCOUNT / NOT_YOUR_NUMBER, 422 CODE_REFUSED / TOKEN_REFUSED / NO_NUMBER /
WHICH_NUMBER / WHICH_ACCOUNT, 502 META_REFUSED, 503 NOT_AVAILABLE. Nothing is saved on an error.

POST /api/whatsapp/status
Asks Meta how the connection stands (the number's name, whether a payment method is on the account, whether the
token is still good), stores it. → { "ok": true, "config": { … }, "problem": null | "…", "live": { … } }.
404 NOT_CONNECTED.
T-176: `live` is what Meta says at that moment and is never stored:
{ "nameStatus": "PENDING_REVIEW" | "APPROVED" | "AVAILABLE_WITHOUT_REVIEW" | "DECLINED" | "EXPIRED" | "NONE" | null,
  "hasPaymentMethod": true | false | null }. The page calls this once when it opens, and on "Check again".

GET /api/whatsapp/template   (T-176)
The business's one message template, "estimate_ready", as Meta has it now. Nothing is stored: Meta is asked each
time, with the business's own token, on its own WhatsApp account.
→ { "ok": true, "problem": null,
    "template": { "name": "estimate_ready", "language": "en_US",
                  "state": "none" | "pending" | "approved" | "rejected" | "paused" | "disabled" | "unknown",
                  "metaStatus": "PENDING" | … | null, "category": "UTILITY" | "MARKETING" | null,
                  "reason": null | "Meta read the wording as advertising.",
                  "text": "Your estimate from Kent Garage Doors is ready. Open it here: https://qolumns.com/q/…\n\nThank you …",
                  "managerUrl": "https://business.facebook.com/wa/manage/message-templates/?waba_id=…" } }
404 NOT_CONNECTED (no connection, or a manual one: templates belong to an account connected through Meta),
502 META_REFUSED.

POST /api/whatsapp/template   (T-176; REMOVED in T-177)
There is no route that creates a template on request any more. The template is set up when a business connects
(`ensureEstimateTemplate`, called by `POST /api/whatsapp/connect`): a template Meta already lists under our name,
in any language and any state, is used and nothing is created; with none, it is created (the wording is fixed,
with the business's name written in and the customer's link as its one variable). `GET` above only reads, so
opening the page can never create one. `state: "none"` means Meta has none for the account yet.

POST /api/whatsapp/register   { "pin"? }
Finishes registering a number Meta refused at connect time. `pin` is the number's own six-digit two-step PIN when
it has one. → { "ok": true, "config": { … } }. 400 INVALID_PIN, 422 REGISTRATION_REFUSED.

PUT /api/whatsapp/config   { "phoneNumberId", "displayPhoneNumber"?, "accessToken"?, "appSecret"?, "isActive"? }
The manual method (a business with its own Meta app). A new connection needs the token and the app secret; the
token is checked with Meta against the number, on the server, before anything is saved. Left empty on an update,
the stored token and secret are kept. 400 VALIDATION_ERROR, 409 NUMBER_IN_USE, 422 VERIFICATION_FAILED.

DELETE /api/whatsapp/config
Disconnect: asks Meta to stop sending us the account's messages (embedded connections) and deletes the row, and the
token with it. The number is not deregistered. → { "ok": true, "removed": true, "metaToldToStop": true }

POST /api/whatsapp/verify   { "useStored": true } | { "phoneNumberId", "accessToken" }
A read-only check of credentials with Meta. Nothing is stored.

POST /api/whatsapp/send   { "toPhone", "message", "conversationId"? }
Sends a text from the business's own number (the page's test message). 402 PAYMENT_NEEDED, 422 OUTSIDE_WINDOW
(the person has not messaged the number in the last 24 hours) / RECONNECT / NAME_IN_REVIEW (T-176: Meta's code
131037, the display name is not approved yet), 502 SEND_FAILED.
→ { "ok": true, "messageId": "wamid.…", "windowOpen": true | false }
T-176: Meta accepts a message to a phone outside the 24-hour window (200 and a message id) and then does not
deliver it; the refusal comes later on the status webhook. `windowOpen` says whether we hold a message from that
phone in the last 24 hours, so the page does not say "sent" about a message that will not arrive.

GET /api/whatsapp/send?messageId=wamid.…   (T-176)
What became of a message this business sent: { "status": "sent" | "delivered" | "read" | "failed" }, as Meta's
status webhook reported it. The business's own messages only. 400, 404 NOT_FOUND.

GET /api/whatsapp/webhook
Meta's handshake: answers `hub.challenge` when `hub.verify_token` matches `WHATSAPP_VERIFY_TOKEN`; otherwise 403.

POST /api/whatsapp/webhook
One address for every business's incoming messages.
T-177 (the silent assistant, AD-057):
- A message is answered only when it asks for a price for something the business offers. One AI call decides
  (registry task `whatsapp_intent`), given the business's services, what each includes and excludes, and its
  service area. Anything else, or any doubt or failure: no reply.
- A message that is not answered is stored without its text (`content` and `media_url` null): only that it
  arrived, from whom and when. The text is stored only when the message is part of a price request.
- A price request is answered in short fixed sentences that ask only for what is missing, then the link. When the
  request is made the conversation's `status` becomes `completed`, so the next message starts a new one.
- A business whose plan has no WhatsApp, or whose subscription is not active, gets no reply and the model is not
  asked.
- `smb_message_echoes` (a message the business sent from its own WhatsApp Business app; coexistence numbers
  only): the chat with that customer is left alone for 24 hours (`intake_data._ownerRepliedAt`), and a request
  under way is dropped. Only the customer's number and the time are read. Signed like a message.
- `X-Hub-Signature-256` is checked on every call (HMAC-SHA256 of the raw body). A call is acted on only when it is
  signed by the Meta app the number is connected through: the platform's app (`WHATSAPP_APP_SECRET`) for an
  embedded connection, the business's own app secret for a manual one. No signature, or one that proves nothing:
  401, and nothing is read from the call.
- A message is routed by `metadata.phone_number_id` to the one business whose row has that id, stored, and passed
  to the intake engine; replies are sent with that business's own token. A repeated delivery is ignored.
- On a number that stays on the WhatsApp Business app, a new conversation is answered only when the message asks
  for a quote, an estimate or a price.
- `account_update` with PARTNER_REMOVED, PARTNER_APP_UNINSTALLED, ACCOUNT_DELETED or ACCOUNT_OFFBOARDED (platform
  signature only) deletes the stored connection of that account.
- Other fields are ignored. Nothing about a customer is logged.
Response: { "received": true }

Response:

{ "ok": true }

⸻

Business app APIs (T-137)

Auth: `Authorization: Bearer <signed-in user's Supabase access token>`. Every dashboard API (e.g. `GET /api/quotes`) also accepts it.
The app uses the widget's public `GET /api/public/widget/config?tenantKey=` and `POST /api/public/uploads/init` with the tenant key from bootstrap.

GET /api/app/bootstrap
200: `{ "tenantName": "…", "tenantKey": "tkey_…", "currency": "USD", "region": { "code": "US", "locale": "en-US", "postalCodeLabel": "ZIP code" } }`
(T-196: also `won`, and the optional `?tz=`; see "T-196" above.)
409 `NO_SITE` when the tenant has no active widget site (the app uses the widget's form).

GET /api/app/account (T-184)
The app's Account tab: a small read of what the dashboard already shows.
200: `{ "businessName": "…", "logoUrl": "<signed address, a few minutes>" | null, "planName": "Pro" | null, "usage": { "used": 37, "limit": 200, "unlimited": false, "per": "month" | "total" }, "quoteLink": "https://…/quote/<slug>" | null, "supportEmail": "…" }`
- `planName` is null for a business on the free allowance; `usage.limit` is 0 and `unlimited` true when the plan has no limit; `per: "total"` is the free allowance, which never resets.
- **It never answers a price, an upgrade or a link to billing:** the app may not point at a purchase outside it.
- Tenant-scoped (RLS and an explicit filter); the limit is read by `checkPlanLimit`, the function that enforces it.

T-184 additions to `GET /api/app/quotes/:id` (all additive):
- `lines[].source` and `sections[].lines[].source`: where the line's quantity came from, in the business's words ("Measured from photos"); absent when not known.
- `photos[]` is `{ id, url, fullUrl }`: `url` the small copy (the photo itself when it has none), `fullUrl` the photo. `photoCount` is how many photos the request has, whether or not they were signed this time.
- `alsoAsked[]`: `{ words, serviceName?, state, stateWords }`, what else the customer asked for (T-179) and where each stands.
- `dates.approvedAt`.
- `request.answers[].value` is the option's label for a choice ("Standard (8 ft)"), on this route and on `GET /api/quotes/:id` (`answerText`, shared).

T-186: a quote the business made itself (`quote_requests.source_json.type` is `app`; `isMadeByBusiness` in `packages/shared/src/quote-turn.ts`). No customer is asked anything about it. All additive:
- `GET /api/app/quotes/:id`: `madeByBusiness: boolean`. `questions` is non-empty **only when the business is the one asked** (status `awaiting_clarification` on a quote it made); a customer's quote in that status carries `questions: []`, because the customer was asked. `pricing.certainty`: the one sentence about how sure the price is, or null (`certaintySentence`, shared). `pricing.estimate.reasons?: string[]`: why the price is not confirmed, most important first (absent on a quote priced before T-186). `lines[].source` reads "Your answer" on a quote the business made and "The customer's answer" otherwise.
- `GET /api/quotes` (the list): each item adds `madeByBusiness` and `openQuestions` (0 unless the business is the one asked). With `group=`, a quote the business made that has open questions is in `needs_you` and not in `waiting`, in the list and in `counts`.
- `GET /api/quotes/:id` (dashboard): `madeByBusiness`, and `businessQuestions: [{ id, question, type?, aiValue?, evidence?, options? }]` (empty unless the business is the one asked). The dashboard answers them with `POST /api/app/quotes/:id/answers`, the route the app uses.
- `GET /api/public/quotes/:id` (the customer's page): for such a quote `status` reads `pending_review`, `provisional.reason` is `pending_review` and no `clarificationQuestions` are returned. `POST /api/public/quotes/:id/clarify` answers 400 `INVALID_STATUS` for it.

T-188: questions with choices, a note with an answer, and answering for the customer. All additive:
- A question, wherever it is sent (`GET /api/app/quotes/:id` `questions[]`, `GET /api/quotes/:id` `businessQuestions[]`, `GET /api/public/quotes/:id` `clarificationQuestions[]`), may carry `choices: [{ label, value }]` (the answers to press, built by the worker from the business's own rules), `closed: true` (the choices are every possible answer: no typed answer is offered) and `answerKind: "number"`. The answer sent back is a choice's `value`. `options[]` and `aiValue` are still sent for a question that has them; a client draws `choices` first.
- `POST /api/app/quotes/:id/answers`: each answer may carry `note` (the business's own "Why (for your records)", up to 500 characters). It is stored with the answer in `quotes.clarification_answers_json` and returned only to the business, in `GET /api/quotes/:id` → `understanding.asked[].note`. No prompt is given it and no pricing rule reads it. `POST /api/public/quotes/:id/clarify` (the customer's) keeps `questionId` and `answer` only.
- `GET /api/app/quotes/:id` adds `customerQuestions[]` and `GET /api/quotes/:id` adds `customerQuestions[]`: the questions a customer was asked and has not answered (non-empty only on a customer's quote in `awaiting_clarification`). The business answers them with the same `POST /api/app/quotes/:id/answers` ("Answer for the customer").
- A line's `source` (in `lines[].source` and wherever a line's source is worded) can now be "From the photos" or "From the notes", for a line the product added. `pricing_json.breakdown[].source` has a new code, `seen`.

POST /api/app/quotes
Request: `{ "serviceId", "customer": { "name", "email?", "phone?" }, "job?": { "address?", "postcodeOrZip?", "answers": [{ "fieldId", "value" }] }, "assetIds?": [], "scan?", "clientRequestId?" }`
Same intake as `POST /api/public/quotes` (field and photo validation, plan limits, queue), without bot checks or the AI service match. `source_json = { "type": "app", "userId", "clientRequestId?" }`.
200: `{ "quoteId", "status": "queued" | "held", "quoteViewUrl", "tokenExpiresAt" }`. The app keeps `quoteViewUrl` (and its token) on the device. `held` = saved, not priced (the plan limit was reached, or the account is paused).
T-182:
- Only `customer.name` is required. `email` is optional (on site the link goes by the phone's share sheet); a malformed one is 400.
- `clientRequestId` (8 to 64 letters, digits, `-` or `_`; anything else is 400) makes a repeat safe. When this business already has a request with that id, nothing is made or counted and the answer is `{ "quoteId", "status", "alreadyCreated": true }` with no `quoteViewUrl` (raw links are never stored; the app asks `POST /api/quotes/:id/link` for one once the quote is approved). The lookup is by tenant: another business sending the same id gets a quote of its own.

GET /api/app/quotes/:quoteId
200 `AppQuoteView`: `{ id, status, businessName, serviceName, customerName, createdAt, pricing: { total, currency, estimate? }, takeoff: [], questions: [] }`. `questions` is non-empty only while `awaiting_clarification` (T-186: and only on a quote the business made; see above). 404 for another tenant's quote.
T-182 adds, all shaped in `apps/web/src/lib/app-quote-view.ts` from the shared rules:
- `mainServiceName`; `customer: { name, email, phone }` (null when not given); `dates: { sentAt, viewedAt, acceptedAt, paidAt, declinedAt, expiresAt }` (for the status wording in `quote-turn.ts`).
- `lines: [{ label, amount }]`: the main service's price lines, **without** the minimum top-up. `minimum?: { minimumCharge, topUp }` when a minimum applied (AD-048: a note, never a line). `totals: { subtotal, tax?: { label, amount }, total }`.
- `sections?: [{ serviceName, addedBy, subtotal, lines, minimum?, awaitingApproval? }]` and `mainSubtotal?` on a combined quote (T-179). `pricing.total` is the one total for everything. `takeoff` is the main service's only (until T-182 an added service's lines were appended to it).
- `held: true` for a request saved at the plan limit or by a paused account (no price).
- `request: { description, answers: [{ label, value }], postcode, address, quantity }`: what was sent, each answer under the business's own question (T-178).
- `photos: [{ id, url }]`: the request's photos (up to 10), each a signed storage address that lasts 5 minutes (the small copy when there is one). Only assets of this quote's request that belong to this tenant. Empty while the quote is `queued` or `generating`, and when storage is not set up. The dashboard's photo route answers with a redirect instead; a phone does not carry the sign-in across one.

The app also uses these dashboard routes with its bearer: `GET /api/quotes?group=`, `POST /api/quotes/:id/approve`, `POST /api/quotes/:id/link` (`{ "force": true }`), `POST /api/quotes/:id/process` (402 `PLAN_LIMIT_REACHED`, 403 `ACCOUNT_PAUSED`), `GET /api/billing/notice`, `PUT /api/quotes/:id/final-invoice`. None of them changed in T-182.

POST /api/app/quotes/:quoteId/answers
Request: `{ "answers": [{ "questionId", "answer" }], "quoteToken?": "…" }`
The business confirms on site: answers merge as confirmed form answers and the quote reprices deterministically (same path as the customer's clarify). `quoteToken` is forwarded to the worker only when it matches the stored hash (needed to email the customer their link). Measurement examples are recorded (T-123).
400 `INVALID_STATUS` unless `awaiting_clarification`; 404 for another tenant's quote.

