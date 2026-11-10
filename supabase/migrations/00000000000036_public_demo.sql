-- T-153: a working public demo — one example business any visitor can try.
--
-- tenants.is_demo: the example business on /demo. Set only by the seed script
--   (service role). A guard trigger refuses any change made with a user's
--   token, so no tenant or public API can turn it on or off.
-- quotes.is_demo: copied from the tenant on insert by a trigger, whatever the
--   caller sent. Demo quotes send no emails, count toward nothing and are
--   deleted after 24 hours by the daily lifecycle cron.
-- reserved_slugs: the demo business's slug, so no one else can take it.
--
-- Additive and re-runnable. No new table, so no new RLS policy.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN tenants.is_demo IS 'T-153: the public example business on /demo (service role only)';

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN quotes.is_demo IS 'T-153: a visitor''s demo request (copied from the tenant on insert)';
CREATE INDEX IF NOT EXISTS idx_quotes_demo_created ON quotes (created_at) WHERE is_demo;

-- ---------- guard: the demo flag changes only through the service role ----------
CREATE OR REPLACE FUNCTION public.tenants_demo_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.jwt() ->> 'role', 'service_role') <> 'service_role' THEN
    IF TG_OP = 'INSERT' AND NEW.is_demo THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    ELSIF TG_OP = 'UPDATE' AND NEW.is_demo IS DISTINCT FROM OLD.is_demo THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_demo_guard ON tenants;
CREATE TRIGGER tenants_demo_guard
  BEFORE INSERT OR UPDATE OF is_demo ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION tenants_demo_guard();

-- ---------- quotes inherit the flag from their tenant ----------
CREATE OR REPLACE FUNCTION public.quotes_inherit_demo()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.is_demo := coalesce((SELECT t.is_demo FROM tenants t WHERE t.id = NEW.tenant_id), false);
  ELSE
    NEW.is_demo := OLD.is_demo;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quotes_inherit_demo ON quotes;
CREATE TRIGGER quotes_inherit_demo
  BEFORE INSERT OR UPDATE OF is_demo ON quotes
  FOR EACH ROW
  EXECUTE FUNCTION quotes_inherit_demo();

INSERT INTO reserved_slugs (slug) VALUES ('example-home-services') ON CONFLICT (slug) DO NOTHING;
