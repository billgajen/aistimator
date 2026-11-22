-- T-199: a business's own address (yourname.<our domain>) for its quote page.
--
-- 1. tenants.own_address: the name the business chose. Its own field: it is
--    not the quote-link name (tenants.slug) and choosing it does not use up
--    the quote link's one change. Chosen once (own_address_chosen_at); only
--    the admin area changes it afterwards. own_address_later_at is "Later" on
--    Home's card.
-- 2. own_address_changes: every choice and every change, with who made it.
--    When the admin area changes or removes an address, the old one is held
--    (held_until, 90 days) before another business can take it.
-- 3. One name, one business, across BOTH fields: no address may equal another
--    business's quote-link name (current or former), and no new quote-link
--    name may equal another business's address. `own_address_taken` and
--    `tenant_slug_taken` say so, and a trigger on tenants holds it even
--    against two requests arriving together.
-- 4. Reserved names: the names T-199 adds (packages/shared/src/own-address.ts
--    has the whole list; a unit test checks the copy). A business that
--    already holds one as its quote-link name keeps it: nobody is renamed.
--
-- The quote link itself is untouched: /quote/<name> keeps working for every
-- business. Nothing is deleted and no existing row is changed.
--
-- Safe to run twice.

-- ---------- 1. the address ----------
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS own_address TEXT,
  ADD COLUMN IF NOT EXISTS own_address_chosen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS own_address_later_at TIMESTAMPTZ;

COMMENT ON COLUMN tenants.own_address IS 'T-199: the name of the business''s own address (<name>.<our domain>). Chosen once; changed only from the admin area';
COMMENT ON COLUMN tenants.own_address_chosen_at IS 'T-199: when the address was chosen or last changed';
COMMENT ON COLUMN tenants.own_address_later_at IS 'T-199: when the business pressed "Later" on Home''s card (cleared when a plan that includes the address starts)';

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_own_address ON tenants (own_address) WHERE own_address IS NOT NULL;
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_own_address_format;
ALTER TABLE tenants ADD CONSTRAINT tenants_own_address_format
  CHECK (own_address IS NULL OR (own_address ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(own_address) BETWEEN 3 AND 30));

-- ---------- 2. choices, changes and held names ----------
CREATE TABLE IF NOT EXISTS own_address_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- kept when the business is deleted, so a held name stays held
  tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  old_address TEXT,
  new_address TEXT,
  -- 'business': its one choice. 'admin': the owner's change, from the admin area.
  changed_from TEXT NOT NULL CHECK (changed_from IN ('business', 'admin')),
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note TEXT,
  -- until when old_address may not be taken by another business
  held_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_own_address_changes_tenant ON own_address_changes (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_own_address_changes_held ON own_address_changes (old_address) WHERE held_until IS NOT NULL;

ALTER TABLE own_address_changes ENABLE ROW LEVEL SECURITY;
-- no policy: only the service role reads or writes it
REVOKE ALL ON own_address_changes FROM anon, authenticated;

COMMENT ON TABLE own_address_changes IS 'T-199: every choice and change of a business''s own address; a changed address is held until held_until. Service role only';

-- ---------- 3. one name, one business, across both fields ----------
-- SECURITY DEFINER: the answer must count every business's names, whoever asks
-- (the tables behind it are closed to signed-in users).
CREATE OR REPLACE FUNCTION public.own_address_held(candidate TEXT, for_tenant TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM own_address_changes
    WHERE old_address = candidate AND held_until > NOW() AND tenant_id IS DISTINCT FROM for_tenant
  )
$$;

CREATE OR REPLACE FUNCTION public.own_address_taken(candidate TEXT, for_tenant TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM reserved_slugs WHERE slug = candidate)
      OR EXISTS (SELECT 1 FROM tenants WHERE own_address = candidate AND id IS DISTINCT FROM for_tenant)
      OR EXISTS (SELECT 1 FROM tenants WHERE slug = candidate AND id IS DISTINCT FROM for_tenant)
      OR EXISTS (SELECT 1 FROM tenant_slug_history WHERE old_slug = candidate AND tenant_id IS DISTINCT FROM for_tenant)
      OR own_address_held(candidate, for_tenant)
$$;

-- The quote-link name's own check (migration 32), now also refusing another
-- business's address and a held one. A business may use its own address as
-- its quote-link name.
CREATE OR REPLACE FUNCTION public.tenant_slug_taken(candidate TEXT, for_tenant TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM reserved_slugs WHERE slug = candidate)
      OR EXISTS (SELECT 1 FROM tenants WHERE slug = candidate AND id IS DISTINCT FROM for_tenant)
      OR EXISTS (SELECT 1 FROM tenant_slug_history WHERE old_slug = candidate)
      OR EXISTS (SELECT 1 FROM tenants WHERE own_address = candidate AND id IS DISTINCT FROM for_tenant)
      OR own_address_held(candidate, for_tenant)
$$;

REVOKE EXECUTE ON FUNCTION public.own_address_held(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.own_address_taken(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.own_address_held(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.own_address_taken(TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.tenants_own_address_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- only the server writes the address and its two dates
  IF coalesce(auth.jwt() ->> 'role', 'service_role') <> 'service_role' THEN
    IF TG_OP = 'INSERT' AND (NEW.own_address IS NOT NULL OR NEW.own_address_chosen_at IS NOT NULL OR NEW.own_address_later_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    ELSIF TG_OP = 'UPDATE' AND (
      NEW.own_address IS DISTINCT FROM OLD.own_address
      OR NEW.own_address_chosen_at IS DISTINCT FROM OLD.own_address_chosen_at
      OR NEW.own_address_later_at IS DISTINCT FROM OLD.own_address_later_at
    ) THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- a new address: not reserved, and no other business's address or quote-link name.
  -- The lock makes two requests for one name take turns.
  IF NEW.own_address IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.own_address IS DISTINCT FROM OLD.own_address) THEN
    PERFORM pg_advisory_xact_lock(hashtext('qolumns_name:' || NEW.own_address));
    IF own_address_taken(NEW.own_address, NEW.id) THEN
      RAISE EXCEPTION 'That address is taken' USING ERRCODE = '23505';
    END IF;
  END IF;

  -- a new quote-link name: not another business's address, and not a held one
  IF NEW.slug IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.slug IS DISTINCT FROM OLD.slug) THEN
    PERFORM pg_advisory_xact_lock(hashtext('qolumns_name:' || NEW.slug));
    IF EXISTS (SELECT 1 FROM tenants WHERE own_address = NEW.slug AND id IS DISTINCT FROM NEW.id) OR own_address_held(NEW.slug, NEW.id) THEN
      RAISE EXCEPTION 'That quote link name is another business''s address' USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Runs after tenants_assign_slug (triggers fire in name order), so a new business's generated name is checked too
DROP TRIGGER IF EXISTS tenants_own_address_guard ON tenants;
CREATE TRIGGER tenants_own_address_guard
  BEFORE INSERT OR UPDATE OF slug, own_address, own_address_chosen_at, own_address_later_at ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION tenants_own_address_guard();

COMMENT ON FUNCTION public.tenants_own_address_guard IS 'T-199: only the service role writes a business''s own address; one name belongs to one business across the address and the quote-link name';

-- ---------- 4. reserved names ----------
INSERT INTO reserved_slugs (slug) VALUES
  -- RESERVED_SLUGS:BEGIN (keep in sync with packages/shared/src/own-address.ts)
  ('cdn'), ('dev'), ('email'), ('m'), ('pm-bounces'), ('q'), ('staging'), ('status')
  -- RESERVED_SLUGS:END
ON CONFLICT (slug) DO NOTHING;
