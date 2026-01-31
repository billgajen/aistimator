# /docs/plan.md

## Build order (v1)
Each item corresponds to a ticket file in `/tickets`.

### Foundation
- T-001 Repo scaffold and tooling
- T-002 Supabase setup and migrations
- T-003 Auth and tenant creation
- T-005 Data model tables and RLS

### Core Pipeline (end-to-end first)
- T-013 Quote request API and persistence
- T-014 Queue consumer and rate limiting (Upstash)
- T-015 AI signals extraction and rules engine (Gemini)
- T-016 Hosted quote page and public APIs

### Widget
- T-009 Widget embed JS snippet
- T-010 Widget iframe embed mode
- T-011 Widget form builder fields and validation
- T-012 Upload pipeline for photos and documents

### Dashboard and Config
- T-004 Dashboard shell and navigation
- T-006 Services and pricing rules UI
- T-007 Tax and service area restrictions UI
- T-008 Branding and template toggles UI

### Delivery and Polish
- T-017 PDF generation (DocRaptor)
- T-018 Email delivery (Postmark)

### Operations
- T-019 Quotes list and actions
- T-020 Basic analytics and usage counter
- T-021 Stripe billing and payment status
- T-024 Admin support tooling

### v2
- T-022 WhatsApp integration and onboarding
- T-023 WhatsApp guided intake flow

## Rules
- One ticket at a time.
- Update `/docs` if any contract changes.
- Keep UI and flows minimal.
