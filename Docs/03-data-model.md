# /docs/03-data-model.md

## Notes
- Supabase Postgres with RLS enforced on all tenant data tables.
- Use `tenant_id` on every tenant owned table.
- Use stable ids with prefixes: `tnt_`, `svc_`, `qte_`, `ast_`.

## Core tables

### tenants
- id (pk)
- name
- region (text, 'US' | 'GB'; default 'US' for new tenants, existing tenants backfilled 'GB' — T-133, AD-025)
- unit_system (text, 'imperial' | 'metric', nullable — null means the region default)
- currency (ISO code; defaults from region, overridable)
- tax_enabled (bool)
- tax_label (text, e.g. VAT, GST, Sales tax; null means the region's label)
- tax_rate (numeric, 0 to 1)
- service_area_mode (enum: none, postcode_allowlist, county_state)
- service_area_values (jsonb)
- created_at

### tenant_sites
Used for embed security.
- id
- tenant_id
- domain (text)
- tenant_key (public key for widget)
- is_active

### services
- tax_exempt (bool, default false — T-133: service skips the tenant tax line)
- id
- tenant_id
- name
- active
- document_type_default (enum)
- created_at

### service_pricing_rules
- id
- tenant_id
- service_id
- rules_json (jsonb) includes baseFee, minimum, addons, multipliers
- updated_at

### widget_configs
- id
- tenant_id
- config_json (jsonb) fields list and file constraints
- updated_at

### assets
- id
- tenant_id
- quote_id (nullable until attached)
- type (enum: image, document, pdf)
- file_name
- content_type
- size_bytes
- r2_key
- created_at

### quote_requests
Raw submission.
- id
- tenant_id
- service_id
- customer_name (text, not null)
- customer_email (text, not null)
- customer_phone (text, nullable)
- job_postcode (text, nullable)
- job_address (text, nullable)
- job_answers (jsonb) — variable form answers
- asset_ids (jsonb)
- source_json (jsonb)
- created_at

### quotes
The generated quote record for delivery and tracking.
- id
- tenant_id
- quote_request_id (fk -> quote_requests.id)
- service_id
- customer_json (jsonb)
- pricing_json (jsonb) total, tax, currency, breakdown
- document_type
- content_json (jsonb) scope summary, notes, optional sections
- status (enum: queued, generating, sent, viewed, accepted, paid, expired, failed)
- quote_token_hash (for public access: the newest link)
- previous_token_hash (text, nullable; T-146: the link issued before approval, still accepted)
- link_token_hashes (text[], not null, default '{}'; T-157, migration 38: the sha256 of every earlier link of the quote, newest first, no duplicates, at most 10. Written only by the trigger `quotes_keep_link_tokens` (BEFORE UPDATE): when `quote_token_hash` changes, the hash it replaces goes to the front. A link stays valid until the quote's links expire; AD-042)
- token_expires_at (timestamptz; covers every link of the quote)
- pdf_asset_id (nullable)
- created_at
- sent_at
- viewed_at
- accepted_at
- paid_at

Money in `pricing_json` (T-157): every `breakdown[].amount` has at most 2 decimals, rounded half away from zero where the line is created (`roundMoney` in `packages/shared/src/money.ts`), and `subtotal` is the sum of the rounded lines. Quotes stored before T-157 may hold unrounded amounts (622.8000000000001); there is no data migration, the editor and the edit route round them on the next save.

The minimum charge in `pricing_json` (T-165, AD-048): when a job's lines total less than the business's minimum charge, the difference is one entry of `breakdown`: `{ "label": "Minimum charge applied", "amount": 25, "kind": "minimum", "minimumCharge": 400 }`. It is the only entry with a `kind`. The lines plus that entry equal `subtotal`. It is never shown as a line: read a breakdown through `splitMinimum` (`packages/shared/src/minimum-charge.ts`), which gives the job's lines and the minimum that applied (or null). At or above the minimum there is no such entry. Quotes stored before T-165 hold the same top-up as an unmarked line with that label (or one line "Minimum charge"), and the sentence "Minimum charge of … applied" among `notes`; they are read the same way, with no data migration.

### quote_feedback
A customer's question on a quote (migration 17). Older rows may be review requests (`approval_request`), which customers can no longer send from the page.
- id
- quote_id (fk -> quotes.id)
- tenant_id
- feedback_type (feedback | approval_request)
- feedback_text
- status (pending | acknowledged | resolved): `acknowledged` = the business pressed "Mark as answered" (T-157); `resolved` = the business edited the quote and sent it
- created_at

### quote_validation_logs (migration 12; T-166, migration 41)
One row per run of the AI quote checker: the quote as priced, the issues found, and what they led to.
Business screens do not read it.
- outcome: `passed` | `passed_with_issues` | `sent_for_review` | `blocked`. `passed_with_issues` = issues were
  found and logged and the quote went on as priced, not held (it was called `auto_corrected` before T-166;
  nothing was ever corrected, and migration 41 renames the old rows).
- corrections_applied: unused, always null. The checker never corrects a quote (AD-049).
- `tenants.validation_settings` decides what each severity leads to. The stored value `auto_correct` (the
  default) is a legacy name for "log the issues and let the quote go on".

### request_leads (T-151, migration 34; T-160, migration 39)
A request saved the moment the customer gives their contact details, before they finish. Not a quote: it never
runs AI, never counts toward usage, and is not in the quote pipeline (AD-038).
- id (`lead_…`)
- tenant_id, service_id (nullable)
- customer_name, customer_email, customer_phone (at least one of email or phone)
- progress (contact | questions | photos | details), job_answers (jsonb), job_postcode, asset_ids (jsonb), source_json
- lead_token_hash (the customer's own token for updating it)
- quote_id, completed_at: set when the request is submitted and becomes a quote. Finished leads are never listed.
- seen_at (timestamptz, null; T-160): when the business first saw it. Null = new. The Home banner and the menu badge
  count only new ones. Set by `POST /api/leads/seen` when the Unfinished list is opened.
- handled_at (timestamptz, null; T-160): when the business pressed "Done". A handled request leaves the list and
  every count. Set by `POST /api/leads/:leadId/done`.
- created_at, updated_at

Listed = `completed_at` is null, `handled_at` is null, started in the last 30 days. New = listed and `seen_at` is null.
The rule is `apps/web/src/lib/unfinished-leads.ts`, used by the list, the tab count, the banner and the badge.
RLS: the business can read its own rows and cannot write. Leads are written by the public API, and `seen_at` and
`handled_at` by signed-in dashboard routes, both with the service role and a tenant filter.
Indexes: `(tenant_id, created_at desc)` where not completed; the same where also not handled and not seen (the count).

### quote_versions (optional v1, or v2)
- id
- quote_id
- version_number
- diff_json
- created_at

### plans
- id
- name
- monthly_estimate_limit
- features_json

### subscriptions
- id
- tenant_id
- plan_id
- stripe_customer_id
- stripe_subscription_id
- status
- current_period_end

T-180 (migration 44): `billing_interval` (`monthly` | `annual`), `cancel_at` (when a cancelled plan ends),
`payment_failed_at` and `payment_failed_notified_at` (the failed payment now being retried, and its one email).
One row per business, written only by `lib/billing-sync.ts` from what Stripe says. `status` is one of active,
trialing, past_due (the plan still works) or canceled ("no plan"; the Stripe customer id is kept, the Stripe
subscription id is cleared). A row with no Stripe customer and no Stripe subscription is a free test account.

T-199 (AD-085): **what a business can use is read from this row by one rule** (`businessAccess`,
`packages/shared/src/access.ts`), never by a query of its own. A live row gives its plan's features. **No row at
all**, with free quotes left (`usage_counters`, every month together, against the allowance that never resets),
gives Pro's features: the free start. A row that is not live gives none, and ends the free start for good.

### usage_counters
- id
- tenant_id
- period_yyyymm
- estimates_created
- estimates_sent
- created_at

T-180 (migration 44, AD-063): never read-then-written. `claim_plan_quote(tenant, period, limit, per)` checks the
limit and adds one in a single step, one business at a time; `release_plan_quote` gives a claim back;
`increment_usage_counter` adds one to a counter with no limit (estimates sent). Service role only.

### stripe_events (T-180, migration 44)
- id (Stripe's event id), type, received_at, processed_at (null until its handler finished)
- The webhook's ledger: a repeated event is answered without being handled again. Service role only.

### admin_activity_logs (T-180, migration 44)
- id, admin_user_id, action, resource_type, resource_id, details_json, created_at
- What a platform admin did (suspend, restore, retry, view). The admin area had written to this table since it
  was built, but no migration created it until 44. Service role only.

### tenants: billing columns (T-180, migration 44)
- `suspended_at`, `suspended_reason`: the platform admin's suspend switch (new requests held, WhatsApp silent,
  sent quotes still open). `free_warning_sent_at`: the one "2 free quotes left" email.

### push_devices (T-196, migration 46)
- token (primary key: the phone's Expo push token), tenant_id, user_id, platform (`ios` | `android`)
- notify_new_request, notify_accepted, notify_question (the user's three switches; all true by default, kept the
  same on every phone of one user)
- last_ticket_id (the id Expo gave the last notification sent to this phone; its receipt is read before the next
  send, and a phone Expo reports as gone is deleted), created_at, updated_at
- Row-level rules: a user reads, adds, changes and deletes **only their own rows** (`user_id = auth.uid()`, in
  their own business). Not another business, not another user of the same business, not signed out. The server
  registers a token with the service role, because a phone that changes hands moves its token to the new user.

### push_events (T-196, migration 46)
- quote_id, event_key (`new_request`, `accepted`, or `question:<the question's id>`), tenant_id, created_at;
  primary key (quote_id, event_key)
- A row is written before a notification is sent, and an event that is already there is not sent again: one
  notification per event, whatever is repriced, re-sent or run twice. Service role only (no policy).

### tenants: time zone (T-196, migration 46)
- `time_zone`: the business's time zone as an IANA name (`Europe/London`). Null until the dashboard or the app
  first reports it, then kept (never overwritten by a later report). "This month" on Home starts at the business's
  midnight; until the column is set, the region's zone is used (`RegionDefinition.timeZone`).

### support_reports (T-197, migration 47)
- id (uuid), tenant_id, user_id (who sent it; kept as null when the user is removed)
- kind: `problem` ("What went wrong?") | `estimate` (a report on one estimate)
- body (the business's own words), choices (an estimate report's ticks: `too_high`, `too_low`, `wrong_reading`,
  `missed`, `extra`, `wording`, `other`)
- expected_total, currency: "What should the total have been?" **Recorded only.** Nothing that prices, sends or
  shows an estimate reads it (a unit test fails if anything outside the support code names it).
- quote_id (the estimate, by id: nothing is copied out of the quote), is_test
- screenshot_asset_id (an `assets` row of the same business: private storage, an image within the upload limit)
- context_json: `{ page, quoteId?, plan?, browser?, screen?, lastError? }`. Only these keys are kept.
- status: `new` | `looking` | `fixed` | `answered` | `not_a_fault` (the business reads `new` as "Sent")
- setup_hint: `{ line, rate, serviceId }` or null: the one thing the sorter shows the business ("This may be down
  to your prices: {line} is set to {rate}"), written from the business's own setup
- reply_unread (a reply from us nobody at the business has opened: the dot on the Help item), created_at,
  updated_at
- Row-level rules: a business **reads its own rows and may add one** (its own user, its own business, status
  `new`, nothing of ours on it, and only its own estimate and upload). It cannot change or delete a report. Not
  another business, not signed out.

### support_report_internal (T-197, migration 47)
- report_id (primary key), title, summary, ai_kind (`fault` | `how_to` | `billing` | `feature` | `other`),
  severity (`high` | `medium` | `low`), similar_json (`[{ id, confidence }]`, up to three open problems that look
  the same), likely_cause (`setup` | `ai_reading` | `fault` | `unknown`; estimate reports only), evidence,
  fix_ticket (the draft, in the house format), service_template (the template the estimate's service matches by
  name, or null)
- sort_state (`waiting` | `sorted` | `failed`), sort_attempts, sorted_at
- merged_into (another report), merged_at, approved_at ("Approved for fixing"), owner_note,
  fixed_emailed_at (when this business was told the problem is fixed: once)
- **Service role only (no policy).** A business can never read the AI's sorting, the ticket or the note.

### support_messages (T-197, migration 47)
- id, report_id, tenant_id, author (`business` | `team`), user_id, body, created_at
- Row-level rules: a business reads its own threads and adds **its own side** on its own report. Our replies
  are written by the server.

### help_questions (T-198, migration 48)
Every question a business put to "Ask Qolumns" (the assistant in the Help panel), with the answer it was given.
- id, tenant_id, user_id, conversation_id (the questions of one sitting; made in the browser)
- question (the business's own words **after** customer details are taken out: every email and phone number,
  and the name and address of the customer of the quote it was asked from), answer (null when no answer came)
- outcome: `answered` | `not_sure` | `not_offered` | `broken` | `team` | `declined` | `failed`
- entries (TEXT[]: the ids of the Docs/help entries the answer rested on), page (the dashboard path it was asked
  from), quote_id (when that page was a quote's)
- rating: `yes` | `no` | null ("Did this answer it?")
- review: `open` | `guide_updated` | `nothing_to_do`, owner_note (the owner's side; never shown to a business)
- report_id (the support report it became, when the business pressed "Send this to the Qolumns team"), model
- created_at, updated_at
- **Row-level rules: none, and nothing is granted to a signed-in user.** Only the server reads or writes it,
  always for the signed-in user's own business (the question, the rating) or for the platform admin (the
  Questions tab). A business's conversation is kept in its own browser for the session.
- **Kept 90 days** (`ASK_KEEP_DAYS`): the worker's timer deletes older rows once a day (`helpCleanup`).
- Needs the owner's eye (`needsAttention`): `review = 'open'` and (`outcome = 'not_sure'` or `rating = 'no'`).
- Hangs off `tenants(id) ON DELETE CASCADE`.

Two columns added by the same migration:
- `support_reports.from_assistant` (boolean, default false): the report was made with "Send this to the Qolumns
  team". The sorter files it as a how-to question whatever the model calls it.
- `support_report_internal.draft_reply` (text): for a report whose kind is not a fault, the AI's draft reply,
  written a few seconds after the sorting (null until then, and when no usable draft came).
  `fix_ticket` is now written only when the kind is a fault. Nothing sends a draft: the owner edits and sends it.

### feature_requests and feature_votes (T-197, migration 47)
- feature_requests: id, title, summary, title_source (`words` = still the first business's own words, never
  shown to another business | `ai` | `owner`), status (`under_review` | `planned` | `shipped` | `not_planned`),
  merged_into, reviewed_at (when the owner first opened it), created_at, updated_at. Not tied to one business.
- feature_votes: id, request_id, tenant_id, user_id, body (the business's own words), shipped_emailed_at (when
  this business was told it shipped: once), created_at. **Unique (request_id, tenant_id): one vote per business
  per request.**
- Row-level rules: a business reads **its own votes** and **the requests it voted for**, and writes neither
  (the server writes both for the signed-in user's business). It can never read who else asked or how many.

Every one of the five hangs off `tenants(id) ON DELETE CASCADE` (directly or through its report): when a closed
account's data is deleted after the export window, its reports, threads and votes go with it. A feature request
that loses its last vote this way stays, with no business on it, for the owner.

### tenants: its own address (T-199, migration 49)
- own_address (text, null until chosen): the name in `<name>.<our domain>`. Its own field: it is not `slug`
  (the quote-link name), and choosing it does not use up the quote link's one change. 3 to 30 characters,
  lowercase letters, numbers and single hyphens (a check constraint). Unique where not null.
- own_address_chosen_at: when it was chosen, or last changed by an admin.
- own_address_later_at: when the business pressed "Later" on Home's card; cleared when a plan that includes the
  address starts.
- **Only the service role writes the three** (the trigger `tenants_own_address_guard` refuses anyone else). The
  business chooses once, through the server; afterwards only the admin area changes it.
- **One name, one business, across `own_address` and `slug`.** `own_address_taken(candidate, for_tenant)` is true
  for a reserved name, another business's address, another business's current or former quote-link name, and a
  held name. `tenant_slug_taken` (migration 32) now also refuses another business's address and a held name. The
  same trigger checks both on insert and update, under a lock per name, so two requests for one name take turns.
  A business may use its own quote-link name as its address.
- Whether an address is **served** is not stored: it is the one rule (`businessAccess`, `packages/shared/src/access.ts`),
  read each time. A business that loses the capability keeps its address; it forwards to the quote link until
  the business has the capability again.
- `reserved_slugs` gains `cdn`, `dev`, `email`, `m`, `pm-bounces`, `q`, `staging`, `status`. The whole list is
  `RESERVED_NAMES` (`packages/shared/src/own-address.ts`); a unit test checks the database's copy against it.
  A business that already holds one as its quote-link name keeps it.

### own_address_changes (T-199, migration 49)
Every choice and every change of an address, and the hold on a changed one.
- id, tenant_id (**`ON DELETE SET NULL`**, so a held name stays held when the business is deleted)
- old_address, new_address (either may be null: the first choice has no old one; a removal has no new one)
- changed_from: `business` (its one choice) | `admin` (the owner's change, from the admin area)
- changed_by (the user), note (the admin's own, up to 500 characters)
- held_until: until when `old_address` may not be taken by another business (90 days after an admin's change;
  null for a first choice). `own_address_held(candidate, for_tenant)` reads it.
- created_at
- **Row-level rules: none, and nothing is granted to a signed-in or signed-out user.** Only the server reads or
  writes it. An admin's change is also written to `admin_activity_logs` (`change_address`).

## Indexes
- quotes: (tenant_id, created_at desc), (tenant_id, status), (quote_request_id)
- quote_requests: (tenant_id, created_at desc), (customer_email), (job_postcode)
- assets: (tenant_id, created_at desc)
- tenant_sites: (tenant_key), (domain)

## RLS
- All tenant tables restricted by `tenant_id` for authenticated users.
- **Signed-out callers (the public key) hold no privilege on any table, and there is no rule for "public"**
  (migration 43, T-173, AD-054). The public quote view, the form and every other public page read and write
  through the server (service role), which checks the quote's link token or the business's key.
- `user_profiles`: `role` is `owner` (every sign-up) or `admin` (the platform's own role; granted only by
  `scripts/set-platform-admin.sh`). A guard trigger lets only the service role change `id`, `tenant_id` or
  `role`; a user can change its own `display_name`.
- `subscriptions`: read by the business, written by the server only.
- Guarded columns on `tenants`: `slug` (migration 32), `is_demo` (migration 36), `suspended_at`, `suspended_reason`
  and `free_warning_sent_at` (migration 44), `own_address`, `own_address_chosen_at` and `own_address_later_at`
  (migration 49).
- `own_address_changes` (migration 49): no rule and no grant; the server only.
### WhatsApp channel (migration 25; T-175, migration 42)
- whatsapp_configs: one row per business, **server-only** (no policy or grant for a signed-in browser since
  migration 42). tenant_id (unique), phone_number_id (unique: the webhook routes by it), display_phone_number,
  verified_name, access_token_encrypted, is_active, connection_method (manual | embedded), waba_id, business_id,
  number_kind (new_number | business_app), token_expires_at, expiry_warned_at, app_secret_encrypted (manual only),
  registered_at, registration_pin_encrypted, messages_ready_at, connected_at. Every `_encrypted` value is
  AES-256-GCM under `WHATSAPP_ENCRYPTION_KEY` (lib/whatsapp-crypto.ts); values from before T-175 are AES-256-CBC
  and still read.
- whatsapp_conversations, whatsapp_messages: the tables are unchanged (migration 25). How they are used changed
  in T-177 (no migration):
  - a conversation's `status` becomes `completed` when its request is made, so the next message from that
    customer starts a new conversation;
  - `intake_data` also holds `_ownerRepliedAt` (when the business last replied to that customer from its own
    app), `_retries`, and `_quoteId` (the quote the chat produced);
  - an inbound message the assistant did not answer has `content` and `media_url` null; an outbound message's
    stored text never carries the token of an estimate's link.
- A photo sent in a chat (WhatsApp, SMS) is an `assets` row like any other; since T-177 a JPEG also has a small
  copy in storage at `<r2_key>.small` (no row, as for a form photo).
- T-178 (no migration, no new column): three things kept in existing JSON columns.
  - `quote_requests.source_json.serviceSuggestion` (`serviceId`, `serviceName`, `reason`): the request form
    thought another of the business's services fits a description-only request. The worker reads it and holds
    the quote for review.
  - `quotes.content_json.error`, `failedAt`, `failedNotifiedAt` on a failed quote: why (for us only), when, and
    when the business was emailed about it. `failedNotifiedAt` is what keeps it to one email.
  - `quotes.content_json.retryCode` (`hash`, `expiresAt`): the hash of the one-time code
    `scripts/retry-failed-quote.sh` writes; the retry route removes it as it uses it.
  - There is no `quotes.error_message` column. Code that wrote one had its whole update refused.
- T-179 (no migration, no new column): a combined quote (AD-061; `packages/shared/src/quote-sections.ts`).
  - `quotes.pricing_json.breakdown` is the MAIN service's lines, exactly as on any quote.
  - `quotes.pricing_json.sections[]` are the added services (at most two): `serviceId`, `serviceName`,
    `breakdown[]` (that service's lines, with its own marked minimum entry while its floor applies), `subtotal`,
    `taxExempt?`, `addedBy` (`customer` | `business`), `addedAt`, `answers[]` (`key`, `label`, `value`),
    `awaitingApproval?` (the customer added it and its service, or the main one, holds until approved: while
    the quote is `pending_review` the customer sees no price for this part). The key
    is absent on a single-service quote, which is how every older quote stays as it was.
  - `quotes.pricing_json.subtotal`, `taxAmount` and `total` are the combined figures: main + every section, tax
    worked out once on the taxed amount (a tax-exempt service's section is left out of it).
  - `quotes.content_json.alsoAsked[]`: what else the customer asked for (`id`, `words`, `serviceId` | null,
    `serviceName`, `state`, `price?`, `questions?`, `priceOnApproval?`). Written by the worker on the first pass; replaces
    `crossServicePricing`, which only quotes made before T-179 carry.
  - `quotes.content_json.sectionsBefore` (`status`, `approvedAt`, `reviewHold`): where a sent quote stood before
    a customer's added service sent it back for review; used to put it back if they remove it.
  - `quotes.service_id` stays the main service: analytics count the quote under it. Accuracy counts a combined
    quote in Overall only.

### SMS channel (T-136, migration 27)
- sms_configs: tenant_id (unique), phone_number (E.164, unique), messaging_service_sid, is_active, a2p_brand_registered, a2p_campaign_registered
- sms_conversations: same shape as whatsapp_conversations + consent_notice_sent
- sms_messages: provider_message_id, direction, message_type, from/to, content, media_url, segments, status (received | sent | test | blocked_opt_out | failed)
- sms_opt_outs: tenant_id + phone (unique), opted_out, last_keyword — checked before every send; only the customer's START clears it
