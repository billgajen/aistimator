-- T-180: Stripe live billing (AD-062, AD-063).
--
-- 1. The plan's usage is counted INSIDE the database.
--    Before: the server read the count, added one and wrote it back, so two
--    requests at the same moment both wrote the same number (six counted as
--    two), and the limit was checked in one step and counted in another, so
--    requests arriving together could all pass a limit that had one place left.
--    Now one function decides and counts in a single step, one business at a
--    time (an advisory lock on the business, held for the transaction).
--    The LIMIT is not stored here: plan numbers live in the plan definitions
--    (packages/shared/src/plans.ts) and are passed in by the server.
-- 2. What the billing page and the payment rules need on `subscriptions`.
-- 3. The suspend switch and the "2 free quotes left" stamp on `tenants`,
--    changed only through the service role.
-- 4. A ledger of Stripe events, so the same event twice changes nothing.
-- 5. The platform admin's activity log. The code has written to
--    `admin_activity_logs` since the admin area was built, but no migration
--    ever created the table, so nothing was being kept.
--
-- Nothing is deleted. No existing row is changed.

-- ---------- 1. usage, counted atomically ----------

-- Claim one priced quote for a business: counts it and says yes, or says no.
--   p_limit <= 0  : no limit (count it and say yes)
--   p_per         : 'month' = this period's row; 'total' = every period's rows (the free allowance)
-- Returns one row: claimed, used (after the claim), reason ('ok' | 'limit' | 'suspended').
CREATE OR REPLACE FUNCTION public.claim_plan_quote(
  p_tenant_id TEXT,
  p_period TEXT,
  p_limit INTEGER,
  p_per TEXT
)
RETURNS TABLE (claimed BOOLEAN, used INTEGER, reason TEXT)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_used INTEGER;
  v_suspended BOOLEAN;
BEGIN
  IF p_per NOT IN ('month', 'total') THEN
    RAISE EXCEPTION 'p_per must be month or total' USING ERRCODE = '22023';
  END IF;

  -- one business at a time, until this transaction ends
  PERFORM pg_advisory_xact_lock(hashtextextended('plan_usage:' || p_tenant_id, 0));

  SELECT coalesce(sum(uc.estimates_created), 0)::INTEGER INTO v_used
  FROM usage_counters uc
  WHERE uc.tenant_id = p_tenant_id
    AND (p_per = 'total' OR uc.period_yyyymm = p_period);

  SELECT t.suspended_at IS NOT NULL INTO v_suspended FROM tenants t WHERE t.id = p_tenant_id;
  IF coalesce(v_suspended, false) THEN
    RETURN QUERY SELECT false, v_used, 'suspended'::TEXT;
    RETURN;
  END IF;

  IF p_limit > 0 AND v_used >= p_limit THEN
    RETURN QUERY SELECT false, v_used, 'limit'::TEXT;
    RETURN;
  END IF;

  INSERT INTO usage_counters (tenant_id, period_yyyymm, estimates_created, estimates_sent)
  VALUES (p_tenant_id, p_period, 1, 0)
  ON CONFLICT (tenant_id, period_yyyymm)
  DO UPDATE SET estimates_created = usage_counters.estimates_created + 1;

  RETURN QUERY SELECT true, v_used + 1, 'ok'::TEXT;
END;
$$;

COMMENT ON FUNCTION public.claim_plan_quote IS
  'T-180: count one priced quote for a business if its limit allows, in one step (service role only)';

-- Give a claim back (the quote could not be saved after it was counted).
CREATE OR REPLACE FUNCTION public.release_plan_quote(p_tenant_id TEXT, p_period TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('plan_usage:' || p_tenant_id, 0));
  UPDATE usage_counters
  SET estimates_created = greatest(estimates_created - 1, 0)
  WHERE tenant_id = p_tenant_id AND period_yyyymm = p_period;
END;
$$;

COMMENT ON FUNCTION public.release_plan_quote IS
  'T-180: undo one claim_plan_quote (service role only)';

