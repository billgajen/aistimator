-- =============================================================================
-- ESTIMATOR PLATFORM - INITIAL SCHEMA
-- =============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- ENUMS
-- =============================================================================

CREATE TYPE service_area_mode AS ENUM ('none', 'postcode_allowlist', 'county_state');
CREATE TYPE document_type AS ENUM ('instant_estimate', 'formal_quote', 'proposal', 'sow');
CREATE TYPE quote_status AS ENUM ('queued', 'generating', 'sent', 'viewed', 'accepted', 'paid', 'expired', 'failed');
CREATE TYPE asset_type AS ENUM ('image', 'document', 'pdf');
CREATE TYPE subscription_status AS ENUM ('active', 'past_due', 'canceled', 'trialing');
CREATE TYPE whatsapp_message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE whatsapp_message_type AS ENUM ('text', 'image', 'document', 'template');
CREATE TYPE whatsapp_intake_state AS ENUM ('idle', 'awaiting_service', 'awaiting_name', 'awaiting_email', 'awaiting_phone', 'awaiting_address', 'awaiting_photos', 'awaiting_confirmation', 'processing', 'completed');

-- =============================================================================
-- CORE TABLES
-- =============================================================================

-- Tenants (businesses using the platform)
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'GBP',
  tax_enabled BOOLEAN NOT NULL DEFAULT false,
  tax_label TEXT,
  tax_rate NUMERIC(5,2) DEFAULT 0,
  service_area_mode service_area_mode NOT NULL DEFAULT 'none',
  service_area_values TEXT[] DEFAULT '{}',
  branding_json JSONB NOT NULL DEFAULT '{"logoAssetId": null, "primaryColor": "#2563eb", "footerNotes": null}',
  template_json JSONB NOT NULL DEFAULT '{"showLineItems": true, "includeAssumptions": true, "includeExclusions": true, "validityDays": 30}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User profiles (linked to Supabase Auth)
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner',
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tenant sites (domains/widget keys)
CREATE TABLE tenant_sites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  tenant_key TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Services offered by tenants
CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  document_type_default document_type NOT NULL DEFAULT 'instant_estimate',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pricing rules for services
CREATE TABLE service_pricing_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  rules_json JSONB NOT NULL DEFAULT '{"baseFee": 0, "minimumCharge": 0, "addons": [], "multipliers": []}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(service_id)
);

-- Widget configuration
CREATE TABLE widget_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_id UUID REFERENCES services(id) ON DELETE CASCADE,
  config_json JSONB NOT NULL DEFAULT '{"fields": [], "files": {"minPhotos": 0, "maxPhotos": 10, "maxDocs": 5}}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- ASSETS (Files stored in R2)
-- =============================================================================

CREATE TABLE assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quote_request_id UUID,
  type asset_type NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- QUOTE REQUESTS & QUOTES
-- =============================================================================

-- Quote requests (submissions from widget/WhatsApp)
CREATE TABLE quote_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  job_postcode TEXT,
  job_address TEXT,
  job_answers JSONB NOT NULL DEFAULT '[]',
  asset_ids UUID[] DEFAULT '{}',
  source_json JSONB NOT NULL DEFAULT '{"type": "widget"}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Quotes (generated from quote requests)
CREATE TABLE quotes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quote_request_id UUID NOT NULL REFERENCES quote_requests(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  customer_json JSONB NOT NULL,
  pricing_json JSONB NOT NULL,
  document_type document_type NOT NULL DEFAULT 'instant_estimate',
  content_json JSONB NOT NULL DEFAULT '{}',
  status quote_status NOT NULL DEFAULT 'queued',
  quote_token_hash TEXT,
  token_expires_at TIMESTAMPTZ,
  pdf_asset_id UUID REFERENCES assets(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ
);

-- Add foreign key from assets to quote_requests (after quote_requests exists)
ALTER TABLE assets ADD CONSTRAINT assets_quote_request_fk
  FOREIGN KEY (quote_request_id) REFERENCES quote_requests(id) ON DELETE SET NULL;

-- =============================================================================
-- BILLING & SUBSCRIPTIONS
-- =============================================================================

-- Plans
CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  monthly_estimate_limit INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  features_json JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Subscriptions
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
  plan_id UUID NOT NULL REFERENCES plans(id),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status subscription_status NOT NULL DEFAULT 'trialing',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Usage counters
CREATE TABLE usage_counters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_yyyymm TEXT NOT NULL,
  estimates_created INTEGER NOT NULL DEFAULT 0,
  estimates_sent INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, period_yyyymm)
);

-- =============================================================================
-- WHATSAPP INTEGRATION
-- =============================================================================

-- WhatsApp configurations per tenant
CREATE TABLE whatsapp_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
  phone_number_id TEXT NOT NULL,
  display_phone_number TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- WhatsApp conversations
