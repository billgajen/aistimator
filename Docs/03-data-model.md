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

### quote_feedback
A customer's question on a quote (migration 17). Older rows may be review requests (`approval_request`), which customers can no longer send from the page.
- id
- quote_id (fk -> quotes.id)
- tenant_id
- feedback_type (feedback | approval_request)
- feedback_text
- status (pending | acknowledged | resolved): `acknowledged` = the business pressed "Mark as answered" (T-157); `resolved` = the business edited the quote and sent it
- created_at

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
- Public quote view uses a token and only returns specific quote data.
### SMS channel (T-136, migration 27)
- sms_configs: tenant_id (unique), phone_number (E.164, unique), messaging_service_sid, is_active, a2p_brand_registered, a2p_campaign_registered
- sms_conversations: same shape as whatsapp_conversations + consent_notice_sent
- sms_messages: provider_message_id, direction, message_type, from/to, content, media_url, segments, status (received | sent | test | blocked_opt_out | failed)
- sms_opt_outs: tenant_id + phone (unique), opted_out, last_keyword — checked before every send; only the customer's START clears it
