-- T-102: Metered overage billing.
-- Plans may define a per-quote overage price; when set (and the tenant has an
-- active paid subscription), quotes beyond the monthly limit proceed and are
-- metered to Stripe instead of being hard-blocked (T-101 behavior remains for
-- free/trial tenants and plans without overage).
-- Additive ALTERs only — follows migration-16/17 lessons (no RLS/ID changes).

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS overage_price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS stripe_metered_price_id TEXT;

COMMENT ON COLUMN plans.overage_price_cents IS
  'Price per quote beyond monthly_estimate_limit (null = no overage, hard block at limit)';
COMMENT ON COLUMN plans.stripe_metered_price_id IS
  'Stripe metered price attached at checkout so meter events bill automatically';