CREATE TABLE whatsapp_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_phone TEXT NOT NULL,
  customer_name TEXT,
  quote_request_id UUID REFERENCES quote_requests(id),
  status TEXT NOT NULL DEFAULT 'active',
  intake_state whatsapp_intake_state NOT NULL DEFAULT 'idle',
  intake_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- WhatsApp messages
CREATE TABLE whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  wa_message_id TEXT,
  direction whatsapp_message_direction NOT NULL,
  message_type whatsapp_message_type NOT NULL,
  from_phone TEXT NOT NULL,
  to_phone TEXT NOT NULL,
  content TEXT,
  media_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- ADMIN & AUDIT
-- =============================================================================

-- Admin activity log
CREATE TABLE admin_activity_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX idx_user_profiles_tenant ON user_profiles(tenant_id);
CREATE INDEX idx_tenant_sites_tenant ON tenant_sites(tenant_id);
CREATE INDEX idx_tenant_sites_key ON tenant_sites(tenant_key);
CREATE INDEX idx_services_tenant ON services(tenant_id);
CREATE INDEX idx_assets_tenant ON assets(tenant_id);
CREATE INDEX idx_assets_quote_request ON assets(quote_request_id);
CREATE INDEX idx_quote_requests_tenant ON quote_requests(tenant_id);
CREATE INDEX idx_quote_requests_email ON quote_requests(customer_email);
CREATE INDEX idx_quotes_tenant ON quotes(tenant_id);
CREATE INDEX idx_quotes_status ON quotes(status);
CREATE INDEX idx_quotes_token ON quotes(quote_token_hash);
CREATE INDEX idx_subscriptions_tenant ON subscriptions(tenant_id);
CREATE INDEX idx_usage_counters_tenant_period ON usage_counters(tenant_id, period_yyyymm);
CREATE INDEX idx_whatsapp_conversations_tenant ON whatsapp_conversations(tenant_id);
CREATE INDEX idx_whatsapp_conversations_phone ON whatsapp_conversations(customer_phone);
CREATE INDEX idx_whatsapp_messages_conversation ON whatsapp_messages(conversation_id);

-- =============================================================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================================================

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE widget_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;

-- User can read their own profile
CREATE POLICY "Users can read own profile" ON user_profiles
  FOR SELECT USING (auth.uid() = id);

-- User can update their own profile
CREATE POLICY "Users can update own profile" ON user_profiles
  FOR UPDATE USING (auth.uid() = id);

-- Users can read their tenant
CREATE POLICY "Users can read own tenant" ON tenants
  FOR SELECT USING (
    id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

-- Users can update their tenant
CREATE POLICY "Users can update own tenant" ON tenants
  FOR UPDATE USING (
    id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

-- Tenant-scoped read policies
CREATE POLICY "Users can read tenant services" ON services
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can manage tenant services" ON services
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can read tenant sites" ON tenant_sites
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can manage tenant sites" ON tenant_sites
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can read pricing rules" ON service_pricing_rules
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can manage pricing rules" ON service_pricing_rules
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can read widget configs" ON widget_configs
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can manage widget configs" ON widget_configs
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can read tenant quotes" ON quotes
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can read tenant quote requests" ON quote_requests
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can read tenant assets" ON assets
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can read subscription" ON subscriptions
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can read usage" ON usage_counters
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "Anyone can read plans" ON plans
  FOR SELECT USING (is_active = true);

CREATE POLICY "Users can read whatsapp config" ON whatsapp_configs
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can manage whatsapp config" ON whatsapp_configs
  FOR ALL USING (
    tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can read whatsapp conversations" ON whatsapp_conversations
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "Users can read whatsapp messages" ON whatsapp_messages
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
  );

-- =============================================================================
-- DEFAULT DATA
-- =============================================================================

-- Insert default plans
INSERT INTO plans (name, monthly_estimate_limit, price_cents, features_json, is_active) VALUES
  ('Starter', 200, 2900, '{"pdf_generation": true, "email_notifications": true, "custom_branding": false, "priority_support": false, "api_access": false}', true),
  ('Growth', 1000, 7900, '{"pdf_generation": true, "email_notifications": true, "custom_branding": true, "priority_support": false, "api_access": true}', true),
  ('Pro', 3000, 19900, '{"pdf_generation": true, "email_notifications": true, "custom_branding": true, "priority_support": true, "api_access": true}', true);

-- =============================================================================
-- FUNCTIONS
-- =============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_tenant_sites_updated_at BEFORE UPDATE ON tenant_sites
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_services_updated_at BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_service_pricing_rules_updated_at BEFORE UPDATE ON service_pricing_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_widget_configs_updated_at BEFORE UPDATE ON widget_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_usage_counters_updated_at BEFORE UPDATE ON usage_counters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_whatsapp_configs_updated_at BEFORE UPDATE ON whatsapp_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_whatsapp_conversations_updated_at BEFORE UPDATE ON whatsapp_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
