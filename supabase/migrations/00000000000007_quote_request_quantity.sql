-- Quote Request Quantity Migration
-- Adds job_quantity field to quote_requests for per-unit pricing

ALTER TABLE quote_requests ADD COLUMN IF NOT EXISTS job_quantity NUMERIC;

COMMENT ON COLUMN quote_requests.job_quantity IS 'Customer-provided quantity for per-unit pricing (e.g., square footage)';
