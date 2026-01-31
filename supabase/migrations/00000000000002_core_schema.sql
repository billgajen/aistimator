-- Core Schema Migration
-- Creates all remaining tables for the Estimator platform

-- ============================================================================
-- TENANT SITES (for embed security)
-- ============================================================================
CREATE TABLE tenant_sites (
  id TEXT PRIMARY KEY DEFAULT generate_prefixed_id('site'),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  tenant_key TEXT NOT NULL UNIQUE DEFAULT generate_prefixed_id('tkey'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER tenant_sites_updated_at
  BEFORE UPDATE ON tenant_sites
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Indexes for tenant_sites
CREATE INDEX idx_tenant_sites_tenant_id ON tenant_sites(tenant_id);
CREATE INDEX idx_tenant_sites_tenant_key ON tenant_sites(tenant_key);
CREATE INDEX idx_tenant_sites_domain ON tenant_sites(domain);

-- ============================================================================
-- SERVICES
-- ============================================================================
CREATE TABLE services (
  id TEXT PRIMARY KEY DEFAULT generate_prefixed_id('svc'),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  document_type_default document_type NOT NULL DEFAULT 'instant_estimate',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER services_updated_at
  BEFORE UPDATE ON services
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_services_tenant_id ON services(tenant_id);

-- ============================================================================
-- SERVICE PRICING RULES
-- ============================================================================
CREATE TABLE service_pricing_rules (
  id TEXT PRIMARY KEY DEFAULT generate_prefixed_id('spr'),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  rules_json JSONB NOT NULL DEFAULT '{
    "baseFee": 0,
    "minimumCharge": 0,
    "addons": [],
    "multipliers": []
  }'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(service_id)
);

CREATE TRIGGER service_pricing_rules_updated_at
  BEFORE UPDATE ON service_pricing_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_service_pricing_rules_tenant_id ON service_pricing_rules(tenant_id);
CREATE INDEX idx_service_pricing_rules_service_id ON service_pricing_rules(service_id);

-- ============================================================================
-- WIDGET CONFIGS
-- ============================================================================
CREATE TABLE widget_configs (
  id TEXT PRIMARY KEY DEFAULT generate_prefixed_id('wc'),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_id TEXT REFERENCES services(id) ON DELETE CASCADE,
  config_json JSONB NOT NULL DEFAULT '{
    "fields": [],
    "files": {
      "minPhotos": 0,
      "maxPhotos": 8,
      "maxDocs": 3
    }
  }'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER widget_configs_updated_at
  BEFORE UPDATE ON widget_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_widget_configs_tenant_id ON widget_configs(tenant_id);
CREATE INDEX idx_widget_configs_service_id ON widget_configs(service_id);

-- ============================================================================
-- ASSETS (photos, documents, PDFs)
-- ============================================================================
CREATE TABLE assets (
  id TEXT PRIMARY KEY DEFAULT generate_prefixed_id('ast'),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quote_request_id TEXT,  -- Set when attached to a quote request
  type asset_type NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  r2_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_assets_tenant_id_created_at ON assets(tenant_id, created_at DESC);
CREATE INDEX idx_assets_quote_request_id ON assets(quote_request_id);

-- ============================================================================
-- QUOTE REQUESTS (raw customer submissions)
-- ============================================================================
CREATE TABLE quote_requests (
  id TEXT PRIMARY KEY DEFAULT generate_prefixed_id('qr'),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  job_postcode TEXT,
  job_address TEXT,
  job_answers JSONB NOT NULL DEFAULT '[]'::jsonb,
  asset_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quote_requests_tenant_id_created_at ON quote_requests(tenant_id, created_at DESC);
CREATE INDEX idx_quote_requests_customer_email ON quote_requests(customer_email);
CREATE INDEX idx_quote_requests_job_postcode ON quote_requests(job_postcode);
CREATE INDEX idx_quote_requests_service_id ON quote_requests(service_id);

-- ============================================================================
-- QUOTES (generated quote records)
-- ============================================================================
CREATE TABLE quotes (
  id TEXT PRIMARY KEY DEFAULT generate_prefixed_id('qte'),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quote_request_id TEXT NOT NULL REFERENCES quote_requests(id) ON DELETE RESTRICT,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  customer_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  pricing_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  document_type document_type NOT NULL DEFAULT 'instant_estimate',
  content_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status quote_status NOT NULL DEFAULT 'queued',
  quote_token_hash TEXT,
  token_expires_at TIMESTAMPTZ,
  pdf_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ
);

CREATE INDEX idx_quotes_tenant_id_created_at ON quotes(tenant_id, created_at DESC);
CREATE INDEX idx_quotes_tenant_id_status ON quotes(tenant_id, status);
CREATE INDEX idx_quotes_quote_request_id ON quotes(quote_request_id);
CREATE INDEX idx_quotes_quote_token_hash ON quotes(quote_token_hash);

-- ============================================================================
-- PLANS (subscription tiers)
-- ============================================================================
CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_estimate_limit INTEGER NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  features_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- SUBSCRIPTIONS
-- ============================================================================
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY DEFAULT generate_prefixed_id('sub'),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status subscription_status NOT NULL DEFAULT 'trialing',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id)
);

CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_subscriptions_tenant_id ON subscriptions(tenant_id);
CREATE INDEX idx_subscriptions_stripe_customer_id ON subscriptions(stripe_customer_id);
CREATE INDEX idx_subscriptions_stripe_subscription_id ON subscriptions(stripe_subscription_id);

-- ============================================================================
-- USAGE COUNTERS
-- ============================================================================
CREATE TABLE usage_counters (
  id TEXT PRIMARY KEY DEFAULT generate_prefixed_id('uc'),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_yyyymm TEXT NOT NULL,  -- e.g., '2026-01'
  estimates_created INTEGER NOT NULL DEFAULT 0,
  estimates_sent INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, period_yyyymm)
);

CREATE TRIGGER usage_counters_updated_at
  BEFORE UPDATE ON usage_counters
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX idx_usage_counters_tenant_id ON usage_counters(tenant_id);
CREATE INDEX idx_usage_counters_period ON usage_counters(period_yyyymm);

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================================

-- Enable RLS on all tenant-owned tables
ALTER TABLE tenant_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE widget_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;

-- Plans table is public read (no tenant restriction)
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Plans are publicly readable" ON plans
  FOR SELECT USING (true);

-- Tenant Sites policies
CREATE POLICY "Users can view own tenant sites" ON tenant_sites
  FOR SELECT USING (tenant_id = get_current_tenant_id());

CREATE POLICY "Users can insert own tenant sites" ON tenant_sites
  FOR INSERT WITH CHECK (tenant_id = get_current_tenant_id());

CREATE POLICY "Users can update own tenant sites" ON tenant_sites
  FOR UPDATE USING (tenant_id = get_current_tenant_id());

CREATE POLICY "Users can delete own tenant sites" ON tenant_sites
  FOR DELETE USING (tenant_id = get_current_tenant_id());

-- Services policies
CREATE POLICY "Users can view own services" ON services
  FOR SELECT USING (tenant_id = get_current_tenant_id());

CREATE POLICY "Users can insert own services" ON services
  FOR INSERT WITH CHECK (tenant_id = get_current_tenant_id());

CREATE POLICY "Users can update own services" ON services
  FOR UPDATE USING (tenant_id = get_current_tenant_id());

CREATE POLICY "Users can delete own services" ON services
  FOR DELETE USING (tenant_id = get_current_tenant_id());

-- Service Pricing Rules policies
CREATE POLICY "Users can view own pricing rules" ON service_pricing_rules
  FOR SELECT USING (tenant_id = get_current_tenant_id());

CREATE POLICY "Users can insert own pricing rules" ON service_pricing_rules
  FOR INSERT WITH CHECK (tenant_id = get_current_tenant_id());

CREATE POLICY "Users can update own pricing rules" ON service_pricing_rules
  FOR UPDATE USING (tenant_id = get_current_tenant_id());

CREATE POLICY "Users can delete own pricing rules" ON service_pricing_rules
  FOR DELETE USING (tenant_id = get_current_tenant_id());

-- Widget Configs policies
CREATE POLICY "Users can view own widget configs" ON widget_configs
  FOR SELECT USING (tenant_id = get_current_tenant_id());

CREATE POLICY "Users can insert own widget configs" ON widget_configs
  FOR INSERT WITH CHECK (tenant_id = get_current_tenant_id());

CREATE POLICY "Users can update own widget configs" ON widget_configs
  FOR UPDATE USING (tenant_id = get_current_tenant_id());

CREATE POLICY "Users can delete own widget configs" ON widget_configs
  FOR DELETE USING (tenant_id = get_current_tenant_id());

-- Assets policies
CREATE POLICY "Users can view own assets" ON assets
  FOR SELECT USING (tenant_id = get_current_tenant_id());

CREATE POLICY "Users can insert own assets" ON assets
  FOR INSERT WITH CHECK (tenant_id = get_current_tenant_id());

CREATE POLICY "Users can update own assets" ON assets
  FOR UPDATE USING (tenant_id = get_current_tenant_id());

CREATE POLICY "Users can delete own assets" ON assets
  FOR DELETE USING (tenant_id = get_current_tenant_id());

-- Quote Requests policies
CREATE POLICY "Users can view own quote requests" ON quote_requests
  FOR SELECT USING (tenant_id = get_current_tenant_id());

CREATE POLICY "Users can insert own quote requests" ON quote_requests
  FOR INSERT WITH CHECK (tenant_id = get_current_tenant_id());

CREATE POLICY "Users can update own quote requests" ON quote_requests
  FOR UPDATE USING (tenant_id = get_current_tenant_id());

-- Quotes policies
CREATE POLICY "Users can view own quotes" ON quotes
  FOR SELECT USING (tenant_id = get_current_tenant_id());

CREATE POLICY "Users can insert own quotes" ON quotes
  FOR INSERT WITH CHECK (tenant_id = get_current_tenant_id());

CREATE POLICY "Users can update own quotes" ON quotes
  FOR UPDATE USING (tenant_id = get_current_tenant_id());

-- Subscriptions policies
CREATE POLICY "Users can view own subscription" ON subscriptions
  FOR SELECT USING (tenant_id = get_current_tenant_id());

CREATE POLICY "Users can update own subscription" ON subscriptions
  FOR UPDATE USING (tenant_id = get_current_tenant_id());

-- Usage Counters policies
CREATE POLICY "Users can view own usage" ON usage_counters
  FOR SELECT USING (tenant_id = get_current_tenant_id());

-- ============================================================================
-- SERVICE ROLE POLICIES (for background jobs and admin operations)
-- ============================================================================

CREATE POLICY "Service role full access tenant_sites" ON tenant_sites
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access services" ON services
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access service_pricing_rules" ON service_pricing_rules
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access widget_configs" ON widget_configs
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access assets" ON assets
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access quote_requests" ON quote_requests
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access quotes" ON quotes
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access plans" ON plans
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access subscriptions" ON subscriptions
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access usage_counters" ON usage_counters
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- ============================================================================
-- PUBLIC ACCESS POLICIES (for widget submissions and quote viewing)
-- ============================================================================

-- Allow public to look up tenant by tenant_key (for widget)
CREATE POLICY "Public can lookup tenant by key" ON tenant_sites
  FOR SELECT USING (is_active = true);

-- Allow public to view active services (for widget)
CREATE POLICY "Public can view active services" ON services
  FOR SELECT USING (active = true);

-- Allow public to view widget configs
CREATE POLICY "Public can view widget configs" ON widget_configs
  FOR SELECT USING (true);

-- Allow public to insert assets (for widget uploads)
CREATE POLICY "Public can insert assets" ON assets
  FOR INSERT WITH CHECK (true);

-- Allow public to insert quote requests (widget submission)
CREATE POLICY "Public can insert quote requests" ON quote_requests
  FOR INSERT WITH CHECK (true);

-- Allow public to view quotes by token (for hosted quote page)
CREATE POLICY "Public can view quotes by token" ON quotes
  FOR SELECT USING (
    quote_token_hash IS NOT NULL
    AND (token_expires_at IS NULL OR token_expires_at > NOW())
  );

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE tenant_sites IS 'Allowed domains for widget embedding with public keys';
COMMENT ON TABLE services IS 'Services offered by each tenant';
COMMENT ON TABLE service_pricing_rules IS 'Pricing configuration for each service';
COMMENT ON TABLE widget_configs IS 'Form fields and file upload settings for widget';
COMMENT ON TABLE assets IS 'Uploaded files (photos, documents, generated PDFs)';
COMMENT ON TABLE quote_requests IS 'Raw customer submissions from widget';
COMMENT ON TABLE quotes IS 'Generated quotes with pricing and content';
COMMENT ON TABLE plans IS 'Subscription plan definitions';
COMMENT ON TABLE subscriptions IS 'Tenant subscription to a plan';
COMMENT ON TABLE usage_counters IS 'Monthly usage tracking per tenant';
