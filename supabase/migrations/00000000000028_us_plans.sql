-- T-134 (AD-026): subscription-only US plans. Plan NUMBERS live in
-- packages/shared/src/plans.ts (the single source); these rows exist only so
-- subscriptions.plan_id can reference the ids. Values mirror the config for
-- readability and are not read for limits, prices or features.
INSERT INTO plans (id, name, monthly_estimate_limit, price_cents, features_json, is_active)
VALUES
  ('plan_us_starter', 'Starter', 50, 4900, '{}'::jsonb, true),
  ('plan_us_pro', 'Pro', 200, 9900, '{}'::jsonb, true),
  ('plan_us_business', 'Business', 600, 19900, '{}'::jsonb, true)
ON CONFLICT (id) DO NOTHING;

-- Legacy plans stay for existing subscribers but are no longer offered
UPDATE plans SET is_active = false WHERE id IN ('plan_starter', 'plan_growth', 'plan_pro');
