-- T-196: the phone app's notifications, and the business's time zone.
--
-- 1. push_devices: one row per phone that may be notified (its Expo push
--    token), with the user's three switches. A user sees and changes only
--    their own rows. The server (service role) registers a token, because a
--    phone that changes hands moves its token to the new user.
-- 2. push_events: one row per notification event (a new request, an
--    acceptance, one question). Recording the event is the permission to
--    notify: a second attempt finds the row and sends nothing, so a repriced
--    or re-sent request never notifies twice. Service role only.
-- 3. tenants.time_zone: the business's time zone (an IANA name), so "this
--    month" on Home starts at the business's midnight. Null until the
--    dashboard or the app first reports it; the region's zone is used until
--    then.
--
-- Additive and re-runnable. Nothing is deleted. No existing row is changed.

-- ---------- 1. the phones ----------
CREATE TABLE IF NOT EXISTS push_devices (
  token TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  notify_new_request BOOLEAN NOT NULL DEFAULT TRUE,
  notify_accepted BOOLEAN NOT NULL DEFAULT TRUE,
  notify_question BOOLEAN NOT NULL DEFAULT TRUE,
  -- the id Expo gave the last notification sent here; its receipt says whether the token is dead
  last_ticket_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_devices_tenant ON push_devices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_push_devices_user ON push_devices(user_id);

DROP TRIGGER IF EXISTS push_devices_updated_at ON push_devices;
CREATE TRIGGER push_devices_updated_at
  BEFORE UPDATE ON push_devices
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE push_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON push_devices FROM anon;
REVOKE ALL ON push_devices FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON push_devices TO authenticated;

-- A user's own phones, in the user's own business, and nobody else's
DROP POLICY IF EXISTS "Users can view own push devices" ON push_devices;
CREATE POLICY "Users can view own push devices" ON push_devices
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can add own push devices" ON push_devices;
CREATE POLICY "Users can add own push devices" ON push_devices
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can change own push devices" ON push_devices;
CREATE POLICY "Users can change own push devices" ON push_devices
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()))
  WITH CHECK (user_id = auth.uid() AND tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can remove own push devices" ON push_devices;
CREATE POLICY "Users can remove own push devices" ON push_devices
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

COMMENT ON TABLE push_devices IS 'T-196: the phones the app may notify (Expo push tokens) and each user''s three switches. A user reads and changes only their own rows.';

-- ---------- 2. one notification per event ----------
CREATE TABLE IF NOT EXISTS push_events (
  quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  -- 'new_request', 'accepted', or 'question:<the question''s id>'
  event_key TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (quote_id, event_key)
);

ALTER TABLE push_events ENABLE ROW LEVEL SECURITY;
-- no policy: only the service role reads or writes it
REVOKE ALL ON push_events FROM anon, authenticated;

COMMENT ON TABLE push_events IS 'T-196: the notification events already sent to phones. A row is written before sending; an event that is already here is not sent again. Service role only.';

-- ---------- 3. the business's time zone ----------
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS time_zone TEXT;

COMMENT ON COLUMN tenants.time_zone IS 'T-196: the business''s time zone as an IANA name (Europe/London). Null until the dashboard or the app first reports it; the region''s zone is used until then.';
