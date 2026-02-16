-- Migration: Quote Amendments, Feedback, and Learning Context
-- Supports quote editing, customer feedback, and amendment-based learning loop

-- Add new quote status values
ALTER TYPE quote_status ADD VALUE IF NOT EXISTS 'feedback_received' AFTER 'viewed';
ALTER TYPE quote_status ADD VALUE IF NOT EXISTS 'revised' AFTER 'feedback_received';

-- Add amendment tracking columns to quotes
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS business_notes TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS last_amended_at TIMESTAMPTZ;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS last_amended_by UUID REFERENCES auth.users(id);

COMMENT ON COLUMN quotes.business_notes IS 'Internal notes visible only to the business owner';
COMMENT ON COLUMN quotes.version IS 'Optimistic locking counter, incremented on each amendment';
COMMENT ON COLUMN quotes.last_amended_at IS 'Timestamp of the most recent amendment';
COMMENT ON COLUMN quotes.last_amended_by IS 'User who made the most recent amendment';

-- Quote feedback table (customer → business communication)
CREATE TABLE IF NOT EXISTS quote_feedback (
  id TEXT PRIMARY KEY DEFAULT generate_prefixed_id('fb'),
  quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('feedback', 'approval_request')),
  feedback_text TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'acknowledged', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_quote_feedback_quote ON quote_feedback(quote_id);
CREATE INDEX idx_quote_feedback_tenant ON quote_feedback(tenant_id);
CREATE INDEX idx_quote_feedback_status ON quote_feedback(tenant_id, status) WHERE status = 'pending';

COMMENT ON TABLE quote_feedback IS 'Customer feedback and review requests on quotes';
COMMENT ON COLUMN quote_feedback.feedback_type IS 'Type: feedback (free text) or approval_request (review request)';

-- RLS for quote_feedback
ALTER TABLE quote_feedback ENABLE ROW LEVEL SECURITY;

-- Authenticated business users can view/update their tenant feedback
CREATE POLICY "Users can view own tenant feedback"
  ON quote_feedback FOR SELECT
  USING (tenant_id = get_current_tenant_id());

CREATE POLICY "Users can update own tenant feedback"
  ON quote_feedback FOR UPDATE
  USING (tenant_id = get_current_tenant_id());

-- Public insert for customers (token verified in API layer)
CREATE POLICY "Public can insert feedback"
  ON quote_feedback FOR INSERT
  WITH CHECK (true);

-- Service role full access
CREATE POLICY "Service role has full access to feedback"
  ON quote_feedback FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

GRANT ALL ON quote_feedback TO authenticated;
GRANT INSERT ON quote_feedback TO anon;
GRANT ALL ON quote_feedback TO service_role;

-- Quote amendments table (edit history)
CREATE TABLE IF NOT EXISTS quote_amendments (
  id TEXT PRIMARY KEY DEFAULT generate_prefixed_id('amd'),
  quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  amended_by UUID NOT NULL REFERENCES auth.users(id),
  before_pricing JSONB NOT NULL,
  after_pricing JSONB NOT NULL,
  before_content JSONB NOT NULL,
  after_content JSONB NOT NULL,
  changes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'feedback_response')),
  feedback_id TEXT REFERENCES quote_feedback(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_quote_amendments_quote ON quote_amendments(quote_id);
CREATE INDEX idx_quote_amendments_tenant ON quote_amendments(tenant_id);
CREATE INDEX idx_quote_amendments_tenant_created ON quote_amendments(tenant_id, created_at DESC);

COMMENT ON TABLE quote_amendments IS 'Tracks all edits made to quotes with before/after snapshots';
COMMENT ON COLUMN quote_amendments.version IS 'Version number this amendment created';
COMMENT ON COLUMN quote_amendments.changes_json IS 'Structured diff: [{field, path, before, after, type}]';
COMMENT ON COLUMN quote_amendments.source IS 'What triggered this amendment: manual edit or feedback response';

-- RLS for quote_amendments
ALTER TABLE quote_amendments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant amendments"
  ON quote_amendments FOR SELECT
  USING (tenant_id = get_current_tenant_id());

CREATE POLICY "Users can insert amendments for own tenant"
  ON quote_amendments FOR INSERT
  WITH CHECK (tenant_id = get_current_tenant_id());

CREATE POLICY "Service role has full access to amendments"
  ON quote_amendments FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

GRANT ALL ON quote_amendments TO authenticated;
GRANT ALL ON quote_amendments TO service_role;

-- Tenant learning context table (AI improvement from amendment patterns)
CREATE TABLE IF NOT EXISTS tenant_learning_context (
  id TEXT PRIMARY KEY DEFAULT generate_prefixed_id('tlc'),
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  patterns_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  prompt_context TEXT,
  total_amendments_analyzed INTEGER NOT NULL DEFAULT 0,
  last_analyzed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, service_id)
);

CREATE INDEX idx_learning_context_tenant ON tenant_learning_context(tenant_id);
CREATE INDEX idx_learning_context_service ON tenant_learning_context(service_id);

COMMENT ON TABLE tenant_learning_context IS 'Aggregated amendment patterns per tenant+service for AI learning';
COMMENT ON COLUMN tenant_learning_context.patterns_json IS 'Detected amendment patterns: [{type, field, direction, frequency, avgMagnitude, description}]';
COMMENT ON COLUMN tenant_learning_context.prompt_context IS 'Natural-language context appended to AI wording prompts';

-- RLS for tenant_learning_context
ALTER TABLE tenant_learning_context ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tenant learning context"
  ON tenant_learning_context FOR SELECT
  USING (tenant_id = get_current_tenant_id());

CREATE POLICY "Users can manage own tenant learning context"
  ON tenant_learning_context FOR ALL
  USING (tenant_id = get_current_tenant_id());

CREATE POLICY "Service role has full access to learning context"
  ON tenant_learning_context FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

GRANT ALL ON tenant_learning_context TO authenticated;
GRANT ALL ON tenant_learning_context TO service_role;
