# /docs/03-data-model.md

## Notes
- Supabase Postgres with RLS enforced on all tenant data tables.
- Use `tenant_id` on every tenant owned table.
- Use stable ids with prefixes: `tnt_`, `svc_`, `qte_`, `ast_`.

## Core tables

### tenants
- id (pk)
- name
- currency (ISO code)
- tax_enabled (bool)
- tax_label (text, e.g. VAT, GST, Sales tax)
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
- quote_token_hash (for public access)
- token_expires_at (timestamptz)
- pdf_asset_id (nullable)
- created_at
- sent_at
- viewed_at
- accepted_at
- paid_at

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