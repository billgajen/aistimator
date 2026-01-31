-- Migration: Add draft config, work steps, expected signals, and pricing traces
-- Supports the new Work-Step + Signals pricing model

-- ============================================================================
-- SERVICES: Add draft config and work-step configuration
-- ============================================================================

-- AI-generated draft configuration (complete starter blueprint)
ALTER TABLE services ADD COLUMN IF NOT EXISTS draft_config JSONB;

-- Version tracking for draft config updates
ALTER TABLE services ADD COLUMN IF NOT EXISTS draft_config_version INTEGER DEFAULT 0;

-- When the draft was generated
ALTER TABLE services ADD COLUMN IF NOT EXISTS draft_config_generated_at TIMESTAMPTZ;

-- Work steps configuration - array of standard operations with cost rules
-- Each step: { id, name, description, costType, cost, optional, triggerSignal, triggerCondition }
ALTER TABLE services ADD COLUMN IF NOT EXISTS work_steps JSONB DEFAULT '[]'::jsonb;

-- Expected signals - what AI should extract from photos/form
-- Each signal: { signalKey, type, possibleValues, description }
ALTER TABLE services ADD COLUMN IF NOT EXISTS expected_signals JSONB DEFAULT '[]'::jsonb;

-- Low confidence fallback mode configuration
-- Options: 'show_range' | 'require_review' | 'request_more_info' | 'recommend_site_visit'
ALTER TABLE services ADD COLUMN IF NOT EXISTS low_confidence_mode TEXT DEFAULT 'show_range';

-- Confidence threshold for triggering fallback (0-1 scale)
ALTER TABLE services ADD COLUMN IF NOT EXISTS confidence_threshold NUMERIC(3,2) DEFAULT 0.7;

-- High value threshold for triggering fallback (dollar amount)
ALTER TABLE services ADD COLUMN IF NOT EXISTS high_value_threshold NUMERIC(10,2);

-- ============================================================================
-- QUOTES: Add signals and pricing trace storage
-- ============================================================================

-- Full extracted signals from AI analysis
-- Contains: { extractedAt, overallConfidence, signals[], siteVisitRecommended, ... }
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS signals_json JSONB;

-- Complete pricing trace for debugging and transparency
-- Contains: { calculatedAt, configVersion, trace[], summary }
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS pricing_trace_json JSONB;

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Index for finding quotes that need review (low confidence fallback)
CREATE INDEX IF NOT EXISTS idx_quotes_status_signals
  ON quotes USING GIN (signals_json)
  WHERE status IN ('queued', 'generating');

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN services.draft_config IS 'AI-generated starter blueprint with scope, pricing model, work steps, and signals';
COMMENT ON COLUMN services.draft_config_version IS 'Version number for tracking draft config updates';
COMMENT ON COLUMN services.draft_config_generated_at IS 'Timestamp when the draft config was generated';
COMMENT ON COLUMN services.work_steps IS 'Array of work step configurations with cost rules';
COMMENT ON COLUMN services.expected_signals IS 'Array of signals AI should extract from photos/form';
COMMENT ON COLUMN services.low_confidence_mode IS 'How to handle low confidence: show_range, require_review, request_more_info, recommend_site_visit';
COMMENT ON COLUMN services.confidence_threshold IS 'Confidence level below which fallback mode is triggered (0-1)';
COMMENT ON COLUMN services.high_value_threshold IS 'Estimate amount above which fallback mode is triggered';

COMMENT ON COLUMN quotes.signals_json IS 'Complete extracted signals from AI analysis with per-field confidence';
COMMENT ON COLUMN quotes.pricing_trace_json IS 'Step-by-step pricing calculation trace for transparency';
