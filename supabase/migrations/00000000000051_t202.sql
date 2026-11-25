-- T-202: the test estimate a business makes from its own dashboard.
--
-- Nothing is deleted and no existing row is changed. Safe to run twice.

-- ---------- item 3: how many test estimates a business made in the last day ----------
-- tenants.test_estimate_times: when this business started each of its recent
-- test estimates (only the last 24 hours are kept). A business may make 5 in
-- 24 hours. The count is kept here, not worked out from the quotes, because a
-- business can now delete a test: a deleted test must not hand back one of the
-- day's five. It starts empty for every business (a test made before this
-- migration is not counted again).
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS test_estimate_times TIMESTAMPTZ[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN tenants.test_estimate_times IS
  'T-202: when each test estimate of the last 24 hours was started (the daily limit; a deleted test still counts). Server-only.';

-- A business can change its own row, so it could empty this list and start the
-- day's five again. Only the service role may write it (the same guard as
-- signup_source, migration 45).
CREATE OR REPLACE FUNCTION public.tenants_test_estimate_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.jwt() ->> 'role', 'service_role') <> 'service_role' THEN
    IF TG_OP = 'INSERT' AND coalesce(array_length(NEW.test_estimate_times, 1), 0) > 0 THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    ELSIF TG_OP = 'UPDATE' AND NEW.test_estimate_times IS DISTINCT FROM OLD.test_estimate_times THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_test_estimate_guard ON tenants;
CREATE TRIGGER tenants_test_estimate_guard
  BEFORE INSERT OR UPDATE OF test_estimate_times ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION tenants_test_estimate_guard();

COMMENT ON FUNCTION public.tenants_test_estimate_guard IS
  'T-202: a business cannot write its own count of test estimates; only the service role can';

-- Take one of the day's test estimates if any is left, in one step. Answers
-- whether it was taken, the moment it was noted (to give it back by), how many
-- are used, and when the next one frees up (the oldest of the day plus 24
-- hours; null while there is room).
CREATE OR REPLACE FUNCTION public.claim_test_estimate(p_tenant_id TEXT, p_limit INTEGER)
RETURNS TABLE (claimed BOOLEAN, claimed_at TIMESTAMPTZ, used INTEGER, available_at TIMESTAMPTZ)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  -- to the millisecond, so the moment handed back is the moment stored
  v_now TIMESTAMPTZ := date_trunc('milliseconds', clock_timestamp());
  v_all TIMESTAMPTZ[];
  v_recent TIMESTAMPTZ[];
  v_used INTEGER;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'p_limit must be 1 or more' USING ERRCODE = '22023';
  END IF;

  -- one claim at a time for a business: its row is held until this transaction ends
  SELECT tn.test_estimate_times INTO v_all FROM tenants tn WHERE tn.id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such business' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(array_agg(t ORDER BY t), '{}') INTO v_recent
  FROM unnest(v_all) AS t
  WHERE t > v_now - INTERVAL '24 hours';

  v_used := coalesce(array_length(v_recent, 1), 0);

  IF v_used >= p_limit THEN
    -- the place that frees first is the oldest of the newest p_limit
    RETURN QUERY SELECT false, NULL::TIMESTAMPTZ, v_used, v_recent[v_used - p_limit + 1] + INTERVAL '24 hours';
    RETURN;
  END IF;

  v_recent := array_append(v_recent, v_now);
  UPDATE tenants SET test_estimate_times = v_recent WHERE id = p_tenant_id;

  v_used := v_used + 1;
  RETURN QUERY SELECT
    true,
    v_now,
    v_used,
    CASE WHEN v_used >= p_limit THEN v_recent[v_used - p_limit + 1] + INTERVAL '24 hours' ELSE NULL END;
END;
$$;

COMMENT ON FUNCTION public.claim_test_estimate IS
  'T-202: note one test estimate for a business if fewer than p_limit were started in the last 24 hours, in one step (service role only)';

-- Give one back: the request it was taken for was refused before it was saved
-- (a missing answer, a bad photo). Only the moment given is removed.
CREATE OR REPLACE FUNCTION public.release_test_estimate(p_tenant_id TEXT, p_claimed_at TIMESTAMPTZ)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE tenants
  SET test_estimate_times = array_remove(test_estimate_times, p_claimed_at)
  WHERE id = p_tenant_id AND p_claimed_at = ANY (test_estimate_times);
END;
$$;

COMMENT ON FUNCTION public.release_test_estimate IS
  'T-202: undo one claim_test_estimate whose request was never saved (service role only)';

REVOKE ALL ON FUNCTION public.claim_test_estimate(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_test_estimate(TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_test_estimate(TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_test_estimate(TEXT, TIMESTAMPTZ) TO service_role;
