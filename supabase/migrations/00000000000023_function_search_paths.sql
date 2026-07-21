-- Deploy-found (2026-07-21, prod smoke test): generate_prefixed_id and
-- handle_new_user call gen_random_bytes unqualified. On hosted Supabase,
-- pgcrypto lives in the `extensions` schema, which is NOT on the default
-- search path for SECURITY DEFINER functions or PostgREST sessions — so the
-- signup trigger (and every prefixed-id column default) failed in prod.
-- Function-level search_path binds regardless of the caller's session.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
ALTER FUNCTION public.generate_prefixed_id(text) SET search_path = public, extensions;
ALTER FUNCTION public.handle_new_user() SET search_path = public, extensions;
