-- T-150: setup that shows the business its prices and ends with a real test quote.
--
-- tenants.trade / trade_other: the answer to "What kind of work do you do?"
--   (a pack id, or 'other' with the business's own words).
-- tenants.selected_plan: the plan picked on the pricing page before signup,
--   for the billing page to pre-select. Checkout is never started from it.
-- tenants.onboarding_skipped_at: the business chose to set up by hand; the
--   dashboard stops sending it to setup.
-- quotes.is_test: a test request made by the signed-in owner from setup.
--   Set only by the server from a signed test token; never counted toward the
--   plan, the free allowance or overage.
--
-- Additive and re-runnable.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trade TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trade_other TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS selected_plan TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_skipped_at TIMESTAMPTZ;
COMMENT ON COLUMN tenants.trade IS 'T-150: setup answer: a vertical pack id, or ''other''';
COMMENT ON COLUMN tenants.trade_other IS 'T-150: the business''s own words when trade = ''other''';
COMMENT ON COLUMN tenants.selected_plan IS 'T-150: plan chosen on the pricing page before signup (billing pre-select only)';
COMMENT ON COLUMN tenants.onboarding_skipped_at IS 'T-150: the business skipped guided setup';

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_trade_other_length;
ALTER TABLE tenants ADD CONSTRAINT tenants_trade_other_length CHECK (trade_other IS NULL OR length(trade_other) <= 200);

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN quotes.is_test IS 'T-150: owner''s test request from setup (server-issued token); not counted toward usage';
CREATE INDEX IF NOT EXISTS idx_quotes_tenant_is_test ON quotes (tenant_id, created_at) WHERE is_test;
