-- T-115: Cross-tenant rate benchmarks — opt-in flag.
-- Tenants who opt in contribute their per-unit rates to anonymized aggregates
-- AND gain access to the benchmarks (reciprocity). Default off.
-- Additive ALTER only — follows migration-16/17 lessons.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS benchmarks_opt_in BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN tenants.benchmarks_opt_in IS
  'Share anonymized per-unit rates for market benchmarks and see them in return (T-115)';
