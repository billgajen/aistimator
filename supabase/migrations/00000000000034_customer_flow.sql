-- T-151: customer flow — contact first, unfinished requests, a next step after accept.
--
-- tenants.contact_requirement: which contact details a customer must give
--   ('email' = email required, phone optional — the default; 'phone' = phone
--   required, email optional; 'both'). At least one is always required.
-- quote_requests.customer_email: nullable, so a phone-only request can be made.
-- quotes.acceptance_json: what the customer told us when accepting (timing,
--   job address, phone) — only what they typed.
-- request_leads: a request saved the moment the contact step is done, updated
--   as the customer goes on. Becomes "finished" (quote_id + completed_at) when
--   the request is submitted. Never runs AI and never counts toward usage.
--
-- Additive and re-runnable.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS contact_requirement TEXT NOT NULL DEFAULT 'email';
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_contact_requirement_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_contact_requirement_check
  CHECK (contact_requirement IN ('email', 'phone', 'both'));
COMMENT ON COLUMN tenants.contact_requirement IS 'T-151: email | phone | both — which customer contact details are required';

ALTER TABLE quote_requests ALTER COLUMN customer_email DROP NOT NULL;

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS acceptance_json JSONB;
COMMENT ON COLUMN quotes.acceptance_json IS 'T-151: timing, job address and phone the customer gave when accepting';

CREATE TABLE IF NOT EXISTS request_leads (
  id TEXT PRIMARY KEY DEFAULT generate_prefixed_id('lead'),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_id TEXT REFERENCES services(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT,
  -- how far they got: contact | questions | photos | details
  progress TEXT NOT NULL DEFAULT 'contact',
  job_answers JSONB NOT NULL DEFAULT '[]'::jsonb,
  job_postcode TEXT,
  asset_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  lead_token_hash TEXT NOT NULL,
  quote_id TEXT REFERENCES quotes(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT request_leads_progress_check CHECK (progress IN ('contact', 'questions', 'photos', 'details')),
  CONSTRAINT request_leads_contact_check CHECK (customer_email IS NOT NULL OR customer_phone IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_request_leads_tenant_open ON request_leads (tenant_id, created_at DESC) WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_request_leads_tenant_email ON request_leads (tenant_id, customer_email) WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_request_leads_tenant_phone ON request_leads (tenant_id, customer_phone) WHERE completed_at IS NULL;

DROP TRIGGER IF EXISTS request_leads_updated_at ON request_leads;
CREATE TRIGGER request_leads_updated_at
  BEFORE UPDATE ON request_leads
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- The business reads its own leads; writes happen through the public API (service role)
ALTER TABLE request_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own request leads" ON request_leads;
CREATE POLICY "Users can view own request leads" ON request_leads
  FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
DROP POLICY IF EXISTS "Service role full access to request leads" ON request_leads;
CREATE POLICY "Service role full access to request leads" ON request_leads
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');
