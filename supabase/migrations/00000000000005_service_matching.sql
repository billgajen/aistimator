-- ============================================================================
-- SERVICE MATCHING SETTINGS
-- ============================================================================
-- Adds settings for AI service matching behavior per tenant

-- Add service matching settings to tenants table
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS service_match_mode TEXT NOT NULL DEFAULT 'medium';
-- Values: 'off' (no AI validation), 'low' (90%+ confidence to reject),
--         'medium' (80%+ confidence to reject), 'high' (70%+ confidence to reject)

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS general_inquiry_enabled BOOLEAN NOT NULL DEFAULT true;
-- When true, creates a general inquiry instead of rejecting when no service matches

-- Add comment for documentation
COMMENT ON COLUMN tenants.service_match_mode IS 'AI service matching strictness: off, low, medium, high';
COMMENT ON COLUMN tenants.general_inquiry_enabled IS 'Create general inquiry when no service matches instead of rejecting';

-- Update quotes table to support general inquiries
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS is_general_inquiry BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN quotes.is_general_inquiry IS 'True if this is a general inquiry without service-specific pricing';
