-- Add prompt_context column to services table
-- This allows business owners to add custom AI guidance per service
-- (e.g., industry-specific counting rules, measurement methodology)

ALTER TABLE services
ADD COLUMN IF NOT EXISTS prompt_context TEXT;

COMMENT ON COLUMN services.prompt_context IS 'Custom AI guidance for this service (industry-specific rules, counting methodology, etc.)';
