-- Service Profile Migration
-- Adds enhanced service definition fields for better AI quote accuracy

-- ============================================================================
-- SERVICE PROFILE FIELDS
-- ============================================================================

-- Description field - context for AI about what this service is
ALTER TABLE services ADD COLUMN IF NOT EXISTS description TEXT;

-- Scope definition arrays
ALTER TABLE services ADD COLUMN IF NOT EXISTS scope_includes JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE services ADD COLUMN IF NOT EXISTS scope_excludes JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE services ADD COLUMN IF NOT EXISTS default_assumptions JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Media requirements configuration per service
ALTER TABLE services ADD COLUMN IF NOT EXISTS media_config JSONB NOT NULL DEFAULT '{
  "minPhotos": 1,
  "maxPhotos": 8,
  "photoGuidance": null
}'::jsonb;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN services.description IS 'What this service is about - provides context for AI wording generation';
COMMENT ON COLUMN services.scope_includes IS 'JSON array of strings: what is typically included in this service';
COMMENT ON COLUMN services.scope_excludes IS 'JSON array of strings: what is typically excluded from this service';
COMMENT ON COLUMN services.default_assumptions IS 'JSON array of strings: standard assumptions for quotes of this service';
COMMENT ON COLUMN services.media_config IS 'JSON object with minPhotos, maxPhotos, photoGuidance for widget upload requirements';
