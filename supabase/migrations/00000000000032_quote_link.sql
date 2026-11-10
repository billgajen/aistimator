-- T-149: quote link + QR code as the main way to go live.
--
-- tenants.slug: the readable address /quote/{slug}. Generated from the
-- business name on insert (both signup paths insert into tenants), backfilled
-- for existing tenants (oldest first, so the first business keeps the plain
-- name). Clashes and reserved words get a short suffix.
--
-- tenants.slug_changed_at: the business may change its slug once.
-- tenant_slug_history: every slug a tenant gave up; it keeps redirecting to
-- the tenant's current slug and can never be taken by anyone else.
-- reserved_slugs: words that would collide with app routes or mislead. The
-- canonical list lives in apps/web/src/lib/tenant-slug.ts (a unit test checks
-- this migration carries the same list).
--
-- tenants.quote_link_copied_at / quote_link_first_visit_at: the home
-- checklist's "Share your quote link" is ticked by real sharing.
--
-- Guard: a slug can only change through the service role (the slug API), so
-- the format, reserved-word and once-only rules can't be bypassed with the
-- "users can update own tenant" policy.
--
-- Additive and re-runnable.

-- ---------- columns ----------
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS slug_changed_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS quote_link_copied_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS quote_link_first_visit_at TIMESTAMPTZ;
COMMENT ON COLUMN tenants.slug IS 'T-149: public quote page address /quote/{slug}';
COMMENT ON COLUMN tenants.slug_changed_at IS 'T-149: set when the business changed its slug (allowed once)';
COMMENT ON COLUMN tenants.quote_link_copied_at IS 'T-149: first time the business copied its quote link';
COMMENT ON COLUMN tenants.quote_link_first_visit_at IS 'T-149: first visit to the quote page';

-- ---------- reserved words ----------
CREATE TABLE IF NOT EXISTS reserved_slugs (slug TEXT PRIMARY KEY);
ALTER TABLE reserved_slugs ENABLE ROW LEVEL SECURITY;
INSERT INTO reserved_slugs (slug) VALUES
  -- RESERVED_SLUGS:BEGIN (keep in sync with apps/web/src/lib/tenant-slug.ts)
  ('about'), ('account'), ('admin'), ('aistimator'), ('api'), ('app'), ('assets'), ('auth'),
  ('billing'), ('blog'), ('business'), ('contact'), ('dashboard'), ('demo'), ('docs'), ('embed'),
  ('estimate'), ('estimates'), ('estimator'), ('example'), ('features'), ('help'), ('home'), ('login'),
  ('logout'), ('mail'), ('new'), ('null'), ('official'), ('painting'), ('pricing'), ('privacy'),
  ('quote'), ('quotes'), ('root'), ('settings'), ('setup'), ('share'), ('signup'), ('static'),
  ('support'), ('terms'), ('test'), ('trades'), ('undefined'), ('widget'), ('www')
  -- RESERVED_SLUGS:END
ON CONFLICT (slug) DO NOTHING;

-- ---------- slug history ----------
CREATE TABLE IF NOT EXISTS tenant_slug_history (
  old_slug TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tenant_slug_history_tenant ON tenant_slug_history (tenant_id);
-- Service role only (the public page and the slug API use the admin client)
ALTER TABLE tenant_slug_history ENABLE ROW LEVEL SECURITY;

-- ---------- generation ----------
-- Lowercase, common Latin accents folded, "&" → "and", anything else → "-",
-- trimmed to 40 characters. Mirrors slugify() in lib/tenant-slug.ts.
CREATE OR REPLACE FUNCTION public.slugify_business_name(input TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT trim(BOTH '-' FROM left(
    trim(BOTH '-' FROM regexp_replace(
      translate(
        replace(replace(replace(lower(coalesce(input, '')), '&', ' and '), 'ß', 'ss'), 'æ', 'ae'),
        'àáâãäåāçćčèéêëēėęìíîïīįñńòóôõöøōùúûüūýÿžźżšśł',
        'aaaaaaaccceeeeeeeiiiiiinnooooooouuuuuyyzzzssl'
      ),
      '[^a-z0-9]+', '-', 'g'
    )),
    40
  ))
$$;

CREATE OR REPLACE FUNCTION public.tenant_slug_taken(candidate TEXT, for_tenant TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM reserved_slugs WHERE slug = candidate)
      OR EXISTS (SELECT 1 FROM tenants WHERE slug = candidate AND id IS DISTINCT FROM for_tenant)
      OR EXISTS (SELECT 1 FROM tenant_slug_history WHERE old_slug = candidate)
$$;

CREATE OR REPLACE FUNCTION public.generate_tenant_slug(business_name TEXT, for_tenant TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  base TEXT := slugify_business_name(business_name);
  candidate TEXT;
  attempt INT := 0;
BEGIN
  IF base = '' THEN base := 'my-business'; END IF;
  -- Room for "-xxxx" inside 40 characters
  base := trim(BOTH '-' FROM left(base, 35));
  candidate := CASE WHEN length(base) >= 3 THEN base ELSE base || '-' || substr(md5(random()::text), 1, 4) END;
  WHILE tenant_slug_taken(candidate, for_tenant) LOOP
    attempt := attempt + 1;
    IF attempt > 20 THEN RAISE EXCEPTION 'could not generate a free slug for %', business_name; END IF;
    candidate := base || '-' || substr(md5(random()::text), 1, 4);
  END LOOP;
  RETURN candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.tenants_assign_slug()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := generate_tenant_slug(NEW.name, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_assign_slug ON tenants;
CREATE TRIGGER tenants_assign_slug
  BEFORE INSERT ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION tenants_assign_slug();

-- ---------- backfill (oldest first) ----------
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT id, name FROM tenants WHERE slug IS NULL ORDER BY created_at, id LOOP
    UPDATE tenants SET slug = generate_tenant_slug(t.name, t.id) WHERE id = t.id;
  END LOOP;
END;
$$;

ALTER TABLE tenants ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_slug ON tenants (slug);
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_slug_format;
ALTER TABLE tenants ADD CONSTRAINT tenants_slug_format
  CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' AND slug !~ '--');

-- ---------- guard: slugs change only through the service role ----------
CREATE OR REPLACE FUNCTION public.tenants_slug_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug
     AND coalesce(auth.jwt() ->> 'role', 'service_role') <> 'service_role' THEN
    RAISE EXCEPTION 'The quote link can only be changed from the Share page' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_slug_guard ON tenants;
CREATE TRIGGER tenants_slug_guard
  BEFORE UPDATE OF slug ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION tenants_slug_guard();
