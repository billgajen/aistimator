# tickets/T-005-data-model-and-rls.md

## Goal
Implement the core DB schema and RLS based on `/docs/03-data-model.md`.

## In scope
- Tables: tenants, tenant_sites, services, service_pricing_rules, widget_configs, assets, quote_requests, quotes, plans, subscriptions, usage_counters
- RLS policies enforcing tenant isolation
- Indexes per spec

## Out of scope
- Quote versioning (optional)
- Advanced auditing

## Acceptance criteria
- [x] Migrations create all tables and indexes
- [x] RLS enabled on tenant-owned tables
- [x] Authenticated user can only read/write their tenant rows
- [x] Basic seed for `plans` (starter/growth) exists

## Completed
- 2026-01-25: Full data model implementation complete
  - Created migration `00000000000002_core_schema.sql` with all tables:
    - `tenant_sites` - domain allowlist for widget embedding
    - `services` - services offered by tenant
    - `service_pricing_rules` - pricing configuration per service
    - `widget_configs` - form fields and file upload settings
    - `assets` - uploaded files (photos, documents, PDFs)
    - `quote_requests` - raw customer submissions
    - `quotes` - generated quotes with pricing
    - `plans` - subscription plan definitions
    - `subscriptions` - tenant subscriptions
    - `usage_counters` - monthly usage tracking
  - All indexes created per spec:
    - quotes: (tenant_id, created_at), (tenant_id, status), (quote_request_id), (quote_token_hash)
    - quote_requests: (tenant_id, created_at), (customer_email), (job_postcode)
    - assets: (tenant_id, created_at)
    - tenant_sites: (tenant_key), (domain)
  - RLS policies for tenant isolation:
    - All tenant-owned tables use `get_current_tenant_id()` for row filtering
    - Service role has full access for background jobs
    - Public access policies for widget submissions and quote viewing
  - Seed data with 3 plans: Starter ($29), Growth ($79), Pro ($199)
  - TypeScript types added to `@estimator/shared` package
