-- T-175: connect WhatsApp in one click (Meta Embedded Signup).
--
-- 1. whatsapp_configs gains what a connection made through Meta's Embedded
--    Signup needs, and what the manual method needs to have its webhook
--    signature checked:
--      connection_method          'manual' (T-112) or 'embedded' (T-175)
--      waba_id                    the WhatsApp Business Account the number is in
--      business_id                the Meta business portfolio (from Meta's message event)
--      verified_name              the name Meta shows for the number
--      number_kind                'new_number', or 'business_app' for a number that
--                                 stays on the WhatsApp Business app as well
--      token_expires_at           when the stored token stops working (60 days)
--      expiry_warned_at           when the business was last emailed about it
--      app_secret_encrypted       manual method only: the secret of the business's
--                                 OWN Meta app, which signs that app's webhook calls
--      registered_at              when the number was registered for the Cloud API
--                                 (null = Meta has not accepted the registration yet)
--      registration_pin_encrypted the two-step PIN set when the number was registered
--      messages_ready_at          Meta reported nothing blocking messages (a payment
--                                 method is in place), or a message went out
--      connected_at               when this connection was made
--    Every secret is stored encrypted by lib/whatsapp.ts, as the access token is.
--
-- 2. The table becomes server-only. Until now a signed-in user could read and
--    write their own row straight from the browser, including the encrypted
--    token and the phone number id the webhook routes by. Every read and write
--    now goes through the API routes (service role, scoped to the caller's own
--    tenant), which check with Meta that a number belongs to the token before a
--    row can name it.
--
-- Additive and re-runnable. No row is changed: existing rows are 'manual'.
-- Deploy ORDER: this first, then the web app (the new code reads the new
-- columns). The old web app only loses the ability to read the row from the
-- browser session; no business has a WhatsApp connection in production.

ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS connection_method TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS waba_id TEXT;
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS business_id TEXT;
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS verified_name TEXT;
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS number_kind TEXT;
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS expiry_warned_at TIMESTAMPTZ;
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS app_secret_encrypted TEXT;
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ;
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS registration_pin_encrypted TEXT;
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS messages_ready_at TIMESTAMPTZ;
ALTER TABLE whatsapp_configs ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ;

ALTER TABLE whatsapp_configs DROP CONSTRAINT IF EXISTS whatsapp_configs_connection_method_check;
ALTER TABLE whatsapp_configs ADD CONSTRAINT whatsapp_configs_connection_method_check
  CHECK (connection_method IN ('manual', 'embedded'));
ALTER TABLE whatsapp_configs DROP CONSTRAINT IF EXISTS whatsapp_configs_number_kind_check;
ALTER TABLE whatsapp_configs ADD CONSTRAINT whatsapp_configs_number_kind_check
  CHECK (number_kind IS NULL OR number_kind IN ('new_number', 'business_app'));
-- a connection made through Meta always knows its account
ALTER TABLE whatsapp_configs DROP CONSTRAINT IF EXISTS whatsapp_configs_embedded_has_account;
ALTER TABLE whatsapp_configs ADD CONSTRAINT whatsapp_configs_embedded_has_account
  CHECK (connection_method <> 'embedded' OR waba_id IS NOT NULL);

-- account events from Meta (the app was removed from an account) arrive by account id
CREATE INDEX IF NOT EXISTS idx_whatsapp_configs_waba ON whatsapp_configs (waba_id) WHERE waba_id IS NOT NULL;
-- the daily check for tokens about to expire
CREATE INDEX IF NOT EXISTS idx_whatsapp_configs_expiry ON whatsapp_configs (token_expires_at) WHERE token_expires_at IS NOT NULL;

COMMENT ON COLUMN whatsapp_configs.connection_method IS 'T-175: manual (the business''s own Meta app, T-112) or embedded (Meta Embedded Signup under the platform''s app)';
COMMENT ON COLUMN whatsapp_configs.waba_id IS 'T-175: WhatsApp Business Account id';
COMMENT ON COLUMN whatsapp_configs.token_expires_at IS 'T-175: when the stored access token expires; null = does not expire (manual permanent token)';
COMMENT ON COLUMN whatsapp_configs.app_secret_encrypted IS 'T-175: manual method only. The business''s own Meta app secret, encrypted; its webhook calls are signed with it';
COMMENT ON COLUMN whatsapp_configs.messages_ready_at IS 'T-175: set when Meta reports nothing blocking messages, or when a message was sent';

-- ---------- server-only ----------
DROP POLICY IF EXISTS "Users manage own tenant whatsapp config" ON whatsapp_configs;
REVOKE ALL ON whatsapp_configs FROM authenticated;
REVOKE ALL ON whatsapp_configs FROM anon;
-- "Service role has full access to whatsapp configs" (migration 25) stays.
