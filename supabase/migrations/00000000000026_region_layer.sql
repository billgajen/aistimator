-- T-133 Region layer (AD-025): every tenant has a region.
-- Existing tenants are all UK businesses, so they are backfilled to GB.
-- New signups default to US, the launch market.
-- No new tables, so no new RLS policies are needed: the columns inherit the
-- existing tenant-scoped policies on tenants and services.

-- Region code, validated against the regions shipped in packages/shared/src/regions
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS region TEXT;
UPDATE tenants SET region = 'GB' WHERE region IS NULL;
ALTER TABLE tenants ALTER COLUMN region SET DEFAULT 'US';
ALTER TABLE tenants ALTER COLUMN region SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_region_check'
  ) THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_region_check CHECK (region IN ('US', 'GB'));
  END IF;
END $$;

-- Optional unit-system override; NULL means "use the region default"
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS unit_system TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_unit_system_check'
  ) THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_unit_system_check
      CHECK (unit_system IS NULL OR unit_system IN ('imperial', 'metric'));
  END IF;
END $$;

-- Services that are not subject to sales tax / VAT skip the tenant tax line
ALTER TABLE services ADD COLUMN IF NOT EXISTS tax_exempt BOOLEAN NOT NULL DEFAULT false;
