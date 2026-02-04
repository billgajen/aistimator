-- Quote Validation Logs
-- Stores validation results, corrections, and config suggestions for learning

-- Create quote_validation_logs table
CREATE TABLE IF NOT EXISTS quote_validation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Input snapshot for debugging and learning
  input_snapshot JSONB NOT NULL,
  -- { formAnswers, customerDescription, photoCount, serviceConfigVersion }

  -- Original quote before any corrections
  original_quote_snapshot JSONB NOT NULL,
  -- { total, breakdown, scopeSummary, assumptions, exclusions, notes, potentialWork, crossServices, addons }

  -- Validation results
  validation_result JSONB NOT NULL,
  -- { overallStatus, confidenceScore, issues[], summary, calculatedExpectedTotal, pricingGapPercent }

  -- Corrections that were applied
  corrections_applied JSONB,
  -- { appliedFixes[], correctedQuote }

  -- Outcome of validation
  outcome TEXT NOT NULL DEFAULT 'passed',
  -- 'auto_corrected' | 'sent_for_review' | 'passed' | 'blocked'

  -- Manual review info
  reviewed_by UUID REFERENCES auth.users(id),
  review_outcome TEXT,
  -- 'approved' | 'modified' | 'rejected'
  review_notes TEXT,
  reviewed_at TIMESTAMPTZ,

  -- Config suggestions for learning
  config_suggestions JSONB
  -- Array of { type, target, suggestion, wouldPrevent }
);

-- Indexes for efficient querying
CREATE INDEX idx_validation_logs_quote ON quote_validation_logs(quote_id);
CREATE INDEX idx_validation_logs_tenant ON quote_validation_logs(tenant_id);
CREATE INDEX idx_validation_logs_service ON quote_validation_logs(service_id);
CREATE INDEX idx_validation_logs_outcome ON quote_validation_logs(outcome);
CREATE INDEX idx_validation_logs_created ON quote_validation_logs(created_at DESC);

-- Composite index for tenant dashboard queries
CREATE INDEX idx_validation_logs_tenant_created ON quote_validation_logs(tenant_id, created_at DESC);

-- Index for finding unreviewed validation logs
CREATE INDEX idx_validation_logs_pending_review ON quote_validation_logs(tenant_id, outcome)
  WHERE outcome = 'sent_for_review' AND review_outcome IS NULL;

-- Add validation_settings JSONB column to tenants table
-- Note: requireManualReviewAbove = 0 means disabled (business must enable and set threshold)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS validation_settings JSONB DEFAULT '{
  "enabled": true,
  "onCriticalIssue": "auto_correct",
  "onHighIssue": "auto_correct",
  "onMediumIssue": "auto_correct",
  "onLowIssue": "pass_with_warning",
  "pricingGapThresholdPercent": 20,
  "requireManualReviewAbove": 0,
  "enabledChecks": {
    "pricingCompleteness": true,
    "scopeValidation": true,
    "potentialWorkValidation": true,
    "crossServiceValidation": true,
    "addonValidation": true,
    "notesValidation": true,
    "discountValidation": true,
    "logicValidation": true
  }
}'::jsonb;

-- Comment on table for documentation
COMMENT ON TABLE quote_validation_logs IS 'Stores quote validation results, corrections, and suggestions for continuous improvement';
COMMENT ON COLUMN quote_validation_logs.input_snapshot IS 'Snapshot of inputs: formAnswers, customerDescription, photoCount, serviceConfigVersion';
COMMENT ON COLUMN quote_validation_logs.original_quote_snapshot IS 'Snapshot of quote before any corrections';
COMMENT ON COLUMN quote_validation_logs.validation_result IS 'Full validation result: status, issues, summary';
COMMENT ON COLUMN quote_validation_logs.corrections_applied IS 'List of auto-corrections that were applied';
COMMENT ON COLUMN quote_validation_logs.outcome IS 'Validation outcome: auto_corrected, sent_for_review, passed, blocked';
COMMENT ON COLUMN quote_validation_logs.config_suggestions IS 'AI-suggested configuration improvements for learning';

-- RLS policies for quote_validation_logs
ALTER TABLE quote_validation_logs ENABLE ROW LEVEL SECURITY;

-- Users can only see validation logs for their tenant
CREATE POLICY "Users can view own tenant validation logs"
  ON quote_validation_logs
  FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM user_profiles WHERE id = auth.uid()
  ));

-- Users can insert validation logs for their tenant
CREATE POLICY "Users can insert validation logs for own tenant"
  ON quote_validation_logs
  FOR INSERT
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM user_profiles WHERE id = auth.uid()
  ));

-- Users can update validation logs for their tenant (for manual review)
CREATE POLICY "Users can update validation logs for own tenant"
  ON quote_validation_logs
  FOR UPDATE
  USING (tenant_id IN (
    SELECT tenant_id FROM user_profiles WHERE id = auth.uid()
  ));

-- Service role can do everything (for worker)
CREATE POLICY "Service role has full access to validation logs"
  ON quote_validation_logs
  FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- Grant permissions
GRANT ALL ON quote_validation_logs TO authenticated;
GRANT ALL ON quote_validation_logs TO service_role;
