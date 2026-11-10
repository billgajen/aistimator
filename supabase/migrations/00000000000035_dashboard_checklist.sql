-- T-152: simpler dashboard — the "Check your prices" setup step.
--
-- tenants.prices_checked_at: when the business itself confirmed its prices —
--   "These are my prices" in setup, or saving a service on the Prices page.
--   Only ever set by the business's own action, so the home checklist ticks
--   on a real action (never just because a service exists).
--
-- The free allowance (10 priced quotes in total, not per month) needs no
-- schema change: it sums the existing usage_counters rows.
--
-- Additive and re-runnable. No new table, so no new RLS policy: the column
-- inherits the tenant-scoped policies on tenants.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS prices_checked_at TIMESTAMPTZ;
COMMENT ON COLUMN tenants.prices_checked_at IS 'T-152: when the business confirmed its prices (setup or the Prices page)';
