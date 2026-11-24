-- T-201: the columns its fixes need. Each block says which item it is for.
--
-- Nothing is deleted and no existing row is changed, unless a block says so.
-- Safe to run twice.

-- ---------- item 4: the reminder to the customer, on or off ----------
-- On for every business (what happened before there was a switch). The daily
-- job reminds only customers of a business that has it on.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS customer_reminder_enabled BOOLEAN NOT NULL DEFAULT true;

-- ---------- item 26: sharing rates in the benchmarks, on for a new business ----------
-- tenants.benchmarks_opt_in (migration 21) was off until a business pressed
-- "Share & See Benchmarks". Settings now has a switch, and a business that
-- signs up from here on starts with it on. No existing row is changed: a
-- business that never pressed the button stays off until it turns the switch
-- on, and the demo business and the store reviewers' accounts (set to false by
-- their scripts) stay out of every benchmark.
ALTER TABLE tenants
  ALTER COLUMN benchmarks_opt_in SET DEFAULT true;

COMMENT ON COLUMN tenants.benchmarks_opt_in IS
  'Share anonymized per-unit rates for market benchmarks and see them in return (T-115). T-201: a switch in Settings, on for a new business';

-- ---------- item 33: the free quotes count only what was priced on the free start ----------
-- usage_counters.plan_estimates_created: of a month's priced quotes, how many
-- were counted against a monthly limit (a plan's, or the old monthly
-- allowance). The rest were counted against the free quotes that never reset.
-- So the free quotes a business has used = estimates_created minus
-- plan_estimates_created, every month together. Until T-201 the free
-- allowance counted every quote ever priced, so a business whose plan ended
-- had none of its free quotes left however few it had used.
--
-- The column is added once, and filled once for the businesses that have ever
-- had a plan: of each month's quotes, those made on or after the day the
-- subscription row was created are taken as the plan's (never more than the
-- month's count). A business that never had a plan keeps 0: all of its quotes
-- were free ones, which is what was counted before. Only this column is
-- written; no count that existed before is changed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'usage_counters' AND column_name = 'plan_estimates_created'
  ) THEN
    ALTER TABLE usage_counters ADD COLUMN plan_estimates_created INTEGER NOT NULL DEFAULT 0;

    UPDATE usage_counters uc
    SET plan_estimates_created = LEAST(uc.estimates_created, made.on_plan)
    FROM (
      SELECT q.tenant_id, to_char(q.created_at, 'YYYYMM') AS period, count(*)::INTEGER AS on_plan
      FROM quotes q
      JOIN subscriptions s ON s.tenant_id = q.tenant_id
      WHERE q.created_at >= s.created_at
        AND coalesce(q.is_test, false) = false
        AND coalesce(q.content_json ->> 'limitHold', 'false') <> 'true'
      GROUP BY q.tenant_id, to_char(q.created_at, 'YYYYMM')
    ) made
    WHERE made.tenant_id = uc.tenant_id AND made.period = uc.period_yyyymm;
  END IF;
END $$;

COMMENT ON COLUMN usage_counters.plan_estimates_created IS
  'T-201: of estimates_created, the quotes counted against a monthly limit (a plan). The free quotes used = estimates_created - plan_estimates_created, all months together';

-- Count one priced quote if the limit allows, in one step (T-180). T-201: a
-- claim against the free quotes ('total') looks only at quotes priced that
-- way; a claim against a monthly limit ('month') is also noted as the plan's.
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
  v_plan INTEGER := CASE WHEN p_per = 'month' THEN 1 ELSE 0 END;
BEGIN
  IF p_per NOT IN ('month', 'total') THEN
    RAISE EXCEPTION 'p_per must be month or total' USING ERRCODE = '22023';
  END IF;

  -- one business at a time, until this transaction ends
  PERFORM pg_advisory_xact_lock(hashtextextended('plan_usage:' || p_tenant_id, 0));

  IF p_per = 'total' THEN
    SELECT coalesce(sum(greatest(uc.estimates_created - uc.plan_estimates_created, 0)), 0)::INTEGER INTO v_used
    FROM usage_counters uc
    WHERE uc.tenant_id = p_tenant_id;
  ELSE
    SELECT coalesce(sum(uc.estimates_created), 0)::INTEGER INTO v_used
    FROM usage_counters uc
    WHERE uc.tenant_id = p_tenant_id AND uc.period_yyyymm = p_period;
  END IF;

  SELECT t.suspended_at IS NOT NULL INTO v_suspended FROM tenants t WHERE t.id = p_tenant_id;
  IF coalesce(v_suspended, false) THEN
    RETURN QUERY SELECT false, v_used, 'suspended'::TEXT;
    RETURN;
  END IF;

  IF p_limit > 0 AND v_used >= p_limit THEN
    RETURN QUERY SELECT false, v_used, 'limit'::TEXT;
    RETURN;
  END IF;

  INSERT INTO usage_counters (tenant_id, period_yyyymm, estimates_created, estimates_sent, plan_estimates_created)
  VALUES (p_tenant_id, p_period, 1, 0, v_plan)
  ON CONFLICT (tenant_id, period_yyyymm)
  DO UPDATE SET
    estimates_created = usage_counters.estimates_created + 1,
    plan_estimates_created = usage_counters.plan_estimates_created + v_plan;

  RETURN QUERY SELECT true, v_used + 1, 'ok'::TEXT;
END;
$$;

COMMENT ON FUNCTION public.claim_plan_quote IS
  'T-180: count one priced quote for a business if its limit allows, in one step (service role only). T-201: the free quotes count only quotes priced as free ones';

-- Give a claim back. T-201: it is told which kind of claim it was, so the
-- plan's share goes back with it. Called the old way (two values, by the web
-- app as it was before T-201), it gives the quote back and never leaves the
-- plan's share above the month's count.
DROP FUNCTION IF EXISTS public.release_plan_quote(TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.release_plan_quote(p_tenant_id TEXT, p_period TEXT, p_per TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('plan_usage:' || p_tenant_id, 0));
  UPDATE usage_counters
  SET
    estimates_created = greatest(estimates_created - 1, 0),
    plan_estimates_created = least(
      greatest(plan_estimates_created - CASE WHEN p_per = 'month' THEN 1 ELSE 0 END, 0),
      greatest(estimates_created - 1, 0)
    )
  WHERE tenant_id = p_tenant_id AND period_yyyymm = p_period;
END;
$$;

COMMENT ON FUNCTION public.release_plan_quote IS
  'T-180: undo one claim_plan_quote (service role only). T-201: p_per says which kind of claim it was';

REVOKE ALL ON FUNCTION public.claim_plan_quote(TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_plan_quote(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_plan_quote(TEXT, TEXT, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_plan_quote(TEXT, TEXT, TEXT) TO service_role;

-- (T-201: add above this line)
