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

### usage_counters
- id
- tenant_id
- period_yyyymm
- estimates_created
- estimates_sent
- created_at

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
- Guarded columns on `tenants`: `slug` (migration 32), `is_demo` (migration 36).
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

### SMS channel (T-136, migration 27)
- sms_configs: tenant_id (unique), phone_number (E.164, unique), messaging_service_sid, is_active, a2p_brand_registered, a2p_campaign_registered
- sms_conversations: same shape as whatsapp_conversations + consent_notice_sent
- sms_messages: provider_message_id, direction, message_type, from/to, content, media_url, segments, status (received | sent | test | blocked_opt_out | failed)
- sms_opt_outs: tenant_id + phone (unique), opted_out, last_keyword — checked before every send; only the customer's START clears it
