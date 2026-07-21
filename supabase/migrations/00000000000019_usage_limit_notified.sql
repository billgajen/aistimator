-- T-101: Plan limit enforcement — once-per-period notification guard.
-- Records when the "monthly quote limit reached" email was sent so we never spam.
-- NOTE: simple additive ALTER; no new RLS needed (usage_counters policies already cover tenant reads,
-- writes go through the service role — see migration 2 and CHANGELOG 2026-02-16 migration lessons).

ALTER TABLE usage_counters
  ADD COLUMN IF NOT EXISTS limit_notified_at TIMESTAMPTZ;

COMMENT ON COLUMN usage_counters.limit_notified_at IS
  'When the tenant was notified that their monthly estimate limit was reached (null = not notified this period)';
