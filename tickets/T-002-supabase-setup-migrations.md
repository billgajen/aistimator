# tickets/T-002-supabase-setup-migrations.md

## Goal
Set up Supabase project configuration, local env wiring, and migrations framework.

## In scope
- Supabase project config expectations documented
- `supabase/` migrations structure
- Scripts to apply migrations (local + remote guidance)
- Env vars in `.env.example` for web and api packages

## Out of scope
- Full schema implementation (that is T-005)

## Acceptance criteria
- [x] Migrations folder exists with placeholder migration
- [x] README includes Supabase setup steps
- [x] Web and API read Supabase URL/anon key from env without hardcoding

## Completed
- 2026-01-25: Initial setup complete
  - Created `supabase/` directory with config.toml, seed.sql
  - Created initial migration with custom types (enums) and helper functions
  - Added @supabase/supabase-js and @supabase/ssr to web app
  - Created Supabase client utilities (client, server, middleware)
  - Added Supabase client to worker
  - Updated README with comprehensive Supabase setup instructions
  - Added database scripts to package.json (db:start, db:stop, db:reset, etc.)
