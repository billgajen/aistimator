-- T-189: where a new business came from, and the owner's alerts.
--
-- 1. tenants.signup_source: the first-visit source of the person who signed
--    up (campaign tags on the link, the site they came from, the first page
--    of ours they opened). Written once by the server from what the sign-up
--    form sent; a business cannot set or change its own.
-- 2. ops_alerts: one row per kind of alert, so the owner gets at most one
--    email per kind per hour. claim_ops_alert() decides and records in one
--    step; whoever is told "yes" sends the email.
--    The row 'queue_watch' is not an alert: it holds the ids the queue check
--    saw waiting last time, so that only a request seen waiting twice counts.
--
-- Additive and re-runnable. Nothing is deleted. No existing row is changed.

-- ---------- 1. where a business came from ----------
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS signup_source JSONB;

COMMENT ON COLUMN tenants.signup_source IS 'T-189: first-visit source at sign-up: {utm:{source,medium,campaign,term,content}, referrer (a host), landing (a path), at}. Null for a business from before T-189 or one that arrived with none. Server-only.';

CREATE OR REPLACE FUNCTION public.tenants_signup_source_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.jwt() ->> 'role', 'service_role') <> 'service_role' THEN
    IF TG_OP = 'INSERT' AND NEW.signup_source IS NOT NULL THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    ELSIF TG_OP = 'UPDATE' AND NEW.signup_source IS DISTINCT FROM OLD.signup_source THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_signup_source_guard ON tenants;
CREATE TRIGGER tenants_signup_source_guard
  BEFORE INSERT OR UPDATE OF signup_source ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION tenants_signup_source_guard();

COMMENT ON FUNCTION public.tenants_signup_source_guard IS 'T-189: a business cannot write where it came from; only the service role can';

-- ---------- 2. the owner's alerts: one per kind per hour ----------
CREATE TABLE IF NOT EXISTS ops_alerts (
  kind TEXT PRIMARY KEY,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- how many times this kind happened since the last email (said in the next one)
  held_back INTEGER NOT NULL DEFAULT 0,
  -- the queue check's own note: the ids of the requests it saw waiting last time
  seen JSONB
);
ALTER TABLE ops_alerts ADD COLUMN IF NOT EXISTS seen JSONB;

ALTER TABLE ops_alerts ENABLE ROW LEVEL SECURITY;
-- no policy: only the service role reads or writes it
REVOKE ALL ON ops_alerts FROM anon, authenticated;

COMMENT ON TABLE ops_alerts IS 'T-189: when the owner was last emailed about each kind of fault, so each kind is emailed at most once an hour';

-- May an alert of this kind be sent now? Yes at most once per p_every_seconds
-- per kind. A "no" is counted, and the next "yes" returns how many were held back.
-- Returns one row: send, held_back (the count the email should mention).
CREATE OR REPLACE FUNCTION public.claim_ops_alert(p_kind TEXT, p_every_seconds INTEGER)
RETURNS TABLE (send BOOLEAN, held_back INTEGER)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_last TIMESTAMPTZ;
  v_held INTEGER;
BEGIN
  -- one decision at a time per kind
  PERFORM pg_advisory_xact_lock(hashtext('ops_alert:' || p_kind));
  SELECT o.last_sent_at, o.held_back INTO v_last, v_held FROM ops_alerts o WHERE o.kind = p_kind;
  IF NOT FOUND THEN
    INSERT INTO ops_alerts (kind, last_sent_at, held_back) VALUES (p_kind, NOW(), 0);
    RETURN QUERY SELECT TRUE, 0;
  ELSIF v_last <= NOW() - make_interval(secs => greatest(p_every_seconds, 0)) THEN
    UPDATE ops_alerts o SET last_sent_at = NOW(), held_back = 0 WHERE o.kind = p_kind;
    RETURN QUERY SELECT TRUE, v_held;
  ELSE
    UPDATE ops_alerts o SET held_back = o.held_back + 1 WHERE o.kind = p_kind;
    RETURN QUERY SELECT FALSE, v_held + 1;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_ops_alert(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ops_alert(TEXT, INTEGER) TO service_role;

COMMENT ON FUNCTION public.claim_ops_alert IS 'T-189: decides and records, in one step, whether the owner is emailed about this kind of fault now (at most once per interval per kind)';