-- Add one to a counter that has no limit of its own (estimates sent).
CREATE OR REPLACE FUNCTION public.increment_usage_counter(
  p_tenant_id TEXT,
  p_period TEXT,
  p_field TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_field = 'estimates_sent' THEN
    INSERT INTO usage_counters (tenant_id, period_yyyymm, estimates_created, estimates_sent)
    VALUES (p_tenant_id, p_period, 0, 1)
    ON CONFLICT (tenant_id, period_yyyymm)
    DO UPDATE SET estimates_sent = usage_counters.estimates_sent + 1;
  ELSIF p_field = 'estimates_created' THEN
    INSERT INTO usage_counters (tenant_id, period_yyyymm, estimates_created, estimates_sent)
    VALUES (p_tenant_id, p_period, 1, 0)
    ON CONFLICT (tenant_id, period_yyyymm)
    DO UPDATE SET estimates_created = usage_counters.estimates_created + 1;
  ELSE
    RAISE EXCEPTION 'unknown counter %', p_field USING ERRCODE = '22023';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.increment_usage_counter IS
  'T-180: add one to a usage counter in a single statement (service role only)';

-- The server only: a signed-in business must not count, uncount or claim.
REVOKE ALL ON FUNCTION public.claim_plan_quote(TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_plan_quote(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.increment_usage_counter(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_plan_quote(TEXT, TEXT, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_plan_quote(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_usage_counter(TEXT, TEXT, TEXT) TO service_role;

-- ---------- 2. subscriptions: what Stripe tells us ----------
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS billing_interval TEXT,
  ADD COLUMN IF NOT EXISTS cancel_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_failed_notified_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_billing_interval_check') THEN
    ALTER TABLE subscriptions
      ADD CONSTRAINT subscriptions_billing_interval_check
      CHECK (billing_interval IS NULL OR billing_interval IN ('monthly', 'annual'));
  END IF;
END $$;

COMMENT ON COLUMN subscriptions.billing_interval IS 'T-180: monthly or annual, from the Stripe price (null for a free test account)';
COMMENT ON COLUMN subscriptions.cancel_at IS 'T-180: when a cancelled subscription ends (the plan holds until then); null when it is not ending';
COMMENT ON COLUMN subscriptions.payment_failed_at IS 'T-180: when the payment now being retried first failed; null when payments are fine';
COMMENT ON COLUMN subscriptions.payment_failed_notified_at IS 'T-180: when the one "payment did not go through" email was sent for this failure';

-- ---------- 3. tenants: suspend, and the one free-allowance warning ----------
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_reason TEXT,
  ADD COLUMN IF NOT EXISTS free_warning_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN tenants.suspended_at IS 'T-180: set by a platform admin. While set: no new quote is priced (requests are held), the WhatsApp assistant is silent; quotes already sent stay open';
COMMENT ON COLUMN tenants.suspended_reason IS 'T-180: the admin''s note; never shown to the business or its customers';
COMMENT ON COLUMN tenants.free_warning_sent_at IS 'T-180: when the one "2 free quotes left" email was sent';

CREATE OR REPLACE FUNCTION public.tenants_billing_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.jwt() ->> 'role', 'service_role') <> 'service_role' THEN
    IF TG_OP = 'INSERT' AND (NEW.suspended_at IS NOT NULL OR NEW.suspended_reason IS NOT NULL OR NEW.free_warning_sent_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    ELSIF TG_OP = 'UPDATE' AND (
      NEW.suspended_at IS DISTINCT FROM OLD.suspended_at
      OR NEW.suspended_reason IS DISTINCT FROM OLD.suspended_reason
      OR NEW.free_warning_sent_at IS DISTINCT FROM OLD.free_warning_sent_at
    ) THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_billing_guard ON tenants;
CREATE TRIGGER tenants_billing_guard
  BEFORE INSERT OR UPDATE OF suspended_at, suspended_reason, free_warning_sent_at ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION tenants_billing_guard();

COMMENT ON FUNCTION public.tenants_billing_guard IS 'T-180: a business cannot suspend, restore or re-arm its own warning; only the service role can';

-- ---------- 4. Stripe events already handled ----------
CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,                       -- Stripe's event id (evt_…)
  type TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ                   -- null until its handler finished
);

ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
-- no policy: only the service role reads or writes it
REVOKE ALL ON stripe_events FROM anon, authenticated;

COMMENT ON TABLE stripe_events IS 'T-180: Stripe webhook events received, so a repeated event is not handled twice. No customer or card data.';

-- ---------- 5. the platform admin's activity log ----------
CREATE TABLE IF NOT EXISTS admin_activity_logs (
  id TEXT PRIMARY KEY DEFAULT generate_prefixed_id('aal'),
  admin_user_id UUID,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_created ON admin_activity_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_resource ON admin_activity_logs (resource_type, resource_id);

ALTER TABLE admin_activity_logs ENABLE ROW LEVEL SECURITY;
-- no policy: only the service role reads or writes it (the admin area reads through the server)
REVOKE ALL ON admin_activity_logs FROM anon, authenticated;

COMMENT ON TABLE admin_activity_logs IS 'T-180: what a platform admin did (suspend, restore, retry, view), written by the server';
