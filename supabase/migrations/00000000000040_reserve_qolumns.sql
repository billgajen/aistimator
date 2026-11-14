-- T-162: the product is called Qolumns.
--
-- Reserve the product name and its most likely misspelling as quote-link
-- names, so no business can take /quote/qolumns or /quote/qolums.
-- The two earlier names stay reserved (migration 32).
--
-- Stops, changing nothing, if a business holds or has held one of them: that
-- needs the owner's decision, not a silent takeover.
--
-- Additive and re-runnable. The list is a copy of the two new words in
-- apps/web/src/lib/tenant-slug.ts (a unit test checks they match).

DO $$
DECLARE
  holders TEXT;
BEGIN
  SELECT string_agg(slug, ', ') INTO holders FROM (
    SELECT slug FROM tenants WHERE slug IN ('qolumns', 'qolums')
    UNION
    SELECT old_slug FROM tenant_slug_history WHERE old_slug IN ('qolumns', 'qolums')
  ) held;
  IF holders IS NOT NULL THEN
    RAISE EXCEPTION 'T-162: a business already holds or held the quote link name(s): %. Nothing was changed.', holders;
  END IF;
END $$;

INSERT INTO reserved_slugs (slug) VALUES
  -- RESERVED_SLUGS:BEGIN (keep in sync with apps/web/src/lib/tenant-slug.ts)
  ('qolumns'), ('qolums')
  -- RESERVED_SLUGS:END
ON CONFLICT (slug) DO NOTHING;
