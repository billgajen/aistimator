-- Seed data for local development
-- This file runs after migrations when using `supabase db reset`

-- ============================================================================
-- PLANS
-- ============================================================================
INSERT INTO plans (id, name, monthly_estimate_limit, price_cents, features_json, is_active)
VALUES
  (
    'plan_starter',
    'Starter',
    200,
    2900,  -- $29/month
    '{
      "pdf_generation": true,
      "email_notifications": true,
      "custom_branding": false,
      "priority_support": false,
      "api_access": false
    }'::jsonb,
    true
  ),
  (
    'plan_growth',
    'Growth',
    1000,
    7900,  -- $79/month
    '{
      "pdf_generation": true,
      "email_notifications": true,
      "custom_branding": true,
      "priority_support": false,
      "api_access": false
    }'::jsonb,
    true
  ),
  (
    'plan_pro',
    'Pro',
    3000,
    19900,  -- $199/month
    '{
      "pdf_generation": true,
      "email_notifications": true,
      "custom_branding": true,
      "priority_support": true,
      "api_access": true
    }'::jsonb,
    true
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  monthly_estimate_limit = EXCLUDED.monthly_estimate_limit,
  price_cents = EXCLUDED.price_cents,
  features_json = EXCLUDED.features_json,
  is_active = EXCLUDED.is_active;

-- ============================================================================
-- TEST TENANT (for local development only)
-- ============================================================================
-- Uncomment below to create a test tenant for local development
-- Note: You'll need to create a user in Supabase Auth first and update the user_id

-- INSERT INTO tenants (id, name, currency, tax_enabled, tax_label, tax_rate)
-- VALUES ('tnt_test123', 'Test Business', 'USD', true, 'Sales Tax', 0.08);

-- INSERT INTO user_profiles (id, tenant_id, role, display_name)
-- VALUES ('YOUR-USER-UUID-HERE', 'tnt_test123', 'admin', 'Test Admin');

-- INSERT INTO tenant_sites (tenant_id, domain, is_active)
-- VALUES ('tnt_test123', 'localhost', true);

-- INSERT INTO services (id, tenant_id, name, active, document_type_default)
-- VALUES ('svc_test1', 'tnt_test123', 'General Cleaning', true, 'instant_estimate');

-- INSERT INTO service_pricing_rules (tenant_id, service_id, rules_json)
-- VALUES ('tnt_test123', 'svc_test1', '{
--   "baseFee": 50,
--   "minimumCharge": 80,
--   "addons": [
--     {"id": "deep_clean", "label": "Deep Clean", "price": 30}
--   ],
--   "multipliers": [
--     {"when": {"fieldId": "rooms", "operator": "gt", "value": 3}, "multiplier": 1.25}
--   ]
-- }'::jsonb);

-- INSERT INTO subscriptions (tenant_id, plan_id, status)
-- VALUES ('tnt_test123', 'plan_starter', 'active');
