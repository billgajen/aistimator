-- Service Detection Keywords Migration
-- Adds detection_keywords column for cross-service matching

-- ============================================================================
-- ADD DETECTION KEYWORDS COLUMN
-- ============================================================================

ALTER TABLE services ADD COLUMN IF NOT EXISTS detection_keywords JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN services.detection_keywords IS 'JSON array of strings: keywords that identify this service for cross-service detection';
