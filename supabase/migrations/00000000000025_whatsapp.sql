-- WhatsApp channel tables (T-111/T-112 code shipped without a migration —
-- the feature was fully coded against tables that never existed; this
-- migration makes it deployable).
--
-- NOTE: tenant_id / quote_request_id are TEXT with NO foreign keys — local
-- dev uses TEXT prefixed ids (tnt_...) while production uses UUID (see
-- migration 22 lessons). TEXT holds both; RLS casts for cross-type safety.

-- Per-tenant WhatsApp Business credentials. One config per tenant; the
-- webhook routes inbound messages to a tenant by phone_number_id.
CREATE TABLE IF NOT EXISTS whatsapp_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL UNIQUE,
  phone_number_id TEXT NOT NULL UNIQUE,
  display_phone_number TEXT NOT NULL,
  -- AES-256-CBC encrypted Meta access token (lib/whatsapp.ts encryptToken)
  access_token_encrypted TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER whatsapp_configs_updated_at
  BEFORE UPDATE ON whatsapp_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- One conversation per customer phone number per tenant; carries the
-- guided-intake state machine (idle -> ... -> completed).
CREATE TABLE IF NOT EXISTS whatsapp_conversations (
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER whatsapp_conversations_updated_at
  BEFORE UPDATE ON whatsapp_conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- The webhook finds the active conversation for an inbound message
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_lookup
  ON whatsapp_conversations(tenant_id, customer_phone, status);

-- Full message log, both directions. conversation_id is a real FK — both
-- tables are UUID-keyed and created together.
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  conversation_id UUID NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  wa_message_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_type TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'document', 'template')),
  from_phone TEXT NOT NULL,
  to_phone TEXT NOT NULL,
  content TEXT,
  media_url TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conversation
  ON whatsapp_messages(conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- RLS. The webhook + intake run under the service role; the dashboard config
-- and send routes run under the signed-in user, so authenticated users need
-- tenant-scoped CRUD on configs and insert on conversations/messages.
-- ---------------------------------------------------------------------------

ALTER TABLE whatsapp_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own tenant whatsapp config"
  ON whatsapp_configs FOR ALL
  USING (tenant_id IN (
    SELECT user_profiles.tenant_id::text FROM user_profiles WHERE user_profiles.id = auth.uid()
  ))
  WITH CHECK (tenant_id IN (
    SELECT user_profiles.tenant_id::text FROM user_profiles WHERE user_profiles.id = auth.uid()
  ));

CREATE POLICY "Users view own tenant whatsapp conversations"
  ON whatsapp_conversations FOR SELECT
  USING (tenant_id IN (
    SELECT user_profiles.tenant_id::text FROM user_profiles WHERE user_profiles.id = auth.uid()
  ));

CREATE POLICY "Users create own tenant whatsapp conversations"
  ON whatsapp_conversations FOR INSERT
  WITH CHECK (tenant_id IN (
    SELECT user_profiles.tenant_id::text FROM user_profiles WHERE user_profiles.id = auth.uid()
  ));

CREATE POLICY "Users view own tenant whatsapp messages"
  ON whatsapp_messages FOR SELECT
  USING (tenant_id IN (
    SELECT user_profiles.tenant_id::text FROM user_profiles WHERE user_profiles.id = auth.uid()
  ));

CREATE POLICY "Users create own tenant whatsapp messages"
  ON whatsapp_messages FOR INSERT
  WITH CHECK (tenant_id IN (
    SELECT user_profiles.tenant_id::text FROM user_profiles WHERE user_profiles.id = auth.uid()
  ));

CREATE POLICY "Service role has full access to whatsapp configs"
  ON whatsapp_configs FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');

CREATE POLICY "Service role has full access to whatsapp conversations"
  ON whatsapp_conversations FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');

CREATE POLICY "Service role has full access to whatsapp messages"
  ON whatsapp_messages FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role');

GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_configs TO authenticated;
GRANT SELECT, INSERT ON whatsapp_conversations TO authenticated;
GRANT SELECT, INSERT ON whatsapp_messages TO authenticated;
GRANT ALL ON whatsapp_configs TO service_role;
GRANT ALL ON whatsapp_conversations TO service_role;
GRANT ALL ON whatsapp_messages TO service_role;

COMMENT ON TABLE whatsapp_configs IS 'Per-tenant WhatsApp Business Cloud API credentials (T-112)';
COMMENT ON TABLE whatsapp_conversations IS 'WhatsApp guided-intake conversations (T-111)';
COMMENT ON TABLE whatsapp_messages IS 'WhatsApp message log, inbound and outbound (T-111)';
