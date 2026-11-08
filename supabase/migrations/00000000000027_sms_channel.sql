-- T-136 SMS channel (Twilio), AD-027. Mirrors the WhatsApp tables (migration 25)
-- so the shared intake engine stores SMS conversations with the same shape.
-- tenant_id / quote_request_id are TEXT with no FKs (local TEXT ids vs prod
-- UUIDs, migration 22 lessons). Line comments only inside column lists.

-- Per-tenant SMS number. Twilio credentials are platform-level env vars; a
-- tenant brings (or is assigned) a number on the platform account.
CREATE TABLE IF NOT EXISTS sms_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL UNIQUE,
  -- E.164, e.g. +15125550100; inbound webhooks are routed by this number
  phone_number TEXT NOT NULL UNIQUE,
  -- Optional Twilio Messaging Service (A2P 10DLC campaigns attach to these)
  messaging_service_sid TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  -- Business-side 10DLC checklist progress (informational; registration is manual)
  a2p_brand_registered BOOLEAN NOT NULL DEFAULT false,
  a2p_campaign_registered BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER sms_configs_updated_at
  BEFORE UPDATE ON sms_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS sms_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_name TEXT,
  quote_request_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired')),
  intake_state TEXT NOT NULL DEFAULT 'idle' CHECK (intake_state IN (
    'idle', 'awaiting_service', 'awaiting_description', 'awaiting_name',
    'awaiting_email', 'awaiting_phone', 'awaiting_address', 'awaiting_photos',
    'awaiting_confirmation', 'processing', 'completed'
  )),
  intake_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- The consent line goes out once, on the first reply of a conversation
  consent_notice_sent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER sms_conversations_updated_at
  BEFORE UPDATE ON sms_conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_sms_conversations_lookup
  ON sms_conversations(tenant_id, customer_phone, status);

CREATE TABLE IF NOT EXISTS sms_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  conversation_id UUID REFERENCES sms_conversations(id) ON DELETE CASCADE,
  -- Twilio MessageSid (SM... / MM...)
  provider_message_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_type TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'document')),
  from_phone TEXT NOT NULL,
  to_phone TEXT NOT NULL,
  content TEXT,
  media_url TEXT,
  -- Billable SMS segments (cost visibility; no billing change)
  segments INTEGER NOT NULL DEFAULT 0,
  -- received | sent | test | blocked_opt_out | failed | Twilio delivery statuses
  status TEXT NOT NULL DEFAULT 'received',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_messages_conversation ON sms_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sms_messages_tenant_month ON sms_messages(tenant_id, created_at);

-- STOP/START state per phone number per tenant. Checked before EVERY send.
CREATE TABLE IF NOT EXISTS sms_opt_outs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  opted_out BOOLEAN NOT NULL DEFAULT true,
  -- The keyword that last changed the state (STOP, START, UNSUBSCRIBE…)
  last_keyword TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone)
);

ALTER TABLE sms_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_opt_outs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own tenant sms config"
  ON sms_configs FOR ALL
  USING (tenant_id IN (
    SELECT user_profiles.tenant_id::text FROM user_profiles WHERE user_profiles.id = auth.uid()
  ))
  WITH CHECK (tenant_id IN (
    SELECT user_profiles.tenant_id::text FROM user_profiles WHERE user_profiles.id = auth.uid()
  ));

CREATE POLICY "Users view own tenant sms conversations"
  ON sms_conversations FOR SELECT
  USING (tenant_id IN (
    SELECT user_profiles.tenant_id::text FROM user_profiles WHERE user_profiles.id = auth.uid()
  ));

CREATE POLICY "Users view own tenant sms messages"
  ON sms_messages FOR SELECT
  USING (tenant_id IN (
    SELECT user_profiles.tenant_id::text FROM user_profiles WHERE user_profiles.id = auth.uid()
  ));

CREATE POLICY "Users create own tenant sms messages"
  ON sms_messages FOR INSERT
  WITH CHECK (tenant_id IN (
    SELECT user_profiles.tenant_id::text FROM user_profiles WHERE user_profiles.id = auth.uid()
  ));

-- Businesses can see opt-outs (to know why a send was blocked) but cannot
-- clear them: only the customer's own START reverses a STOP.
CREATE POLICY "Users view own tenant sms opt-outs"
  ON sms_opt_outs FOR SELECT
  USING (tenant_id IN (
    SELECT user_profiles.tenant_id::text FROM user_profiles WHERE user_profiles.id = auth.uid()
  ));

CREATE POLICY "Service role has full access to sms configs"
  ON sms_configs FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Service role has full access to sms conversations"
  ON sms_conversations FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Service role has full access to sms messages"
  ON sms_messages FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Service role has full access to sms opt-outs"
  ON sms_opt_outs FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role');

GRANT SELECT, INSERT, UPDATE, DELETE ON sms_configs TO authenticated;
GRANT SELECT ON sms_conversations TO authenticated;
GRANT SELECT, INSERT ON sms_messages TO authenticated;
GRANT SELECT ON sms_opt_outs TO authenticated;
GRANT ALL ON sms_configs TO service_role;
GRANT ALL ON sms_conversations TO service_role;
GRANT ALL ON sms_messages TO service_role;
GRANT ALL ON sms_opt_outs TO service_role;

COMMENT ON TABLE sms_configs IS 'Per-tenant Twilio SMS number (T-136)';
COMMENT ON TABLE sms_conversations IS 'SMS guided-intake conversations (T-136)';
COMMENT ON TABLE sms_messages IS 'SMS/MMS message log with billable segments (T-136)';
COMMENT ON TABLE sms_opt_outs IS 'STOP/START opt-out state per phone per tenant, enforced on every send (T-136)';
